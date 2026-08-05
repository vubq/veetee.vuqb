#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

typedef struct {
    uint32_t delay_samples;
    uint32_t depth_samples;
    uint32_t peak_depth_samples;
    uint32_t producer_samples;
    uint32_t consumer_samples;
    uint32_t underrun_count;
    uint32_t overrun_count;
    uint32_t processed_frames;
    uint32_t reset_count;
} vt_aec_reference_stats_t;

typedef struct {
    int16_t *storage;
    size_t capacity;
    size_t delay_samples;
    size_t read;
    size_t write;
    size_t count;
    vt_aec_reference_stats_t stats;
} vt_aec_reference_t;

typedef struct {
    uint32_t source_rate;
    uint32_t target_rate;
    uint64_t phase;
    int16_t previous;
} vt_aec_resampler_t;

int vt_aec_reference_init(vt_aec_reference_t *reference, int16_t *storage,
                          size_t capacity, size_t delay_samples);
size_t vt_aec_reference_push(vt_aec_reference_t *reference, const int16_t *samples,
                             size_t sample_count);
size_t vt_aec_reference_pop(vt_aec_reference_t *reference, int16_t *destination,
                            size_t sample_count);
void vt_aec_reference_reset(vt_aec_reference_t *reference);
void vt_aec_reference_get_stats(const vt_aec_reference_t *reference,
                                vt_aec_reference_stats_t *stats);

int vt_aec_resampler_init(vt_aec_resampler_t *resampler, uint32_t source_rate,
                          uint32_t target_rate);
size_t vt_aec_resampler_process(vt_aec_resampler_t *resampler, const int16_t *input,
                                size_t input_count, int16_t *output,
                                size_t output_capacity);
void vt_aec_resampler_reset(vt_aec_resampler_t *resampler);
