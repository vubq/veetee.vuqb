# Board profiles

Board profile là manifest được xác minh ngoài code: exact module/revision, audio
codec, mic/speaker I2S, button active level, display bus/controller/rotation,
LED/IR/mmWave pins, partition and asset constraints. Không điền GPIO theo tên
board gần giống. Khi thiếu schematic/BOM, chỉ chạy host protocol tests và firmware
compile không I/O; tuyệt đối không flash.
