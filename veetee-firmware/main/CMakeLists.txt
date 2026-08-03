idf_component_register(
    SRCS "main.c" "veetee_protocol.c" "veetee_state.c" "veetee_config.c" "veetee_audio.c" "veetee_display.c" "veetee_transport.c"
    INCLUDE_DIRS "."
    REQUIRES freertos log esp_driver_i2s esp_driver_gpio esp_driver_spi esp_lcd esp_event esp_netif esp_wifi nvs_flash esp_websocket_client esp_audio_codec cjson esp-tls
)
