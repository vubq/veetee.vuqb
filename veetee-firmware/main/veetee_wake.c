#include "veetee_wake.h"

#include <stdio.h>
#include <string.h>

#ifndef CONFIG_VEETEE_WAKE_ENABLED
#define CONFIG_VEETEE_WAKE_ENABLED 0
#endif

#if CONFIG_VEETEE_WAKE_ENABLED

#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_wn_iface.h"
#include "esp_wn_models.h"
#include "model_path.h"

#define TAG "veetee-wake"
#define VT_WAKE_MIN_BUFFER_SAMPLES 512U

static void release_runtime(vt_wake_t *wake) {
    if (wake->model_data != NULL && wake->interface_handle != NULL) {
        const esp_wn_iface_t *iface = (const esp_wn_iface_t *)wake->interface_handle;
        iface->destroy((model_iface_data_t *)wake->model_data);
    }
    if (wake->models != NULL) {
        esp_srmodel_deinit((srmodel_list_t *)wake->models);
    }
    if (wake->input_buffer != NULL) {
        heap_caps_free(wake->input_buffer);
    }
    wake->models = NULL;
    wake->interface_handle = NULL;
    wake->model_data = NULL;
    wake->model_key = NULL;
    wake->input_buffer = NULL;
    wake->input_capacity = 0U;
    wake->input_size = 0U;
    wake->chunk_samples = 0U;
    wake->word_count = 0U;
    wake->ready = false;
    wake->armed = false;
}

