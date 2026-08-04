"""Device MCP JSON-RPC bridge with bounded pending calls and generation safety."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
import math
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

    async def initialize(self) -> dict[str, Any]:
        return await self._request(
            "initialize",
            {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "veetee-server", "version": "0.1.0"},
            },
            error_code="MCP_INITIALIZE_FAILED",
        )

    async def list_tools(self, *, cursor: str | None = None) -> dict[str, Any]:
        params: dict[str, Any] = {}
        if cursor is not None:
            params["cursor"] = cursor
        return await self._request("tools/list", params, error_code="MCP_TOOLS_LIST_FAILED")

    async def call(self, name: str, arguments: dict[str, Any], generation: int) -> dict[str, Any]:
        descriptor = next((item for item in self._descriptors if item.get("name") == name), None)
        if descriptor is None:
            raise ProviderError("TOOL_NOT_ALLOWED", f"tool is not present in published descriptor: {name}")
        try:
            _validate_tool_arguments(arguments, descriptor.get("inputSchema"))
        except ToolSchemaError as exc:
            raise ProviderError("TOOL_ARGUMENTS_INVALID", str(exc)) from exc
        request_id = self._allocate()
        loop = asyncio.get_running_loop()
        future: asyncio.Future[dict[str, Any]] = loop.create_future()
        self._pending[request_id] = PendingCall(request_id, generation, future)
        try:
            await self._send(self._envelope(request_id, "tools/call", {"name": name, "arguments": arguments}))
            result = await asyncio.wait_for(future, timeout=self._timeout_s)
        except asyncio.CancelledError:
            self._pending.pop(request_id, None)
            raise
        except asyncio.TimeoutError as exc:
            self._pending.pop(request_id, None)
            raise ProviderError("TOOL_TIMEOUT", f"device tool timed out: {name}", retryable=True) from exc
        except ProviderError:
            self._pending.pop(request_id, None)
            raise
        except Exception as exc:  # noqa: BLE001
            self._pending.pop(request_id, None)
            raise ProviderError("TOOL_TRANSPORT_FAILED", "device tool request could not be sent", retryable=True) from exc
        finally:
            self._pending.pop(request_id, None)
        if result.get("error"):
            raise ProviderError("TOOL_FAILED", str(result["error"]))
        return result

    async def _request(self, method: str, params: dict[str, Any], *, error_code: str) -> dict[str, Any]:
        request_id = self._allocate()
        loop = asyncio.get_running_loop()
        future: asyncio.Future[dict[str, Any]] = loop.create_future()
        self._pending[request_id] = PendingCall(request_id, 0, future)
        try:
            await self._send(self._envelope(request_id, method, params))
            result = await asyncio.wait_for(future, timeout=self._timeout_s)
        except asyncio.CancelledError:
            self._pending.pop(request_id, None)
            raise
        except asyncio.TimeoutError as exc:
            self._pending.pop(request_id, None)
            raise ProviderError(error_code, f"device MCP request timed out: {method}", retryable=True) from exc
        except ProviderError:
            self._pending.pop(request_id, None)
            raise
        except Exception as exc:  # noqa: BLE001
            self._pending.pop(request_id, None)
            raise ProviderError(error_code, "device MCP request could not be sent", retryable=True) from exc
        finally:
            self._pending.pop(request_id, None)
        if result.get("error"):
            raise ProviderError(error_code, str(result["error"]))
        return result

    def resolve(self, payload: dict[str, Any]) -> bool:
        if payload.get("jsonrpc") != "2.0":
            return False
        request_id = payload.get("id")
        if isinstance(request_id, bool) or not isinstance(request_id, int) or not 0 < request_id <= 2_147_483_647:
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

    def cancel_all(self) -> None:
        for request_id, pending in list(self._pending.items()):
            if not pending.future.done():
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


class ToolSchemaError(ValueError):
    """A bounded, wire-compatible tool schema or argument validation error."""


_SUPPORTED_SCHEMA_TYPES = {"array", "boolean", "integer", "number", "object", "string"}
_MAX_SCHEMA_DEPTH = 8
_MAX_OBJECT_PROPERTIES = 64
_MAX_ARRAY_ITEMS = 128


def _validate_tool_arguments(arguments: Any, raw_schema: Any) -> None:
    """Validate an MCP call using the supported JSON Schema subset.

    Device descriptors are configuration data, so validation is intentionally
    generic and never branches on a tool name.  A missing schema is treated as
    an empty object schema for compatibility with older descriptors; a present
    malformed/unsupported schema fails closed before any device request is sent.
    """

    schema = {} if raw_schema is None else raw_schema
    if not isinstance(schema, dict):
        raise ToolSchemaError("tool inputSchema must be an object")
    _validate_schema_node(arguments, schema, path="$", depth=0)


def _validate_schema_node(value: Any, schema: dict[str, Any], *, path: str, depth: int) -> None:
    if depth > _MAX_SCHEMA_DEPTH:
        raise ToolSchemaError(f"{path}: schema nesting exceeds {_MAX_SCHEMA_DEPTH} levels")
    schema_type = schema.get("type", "object")
    if not isinstance(schema_type, str) or schema_type not in _SUPPORTED_SCHEMA_TYPES:
        raise ToolSchemaError(f"{path}: unsupported schema type")

    enum = schema.get("enum")
    if enum is not None:
        if not isinstance(enum, list) or not enum or not any(_json_value_equal(value, item) for item in enum):
            raise ToolSchemaError(f"{path}: value is not one of the allowed options")

    if schema_type == "object":
        if not isinstance(value, dict):
            raise ToolSchemaError(f"{path}: expected object")
        if any(not isinstance(name, str) for name in value):
            raise ToolSchemaError(f"{path}: object property names must be strings")
        properties = schema.get("properties", {})
        if not isinstance(properties, dict) or len(properties) > _MAX_OBJECT_PROPERTIES:
            raise ToolSchemaError(f"{path}: properties must be a bounded object")
        if any(not isinstance(name, str) or not isinstance(item, dict) for name, item in properties.items()):
            raise ToolSchemaError(f"{path}: property schema is invalid")
        required = schema.get("required", [])
        if not isinstance(required, list) or any(not isinstance(item, str) or not item for item in required):
            raise ToolSchemaError(f"{path}: required must be an array of names")
        for name in required:
            if name not in value:
                raise ToolSchemaError(f"{path}.{name}: required property is missing")
        additional = schema.get("additionalProperties", True)
        if not isinstance(additional, bool):
            raise ToolSchemaError(f"{path}: additionalProperties must be boolean")
        if not additional:
            unknown = sorted(set(value) - set(properties))
            if unknown:
                raise ToolSchemaError(f"{path}.{unknown[0]}: unknown property")
        for name, item in value.items():
            child_schema = properties.get(name)
            if child_schema is None:
                continue
            _validate_schema_node(item, child_schema, path=f"{path}.{name}", depth=depth + 1)
        return

    if schema_type == "array":
        if not isinstance(value, list):
            raise ToolSchemaError(f"{path}: expected array")
        if len(value) > _MAX_ARRAY_ITEMS:
            raise ToolSchemaError(f"{path}: array exceeds {_MAX_ARRAY_ITEMS} items")
        minimum = schema.get("minItems")
        maximum = schema.get("maxItems")
        if _bounded_number(minimum, "minItems", path) is not None and len(value) < minimum:
            raise ToolSchemaError(f"{path}: array has fewer than minItems")
        if _bounded_number(maximum, "maxItems", path) is not None and len(value) > maximum:
            raise ToolSchemaError(f"{path}: array has more than maxItems")
        item_schema = schema.get("items")
        if item_schema is not None:
            if not isinstance(item_schema, dict):
                raise ToolSchemaError(f"{path}: items schema is invalid")
            for index, item in enumerate(value):
                _validate_schema_node(item, item_schema, path=f"{path}[{index}]", depth=depth + 1)
        return

    if schema_type == "string":
        if not isinstance(value, str):
            raise ToolSchemaError(f"{path}: expected string")
        _validate_string_bounds(value, schema, path)
        return

    if schema_type == "boolean":
        if not isinstance(value, bool):
            raise ToolSchemaError(f"{path}: expected boolean")
        return

    if schema_type == "integer":
        if isinstance(value, bool) or not isinstance(value, int):
            raise ToolSchemaError(f"{path}: expected integer")
        _validate_numeric_bounds(value, schema, path)
        return

    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(float(value)):
        raise ToolSchemaError(f"{path}: expected finite number")
    _validate_numeric_bounds(value, schema, path)


def _validate_string_bounds(value: str, schema: dict[str, Any], path: str) -> None:
    minimum = schema.get("minLength")
    maximum = schema.get("maxLength")
    if _bounded_number(minimum, "minLength", path) is not None and len(value) < minimum:
        raise ToolSchemaError(f"{path}: string is shorter than minLength")
    if _bounded_number(maximum, "maxLength", path) is not None and len(value) > maximum:
        raise ToolSchemaError(f"{path}: string is longer than maxLength")


def _validate_numeric_bounds(value: int | float, schema: dict[str, Any], path: str) -> None:
    minimum = schema.get("minimum")
    maximum = schema.get("maximum")
    if _bounded_number(minimum, "minimum", path) is not None and value < minimum:
        raise ToolSchemaError(f"{path}: value is below minimum")
    if _bounded_number(maximum, "maximum", path) is not None and value > maximum:
        raise ToolSchemaError(f"{path}: value is above maximum")


def _bounded_number(value: Any, name: str, path: str) -> int | float | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(float(value)):
        raise ToolSchemaError(f"{path}: {name} must be a finite number")
    if value < 0:
        raise ToolSchemaError(f"{path}: {name} must be non-negative")
    if name in {"minItems", "maxItems", "minLength", "maxLength"} and not isinstance(value, int):
        raise ToolSchemaError(f"{path}: {name} must be an integer")
    return value


def _json_value_equal(left: Any, right: Any) -> bool:
    if isinstance(left, bool) or isinstance(right, bool):
        return type(left) is type(right) and left == right
    return left == right
