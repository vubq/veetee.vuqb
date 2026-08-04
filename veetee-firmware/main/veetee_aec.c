#include "veetee_aec.h"

#include <string.h>

#ifndef CONFIG_VEETEE_AEC_ENABLED
#define CONFIG_VEETEE_AEC_ENABLED 0
#endif

#if CONFIG_VEETEE_AEC_ENABLED

#include "esp_afe_aec.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"

#define TAG "veetee-aec"
#define VT_AEC_SAMPLE_RATE 16000U
#define VT_AEC_MIN_REFERENCE_FRAMES 4U
#define VT_AEC_ALIGNMENT 16U

static size_t bounded_reference_capacity(const vt_aec_config_t *config, size_t frame_samples) {
    size_t requested = (size_t)config->reference_buffer_ms * VT_AEC_SAMPLE_RATE / 1000U;
    size_t minimum = frame_samples * VT_AEC_MIN_REFERENCE_FRAMES;
    return requested > minimum ? requested : minimum;
}

static void free_buffers(vt_aec_t *aec) {
    if (aec->aec_input != NULL) heap_caps_free(aec->aec_input);
    if (aec->aec_output != NULL) heap_caps_free(aec->aec_output);
    if (aec->reference_frame != NULL) heap_caps_free(aec->reference_frame);
    if (aec->resample_buffer != NULL) heap_caps_free(aec->resample_buffer);
    if (aec->reference_ring != NULL) heap_caps_free(aec->reference_ring);
    aec->aec_input = NULL;
    aec->aec_output = NULL;
    aec->reference_frame = NULL;
    aec->resample_buffer = NULL;
    aec->reference_ring = NULL;
}

static void release_handle(vt_aec_t *aec) {
    if (aec->handle != NULL) {
        afe_aec_destroy((afe_aec_handle_t *)aec->handle);
        aec->handle = NULL;
    }
}

static bool lock_take(vt_aec_t *aec) {
    return aec->reference_lock != NULL &&
           xSemaphoreTake((SemaphoreHandle_t)aec->reference_lock, pdMS_TO_TICKS(20)) == pdTRUE;
}

static void lock_give(vt_aec_t *aec) {
    if (aec->reference_lock != NULL) (void)xSemaphoreGive((SemaphoreHandle_t)aec->reference_lock);
}

static size_t resample_to_16k(vt_aec_t *aec, const int16_t *input, size_t input_count) {
    if (input_count == 0U || aec->resample_buffer == NULL || aec->resample_capacity == 0U) return 0U;
    if (aec->playback_sample_rate == (int)VT_AEC_SAMPLE_RATE) {
        size_t count = input_count < aec->resample_capacity ? input_count : aec->resample_capacity;
        memcpy(aec->resample_buffer, input, count * sizeof(*input));
        return count;
    }

    const uint64_t target_rate = VT_AEC_SAMPLE_RATE;
    const uint64_t source_rate = (uint64_t)aec->playback_sample_rate;
    const uint64_t input_span = (uint64_t)input_count * target_rate;
    uint64_t phase = aec->resample_phase;
    size_t produced = 0U;
    while (phase < input_span && produced < aec->resample_capacity) {
        size_t index = (size_t)(phase / target_rate);
        uint32_t fraction = (uint32_t)(phase % target_rate);
        int32_t first = input[index];
        int32_t second = index + 1U < input_count ? input[index + 1U] : input[index];
        int32_t value = (first * (int32_t)(target_rate - fraction) + second * (int32_t)fraction) /
                        (int32_t)target_rate;
        if (value > INT16_MAX) value = INT16_MAX;
        if (value < INT16_MIN) value = INT16_MIN;
        aec->resample_buffer[produced++] = (int16_t)value;
        phase += source_rate;
    }
    aec->resample_phase = phase >= input_span ? phase - input_span : 0U;
    aec->resample_previous = input[input_count - 1U];
    return produced;
}

