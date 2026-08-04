#include "veetee_audio.h"

#include <string.h>

#include "driver/i2s_common.h"
#include "esp_audio_enc.h"
#include "esp_err.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_ns.h"
#include "freertos/FreeRTOS.h"
#include "encoder/impl/esp_opus_enc.h"
#include "decoder/impl/esp_opus_dec.h"

#define TAG "veetee-audio"
#define VT_AUDIO_DMA_DESC_NUM 8
#define VT_AUDIO_DMA_FRAME_NUM 240
#define VT_AUDIO_PCM_SHIFT 12

#ifndef CONFIG_VEETEE_NOISE_SUPPRESSION_ENABLED
#define CONFIG_VEETEE_NOISE_SUPPRESSION_ENABLED 0
#endif
#ifndef CONFIG_VEETEE_NOISE_SUPPRESSION_MODE
#define CONFIG_VEETEE_NOISE_SUPPRESSION_MODE 1
#endif
#define VT_NOISE_SAMPLE_RATE 16000
#define VT_NOISE_FRAME_MS 10
#define VT_NOISE_FRAME_SAMPLES (VT_NOISE_SAMPLE_RATE * VT_NOISE_FRAME_MS / 1000)

static int frame_duration_to_encoder(int duration_ms) {
    switch (duration_ms) {
    case 20: return ESP_OPUS_ENC_FRAME_DURATION_20_MS;
    case 40: return ESP_OPUS_ENC_FRAME_DURATION_40_MS;
    case 60: return ESP_OPUS_ENC_FRAME_DURATION_60_MS;
    case 80: return ESP_OPUS_ENC_FRAME_DURATION_80_MS;
    case 100: return ESP_OPUS_ENC_FRAME_DURATION_100_MS;
    case 120: return ESP_OPUS_ENC_FRAME_DURATION_120_MS;
    default: return -1;
    }
}

static int check_config(const vt_audio_config_t *config) {
    if (config == NULL || config->input_sample_rate <= 0 || config->output_sample_rate <= 0 ||
        config->frame_duration_ms <= 0 || config->speaker_bclk_gpio < 0 || config->speaker_ws_gpio < 0 ||
        config->speaker_dout_gpio < 0 || config->microphone_bclk_gpio < 0 || config->microphone_ws_gpio < 0 ||
        config->microphone_din_gpio < 0) {
        return ESP_ERR_INVALID_ARG;
    }
    if (frame_duration_to_encoder(config->frame_duration_ms) < 0) return ESP_ERR_INVALID_ARG;
    return ESP_OK;
}

static i2s_std_config_t std_config(int sample_rate, int bclk, int ws, int dout, int din) {
    i2s_std_config_t value = {
        .clk_cfg = {
            .sample_rate_hz = (uint32_t)sample_rate,
            .clk_src = I2S_CLK_SRC_DEFAULT,
            .mclk_multiple = I2S_MCLK_MULTIPLE_256,
        },
        .slot_cfg = {
            .data_bit_width = I2S_DATA_BIT_WIDTH_32BIT,
            .slot_bit_width = I2S_SLOT_BIT_WIDTH_AUTO,
            .slot_mode = I2S_SLOT_MODE_MONO,
            .slot_mask = I2S_STD_SLOT_LEFT,
            .ws_width = I2S_DATA_BIT_WIDTH_32BIT,
            .ws_pol = false,
            .bit_shift = true,
#if defined(I2S_HW_VERSION_2)
            .left_align = true,
            .big_endian = false,
            .bit_order_lsb = false,
#endif
        },
        .gpio_cfg = {
            .mclk = I2S_GPIO_UNUSED,
            .bclk = bclk,
            .ws = ws,
            .dout = dout,
            .din = din,
            .invert_flags = { .mclk_inv = false, .bclk_inv = false, .ws_inv = false },
        },
    };
    return value;
}

