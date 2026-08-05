import asyncio
import json
from pathlib import Path

import pytest

from veetee_server.mcp import DeviceMcpBridge


FIXTURE = Path(__file__).parents[2] / "tests/fixtures/mcp_conformance.json"


def load_fixture() -> dict:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


@pytest.mark.asyncio
async def test_server_mcp_requests_match_shared_firmware_contract():
    fixture = load_fixture()
    sent: list[dict] = []

    async def send(value: dict) -> None:
        sent.append(value)

    bridge = DeviceMcpBridge(
        session_id=fixture["session_id"],
        send=send,
        descriptors=fixture["tools"],
        timeout_ms=1000,
    )

    for case in fixture["server_cases"]:
        method = case["method"]
        params = case["params"]
        if method == "initialize":
            task = asyncio.create_task(bridge.initialize())
        elif method == "tools/list":
            task = asyncio.create_task(bridge.list_tools())
        else:
            task = asyncio.create_task(bridge.call(params["name"], params["arguments"], generation=1))
        await asyncio.sleep(0)

        request = sent[-1]
        payload = request["payload"]
        assert request["type"] == "mcp"
        assert request["session_id"] == fixture["session_id"]
        assert payload["jsonrpc"] == "2.0"
        assert payload["method"] == method
        assert payload["params"] == params

        response = dict(case["response"])
        response["id"] = payload["id"]
        assert bridge.resolve(response)
        result = await task
        assert result == response["result"]
