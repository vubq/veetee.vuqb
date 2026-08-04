"""Deterministic host-only loss/reorder soak for the staged UDP profile."""

from __future__ import annotations

import random

import pytest

from veetee_server.mqtt_udp import UdpAudioPacket, UdpTtsStreamBarrier


STREAM_ID = 42
SESSION_ID = "soak-session"
PACKET_COUNT = 400


def _packet(sequence: int) -> UdpAudioPacket:
    return UdpAudioPacket(
        flags=0,
        ssrc=STREAM_ID,
        timestamp_ms=sequence * 60,
        sequence=sequence,
        opus=bytes((sequence & 0xFF,)),
    )


def _control(state: str, sequence: int) -> dict[str, object]:
    return {
        "type": "tts",
        "state": state,
        "session_id": SESSION_ID,
        "audio_stream_id": STREAM_ID,
        ("start_sequence" if state == "start" else "end_sequence"): sequence,
    }


def _bounded_reorder(packets: list[UdpAudioPacket], rng: random.Random) -> list[UdpAudioPacket]:
    """Permute independent groups of four, matching the receiver window."""

    output: list[UdpAudioPacket] = []
    for offset in range(0, len(packets), 4):
        group = packets[offset : offset + 4]
        rng.shuffle(group)
        output.extend(group)
    return output


def _run_profile(loss_rate: float, seed: int, *, duplicates: bool = False) -> tuple[UdpTtsStreamBarrier, int, int]:
    rng = random.Random(seed)
    barrier = UdpTtsStreamBarrier(SESSION_ID)
    barrier.start(_control("start", 1), now=0)
    barrier.stop(_control("stop", PACKET_COUNT), now=0)
    source = [_packet(sequence) for sequence in range(1, PACKET_COUNT + 1)]
    selected = [packet for packet in source[:-1] if rng.random() >= loss_rate]
    selected.append(source[-1])  # keep the inclusive stop boundary present
    if duplicates:
        selected[30:30] = [source[30], source[30]]
    delivered = _bounded_reorder(selected, rng)

    released = 0
    lost = 0
    now = 0.01
    for packet in delivered:
        result = barrier.push(packet, now=now)
        released += len(result.released)
        lost += len(result.lost_sequences)
        now += 0.01
    result = barrier.tick(now=now + 0.2)
    released += len(result.released)
    lost += len(result.lost_sequences)
    return barrier, released, lost


@pytest.mark.parametrize("loss_rate, seed", [(0.0, 11), (0.01, 17), (0.05, 23)])
def test_udp_loss_profiles_complete_without_unbounded_reorder(loss_rate: float, seed: int):
    barrier, released, lost = _run_profile(loss_rate, seed)
    assert barrier.state == barrier.COMPLETED
    assert released + lost == PACKET_COUNT
    assert len(barrier.reorder.pending_sequences) <= 4
    if loss_rate == 0:
        assert lost == 0
    else:
        assert lost > 0


def test_udp_duplicate_and_reorder_profile_is_idempotent():
    barrier, released, lost = _run_profile(0.01, 31, duplicates=True)
    assert barrier.state == barrier.COMPLETED
    assert barrier.reorder.duplicates >= 1
    assert released + lost == PACKET_COUNT
    assert len(barrier.reorder.pending_sequences) <= 4


def test_udp_long_ordered_stream_keeps_receiver_state_bounded():
    barrier = UdpTtsStreamBarrier(SESSION_ID)
    barrier.start(_control("start", 1), now=0)
    barrier.stop(_control("stop", 20_000), now=0)
    released = 0
    for sequence in range(1, 20_001):
        result = barrier.push(_packet(sequence), now=sequence / 1000)
        released += len(result.released)
        assert len(barrier.reorder.pending_sequences) <= 4
    assert barrier.state == barrier.COMPLETED
    assert released == 20_000
