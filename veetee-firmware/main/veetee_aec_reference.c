#include "veetee_aec_reference.h"

#include <limits.h>
#include <string.h>

static uint32_t saturating_add(uint32_t value, size_t amount) {
    if (amount > (size_t)(UINT32_MAX - value)) return UINT32_MAX;
    return value + (uint32_t)amount;
}

static uint32_t saturating_increment(uint32_t value) {
    return value == UINT32_MAX ? value : value + 1U;
}

int vt_aec_reference_init(vt_aec_reference_t *reference, int16_t *storage,
                          size_t capacity, size_t delay_samples) {
    if (reference == NULL || storage == NULL || capacity == 0U || delay_samples >= capacity ||
        delay_samples > UINT32_MAX || capacity > UINT32_MAX) {
        return -1;
    }
    memset(reference, 0, sizeof(*reference));
    reference->storage = storage;
    reference->capacity = capacity;
    reference->delay_samples = delay_samples;
    reference->stats.delay_samples = (uint32_t)delay_samples;
    return 0;
}

size_t vt_aec_reference_push(vt_aec_reference_t *reference, const int16_t *samples,
                             size_t sample_count) {
    if (reference == NULL || reference->storage == NULL || samples == NULL || sample_count == 0U) return 0U;
    size_t pushed = 0U;
    for (; pushed < sample_count; ++pushed) {
        if (reference->count == reference->capacity) {
            reference->read = (reference->read + 1U) % reference->capacity;
            --reference->count;
            reference->stats.overrun_count = saturating_increment(reference->stats.overrun_count);
        }
        reference->storage[reference->write] = samples[pushed];
        reference->write = (reference->write + 1U) % reference->capacity;
        ++reference->count;
    }
    reference->stats.producer_samples = saturating_add(reference->stats.producer_samples, pushed);
    if (reference->count > (size_t)reference->stats.peak_depth_samples) {
        reference->stats.peak_depth_samples = (uint32_t)reference->count;
    }
    reference->stats.depth_samples = (uint32_t)reference->count;
    return pushed;
}

size_t vt_aec_reference_pop(vt_aec_reference_t *reference, int16_t *destination,
                            size_t sample_count) {
    if (reference == NULL || reference->storage == NULL || destination == NULL || sample_count == 0U) return 0U;
    size_t available = reference->count > reference->delay_samples
        ? reference->count - reference->delay_samples
        : 0U;
    size_t popped = available < sample_count ? available : sample_count;
    for (size_t index = 0U; index < popped; ++index) {
        destination[index] = reference->storage[reference->read];
        reference->read = (reference->read + 1U) % reference->capacity;
        --reference->count;
    }
    if (popped < sample_count) {
        memset(destination + popped, 0, (sample_count - popped) * sizeof(*destination));
        reference->stats.underrun_count = saturating_add(reference->stats.underrun_count, sample_count - popped);
    }
    reference->stats.consumer_samples = saturating_add(reference->stats.consumer_samples, popped);
    reference->stats.processed_frames = saturating_increment(reference->stats.processed_frames);
    reference->stats.depth_samples = (uint32_t)reference->count;
    return popped;
}

void vt_aec_reference_reset(vt_aec_reference_t *reference) {
    if (reference == NULL) return;
    reference->read = 0U;
    reference->write = 0U;
    reference->count = 0U;
    reference->stats.depth_samples = 0U;
    reference->stats.reset_count = saturating_increment(reference->stats.reset_count);
}

void vt_aec_reference_get_stats(const vt_aec_reference_t *reference,
                                vt_aec_reference_stats_t *stats) {
    if (stats == NULL) return;
    if (reference == NULL) {
        memset(stats, 0, sizeof(*stats));
        return;
    }
    *stats = reference->stats;
    stats->depth_samples = (uint32_t)reference->count;
}

int vt_aec_resampler_init(vt_aec_resampler_t *resampler, uint32_t source_rate,
                          uint32_t target_rate) {
    if (resampler == NULL || source_rate == 0U || target_rate == 0U) return -1;
    memset(resampler, 0, sizeof(*resampler));
    resampler->source_rate = source_rate;
    resampler->target_rate = target_rate;
    return 0;
}

size_t vt_aec_resampler_process(vt_aec_resampler_t *resampler, const int16_t *input,
                                size_t input_count, int16_t *output,
                                size_t output_capacity) {
    if (resampler == NULL || input == NULL || output == NULL || input_count == 0U ||
        output_capacity == 0U || resampler->source_rate == 0U || resampler->target_rate == 0U) return 0U;
    if (resampler->source_rate == resampler->target_rate) {
        size_t count = input_count < output_capacity ? input_count : output_capacity;
        memcpy(output, input, count * sizeof(*output));
        resampler->previous = input[input_count - 1U];
        return count;
    }
    if (input_count > SIZE_MAX / (size_t)resampler->target_rate) return 0U;
    uint64_t input_span = (uint64_t)input_count * (uint64_t)resampler->target_rate;
    uint64_t phase = resampler->phase;
    size_t produced = 0U;
    while (phase < input_span && produced < output_capacity) {
        size_t index = (size_t)(phase / resampler->target_rate);
        uint32_t fraction = (uint32_t)(phase % resampler->target_rate);
        int32_t first = input[index];
        int32_t second = index + 1U < input_count ? input[index + 1U] : input[index];
        int64_t weighted = (int64_t)first * (int64_t)(resampler->target_rate - fraction) +
                            (int64_t)second * (int64_t)fraction;
        int64_t value = weighted / (int64_t)resampler->target_rate;
        if (value > INT16_MAX) value = INT16_MAX;
        if (value < INT16_MIN) value = INT16_MIN;
        output[produced++] = (int16_t)value;
        phase += resampler->source_rate;
    }
    resampler->phase = phase >= input_span ? phase - input_span : 0U;
    resampler->previous = input[input_count - 1U];
    return produced;
}

void vt_aec_resampler_reset(vt_aec_resampler_t *resampler) {
    if (resampler == NULL) return;
    resampler->phase = 0U;
    resampler->previous = 0;
}
