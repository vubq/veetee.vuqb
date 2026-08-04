#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

enum {
    VT_AEC_OK = 0,
    VT_AEC_ERR_INVALID_ARG = -1,
    VT_AEC_ERR_UNAVAILABLE = -2,
    VT_AEC_ERR_NO_MEM = -3,
    VT_AEC_ERR_MODEL = -4,
    VT_AEC_ERR_AUDIO = -5,
};

typedef struct {
    int mic_sample_rate;
    int playback_sample_rate;
    int max_playback_frame_samples;
    int filter_length;
    int reference_buffer_ms;
} vt_aec_config_t;

/*
 * The implementation is intentionally opaque to the rest of the firmware.
 * ESP-SR owns the adaptive filter; this module owns bounded reference storage
 * and the 24 kHz speaker -> 16 kHz AEC resampling boundary.
 */
typedef struct {
    void *handle;
    void *reference_lock;
    int16_t *aec_input;
    int16_t *aec_output;
    int16_t *reference_frame;
    int16_t *resample_buffer;
    int16_t *reference_ring;
    size_t frame_samples;
    size_t resample_capacity;
    size_t reference_capacity;
    size_t reference_read;
    size_t reference_write;
    size_t reference_count;
    uint64_t resample_phase;
    int16_t resample_previous;
    int playback_sample_rate;
    bool ready;
} vt_aec_t;

int vt_aec_init(vt_aec_t *aec, const vt_aec_config_t *config);
void vt_aec_deinit(vt_aec_t *aec);
bool vt_aec_is_ready(const vt_aec_t *aec);
size_t vt_aec_frame_samples(const vt_aec_t *aec);

/* Add decoded speaker PCM to the bounded 16 kHz far-end reference ring. */
int vt_aec_push_playback(vt_aec_t *aec, const int16_t *samples, size_t sample_count);

/* Process microphone samples in-place; partial final AEC blocks are padded. */
int vt_aec_process(vt_aec_t *aec, int16_t *samples, size_t sample_count);

/* Drop stale far-end samples after abort/turn ownership changes. */
void vt_aec_reset_reference(vt_aec_t *aec);
