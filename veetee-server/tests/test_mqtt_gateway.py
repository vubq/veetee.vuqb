from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest

from veetee_server.mqtt_control import encode_control_payload, parse_mqtt_session_config
from veetee_server.mqtt_gateway import MqttGatewayError, MqttUdpGateway, MqttUdpGatewayConfig
from veetee_server.mqtt_udp import UdpCryptoSession


FIXTURE = Path(__file__).parents[2] / "tests/fixtures/mqtt_control_v3.json"


def _fixture() -> dict[str, object]:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def _config() -> object:
    fixture = _fixture()
    return parse_mqtt_session_config(fixture["config"])


def test_gateway_config_requires_explicit_bind_host_and_bounds_values() -> None:
    with pytest.raises(MqttGatewayError, match="missing gateway field"):
        MqttUdpGatewayConfig.from_mapping({})
    with pytest.raises(MqttGatewayError, match="queue_capacity"):
        MqttUdpGatewayConfig.from_mapping({"bind_host": "127.0.0.1", "queue_capacity": 0})
    config = MqttUdpGatewayConfig.from_mapping({"bind_host": "127.0.0.1"})
    assert config.bind_port == 0
    assert config.handshake_timeout_ms == 10_000


class _Peer(asyncio.DatagramProtocol):
    def __init__(self) -> None:
        self.transport: asyncio.DatagramTransport | None = None
        self.address: tuple[str, int] | None = None
        self.received: asyncio.Queue[tuple[bytes, tuple[str, int]]] = asyncio.Queue()

    def connection_made(self, transport: asyncio.BaseTransport) -> None:
        self.transport = transport  # type: ignore[assignment]
        address = transport.get_extra_info("sockname")
        self.address = (str(address[0]), int(address[1]))

    def datagram_received(self, data: bytes, addr: tuple[str, int]) -> None:
        self.received.put_nowait((bytes(data), addr))


async def _make_peer() -> tuple[asyncio.DatagramTransport, _Peer]:
    loop = asyncio.get_running_loop()
    peer = _Peer()
    transport, _ = await loop.create_datagram_endpoint(lambda: peer, local_addr=("127.0.0.1", 0))
    assert peer.address is not None
    return transport, peer


class _Client:
    def __init__(self, *, server_hello: dict[str, object]) -> None:
        self.server_hello = server_hello
        self.messages: asyncio.Queue[tuple[str, bytes] | None] = asyncio.Queue()
        self.published: list[tuple[str, bytes, int, bool]] = []
        self.closed = False

    async def __aenter__(self) -> "_Client":
        return self

    async def __aexit__(self, exc_type, exc, traceback) -> None:
        self.closed = True
        self.messages.put_nowait(None)

    async def subscribe(self, topic: str, *, qos: int) -> None:
        assert qos == 1

    async def publish(self, topic: str, payload: bytes, *, qos: int, retain: bool) -> None:
        self.published.append((topic, bytes(payload), qos, retain))
        message = json.loads(payload.decode("utf-8"))
        if message.get("type") == "hello":
            self.messages.put_nowait(("downstream/opaque-7", encode_control_payload(self.server_hello)))

    @property
    def message_iterator(self):
        async def iterate():
            while True:
                item = await self.messages.get()
                if item is None:
                    return
                yield type("Message", (), {"topic": item[0], "payload": item[1]})()

        return iterate()


def _client_factory(client: _Client):
    def factory(*args, **kwargs):
        return _ClientAdapter(client)

    return factory


class _ClientAdapter:
    """Expose the aiomqtt-shaped ``messages`` iterator on a test client."""

    def __init__(self, client: _Client) -> None:
        self.client = client

    async def __aenter__(self) -> _ClientAdapter:
        await self.client.__aenter__()
        return self

    async def __aexit__(self, exc_type, exc, traceback) -> None:
        await self.client.__aexit__(exc_type, exc, traceback)

    async def subscribe(self, topic: str, *, qos: int) -> None:
        await self.client.subscribe(topic, qos=qos)

    async def publish(self, topic: str, payload: bytes, *, qos: int, retain: bool) -> None:
        await self.client.publish(topic, payload, qos=qos, retain=retain)

    @property
    def messages(self):
        return self.client.message_iterator


