# Veetee Firmware

ESP-IDF/FreeRTOS firmware slice cho ESP32-S3. Mốc hiện tại có protocol framing
v1/v2/v3, I2S PCM, Opus frame encode/decode, Wi-Fi station, direct WebSocket v3,
PTT state flow và bounded queue/task. Board profile/pin map nằm trong
`config/boards/`; credentials chỉ là local `sdkconfig` bị ignore.

## Host protocol tests

```bash
cmake -S host-tests -B host-tests/build
cmake --build host-tests/build
ctest --test-dir host-tests/build --output-on-failure
```

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
