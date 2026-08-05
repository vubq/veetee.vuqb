from __future__ import annotations

import asyncio

import pytest

from veetee_server.mqtt_carrier import MqttCarrierError, MqttControlCarrier
from veetee_server.mqtt_control import MqttPublish, parse_mqtt_session_config


def _config():
    return parse_mqtt_session_config({
        "endpoint": "broker.test:1884",
        "client_id": "device-1",
        "publish_topic": "up/device-1",
        "subscribe_topic": "down/device-1",
        "username": "operator",
        "password": "secret",
    })


class FakeMessage:
    def __init__(self, topic: str, payload: bytes) -> None:
        self.topic = topic
        self.payload = payload


class FakeClient:
    def __init__(self, **kwargs):
        self.kwargs = kwargs
        self.subscriptions: list[tuple[str, int]] = []
        self.publications: list[tuple[str, bytes, int, bool]] = []
        self.messages_queue: asyncio.Queue[FakeMessage | None] = asyncio.Queue()
        self.closed = False

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, traceback):
        self.closed = True

    async def subscribe(self, topic: str, *, qos: int):
        self.subscriptions.append((topic, qos))

    async def publish(self, topic: str, payload: bytes, *, qos: int, retain: bool):
        self.publications.append((topic, payload, qos, retain))

    @property
    def messages(self):
        async def iterate():
            while True:
                message = await self.messages_queue.get()
                if message is None:
                    return
                yield message

        return iterate()


@pytest.mark.asyncio
async def test_carrier_constructs_client_subscribes_and_publishes_without_decoding():
    created: list[FakeClient] = []

    def factory(endpoint, port, **kwargs):
        client = FakeClient(endpoint=endpoint, port=port, **kwargs)
        created.append(client)
        return client

    async with MqttControlCarrier(_config(), client_factory=factory) as carrier:
        assert created[0].kwargs == {
            "endpoint": "broker.test",
            "port": 1884,
            "username": "operator",
            "password": "secret",
            "identifier": "device-1",
            "keepalive": 240,
        }
        assert created[0].subscriptions == [("down/device-1", 1)]
        await carrier.publish(MqttPublish("up/device-1", b'{"type":"ping"}', 1, False))
        assert created[0].publications == [("up/device-1", b'{"type":"ping"}', 1, False)]
    assert created[0].closed is True


@pytest.mark.asyncio
async def test_carrier_yields_exact_topic_messages_and_rejects_other_topic():
    client = FakeClient()
    client.messages_queue.put_nowait(FakeMessage("down/device-1", b"{}"))
    client.messages_queue.put_nowait(FakeMessage("unexpected", b"{}"))

    async with MqttControlCarrier(_config(), client_factory=lambda *args, **kwargs: client) as carrier:
        incoming = carrier.incoming()
        assert await anext(incoming) == ("down/device-1", b"{}")
        with pytest.raises(MqttCarrierError, match="unexpected topic"):
            await anext(incoming)


@pytest.mark.asyncio
async def test_carrier_rejects_publish_before_connect_and_oversized_payload():
    carrier = MqttControlCarrier(_config(), client_factory=lambda *args, **kwargs: FakeClient())
    with pytest.raises(MqttCarrierError, match="not connected"):
        await carrier.publish(MqttPublish("up/device-1", b"{}", 1, False))

    async with carrier:
        with pytest.raises(MqttCarrierError, match="exceeds 8192"):
            await carrier.publish(MqttPublish("up/device-1", b"x" * 8193, 1, False))


@pytest.mark.asyncio
async def test_carrier_dependency_failure_is_typed():
    def missing_factory(*args, **kwargs):
        raise MqttCarrierError("MQTT_CLIENT_MISSING", "install the optional mqtt extra")

    with pytest.raises(MqttCarrierError, match="optional mqtt extra"):
        async with MqttControlCarrier(_config(), client_factory=missing_factory):
            pass