void vt_audio_deinit(vt_audio_t *audio) {
    if (audio == NULL) return;
    (void)vt_audio_stop(audio);
    if (audio->encoder != NULL) {
        esp_opus_enc_close(audio->encoder);
        audio->encoder = NULL;
    }
    if (audio->decoder != NULL) {
        (void)esp_opus_dec_close(audio->decoder);
        audio->decoder = NULL;
    }
#if CONFIG_VEETEE_NOISE_SUPPRESSION_ENABLED
    if (audio->noise_suppressor != NULL) {
        ns_destroy(audio->noise_suppressor);
        audio->noise_suppressor = NULL;
    }
#endif
    if (audio->input_raw != NULL) {
        heap_caps_free(audio->input_raw);
        audio->input_raw = NULL;
    }
    if (audio->rx_handle != NULL) {
        (void)i2s_del_channel(audio->rx_handle);
        audio->rx_handle = NULL;
    }
    if (audio->tx_handle != NULL) {
        (void)i2s_del_channel(audio->tx_handle);
        audio->tx_handle = NULL;
    }
    if (audio->decode_pcm != NULL) {
        heap_caps_free(audio->decode_pcm);
        audio->decode_pcm = NULL;
    }
    if (audio->output_pcm != NULL) {
        heap_caps_free(audio->output_pcm);
        audio->output_pcm = NULL;
    }
    if (audio->noise_frame != NULL) {
        heap_caps_free(audio->noise_frame);
        audio->noise_frame = NULL;
    }
    audio->noise_frame_samples = 0;
    audio->started = false;
}