int vt_aec_init(vt_aec_t *aec, const vt_aec_config_t *config) {
    if (aec == NULL || config == NULL || config->mic_sample_rate != (int)VT_AEC_SAMPLE_RATE ||
        config->playback_sample_rate <= 0 || config->max_playback_frame_samples <= 0 ||
        config->filter_length <= 0 || config->reference_buffer_ms <= 0) {
        return VT_AEC_ERR_INVALID_ARG;
    }
    memset(aec, 0, sizeof(*aec));

    afe_aec_handle_t *handle = afe_aec_create("MR", config->filter_length, AFE_TYPE_FD, AFE_MODE_LOW_COST);
    if (handle == NULL) {
        ESP_LOGE(TAG, "ESP-SR AEC create failed filter_length=%d", config->filter_length);
        return VT_AEC_ERR_MODEL;
    }
    int chunk_samples = afe_aec_get_chunksize(handle);
    if (chunk_samples <= 0) {
        ESP_LOGE(TAG, "ESP-SR AEC returned invalid chunk=%d", chunk_samples);
        afe_aec_destroy(handle);
        return VT_AEC_ERR_AUDIO;
    }

    size_t reference_capacity = bounded_reference_capacity(config, (size_t)chunk_samples);
    size_t resample_capacity = ((size_t)config->max_playback_frame_samples * VT_AEC_SAMPLE_RATE +
                                (size_t)config->playback_sample_rate - 1U) /
                               (size_t)config->playback_sample_rate + 2U;
    uint32_t caps = MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT;
    int16_t *input = heap_caps_aligned_calloc(VT_AEC_ALIGNMENT, (size_t)chunk_samples * 2U, sizeof(*input), caps);
    int16_t *output = heap_caps_aligned_calloc(VT_AEC_ALIGNMENT, (size_t)chunk_samples, sizeof(*output), caps);
    int16_t *reference_frame = heap_caps_aligned_calloc(VT_AEC_ALIGNMENT, (size_t)chunk_samples, sizeof(*reference_frame), caps);
    int16_t *resample_buffer = heap_caps_calloc(resample_capacity, sizeof(*resample_buffer), caps);
    int16_t *reference_ring = heap_caps_calloc(reference_capacity, sizeof(*reference_ring),
                                               MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    if (reference_ring == NULL) {
        reference_ring = heap_caps_calloc(reference_capacity, sizeof(*reference_ring), caps);
    }
    SemaphoreHandle_t lock = xSemaphoreCreateMutex();
    if (input == NULL || output == NULL || reference_frame == NULL || resample_buffer == NULL ||
        reference_ring == NULL || lock == NULL) {
        if (lock != NULL) vSemaphoreDelete(lock);
        if (input != NULL) heap_caps_free(input);
        if (output != NULL) heap_caps_free(output);
        if (reference_frame != NULL) heap_caps_free(reference_frame);
        if (resample_buffer != NULL) heap_caps_free(resample_buffer);
        if (reference_ring != NULL) heap_caps_free(reference_ring);
        afe_aec_destroy(handle);
        return VT_AEC_ERR_NO_MEM;
    }

    aec->handle = handle;
    aec->reference_lock = lock;
    aec->aec_input = input;
    aec->aec_output = output;
    aec->reference_frame = reference_frame;
    aec->resample_buffer = resample_buffer;
    aec->reference_ring = reference_ring;
    aec->frame_samples = (size_t)chunk_samples;
    aec->resample_capacity = resample_capacity;
    aec->reference_capacity = reference_capacity;
    aec->playback_sample_rate = config->playback_sample_rate;
    aec->ready = true;
    ESP_LOGI(TAG, "ready input=MR mic_rate=%u playback_rate=%d chunk=%u reference_samples=%u",
             (unsigned)VT_AEC_SAMPLE_RATE, config->playback_sample_rate,
             (unsigned)aec->frame_samples, (unsigned)aec->reference_capacity);
    return VT_AEC_OK;
}

void vt_aec_deinit(vt_aec_t *aec) {
    if (aec == NULL) return;
    release_handle(aec);
    free_buffers(aec);
    if (aec->reference_lock != NULL) vSemaphoreDelete((SemaphoreHandle_t)aec->reference_lock);
    memset(aec, 0, sizeof(*aec));
}

bool vt_aec_is_ready(const vt_aec_t *aec) {
    return aec != NULL && aec->ready && aec->handle != NULL && aec->frame_samples > 0U;
}

size_t vt_aec_frame_samples(const vt_aec_t *aec) {
    return vt_aec_is_ready(aec) ? aec->frame_samples : 0U;
}

int vt_aec_push_playback(vt_aec_t *aec, const int16_t *samples, size_t sample_count) {
    if (!vt_aec_is_ready(aec)) return VT_AEC_ERR_UNAVAILABLE;
    if (samples == NULL || sample_count == 0U) return VT_AEC_ERR_INVALID_ARG;
    size_t count = resample_to_16k(aec, samples, sample_count);
    if (count == 0U || !lock_take(aec)) return count == 0U ? VT_AEC_ERR_AUDIO : VT_AEC_ERR_NO_MEM;
    for (size_t index = 0; index < count; ++index) {
        if (aec->reference_count == aec->reference_capacity) {
            aec->reference_read = (aec->reference_read + 1U) % aec->reference_capacity;
            --aec->reference_count;
        }
        aec->reference_ring[aec->reference_write] = aec->resample_buffer[index];
        aec->reference_write = (aec->reference_write + 1U) % aec->reference_capacity;
        ++aec->reference_count;
    }
    lock_give(aec);
    return VT_AEC_OK;
}

static size_t pop_reference(vt_aec_t *aec, int16_t *destination, size_t count) {
    if (destination == NULL || count == 0U || !lock_take(aec)) {
        if (destination != NULL) memset(destination, 0, count * sizeof(*destination));
        return 0U;
    }
    size_t popped = 0U;
    while (popped < count && aec->reference_count > 0U) {
        destination[popped++] = aec->reference_ring[aec->reference_read];
        aec->reference_read = (aec->reference_read + 1U) % aec->reference_capacity;
        --aec->reference_count;
    }
    lock_give(aec);
    if (popped < count) memset(destination + popped, 0, (count - popped) * sizeof(*destination));
    return popped;
}

int vt_aec_process(vt_aec_t *aec, int16_t *samples, size_t sample_count) {
    if (!vt_aec_is_ready(aec)) return VT_AEC_ERR_UNAVAILABLE;
    if (samples == NULL || sample_count == 0U) return VT_AEC_ERR_INVALID_ARG;
    afe_aec_handle_t *handle = (afe_aec_handle_t *)aec->handle;
    for (size_t offset = 0; offset < sample_count; offset += aec->frame_samples) {
        size_t actual = sample_count - offset;
        if (actual > aec->frame_samples) actual = aec->frame_samples;
        memset(aec->aec_input, 0, aec->frame_samples * 2U * sizeof(*aec->aec_input));
        for (size_t index = 0; index < actual; ++index) {
            aec->aec_input[index * 2U] = samples[offset + index];
        }
        (void)pop_reference(aec, aec->reference_frame, actual);
        for (size_t index = 0; index < aec->frame_samples; ++index) {
            aec->aec_input[index * 2U + 1U] = index < actual ? aec->reference_frame[index] : 0;
        }
        size_t output_bytes = afe_aec_process(handle, aec->aec_input, aec->aec_output);
        if (output_bytes != aec->frame_samples * sizeof(*aec->aec_output)) {
            ESP_LOGW(TAG, "AEC process returned bytes=%u expected=%u", (unsigned)output_bytes,
                     (unsigned)(aec->frame_samples * sizeof(*aec->aec_output)));
            return VT_AEC_ERR_AUDIO;
        }
        memcpy(samples + offset, aec->aec_output, actual * sizeof(*samples));
    }
    return VT_AEC_OK;
}

void vt_aec_reset_reference(vt_aec_t *aec) {
    if (!vt_aec_is_ready(aec)) return;
    if (lock_take(aec)) {
        aec->reference_read = 0U;
        aec->reference_write = 0U;
        aec->reference_count = 0U;
        lock_give(aec);
    }
    aec->resample_phase = 0U;
    aec->resample_previous = 0;
}

#else

int vt_aec_init(vt_aec_t *aec, const vt_aec_config_t *config) {
    (void)config;
    if (aec == NULL) return VT_AEC_ERR_INVALID_ARG;
    memset(aec, 0, sizeof(*aec));
    return VT_AEC_ERR_UNAVAILABLE;
}

void vt_aec_deinit(vt_aec_t *aec) {
    if (aec != NULL) memset(aec, 0, sizeof(*aec));
}

bool vt_aec_is_ready(const vt_aec_t *aec) {
    (void)aec;
    return false;
}

size_t vt_aec_frame_samples(const vt_aec_t *aec) {
    (void)aec;
    return 0U;
}

int vt_aec_push_playback(vt_aec_t *aec, const int16_t *samples, size_t sample_count) {
    (void)aec;
    (void)samples;
    (void)sample_count;
    return VT_AEC_ERR_UNAVAILABLE;
}

int vt_aec_process(vt_aec_t *aec, int16_t *samples, size_t sample_count) {
    (void)aec;
    (void)samples;
    (void)sample_count;
    return VT_AEC_ERR_UNAVAILABLE;
}

void vt_aec_reset_reference(vt_aec_t *aec) {
    (void)aec;
}

#endif
