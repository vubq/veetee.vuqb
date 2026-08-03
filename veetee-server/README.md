# Veetee Server

Host-native realtime data plane. Đây là một Python service độc lập, đọc runtime
snapshot từ fixture (M0/M1) hoặc Manager API (M2+), mở HTTP health và direct
WebSocket v3. Không chứa provider fallback, prompt/business literal hoặc GPIO.

## Bring-up

```bash
cd veetee-server
python3 -m venv .venv
./.venv/bin/pip install -e '.[test]'
# Chỉ khi snapshot đã chọn VieNeu thật (M0 physical/model gate):
./.venv/bin/pip install -e '.[local-tts]'
# PhoWhisper-small CTranslate2; thêm local-asr-cuda để dùng CUDA 12 trên host:
./.venv/bin/pip install -e '.[local-asr-cuda]'
# Silero VAD ONNX (modelPath phải được provision trong provider snapshot):
./.venv/bin/pip install -e '.[local-vad]'
VEETEE_CONFIG_SOURCE=fixture \
VEETEE_CONFIG_FIXTURE_FILE=config/fixtures/m0.json \
VEETEE_GROQ_SECRET_FILE=../secrets/groq.keys \
./.venv/bin/python -m veetee_server
```

Khi chạy cùng Manager API, có thể bật history telemetry bằng
`VEETEE_HISTORY_ENABLED=true`. Reporter dùng chính `VEETEE_MANAGER_API_URL` và
machine bearer (nếu có), đẩy `POST /internal/v1/conversations/turns` qua queue
bounded; queue đầy hoặc Manager tạm lỗi không chặn audio critical path. Các
tham số `VEETEE_HISTORY_QUEUE_SIZE`, `VEETEE_HISTORY_REQUEST_TIMEOUT_MS`,
`VEETEE_HISTORY_MAX_RETRIES`, `VEETEE_HISTORY_RETRY_BACKOFF_MS` và
`VEETEE_HISTORY_SHUTDOWN_DRAIN_MS` chỉ là vận hành, không chứa credential.

Presence tùy chọn bằng `VEETEE_PRESENCE_ENABLED=true` đẩy online/offline của
session tới `POST /internal/v1/devices/presence` qua queue riêng. Payload chỉ
chứa SHA-256 của `Device-Id`/`Client-Id`, MAC đã mask, board và firmware version;
raw identity không đi vào Manager API. Các tham số queue/timeout/retry tương ứng
có prefix `VEETEE_PRESENCE_`.

Các giá trị vận hành đọc từ environment hoặc snapshot. Fixture mặc định dùng
provider deterministic để contract test không gọi API ngoài. Groq/VieNeu thật chỉ
được activate bằng snapshot/provider manifest và dependency đã cài. Adapter VieNeu
dùng `vieneu.Vieneu(...).infer_stream(...)`, lazy-load model ở lần synthesis đầu,
resample audio native 48 kHz về downlink rate đã negotiate (24 kHz mặc định), và
không ghi model/audio vào log.

PhoWhisper adapter dùng `faster-whisper` với `modelPath`, `device` và
`computeType` từ runtime snapshot. Khi chọn CUDA, adapter tự preload các CUDA
runtime wheel trong virtualenv nếu có; thiếu runtime tạo provider error có mã,
không âm thầm chuyển sang provider khác. `local-asr-cuda` là optional extra vì
CUDA wheels khá lớn và không cần cho fixture/CPU-only bring-up.

Silero VAD adapter dùng ONNX recurrent state và reframe mỗi input thành
`windowSamples` (mặc định 512 samples ở 16 kHz). Model path, threshold và
endpoint policy đều đến từ snapshot; thiếu artifact/dependency tạo typed provider
error, không tự chuyển về energy VAD.

VieNeu có `prewarm: true` tùy chọn trong provider config. Khi bật, runtime load
local engine trước khi công bố readiness/snapshot; nếu không bật, engine vẫn lazy
load ở lần synthesize đầu.

Health:

- `GET /health/live`
- `GET /health/ready`
- `GET /metrics` (redacted counters)
- `WS /veetee/v1/` (path có thể đổi bằng `VEETEE_WS_PATH`)

## Test

```bash
./.venv/bin/pytest -q
```
