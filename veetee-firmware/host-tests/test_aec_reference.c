#include "veetee_aec_reference.h"

#include <assert.h>
#include <stdint.h>
#include <string.h>

static void test_resampler(void) {
    vt_aec_resampler_t resampler;
    int16_t input[] = {0, 100, 200, 300, 400, 500};
    int16_t output[8] = {0};
    assert(vt_aec_resampler_init(&resampler, 24000U, 16000U) == 0);
    assert(vt_aec_resampler_process(&resampler, input, 6U, output, 8U) == 4U);
    assert(output[0] == 0);
    assert(output[1] == 150);
    assert(output[2] == 300);
    assert(output[3] == 450);
    vt_aec_resampler_reset(&resampler);
    memset(output, 0, sizeof(output));
    assert(vt_aec_resampler_process(&resampler, input, 6U, output, 2U) == 2U);
    assert(output[0] == 0);
    assert(output[1] == 150);
}

static void test_delay_gate_and_underflow(void) {
    int16_t storage[8] = {0};
    int16_t input[] = {1, 2, 3, 4};
    int16_t output[3] = {0};
    vt_aec_reference_t reference;
    vt_aec_reference_stats_t stats;
    assert(vt_aec_reference_init(&reference, storage, 8U, 2U) == 0);
    assert(vt_aec_reference_push(&reference, input, 4U) == 4U);
    assert(vt_aec_reference_pop(&reference, output, 3U) == 2U);
    assert(output[0] == 1 && output[1] == 2 && output[2] == 0);
    vt_aec_reference_get_stats(&reference, &stats);
    assert(stats.depth_samples == 2U);
    assert(stats.underrun_count == 1U);
    assert(stats.consumer_samples == 2U);
    assert(stats.processed_frames == 1U);
    assert(stats.delay_samples == 2U);
}

static void test_overflow_and_reset(void) {
    int16_t storage[4] = {0};
    int16_t input[] = {1, 2, 3, 4, 5, 6};
    int16_t output[4] = {0};
    vt_aec_reference_t reference;
    vt_aec_reference_stats_t stats;
    assert(vt_aec_reference_init(&reference, storage, 4U, 0U) == 0);
    assert(vt_aec_reference_push(&reference, input, 6U) == 6U);
    assert(vt_aec_reference_pop(&reference, output, 4U) == 4U);
    assert(output[0] == 3 && output[1] == 4 && output[2] == 5 && output[3] == 6);
    vt_aec_reference_get_stats(&reference, &stats);
    assert(stats.overrun_count == 2U);
    assert(stats.peak_depth_samples == 4U);
    vt_aec_reference_reset(&reference);
    vt_aec_reference_get_stats(&reference, &stats);
    assert(stats.depth_samples == 0U);
    assert(stats.reset_count == 1U);
    assert(stats.producer_samples == 6U);
}

int main(void) {
    test_resampler();
    test_delay_gate_and_underflow();
    test_overflow_and_reset();
    return 0;
}
