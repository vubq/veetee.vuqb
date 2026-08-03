import asyncio

import pytest

from veetee_server.mcp import DeviceMcpBridge
from veetee_server.providers import ProviderError


@pytest.mark.asyncio
async def test_mcp_call_uses_positive_monotonic_id_and_resolves():
    sent = []

    async def send(value):
        sent.append(value)

    bridge = DeviceMcpBridge(session_id="session", send=send, descriptors=[{"name": "device.led.set"}], timeout_ms=1000)
    await bridge.initialize()
    await bridge.list_tools()
    task = asyncio.create_task(bridge.call("device.led.set", {"red": 1}, generation=2))
    await asyncio.sleep(0)
    request = sent[-1]["payload"]
    assert request["method"] == "tools/call"
    assert request["id"] > 0
    assert bridge.resolve({"jsonrpc": "2.0", "id": request["id"], "result": {"isError": False}})
    assert await task == {"isError": False}


@pytest.mark.asyncio
async def test_mcp_cancel_generation_cancels_pending_call():
    async def send(value):
        return None

    bridge = DeviceMcpBridge(session_id="session", send=send, descriptors=[{"name": "device.led.set"}], timeout_ms=1000)
    task = asyncio.create_task(bridge.call("device.led.set", {}, generation=3))
    await asyncio.sleep(0)
    bridge.cancel_generation(3)
    with pytest.raises(asyncio.CancelledError):
        await task


def test_mcp_resolve_rejects_invalid_jsonrpc_ids():
    async def send(value):
        del value

    bridge = DeviceMcpBridge(session_id="session", send=send, descriptors=[], timeout_ms=1000)
    assert bridge.resolve({"jsonrpc": "1.0", "id": 1, "result": {}}) is False
    assert bridge.resolve({"jsonrpc": "2.0", "id": True, "result": {}}) is False
    assert bridge.resolve({"jsonrpc": "2.0", "id": 0, "result": {}}) is False
    assert bridge.resolve({"jsonrpc": "2.0", "id": -1, "result": {}}) is False


@pytest.mark.asyncio
async def test_mcp_send_failure_removes_pending_request():
    async def send(value):
        del value
        raise OSError("socket closed")

    bridge = DeviceMcpBridge(session_id="session", send=send, descriptors=[{"name": "device.led.set"}], timeout_ms=1000)
    with pytest.raises(ProviderError, match="device tool request could not be sent"):
        await bridge.call("device.led.set", {}, generation=4)
    assert bridge._pending == {}
