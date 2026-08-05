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
    size_t delay = (size_t)config->reference_delay_ms * VT_AEC_SAMPLE_RATE / 1000U;
    size_t minimum = frame_samples * VT_AEC_MIN_REFERENCE_FRAMES;
    size_t retained = requested > minimum ? requested : minimum;
    return retained <= SIZE_MAX - delay ? retained + delay : 0U;
}

static void free_buffers(vt_aec_t *aec) {
    if (aec->aec_input != NULL) heap_caps_free(aec->aec_input);
    if (aec->aec_output != NULL) heap_caps_free(aec->aec_output);
    if (aec->reference_frame != NULL) heap_caps_free(aec->reference_frame);
    if (aec->resample_buffer != NULL) heap_caps_free(aec->resample_buffer);
    if (aec->reference.storage != NULL) heap_caps_free(aec->reference.storage);
    aec->aec_input = NULL;
    aec->aec_output = NULL;
    aec->reference_frame = NULL;
    aec->resample_buffer = NULL;
    aec->reference.storage = NULL;
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

int vt_aec_init(vt_aec_t *aec, const vt_aec_config_t *config) {
    if (aec == NULL || config == NULL || config->mic_sample_rate != (int)VT_AEC_SAMPLE_RATE ||
        config->playback_sample_rate <= 0 || config->max_playback_frame_samples <= 0 ||
        config->filter_length <= 0 || config->reference_buffer_ms <= 0 ||
        config->reference_delay_ms < 0 || config->reference_delay_ms > 500) {
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
    size_t reference_delay = (size_t)config->reference_delay_ms * VT_AEC_SAMPLE_RATE / 1000U;
    if (reference_capacity == 0U || reference_delay >= reference_capacity) {
        ESP_LOGE(TAG, "invalid reference capacity=%u delay_samples=%u", (unsigned)reference_capacity,
                 (unsigned)reference_delay);
        afe_aec_destroy(handle);
        return VT_AEC_ERR_INVALID_ARG;
    }
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
    aec->frame_samples = (size_t)chunk_samples;
    aec->resample_capacity = resample_capacity;
    aec->playback_sample_rate = config->playback_sample_rate;
    if (vt_aec_reference_init(&aec->reference, reference_ring, reference_capacity, reference_delay) != 0 ||
        vt_aec_resampler_init(&aec->resampler, (uint32_t)config->playback_sample_rate, VT_AEC_SAMPLE_RATE) != 0) {
        vSemaphoreDelete(lock);
        heap_caps_free(input);
        heap_caps_free(output);
        heap_caps_free(reference_frame);
        heap_caps_free(resample_buffer);
        heap_caps_free(reference_ring);
        afe_aec_destroy(handle);
        return VT_AEC_ERR_INVALID_ARG;
    }
    aec->ready = true;
    ESP_LOGI(TAG, "ready input=MR mic_rate=%u playback_rate=%d chunk=%u reference_samples=%u delay_samples=%u",
             (unsigned)VT_AEC_SAMPLE_RATE, config->playback_sample_rate,
             (unsigned)aec->frame_samples, (unsigned)reference_capacity, (unsigned)reference_delay);
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
    if (!lock_take(aec)) return VT_AEC_ERR_NO_MEM;
    size_t count = vt_aec_resampler_process(&aec->resampler, samples, sample_count,
                                            aec->resample_buffer, aec->resample_capacity);
    size_t pushed = count == 0U ? 0U : vt_aec_reference_push(&aec->reference, aec->resample_buffer, count);
    lock_give(aec);
    return pushed == count && count > 0U ? VT_AEC_OK : VT_AEC_ERR_AUDIO;
}

static size_t pop_reference(vt_aec_t *aec, int16_t *destination, size_t count) {
    if (destination == NULL || count == 0U || !lock_take(aec)) {
        if (destination != NULL) memset(destination, 0, count * sizeof(*destination));
        return 0U;
    }
    size_t popped = vt_aec_reference_pop(&aec->reference, destination, count);
    lock_give(aec);
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
        vt_aec_reference_reset(&aec->reference);
        vt_aec_resampler_reset(&aec->resampler);
        lock_give(aec);
    }
}

void vt_aec_get_stats(vt_aec_t *aec, vt_aec_stats_t *stats) {
    if (stats == NULL) return;
    memset(stats, 0, sizeof(*stats));
    if (!vt_aec_is_ready(aec) || !lock_take(aec)) return;
    vt_aec_reference_get_stats(&aec->reference, stats);
    lock_give(aec);
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

void vt_aec_get_stats(vt_aec_t *aec, vt_aec_stats_t *stats) {
    (void)aec;
    if (stats != NULL) memset(stats, 0, sizeof(*stats));
}

#endif