@pytest.mark.asyncio
async def test_gateway_handshake_composes_control_and_udp_loopback() -> None:
    peer_transport, peer = await _make_peer()
    client: _Client | None = None
    try:
        fixture = _fixture()
        server_hello = dict(fixture["server_hello"])
        udp = dict(server_hello["udp"])
        assert peer.address is not None
        udp.update({"server": "127.0.0.1", "port": peer.address[1]})
        server_hello["udp"] = udp
        client = _Client(server_hello=server_hello)
        gateway = MqttUdpGateway(
            _config(),
            MqttUdpGatewayConfig(bind_host="127.0.0.1"),
            client_factory=_client_factory(client),
        )
        handshake = await gateway.start(fixture["client_hello"])
        assert handshake.message == server_hello
        assert gateway.state == gateway.READY
        assert gateway.udp_carrier.local_address is not None

        await gateway.send_audio(b"uplink-opus", timestamp_ms=60, ssrc=7)
        wire, sender = await asyncio.wait_for(peer.received.get(), timeout=1)
        assert sender == gateway.udp_carrier.local_address
        decoded = UdpCryptoSession(bytes.fromhex(udp["key"]), bytes.fromhex(udp["nonce"])).decrypt(wire)
        assert decoded.sequence == 1
        assert decoded.timestamp_ms == 60
        assert decoded.opus == b"uplink-opus"
        await gateway.close()
        assert client.closed is True
    finally:
        peer_transport.close()


@pytest.mark.asyncio
async def test_gateway_events_join_tts_control_and_encrypted_udp_bytes() -> None:
    peer_transport, peer = await _make_peer()
    try:
        fixture = _fixture()
        server_hello = dict(fixture["server_hello"])
        udp = dict(server_hello["udp"])
        assert peer.address is not None
        udp.update({"server": "127.0.0.1", "port": peer.address[1]})
        server_hello["udp"] = udp
        client = _Client(server_hello=server_hello)
        gateway = MqttUdpGateway(
            _config(),
            MqttUdpGatewayConfig(bind_host="127.0.0.1"),
            client_factory=_client_factory(client),
        )
        await gateway.start(fixture["client_hello"])
        assert gateway.session_id == "session-1"
        downlink_crypto = UdpCryptoSession(bytes.fromhex(udp["key"]), bytes.fromhex(udp["nonce"]))
        start = {
            "type": "tts",
            "state": "start",
            "session_id": "session-1",
            "audio_stream_id": 7,
            "start_sequence": 1,
        }
        client.messages.put_nowait(("downstream/opaque-7", encode_control_payload(start)))
        assert peer.transport is not None
        peer.transport.sendto(downlink_crypto.encrypt(b"downlink-opus", timestamp_ms=120, ssrc=7), gateway.udp_carrier.local_address)
        event_stream = gateway.events()
        events = [await asyncio.wait_for(anext(event_stream), timeout=1), await asyncio.wait_for(anext(event_stream), timeout=1)]
        assert {event.source for event in events} == {"control", "audio"}
        released = []
        for event in events:
            result = event.stream_result if event.source == "audio" else event.control.stream_result
            if result is not None:
                released.extend(packet.opus for packet in result.released)
        assert released == [b"downlink-opus"]
        await event_stream.aclose()
        assert gateway.state == gateway.CLOSED
    finally:
        peer_transport.close()


@pytest.mark.asyncio
async def test_gateway_rejects_use_before_handshake_and_closes_on_control_end() -> None:
    client = _Client(server_hello=_fixture()["server_hello"])
    gateway = MqttUdpGateway(
        _config(),
        MqttUdpGatewayConfig(bind_host="127.0.0.1"),
        client_factory=_client_factory(client),
    )
    with pytest.raises(MqttGatewayError, match="not READY"):
        await gateway.send_control({"type": "ping"})
    await gateway.close()
    assert gateway.state == gateway.CLOSED
