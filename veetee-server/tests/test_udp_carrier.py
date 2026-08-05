from __future__ import annotations

import asyncio

import pytest

from veetee_server.udp_carrier import (
    UDP_MAX_DATAGRAM_BYTES,
    UdpCarrierConfig,
    UdpCarrierError,
    UdpDatagramCarrier,
)


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
    protocol = _Peer()
    transport, _ = await loop.create_datagram_endpoint(
        lambda: protocol,
        local_addr=("127.0.0.1", 0),
    )
    assert protocol.address is not None
    return transport, protocol


def _config(peer: _Peer, *, queue_capacity: int = 4) -> UdpCarrierConfig:
    assert peer.address is not None
    return UdpCarrierConfig(
        bind_host="127.0.0.1",
        bind_port=0,
        peer_host="127.0.0.1",
        peer_port=peer.address[1],
        queue_capacity=queue_capacity,
    )


@pytest.mark.asyncio
async def test_loopback_carrier_sends_and_yields_bounded_bytes() -> None:
    peer_transport, peer = await _make_peer()
    try:
        async with UdpDatagramCarrier(_config(peer)) as carrier:
            await carrier.send(b"ciphertext")
            sent, sender = await asyncio.wait_for(peer.received.get(), timeout=1)
            assert sent == b"ciphertext"
            assert sender == carrier.local_address
            assert peer.transport is not None
            peer.transport.sendto(b"reply", sender)
            incoming = carrier.incoming()
            assert await asyncio.wait_for(anext(incoming), timeout=1) == b"reply"
            await incoming.aclose()
            assert carrier.metrics.packets_sent == 1
            assert carrier.metrics.packets_received == 1
    finally:
        peer_transport.close()


@pytest.mark.asyncio
async def test_carrier_drops_newest_packet_when_queue_is_full() -> None:
    peer_transport, peer = await _make_peer()
    try:
        async with UdpDatagramCarrier(_config(peer, queue_capacity=1)) as carrier:
            assert carrier.local_address is not None
            assert peer.transport is not None
            peer.transport.sendto(b"first", carrier.local_address)
            peer.transport.sendto(b"second", carrier.local_address)
            for _ in range(3):
                await asyncio.sleep(0)
            incoming = carrier.incoming()
            assert await asyncio.wait_for(anext(incoming), timeout=1) == b"first"
            assert carrier.metrics.packets_dropped == 1
            await incoming.aclose()
    finally:
        peer_transport.close()


@pytest.mark.asyncio
async def test_carrier_rejects_invalid_send_and_closes_incoming() -> None:
    peer_transport, peer = await _make_peer()
    carrier = UdpDatagramCarrier(_config(peer))
    with pytest.raises(UdpCarrierError, match="not open"):
        await carrier.send(b"before-open")
    with pytest.raises(UdpCarrierError, match="not open"):
        await anext(carrier.incoming())
    try:
        async with carrier:
            with pytest.raises(UdpCarrierError, match="outside configured limits"):
                await carrier.send(b"x" * (UDP_MAX_DATAGRAM_BYTES + 1))
            incoming = carrier.incoming()
            await carrier.close()
            with pytest.raises(StopAsyncIteration):
                await anext(incoming)
    finally:
        peer_transport.close()


def test_carrier_config_is_explicit_and_bounded() -> None:
    with pytest.raises(UdpCarrierError, match="missing carrier field"):
        UdpCarrierConfig.from_mapping({"bind_host": "127.0.0.1"})
    with pytest.raises(UdpCarrierError, match="queue_capacity"):
        UdpCarrierConfig.from_mapping({
            "bind_host": "127.0.0.1",
            "peer_host": "127.0.0.1",
            "peer_port": 1,
            "queue_capacity": 0,
        })
    config = UdpCarrierConfig.from_mapping({
        "bind_host": "127.0.0.1",
        "peer_host": "127.0.0.1",
        "peer_port": 9,
    })
    assert config.bind_port == 0
    assert config.max_datagram_bytes == UDP_MAX_DATAGRAM_BYTES
