# Veetee Firmware

ESP-IDF/FreeRTOS firmware boundary cho ESP32-S3. Mốc hiện tại có protocol
framing v1/v2/v3, state machine, bounded queue/task và config safety gate. Chưa có
GPIO/audio codec/network driver vì exact BOM/pin map của board thật chưa được
xác minh; không đoán pin và không flash board.

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

Build không chứng minh physical acceptance. Flash chỉ được cho phép khi
`config/boards/<verified-profile>.json` có schematic/BOM/pin map đã được chủ dự
án xác nhận và runtime snapshot đã publish qua Manager Web.