int vt_audio_init(vt_audio_t *audio, const vt_audio_config_t *config) {
    if (audio == NULL || check_config(config) != ESP_OK) return ESP_ERR_INVALID_ARG;
    memset(audio, 0, sizeof(*audio));
    audio->input_frame_samples = config->input_sample_rate * config->frame_duration_ms / 1000;
    audio->output_frame_samples = config->output_sample_rate * config->frame_duration_ms / 1000;
    audio->output_sample_rate = config->output_sample_rate;
    audio->input_frame_bytes = audio->input_frame_samples * (int)sizeof(int16_t);
    audio->output_frame_bytes = audio->output_frame_samples * (int)sizeof(int16_t);
    if (audio->input_frame_samples <= 0 || audio->output_frame_samples <= 0) return ESP_ERR_INVALID_SIZE;
#if CONFIG_VEETEE_NOISE_SUPPRESSION_ENABLED
    if (config->input_sample_rate != VT_NOISE_SAMPLE_RATE) {
        ESP_LOGE(TAG, "noise suppression requires input sample rate=%d, got=%d", VT_NOISE_SAMPLE_RATE,
                 config->input_sample_rate);
        return ESP_ERR_INVALID_ARG;
    }
    audio->noise_frame_samples = VT_NOISE_FRAME_SAMPLES;
    audio->noise_frame = heap_caps_calloc(audio->noise_frame_samples, sizeof(*audio->noise_frame),
                                           MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
    if (audio->noise_frame == NULL) {
        vt_audio_deinit(audio);
        return ESP_ERR_NO_MEM;
    }
    audio->noise_suppressor = ns_pro_create(VT_NOISE_FRAME_MS, CONFIG_VEETEE_NOISE_SUPPRESSION_MODE,
                                             VT_NOISE_SAMPLE_RATE);
    if (audio->noise_suppressor == NULL) {
        ESP_LOGE(TAG, "noise suppression init failed mode=%d", CONFIG_VEETEE_NOISE_SUPPRESSION_MODE);
        vt_audio_deinit(audio);
        return ESP_ERR_NOT_SUPPORTED;
    }
    ESP_LOGI(TAG, "noise suppression enabled mode=%d frame_samples=%u", CONFIG_VEETEE_NOISE_SUPPRESSION_MODE,
             (unsigned)audio->noise_frame_samples);
#endif
    audio->input_raw = heap_caps_calloc((size_t)audio->input_frame_samples, sizeof(*audio->input_raw),
                                        MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
    if (audio->input_raw == NULL) {
        vt_audio_deinit(audio);
        return ESP_ERR_NO_MEM;
    }
    audio->decode_pcm = heap_caps_calloc((size_t)audio->output_frame_samples, sizeof(*audio->decode_pcm),
                                         MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
    audio->output_pcm = heap_caps_calloc((size_t)audio->output_frame_samples, sizeof(*audio->output_pcm),
                                         MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
    if (audio->decode_pcm == NULL || audio->output_pcm == NULL) {
        vt_audio_deinit(audio);
        return ESP_ERR_NO_MEM;
    }

    i2s_chan_config_t channel_config = {
        .id = 0,
        .role = I2S_ROLE_MASTER,
        .dma_desc_num = VT_AUDIO_DMA_DESC_NUM,
        .dma_frame_num = VT_AUDIO_DMA_FRAME_NUM,
        .auto_clear_after_cb = true,
        .auto_clear_before_cb = false,
        .intr_priority = 0,
    };
    esp_err_t error = i2s_new_channel(&channel_config, &audio->tx_handle, NULL);
    if (error != ESP_OK) {
        vt_audio_deinit(audio);
        return error;
    }
    i2s_std_config_t tx_config = std_config(config->output_sample_rate, config->speaker_bclk_gpio,
                                            config->speaker_ws_gpio, config->speaker_dout_gpio, I2S_GPIO_UNUSED);
    error = i2s_channel_init_std_mode(audio->tx_handle, &tx_config);
    if (error != ESP_OK) {
        vt_audio_deinit(audio);
        return error;
    }

    channel_config.id = 1;
    error = i2s_new_channel(&channel_config, NULL, &audio->rx_handle);
    if (error != ESP_OK) {
        vt_audio_deinit(audio);
        return error;
    }
    i2s_std_config_t rx_config = std_config(config->input_sample_rate, config->microphone_bclk_gpio,
                                            config->microphone_ws_gpio, I2S_GPIO_UNUSED, config->microphone_din_gpio);
    error = i2s_channel_init_std_mode(audio->rx_handle, &rx_config);
    if (error != ESP_OK) {
        vt_audio_deinit(audio);
        return error;
    }

    esp_opus_enc_config_t encoder_config = {
        .sample_rate = config->input_sample_rate,
        .channel = 1,
        .bits_per_sample = 16,
        .bitrate = ESP_OPUS_BITRATE_AUTO,
        .frame_duration = (esp_opus_enc_frame_duration_t)frame_duration_to_encoder(config->frame_duration_ms),
        .application_mode = ESP_OPUS_ENC_APPLICATION_LOWDELAY,
        .complexity = 5,
        .enable_fec = false,
        .enable_dtx = false,
        .enable_vbr = true,
    };
    if (esp_opus_enc_open(&encoder_config, sizeof(encoder_config), &audio->encoder) != ESP_AUDIO_ERR_OK) {
        ESP_LOGE(TAG, "Opus encoder init failed");
        vt_audio_deinit(audio);
        return ESP_ERR_NOT_SUPPORTED;
    }
    esp_opus_dec_cfg_t decoder_config = {
        .sample_rate = (uint32_t)config->output_sample_rate,
        .channel = 1,
        .frame_duration = (esp_opus_dec_frame_duration_t)frame_duration_to_encoder(config->frame_duration_ms),
        .self_delimited = false,
    };
    if (esp_opus_dec_open(&decoder_config, sizeof(decoder_config), &audio->decoder) != ESP_AUDIO_ERR_OK) {
        ESP_LOGE(TAG, "Opus decoder init failed");
        vt_audio_deinit(audio);
        return ESP_ERR_NOT_SUPPORTED;
    }
    int encoder_frame_bytes = 0;
    int encoder_out_bytes = 0;
    if (esp_opus_enc_get_frame_size(audio->encoder, &encoder_frame_bytes, &encoder_out_bytes) != ESP_AUDIO_ERR_OK ||
        encoder_frame_bytes != audio->input_frame_bytes) {
        ESP_LOGE(TAG, "unexpected Opus frame size input=%d expected=%d", encoder_frame_bytes, audio->input_frame_bytes);
        vt_audio_deinit(audio);
        return ESP_ERR_INVALID_SIZE;
    }
    if (encoder_out_bytes <= 0) {
        vt_audio_deinit(audio);
        return ESP_ERR_INVALID_SIZE;
    }
    ESP_LOGI(TAG, "Opus encoder contract input_bytes=%d output_hint=%d frame_samples=%d",
             encoder_frame_bytes, encoder_out_bytes, audio->input_frame_samples);
    audio->output_frame_bytes = audio->output_frame_samples * (int)sizeof(int16_t);
    return ESP_OK;
}

int vt_audio_start(vt_audio_t *audio) {
    if (audio == NULL || audio->tx_handle == NULL || audio->rx_handle == NULL) return ESP_ERR_INVALID_ARG;
    esp_err_t error = i2s_channel_enable(audio->tx_handle);
    if (error != ESP_OK) return error;
    error = i2s_channel_enable(audio->rx_handle);
    if (error != ESP_OK) return error;
    audio->started = true;
    return ESP_OK;
}

int vt_audio_stop(vt_audio_t *audio) {
    if (audio == NULL) return ESP_ERR_INVALID_ARG;
    if (audio->rx_handle != NULL) (void)i2s_channel_disable(audio->rx_handle);
    if (audio->tx_handle != NULL) (void)i2s_channel_disable(audio->tx_handle);
    audio->started = false;
    return ESP_OK;
}

int vt_audio_read_pcm(vt_audio_t *audio, int16_t *samples, size_t sample_capacity, size_t *sample_count) {
    if (audio == NULL || samples == NULL || sample_count == NULL || !audio->started ||
        audio->input_raw == NULL || sample_capacity < (size_t)audio->input_frame_samples) return ESP_ERR_INVALID_ARG;
    size_t bytes_read = 0;
    esp_err_t error = i2s_channel_read(audio->rx_handle, audio->input_raw,
                                       (size_t)audio->input_frame_samples * sizeof(*audio->input_raw),
                                       &bytes_read, pdMS_TO_TICKS(250));
    if (error != ESP_OK) return error;
    size_t count = bytes_read / sizeof(int32_t);
    if (count > sample_capacity || count > (size_t)audio->input_frame_samples) {
        *sample_count = 0;
        return ESP_ERR_INVALID_SIZE;
    }
    for (size_t index = 0; index < count; ++index) {
        int32_t value = audio->input_raw[index] >> VT_AUDIO_PCM_SHIFT;
        if (value > INT16_MAX) value = INT16_MAX;
        if (value < INT16_MIN) value = INT16_MIN;
        samples[index] = (int16_t)value;
    }
    *sample_count = count;
    return ESP_OK;
}

int vt_audio_process_capture(vt_audio_t *audio, int16_t *samples, size_t sample_count) {
    if (audio == NULL || samples == NULL || sample_count == 0U) return ESP_ERR_INVALID_ARG;
#if CONFIG_VEETEE_NOISE_SUPPRESSION_ENABLED
    if (audio->noise_suppressor == NULL || audio->noise_frame == NULL || audio->noise_frame_samples == 0U) {
        return ESP_ERR_INVALID_STATE;
    }
    if (sample_count % audio->noise_frame_samples != 0U) return ESP_ERR_INVALID_SIZE;
    for (size_t offset = 0; offset < sample_count; offset += audio->noise_frame_samples) {
        ns_process(audio->noise_suppressor, samples + offset, audio->noise_frame);
        memcpy(samples + offset, audio->noise_frame, audio->noise_frame_samples * sizeof(*samples));
    }
#else
    (void)sample_count;
#endif
    return ESP_OK;
}

int vt_audio_encode(vt_audio_t *audio, const int16_t *samples, size_t sample_count, uint8_t *opus, size_t opus_capacity, size_t *opus_size) {
    if (audio == NULL || samples == NULL || opus == NULL || opus_size == NULL || audio->encoder == NULL ||
        sample_count != (size_t)audio->input_frame_samples || opus_capacity == 0) return ESP_ERR_INVALID_ARG;
    esp_audio_enc_in_frame_t input = { .buffer = (uint8_t *)samples, .len = (uint32_t)(sample_count * sizeof(int16_t)) };
    esp_audio_enc_out_frame_t output = { .buffer = opus, .len = (uint32_t)opus_capacity, .encoded_bytes = 0 };
    esp_audio_err_t error = esp_opus_enc_process(audio->encoder, &input, &output);
    if (error != ESP_AUDIO_ERR_OK) {
        ESP_LOGW(TAG, "Opus encoder process rejected result=%d input_bytes=%u output_capacity=%u encoded=%u",
                 (int)error, (unsigned)input.len, (unsigned)opus_capacity, (unsigned)output.encoded_bytes);
        return ESP_ERR_INVALID_SIZE;
    }
    if (output.encoded_bytes == 0 || output.encoded_bytes > opus_capacity) {
        ESP_LOGW(TAG, "Opus encoder output invalid encoded=%u capacity=%u",
                 (unsigned)output.encoded_bytes, (unsigned)opus_capacity);
        return ESP_ERR_INVALID_SIZE;
    }
    *opus_size = output.encoded_bytes;
    return ESP_OK;
}

int vt_audio_decode_and_play(vt_audio_t *audio, const uint8_t *opus, size_t opus_size) {
    if (audio == NULL || opus == NULL || opus_size == 0 || audio->decoder == NULL ||
        audio->decode_pcm == NULL || audio->output_pcm == NULL || !audio->started) return ESP_ERR_INVALID_ARG;
    esp_audio_dec_in_raw_t input = { .buffer = (uint8_t *)opus, .len = (uint32_t)opus_size, .consumed = 0 };
    esp_audio_dec_out_frame_t output = {
        .buffer = (uint8_t *)audio->decode_pcm,
        .len = (uint32_t)(audio->output_frame_samples * sizeof(*audio->decode_pcm)),
        .needed_size = 0,
        .decoded_size = 0,
    };
    esp_audio_dec_info_t info = {0};
    esp_audio_err_t error = esp_opus_dec_decode(audio->decoder, &input, &output, &info);
    if (error != ESP_AUDIO_ERR_OK || output.decoded_size == 0) return ESP_ERR_INVALID_SIZE;
    if (output.decoded_size % sizeof(*audio->decode_pcm) != 0 ||
        output.decoded_size > audio->output_frame_samples * (int)sizeof(*audio->decode_pcm)) {
        return ESP_ERR_INVALID_SIZE;
    }
    size_t samples = output.decoded_size / sizeof(int16_t);
    for (size_t index = 0; index < samples; ++index) {
        audio->output_pcm[index] = (int32_t)audio->decode_pcm[index] << VT_AUDIO_PCM_SHIFT;
    }
    size_t bytes_written = 0;
    size_t output_bytes = samples * sizeof(*audio->output_pcm);
    error = i2s_channel_write(audio->tx_handle, audio->output_pcm, output_bytes, &bytes_written, pdMS_TO_TICKS(250));
    return error == ESP_OK && bytes_written == output_bytes ? ESP_OK : ESP_FAIL;
}

int vt_audio_play_tone(vt_audio_t *audio, int frequency_hz, int duration_ms, int amplitude) {
    if (audio == NULL || !audio->started || audio->tx_handle == NULL || frequency_hz <= 0 ||
        duration_ms <= 0 || amplitude <= 0 || amplitude > INT16_MAX) return ESP_ERR_INVALID_ARG;
    const size_t block_samples = 240;
    int32_t expanded[block_samples];
    size_t total_samples = (size_t)audio->output_sample_rate * (size_t)duration_ms / 1000U;
    const size_t fade_samples = (size_t)audio->output_sample_rate / 200U;
    const uint32_t phase_step = (uint32_t)(((uint64_t)frequency_hz << 32) /
                                           (uint32_t)audio->output_sample_rate);
    uint32_t phase = 0;
    size_t rendered = 0;
    while (rendered < total_samples) {
        size_t count = total_samples - rendered;
        if (count > block_samples) count = block_samples;
        for (size_t index = 0; index < count; ++index) {
            size_t absolute = rendered + index;
            int level = (phase & 0x80000000U) != 0U ? amplitude : -amplitude;
            if (fade_samples > 0U && absolute < fade_samples) level = level * (int)absolute / (int)fade_samples;
            size_t remaining = total_samples - absolute;
            if (fade_samples > 0U && remaining < fade_samples) level = level * (int)remaining / (int)fade_samples;
            expanded[index] = (int32_t)level << VT_AUDIO_PCM_SHIFT;
            phase += phase_step;
        }
        size_t written = 0;
        esp_err_t error = i2s_channel_write(audio->tx_handle, expanded, count * sizeof(expanded[0]),
                                            &written, pdMS_TO_TICKS(250));
        if (error != ESP_OK || written != count * sizeof(expanded[0])) return ESP_FAIL;
        rendered += count;
    }
    return ESP_OK;
}

void vt_audio_reset_decoder(vt_audio_t *audio) {
    if (audio == NULL) return;
    if (audio->decoder != NULL) (void)esp_opus_dec_reset(audio->decoder);
}

void vt_audio_reset_encoder(vt_audio_t *audio) {
    if (audio != NULL && audio->encoder != NULL) (void)esp_opus_enc_reset(audio->encoder);
}

void vt_audio_reset(vt_audio_t *audio) {
    vt_audio_reset_decoder(audio);
    vt_audio_reset_encoder(audio);
}