int vt_wake_init(vt_wake_t *wake, const vt_wake_config_t *config) {
    if (wake == NULL || config == NULL || config->partition_label == NULL ||
        config->model_name == NULL || config->model_name[0] == '\0') {
        return VT_WAKE_ERR_INVALID_ARG;
    }
    memset(wake, 0, sizeof(*wake));
    wake->threshold_percent = config->threshold_percent;
    wake->detection_mode = config->detection_mode;

    srmodel_list_t *models = esp_srmodel_init(config->partition_label);
    if (models == NULL || models->num <= 0) {
        ESP_LOGE(TAG, "wake model partition unavailable label=%s", config->partition_label);
        if (models != NULL) esp_srmodel_deinit(models);
        return VT_WAKE_ERR_MODEL;
    }
    int model_index = esp_srmodel_exists(models, (char *)config->model_name);
    if (model_index < 0) {
        ESP_LOGE(TAG, "wake model not found name=%s", config->model_name);
        esp_srmodel_deinit(models);
        return VT_WAKE_ERR_MODEL;
    }

    srmodel_data_t *selected_model_data = models->model_data == NULL
        ? NULL
        : models->model_data[model_index];
    ESP_LOGI(TAG, "model manifest index=%d name=%s info=%p data=%p files=%d",
             model_index, models->model_name[model_index],
             (void *)models->model_info[model_index],
             (void *)selected_model_data,
             selected_model_data == NULL ? 0 : selected_model_data->num);
    if (selected_model_data == NULL || models->model_info[model_index] == NULL) {
        ESP_LOGE(TAG, "wake model manifest is incomplete; refusing model create");
        esp_srmodel_deinit(models);
        return VT_WAKE_ERR_MODEL;
    }
    ESP_LOGI(TAG, "model manifest text=%s wake_words=%s",
             models->model_info[model_index],
             esp_srmodel_get_wake_words(models, models->model_name[model_index]));
    for (int file_index = 0; file_index < selected_model_data->num; ++file_index) {
        ESP_LOGI(TAG, "model file[%d] name=%s data=%p size=%d",
                 file_index, selected_model_data->files[file_index],
                 selected_model_data->data[file_index],
                 selected_model_data->sizes[file_index]);
    }

    /* ESP-SR's prebuilt model loader uses the canonical name stored in the
       loaded manifest. Keep that pointer instead of passing an independent
       sdkconfig string into the binary model implementation. */
    char *selected_model_name = models->model_name[model_index];

    const esp_wn_iface_t *iface = esp_wn_handle_from_name(selected_model_name);
    if (iface == NULL || iface->create == NULL || iface->detect == NULL || iface->destroy == NULL) {
        ESP_LOGE(TAG, "wake interface unavailable name=%s", config->model_name);
        esp_srmodel_deinit(models);
        return VT_WAKE_ERR_MODEL;
    }

    det_mode_t mode = config->detection_mode == 95U ? DET_MODE_95 : DET_MODE_90;
    model_iface_data_t *model_data = iface->create(selected_model_name, mode);
    if (model_data == NULL) {
        ESP_LOGE(TAG, "wake model create failed name=%s", config->model_name);
        esp_srmodel_deinit(models);
        return VT_WAKE_ERR_MODEL;
    }

    int sample_rate = iface->get_samp_rate == NULL ? 0 : iface->get_samp_rate(model_data);
    int chunk_samples = iface->get_samp_chunksize == NULL ? 0 : iface->get_samp_chunksize(model_data);
    int word_count = iface->get_word_num == NULL ? 0 : iface->get_word_num(model_data);
    if (sample_rate != 16000 || chunk_samples <= 0 || word_count <= 0) {
        ESP_LOGE(TAG, "wake audio contract invalid rate=%d chunk=%d words=%d", sample_rate, chunk_samples, word_count);
        iface->destroy(model_data);
        esp_srmodel_deinit(models);
        return VT_WAKE_ERR_AUDIO;
    }

    size_t capacity = config->input_buffer_samples;
    if (capacity < (size_t)chunk_samples + VT_WAKE_MIN_BUFFER_SAMPLES) {
        capacity = (size_t)chunk_samples + VT_WAKE_MIN_BUFFER_SAMPLES;
    }
    int16_t *input = heap_caps_calloc(capacity, sizeof(*input), MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    if (input == NULL) {
        input = heap_caps_calloc(capacity, sizeof(*input), MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
    }
    if (input == NULL) {
        ESP_LOGE(TAG, "wake input buffer allocation failed samples=%u", (unsigned)capacity);
        iface->destroy(model_data);
        esp_srmodel_deinit(models);
        return VT_WAKE_ERR_NO_MEM;
    }

    if (config->threshold_percent >= 40U && config->threshold_percent <= 99U && iface->set_det_threshold != NULL) {
        float threshold = (float)config->threshold_percent / 100.0F;
        for (int word = 1; word <= word_count; ++word) {
            (void)iface->set_det_threshold(model_data, threshold, word);
        }
    }

    wake->models = models;
    wake->interface_handle = iface;
    wake->model_data = model_data;
    wake->model_key = selected_model_name;
    wake->input_buffer = input;
    wake->input_capacity = capacity;
    wake->chunk_samples = (size_t)chunk_samples;
    wake->word_count = (unsigned int)word_count;
    wake->ready = true;
    wake->armed = true;
    (void)snprintf(wake->model_name, sizeof(wake->model_name), "%s", selected_model_name);
    ESP_LOGI(TAG, "ready model=%s rate=%d chunk=%d words=%d buffer=%u threshold=%u mode=%u",
             wake->model_name, sample_rate, chunk_samples, word_count, (unsigned)capacity,
             config->threshold_percent, config->detection_mode);
    return VT_WAKE_OK;
}

void vt_wake_deinit(vt_wake_t *wake) {
    if (wake == NULL) return;
    release_runtime(wake);
    memset(wake->model_name, 0, sizeof(wake->model_name));
}

int vt_wake_feed(vt_wake_t *wake, const int16_t *samples, size_t sample_count, vt_wake_event_t *event) {
    if (event != NULL) memset(event, 0, sizeof(*event));
    if (wake == NULL || samples == NULL || sample_count == 0U || event == NULL) return VT_WAKE_ERR_INVALID_ARG;
    if (!wake->ready || !wake->armed) return VT_WAKE_OK;
    if (sample_count > wake->input_capacity) return VT_WAKE_ERR_AUDIO;

    const esp_wn_iface_t *iface = (const esp_wn_iface_t *)wake->interface_handle;
    size_t offset = 0U;
    while (offset < sample_count) {
        size_t available = wake->input_capacity - wake->input_size;
        size_t copy_count = sample_count - offset;
        if (copy_count > available) copy_count = available;
        memcpy(wake->input_buffer + wake->input_size, samples + offset, copy_count * sizeof(*samples));
        wake->input_size += copy_count;
        offset += copy_count;

        while (wake->input_size >= wake->chunk_samples) {
            int result = (int)iface->detect((model_iface_data_t *)wake->model_data, wake->input_buffer);
            size_t remaining = wake->input_size - wake->chunk_samples;
            if (remaining > 0U) {
                memmove(wake->input_buffer, wake->input_buffer + wake->chunk_samples, remaining * sizeof(*samples));
            }
            wake->input_size = remaining;
            if (result > 0 && result <= (int)wake->word_count) {
                event->detected = true;
                event->word_index = (unsigned int)result;
                if (iface->get_word_name != NULL) {
                    char *name = iface->get_word_name((model_iface_data_t *)wake->model_data, result);
                    if (name != NULL) (void)snprintf(event->phrase, sizeof(event->phrase), "%s", name);
                }
                wake->armed = false;
                wake->input_size = 0U;
                return VT_WAKE_OK;
            }
        }
    }
    return VT_WAKE_OK;
}

int vt_wake_arm(vt_wake_t *wake) {
    if (wake == NULL) return VT_WAKE_ERR_INVALID_ARG;
    if (!wake->ready) return VT_WAKE_ERR_UNAVAILABLE;
    if (wake->interface_handle == NULL || wake->model_data == NULL || wake->model_key == NULL) return VT_WAKE_ERR_MODEL;

    const esp_wn_iface_t *iface = (const esp_wn_iface_t *)wake->interface_handle;
    if (iface->destroy == NULL || iface->create == NULL || iface->get_samp_rate == NULL ||
        iface->get_samp_chunksize == NULL || iface->get_word_num == NULL) {
        wake->ready = false;
        wake->armed = false;
        return VT_WAKE_ERR_MODEL;
    }

    /* The preset's clean() is unsafe after detection (it dereferences a
       released convolution queue). Recreate the single model instance instead
       so the next turn gets a fresh internal state without accumulating model
       allocations across a long session. */
    model_iface_data_t *previous = (model_iface_data_t *)wake->model_data;
    wake->model_data = NULL;
    wake->armed = false;
    iface->destroy(previous);
    det_mode_t mode = wake->detection_mode == 95U ? DET_MODE_95 : DET_MODE_90;
    model_iface_data_t *model = iface->create(wake->model_key, mode);
    if (model == NULL) {
        wake->ready = false;
        return VT_WAKE_ERR_MODEL;
    }

    int sample_rate = iface->get_samp_rate(model);
    int chunk_samples = iface->get_samp_chunksize(model);
    int word_count = iface->get_word_num(model);
    if (sample_rate != 16000 || chunk_samples <= 0 || word_count <= 0 ||
        (size_t)chunk_samples > wake->input_capacity) {
        iface->destroy(model);
        wake->ready = false;
        return VT_WAKE_ERR_AUDIO;
    }
    if (wake->threshold_percent >= 40U && wake->threshold_percent <= 99U && iface->set_det_threshold != NULL) {
        float threshold = (float)wake->threshold_percent / 100.0F;
        for (int word = 1; word <= word_count; ++word) (void)iface->set_det_threshold(model, threshold, word);
    }
    wake->model_data = model;
    wake->chunk_samples = (size_t)chunk_samples;
    wake->word_count = (unsigned int)word_count;
    wake->input_size = 0U;
    wake->armed = true;
    return VT_WAKE_OK;
}

int vt_wake_disarm(vt_wake_t *wake) {
    if (wake == NULL) return VT_WAKE_ERR_INVALID_ARG;
    wake->armed = false;
    wake->input_size = 0U;
    return VT_WAKE_OK;
}

#else

int vt_wake_init(vt_wake_t *wake, const vt_wake_config_t *config) {
    (void)config;
    if (wake == NULL) return VT_WAKE_ERR_INVALID_ARG;
    memset(wake, 0, sizeof(*wake));
    return VT_WAKE_ERR_UNAVAILABLE;
}

void vt_wake_deinit(vt_wake_t *wake) {
    if (wake != NULL) memset(wake, 0, sizeof(*wake));
}

int vt_wake_feed(vt_wake_t *wake, const int16_t *samples, size_t sample_count, vt_wake_event_t *event) {
    (void)wake;
    (void)samples;
    (void)sample_count;
    if (event != NULL) memset(event, 0, sizeof(*event));
    return VT_WAKE_ERR_UNAVAILABLE;
}

int vt_wake_arm(vt_wake_t *wake) {
    return wake == NULL ? VT_WAKE_ERR_INVALID_ARG : VT_WAKE_ERR_UNAVAILABLE;
}

int vt_wake_disarm(vt_wake_t *wake) {
    return wake == NULL ? VT_WAKE_ERR_INVALID_ARG : VT_WAKE_ERR_UNAVAILABLE;
}

#endif

bool vt_wake_is_ready(const vt_wake_t *wake) {
    return wake != NULL && wake->ready;
}

const char *vt_wake_model_name(const vt_wake_t *wake) {
    return wake == NULL ? "" : wake->model_name;
}
