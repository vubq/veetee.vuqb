"""Device MCP JSON-RPC bridge with bounded pending calls and generation safety."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any, Awaitable, Callable

from .providers import ProviderError


@dataclass(slots=True)
class PendingCall:
    request_id: int
    turn_generation: int
    future: asyncio.Future[dict[str, Any]]


class DeviceMcpBridge:
    def __init__(self, *, session_id: str, send: Callable[[dict[str, Any]], Awaitable[None]], descriptors: list[dict[str, Any]], timeout_ms: int) -> None:
        self.session_id = session_id
        self._send = send
        self._descriptors = descriptors
        self._timeout_s = max(1, timeout_ms) / 1000
        self._next_id = 1
        self._pending: dict[int, PendingCall] = {}

    async def initialize(self) -> None:
        await self._send(self._envelope(self._allocate(), "initialize", {"protocolVersion": "2024-11-05", "capabilities": {}, "clientInfo": {"name": "veetee-server", "version": "0.1.0"}}))

    async def list_tools(self) -> None:
        await self._send(self._envelope(self._allocate(), "tools/list", {}))

    async def call(self, name: str, arguments: dict[str, Any], generation: int) -> dict[str, Any]:
        if not any(descriptor.get("name") == name for descriptor in self._descriptors):
            raise ProviderError("TOOL_NOT_ALLOWED", f"tool is not present in published descriptor: {name}")
        request_id = self._allocate()
        loop = asyncio.get_running_loop()
        future: asyncio.Future[dict[str, Any]] = loop.create_future()
        self._pending[request_id] = PendingCall(request_id, generation, future)
        await self._send(self._envelope(request_id, "tools/call", {"name": name, "arguments": arguments}))
        try:
            result = await asyncio.wait_for(future, timeout=self._timeout_s)
        except asyncio.TimeoutError as exc:
            self._pending.pop(request_id, None)
            raise ProviderError("TOOL_TIMEOUT", f"device tool timed out: {name}", retryable=True) from exc
        if result.get("error"):
            raise ProviderError("TOOL_FAILED", str(result["error"]))
        return result

    def resolve(self, payload: dict[str, Any]) -> bool:
        request_id = payload.get("id")
        if not isinstance(request_id, int):
            return False
        pending = self._pending.pop(request_id, None)
        if pending is None or pending.future.done():
            return False
        if "error" in payload:
            pending.future.set_result({"error": payload["error"]})
        else:
            pending.future.set_result(payload.get("result") if isinstance(payload.get("result"), dict) else {"result": payload.get("result")})
        return True

    def cancel_generation(self, generation: int) -> None:
        for request_id, pending in list(self._pending.items()):
            if pending.turn_generation == generation and not pending.future.done():
                pending.future.cancel()
                self._pending.pop(request_id, None)

    def _allocate(self) -> int:
        if self._next_id > 2_147_483_647:
            raise ProviderError("MCP_ID_EXHAUSTED", "MCP session must be reopened")
        value = self._next_id
        self._next_id += 1
        return value

    def _envelope(self, request_id: int, method: str, params: dict[str, Any]) -> dict[str, Any]:
        return {"type": "mcp", "session_id": self.session_id, "payload": {"jsonrpc": "2.0", "id": request_id, "method": method, "params": params}}
