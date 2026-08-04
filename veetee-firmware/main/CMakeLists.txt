idf_component_register(
    SRCS "main.c" "veetee_protocol.c" "veetee_mqtt_udp_wire.c" "veetee_state.c" "veetee_config.c" "veetee_audio.c" "veetee_aec.c" "veetee_display.c" "veetee_transport.c" "veetee_wake.c" "veetee_wire_guard.c" "veetee_ptt.c"
    INCLUDE_DIRS "."
    REQUIRES freertos log esp_app_format esp_driver_i2s esp_driver_gpio esp_driver_spi esp_lcd esp_event esp_netif esp_wifi nvs_flash esp_websocket_client esp_audio_codec esp-sr cjson esp-tls
)
