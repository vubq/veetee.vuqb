# Veetee Server

Host-native realtime data plane. Đây là một Python service độc lập, đọc runtime
snapshot từ fixture (M0/M1) hoặc Manager API (M2+), mở HTTP health và direct
WebSocket v3. Không chứa provider fallback, prompt/business literal hoặc GPIO.

## Bring-up

```bash
cd veetee-server
python3 -m venv .venv
./.venv/bin/pip install -e '.[test]'
VEETEE_CONFIG_SOURCE=fixture \
VEETEE_CONFIG_FIXTURE_FILE=config/fixtures/m0.json \
VEETEE_GROQ_SECRET_FILE=../secrets/groq.keys \
./.venv/bin/python -m veetee_server
```

Các giá trị vận hành đọc từ environment hoặc snapshot. Fixture mặc định dùng
provider deterministic để contract test không gọi API ngoài. Groq/VieNeu thật chỉ
được activate bằng snapshot/provider manifest và dependency đã cài.

Health:

- `GET /health/live`
- `GET /health/ready`
- `GET /metrics` (redacted counters)
- `WS /veetee/v1/` (path có thể đổi bằng `VEETEE_WS_PATH`)

## Test

```bash
./.venv/bin/pytest -q
```
