"""aiohttp application for health endpoints and direct WebSocket profiles."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
import json
import logging
import secrets
import time
from typing import Any
from uuid import UUID, uuid4

from aiohttp import WSMsgType, web

from .config import ServerConfig
from .history import ConversationHistoryReporter
from .pipeline import Turn, TurnPipeline
from .mcp import DeviceMcpBridge
from .protocol import ProtocolError, decode_audio, decode_json, profile_from_version, control_message
from .providers import IntentMatch, MemorySession, OpusCodec, ProviderError
from .runtime import RuntimeConfigManager, RuntimeView

VOICE_APP_KEY = web.AppKey("voice", object)


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


class VoiceApplication:
    def __init__(self, config: ServerConfig, runtime: RuntimeConfigManager, *, history_reporter: ConversationHistoryReporter | None = None) -> None:
        self.config = config
        self.runtime = runtime
        self.history_reporter = history_reporter
        self.log = logging.getLogger("veetee.voice")
        self.metrics: dict[str, int] = {
            "connections": 0,
            "active_connections": 0,
            "protocol_errors": 0,
            "audio_frames_in": 0,
            "audio_frames_out": 0,
            "turn_count": 0,
        }
        self._sessions: set[VoiceSession] = set()

    def make_app(self) -> web.Application:
        app = web.Application(client_max_size=self.config.max_ws_message_bytes)
        app[VOICE_APP_KEY] = self
        app.router.add_get("/health/live", self.health_live)
        app.router.add_get("/health/ready", self.health_ready)
        app.router.add_get("/metrics", self.metrics_view)
        app.router.add_get(self.config.ws_path, self.websocket)
        return app

    async def health_live(self, request: web.Request) -> web.Response:
        return web.json_response({"status": "ok", "service": "veetee-server"})

    async def health_ready(self, request: web.Request) -> web.Response:
        try:
            view = self.runtime.view
        except RuntimeError:
            return web.json_response({"status": "not_ready", "reason": "config_unavailable"}, status=503)
        return web.json_response(
            {
                "status": "ready",
                "service": "veetee-server",
                "revision": view.snapshot.revision,
                "configChecksum": view.snapshot.checksum,
                "activeConnections": self.metrics["active_connections"],
                "activationFailures": self.runtime.activation_failures,
                "lastActivationErrorType": self.runtime.last_activation_error_type,
            }
        )

    async def metrics_view(self, request: web.Request) -> web.Response:
        payload = dict(self.metrics)
        if self.history_reporter is not None:
            payload.update({f"history_{key}": value for key, value in self.history_reporter.metrics().items()})
        return web.json_response(payload)

    async def websocket(self, request: web.Request) -> web.WebSocketResponse:
        device_id = request.headers.get("Device-Id") or request.headers.get("device-id")
        version_header = request.headers.get("Protocol-Version", "")
        if not device_id or len(device_id) > 128:
            return web.Response(status=400, text="invalid Device-Id")
        try:
            profile = profile_from_version(int(version_header))
        except (ValueError, ProtocolError):
            return web.Response(status=400, text="invalid Protocol-Version")
        client_id = request.headers.get("Client-Id") or request.headers.get("client-id")
        if profile != "ws-v1-compat" and (not client_id or len(client_id) > 128):
            return web.Response(status=400, text="invalid Client-Id")
        ws = web.WebSocketResponse(max_msg_size=self.config.max_ws_message_bytes, heartbeat=30)
        await ws.prepare(request)
        session = VoiceSession(self, ws, device_id=device_id, client_id=client_id or "", profile=profile)
        self._sessions.add(session)
        self.metrics["connections"] += 1
        self.metrics["active_connections"] += 1
        try:
            await session.run()
        finally:
            self._sessions.discard(session)
            self.metrics["active_connections"] = max(0, self.metrics["active_connections"] - 1)
        return ws


class VoiceSession:
    def __init__(self, app: VoiceApplication, ws: web.WebSocketResponse, *, device_id: str, client_id: str, profile: str) -> None:
        self.app = app
        self.ws = ws
        self.device_id = device_id
        self.client_id = client_id
        self.profile = profile  # typed after header validation
        self.session_id = secrets.token_urlsafe(18)
        self.client_hello: dict[str, Any] | None = None
        self.ready = False
        self.turn: Turn | None = None
        self.pipeline: TurnPipeline | None = None
        self.generation = 0
        self.codec: OpusCodec | None = None
        self.mcp: DeviceMcpBridge | None = None
        self.memory: MemorySession | None = None
        self.phase = "ready_idle"
        self._speech_frames = 0
        self._closed = False
        self._lock = asyncio.Lock()
        self.conversation_id = str(uuid4())
        self.conversation_started_at: str | None = None
        self.turn_sequence = 0

    async def run(self) -> None:
        try:
            first = await self.ws.receive()
            if first.type != WSMsgType.TEXT:
                await self.close(1002, "hello required")
                return
            hello = decode_json(first.data)
            await self._hello(hello)
            async for message in self.ws:
                try:
                    if message.type == WSMsgType.TEXT:
                        await self._control(decode_json(message.data))
                    elif message.type == WSMsgType.BINARY:
                        await self._audio(bytes(message.data))
                    elif message.type in {WSMsgType.CLOSE, WSMsgType.CLOSING, WSMsgType.CLOSED}:
                        break
                    elif message.type == WSMsgType.ERROR:
                        break
                except ProtocolError:
                    self.app.metrics["protocol_errors"] += 1
                    await self.close(1002, "protocol error")
                    break
                except ProviderError as exc:
                    await self.send_text(control_message("alert", session_id=self.session_id, status="error", code=exc.code))
        except ProtocolError:
            # The first hello is outside the steady-state message loop. Keep
            # malformed handshake behavior identical to malformed later frames
            # instead of leaking a server-side exception to aiohttp.
            self.app.metrics["protocol_errors"] += 1
            await self.close(1002, "protocol error")
        finally:
            await self._abort(reason="disconnect", send_stop=False)

    async def _hello(self, message: dict[str, Any]) -> None:
        if message.get("type") != "hello":
            raise ProtocolError("first control message must be hello")
        expected_version = {"ws-v1-compat": 1, "ws-v2": 2, "ws-v3": 3}[self.profile]
        version = message.get("version")
        if isinstance(version, bool) or not isinstance(version, int) or version != expected_version:
            raise ProtocolError("hello version mismatch")
        if message.get("transport") != "websocket":
            raise ProtocolError("unsupported transport")
        audio = message.get("audio_params")
        if not isinstance(audio, dict) or audio.get("format") != "opus":
            raise ProtocolError("unsupported client audio parameters")
        channels = audio.get("channels")
        sample_rate = audio.get("sample_rate")
        frame_duration = audio.get("frame_duration")
        if any(isinstance(value, bool) or not isinstance(value, int) for value in (channels, sample_rate, frame_duration)):
            raise ProtocolError("audio parameters must be integers")
        if channels != 1 or sample_rate != 16000 or frame_duration != 60:
            raise ProtocolError("client audio must be opus mono 16kHz/60ms")
        self.client_hello = message
        snapshot = self.app.runtime.view.snapshot
        wire = snapshot.raw.get("wire") or {}
        self.codec = OpusCodec(int(wire.get("uplinkSampleRate", 16000)), int(wire.get("downlinkSampleRate", 24000)))
        self.memory = self.app.runtime.view.registry.memory.create_session() if self.app.runtime.view.registry.memory else None
        await self.send_text(
            {
                "type": "hello",
                "version": int(message["version"]),
                "transport": "websocket",
                "audio_params": {
                    "format": "opus",
                    "sample_rate": int(wire.get("downlinkSampleRate", 24000)),
                    "channels": 1,
                    "frame_duration": int(wire.get("frameDurationMs", 60)),
                },
                "session_id": self.session_id,
            }
        )
        descriptors = snapshot.raw.get("tools")
        if not isinstance(descriptors, list):
            descriptors = []
        timeout_ms = int((snapshot.raw.get("toolPolicy") or {}).get("timeoutMs", 30000))
        self.mcp = DeviceMcpBridge(session_id=self.session_id, send=self.send_text, descriptors=descriptors, timeout_ms=timeout_ms)
        if bool((message.get("features") or {}).get("mcp", False)):
            await self.mcp.initialize()
            await self.mcp.list_tools()
        self.ready = True

    async def _control(self, message: dict[str, Any]) -> None:
        if not self.ready:
            raise ProtocolError("session is not ready")
        kind = message.get("type")
        if not isinstance(kind, str):
            raise ProtocolError("control type is required")
        incoming_session = message.get("session_id")
        if incoming_session is not None and incoming_session != self.session_id:
            return
        if kind == "listen":
            await self._listen(message)
        elif kind == "abort":
            await self._abort(reason=str(message.get("reason", "client")))
        elif kind == "ping":
            await self.send_text({"type": "pong", "session_id": self.session_id})
        elif kind == "mcp":
            payload = message.get("payload")
            if isinstance(payload, dict) and self.mcp and self.mcp.resolve(payload):
                return
        # Unknown message types are intentionally ignored for additive compatibility.

    async def _listen(self, message: dict[str, Any]) -> None:
        state = message.get("state")
        if state == "start":
            await self._start_turn(str(message.get("mode", "manual")))
        elif state == "stop":
            if self.turn and self.pipeline and self.turn.task is None:
                self.turn.listen_stopped_at = time.perf_counter()
                self.phase = "thinking"
                turn = self.turn
                pipeline = self.pipeline
                turn.task = asyncio.create_task(self._finish_turn(turn, pipeline), name=f"turn-{turn.turn_id}")
        elif state == "detect":
            text = message.get("text")
            if isinstance(text, str) and self.app.runtime.view.registry.intent:
                match = self.app.runtime.view.registry.intent.classify(text, locale=self.app.runtime.view.snapshot.locale)
                if match:
                    await self.send_text(control_message("intent", session_id=self.session_id, intent_id=match.intent_id, action=match.action, confidence=match.confidence))
                    await self._handle_intent(match)
            return
        else:
            raise ProtocolError("unsupported listen state")

    async def _start_turn(self, mode: str) -> None:
        await self._abort(reason="new_turn", send_stop=False)
        self.generation += 1
        now = _utc_now()
        if self.conversation_started_at is None:
            self.conversation_started_at = now
        self.turn_sequence += 1
        self.turn = Turn(
            turn_id=secrets.token_urlsafe(10),
            generation=self.generation,
            mode=mode,
            cancelled=asyncio.Event(),
            sequence=self.turn_sequence,
            started_at=now,
            conversation_started_at=self.conversation_started_at,
            started_monotonic=time.perf_counter(),
        )
        self.phase = "listening"
        self._speech_frames = 0
        view: RuntimeView = self.app.runtime.view
        assert self.codec is not None
        self.pipeline = TurnPipeline(
            snapshot=view.snapshot,
            registry=view.registry,
            codec=self.codec,
            profile=self.profile,
            session_id=self.session_id,
            turn=self.turn,
            send_text=self.send_text,
            send_binary=lambda value, turn_id=self.turn.turn_id: self.send_binary(value, turn_id=turn_id),
            execute_tool=self._execute_tool,
            memory=self.memory,
            on_intent=self._handle_intent,
            metrics=self.app.metrics,
        )
        view.registry.vad.reset()
        view.registry.asr.reset()

    async def _finish_turn(self, turn: Turn, pipeline: TurnPipeline) -> None:
        cancelled = False
        try:
            await pipeline.finish()
        except asyncio.CancelledError:
            cancelled = True
            raise
        finally:
            if not cancelled:
                await self._report_turn(turn)

    async def _audio(self, raw: bytes) -> None:
        if not self.ready or self.pipeline is None or self.turn is None or self.codec is None:
            raise ProtocolError("audio received outside listening turn")
        # A manual/auto turn owns the microphone only while it is listening.
        # Once endpointing has scheduled finish(), or while the answer is being
        # spoken, late packets are ambient audio and must not be appended to the
        # finalized ASR session. Realtime is the explicit duplex exception.
        if (self.phase in {"thinking", "speaking"} and self.turn.mode != "realtime") or (
            self.phase == "listening" and self.turn.task is not None
        ):
            self.app.metrics["audio_frames_ignored"] = self.app.metrics.get("audio_frames_ignored", 0) + 1
            return
        frame = decode_audio(self.profile, raw)  # type: ignore[arg-type]
        pcm = self.codec.decode_uplink(frame.payload, int(self.app.runtime.view.snapshot.raw.get("wire", {}).get("uplinkSampleRate", 16000)) * 60 // 1000)
        self.app.metrics["audio_frames_in"] += 1
        speech = self.app.runtime.view.registry.vad.accept(pcm, 16000)
        if self.phase == "speaking" and self.turn.mode == "realtime" and speech:
            self._speech_frames += 1
            threshold = int((self.app.runtime.view.snapshot.raw.get("bargeIn") or {}).get("minSpeechFrames", 2))
            if self._speech_frames >= max(1, threshold):
                await self._abort(reason="barge_in")
                await self._start_turn("realtime")
        await self.pipeline.ingest(pcm)
        # Ingest the endpointing frame before scheduling ASR finalization. This
        # ordering is important for short utterances where VAD marks the last
        # frame as endpointed: finish() must observe that frame.
        if self.phase == "listening" and self.turn.mode == "auto" and self.app.runtime.view.registry.vad.endpoint() and self.turn.task is None:
            self.phase = "thinking"
            turn = self.turn
            pipeline = self.pipeline
            turn.listen_stopped_at = time.perf_counter()
            turn.task = asyncio.create_task(self._finish_turn(turn, pipeline), name=f"turn-{turn.turn_id}")

    async def _execute_tool(self, name: str, arguments: dict[str, Any], generation: int) -> dict[str, Any]:
        if not self.mcp:
            raise ProviderError("MCP_UNAVAILABLE", "device MCP is not enabled for this session")
        return await self.mcp.call(name, arguments, generation)

    async def _handle_intent(self, match: IntentMatch) -> None:
        if match.action not in {"conversation.exit", "turn.cancel"}:
            return
        turn = self.turn
        if turn is not None:
            turn.cancelled.set()
            turn.state = "completed"
            turn.finish_reason = match.action
            turn.conversation_status = "completed"
            if self.mcp:
                self.mcp.cancel_generation(turn.generation)
        # The callback runs inside the turn task, so do not cancel or await that
        # task here. Clearing ownership is enough to reject any later stale audio.
        self.pipeline = None
        self.turn = None
        self.phase = "ready_idle"
        await self.send_text(control_message("alert", session_id=self.session_id, status="ok", code=match.action.replace(".", "_")))

    async def _abort(self, *, reason: str, send_stop: bool = True) -> None:
        pipeline = self.pipeline
        turn = self.turn
        task = turn.task if turn else None
        if pipeline:
            pipeline.cancel()
        if self.mcp and turn:
            self.mcp.cancel_generation(turn.generation)
        # Clear ownership before awaiting a provider task. A misbehaving or
        # late provider callback must not be allowed to write frames for the
        # cancelled turn while a new turn is being created.
        self.pipeline = None
        self.turn = None
        if task and not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        if turn is not None:
            turn.state = "aborted"
            turn.finish_reason = reason
            turn.conversation_status = "aborted" if reason == "disconnect" else "active"
            turn.ended_at = turn.ended_at or _utc_now()
            await self._report_turn(turn)
        if send_stop and self.ready and not self._closed:
            await self.send_text(control_message("tts", session_id=self.session_id, state="stop", reason=reason))

    async def _report_turn(self, turn: Turn) -> None:
        reporter = self.app.history_reporter
        if reporter is None or turn.reported:
            return
        turn.reported = True
        try:
            UUID(self.app.runtime.view.snapshot.assistant_id)
        except (ValueError, AttributeError):
            self.app.metrics["history_invalid_assistant_id"] = self.app.metrics.get("history_invalid_assistant_id", 0) + 1
            return
        ended_at = turn.ended_at or _utc_now()
        event = {
            "conversationId": self.conversation_id,
            "assistantId": self.app.runtime.view.snapshot.assistant_id,
            "deviceKey": self.device_id,
            "locale": self.app.runtime.view.snapshot.locale,
            "configRevision": self.app.runtime.view.snapshot.revision,
            "conversationStartedAt": turn.conversation_started_at or turn.started_at,
            "conversationEndedAt": ended_at if turn.conversation_status != "active" else None,
            "conversationStatus": turn.conversation_status,
            "turnId": turn.turn_id,
            "sequence": turn.sequence,
            "state": turn.state,
            "startedAt": turn.started_at,
            "endedAt": ended_at,
            "finishReason": turn.finish_reason,
            "timings": dict(turn.timings),
            "transcript": list(turn.transcript),
            "toolCalls": list(turn.tool_calls),
        }
        if event["conversationEndedAt"] is None:
            del event["conversationEndedAt"]
        if not reporter.enqueue(event):
            self.app.metrics["history_enqueue_dropped"] = self.app.metrics.get("history_enqueue_dropped", 0) + 1

    async def send_text(self, value: dict[str, Any]) -> None:
        if not self._closed:
            turn_id = value.get("turn_id")
            if isinstance(turn_id, str) and (self.turn is None or self.turn.turn_id != turn_id):
                return
            if value.get("type") == "tts" and value.get("state") == "start":
                self.phase = "speaking"
            elif value.get("type") == "tts" and value.get("state") == "stop":
                self.phase = "listening"
            await self.ws.send_str(json.dumps(value, ensure_ascii=False, separators=(",", ":")))

    async def send_binary(self, value: bytes, *, turn_id: str | None = None) -> None:
        if not self._closed and (turn_id is None or (self.turn is not None and self.turn.turn_id == turn_id)):
            await self.ws.send_bytes(value)

    async def close(self, code: int, message: str) -> None:
        if self._closed:
            return
        self._closed = True
        await self.ws.close(code=code, message=message.encode())
