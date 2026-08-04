#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

/*
 * Wake detection is deliberately exposed as a small product-owned interface.
 * The current ESP32-S3 implementation is backed by ESP-SR/WakeNet, while
 * host tests and a future signed custom model can use the same lifecycle.
 */
enum {
    VT_WAKE_OK = 0,
    VT_WAKE_ERR_INVALID_ARG = -1,
    VT_WAKE_ERR_UNAVAILABLE = -2,
    VT_WAKE_ERR_NO_MEM = -3,
    VT_WAKE_ERR_MODEL = -4,
    VT_WAKE_ERR_AUDIO = -5,
};

typedef struct {
    const char *partition_label;
    const char *model_name;
    unsigned int threshold_percent;
    unsigned int detection_mode;
    size_t input_buffer_samples;
} vt_wake_config_t;

typedef struct {
    bool detected;
    unsigned int word_index;
    char phrase[64];
} vt_wake_event_t;

typedef struct {
    void *models;
    const void *interface_handle;
    void *model_data;
    int16_t *input_buffer;
    size_t input_capacity;
    size_t input_size;
    size_t chunk_samples;
    unsigned int word_count;
    unsigned int threshold_percent;
    unsigned int detection_mode;
    bool ready;
    bool armed;
    char model_name[64];
} vt_wake_t;

int vt_wake_init(vt_wake_t *wake, const vt_wake_config_t *config);
void vt_wake_deinit(vt_wake_t *wake);
int vt_wake_feed(vt_wake_t *wake, const int16_t *samples, size_t sample_count, vt_wake_event_t *event);
int vt_wake_arm(vt_wake_t *wake);
int vt_wake_disarm(vt_wake_t *wake);
bool vt_wake_is_ready(const vt_wake_t *wake);
const char *vt_wake_model_name(const vt_wake_t *wake);
