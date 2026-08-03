#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "driver/i2s_std.h"

#include "esp_audio_dec.h"

typedef struct {
    int input_sample_rate;
    int output_sample_rate;
    int frame_duration_ms;
    int speaker_bclk_gpio;
    int speaker_ws_gpio;
    int speaker_dout_gpio;
    int microphone_bclk_gpio;
    int microphone_ws_gpio;
    int microphone_din_gpio;
} vt_audio_config_t;

typedef struct {
    i2s_chan_handle_t tx_handle;
    i2s_chan_handle_t rx_handle;
    void *encoder;
    void *decoder;
    int16_t *decode_pcm;
    int32_t *output_pcm;
    int input_frame_bytes;
    int output_frame_bytes;
    int input_frame_samples;
    int output_frame_samples;
    int output_sample_rate;
    bool started;
} vt_audio_t;

int vt_audio_init(vt_audio_t *audio, const vt_audio_config_t *config);
int vt_audio_start(vt_audio_t *audio);
int vt_audio_stop(vt_audio_t *audio);
void vt_audio_deinit(vt_audio_t *audio);
int vt_audio_read_pcm(vt_audio_t *audio, int16_t *samples, size_t sample_capacity, size_t *sample_count);
int vt_audio_encode(vt_audio_t *audio, const int16_t *samples, size_t sample_count, uint8_t *opus, size_t opus_capacity, size_t *opus_size);
int vt_audio_decode_and_play(vt_audio_t *audio, const uint8_t *opus, size_t opus_size);
int vt_audio_play_tone(vt_audio_t *audio, int frequency_hz, int duration_ms, int amplitude);
void vt_audio_reset(vt_audio_t *audio);
