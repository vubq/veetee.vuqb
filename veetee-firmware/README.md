# Veetee Firmware

ESP-IDF/FreeRTOS firmware slice cho ESP32-S3. Mốc hiện tại có protocol framing
v1/v2/v3, host-validated MQTT/UDP v3 clear header, I2S PCM, Opus frame
encode/decode, Wi-Fi station, direct WebSocket v3, PTT state flow và bounded
queue/task. Board profile/pin map nằm trong
`config/boards/`; credentials chỉ là local `sdkconfig` bị ignore.

## Host protocol tests

```bash
cmake -S host-tests -B host-tests/build
cmake --build host-tests/build
ctest --test-dir host-tests/build --output-on-failure
```

The C host test and `veetee-server` Python protocol test read the same
language-neutral oracle at `tests/fixtures/ws_audio_golden.csv`; this prevents
the two implementations from silently drifting while keeping reference repos
read-only. The additional `mqtt_udp_wire` CTest validates the 16-byte UDP v3
header and bounded 1.400-byte payload without opening a socket or doing AES; the
Python crypto/session fixtures cover the encrypted host-side path. These tests
validate framing/round-trip bytes, not a full peer-server conformance run.

## ESP-IDF compile gate

Sau khi source ESP-IDF đã được activate:

```bash
source /home/vubq/.espressif/v6.0.2/esp-idf/export.sh
idf.py set-target esp32s3
idf.py build
```

Build không chứng minh physical acceptance. Khi chủ dự án đã cho phép thử board,
flash bằng `idf.py -p /dev/ttyACM0 flash` mà không chạy `erase_flash`; NVS/Wi-Fi
được giữ nguyên. Serial log chỉ là host/network evidence, còn người dùng phải
xác nhận LCD, nút PTT, mic và speaker.
