"""Unit tests for the pause-aware SessionClock.

These exercise the clock in isolation (no LiveKit / boto3 deps) so they run in
any environment.
"""

import asyncio
import time
from datetime import datetime, timedelta, timezone

from app.core.session_clock import SessionClock


def _clock(seconds_ago: float = 0.0) -> SessionClock:
    return SessionClock(datetime.now(timezone.utc) - timedelta(seconds=seconds_ago))


def test_elapsed_counts_wall_time_when_running():
    c = _clock(seconds_ago=100)
    assert 99.0 <= c.elapsed() <= 101.0
    assert c.is_paused is False
    assert c.paused_offset == 0.0


def test_pause_freezes_elapsed_and_resume_banks_offset():
    c = _clock(seconds_ago=100)
    c.pause()
    assert c.is_paused is True
    at_pause = c.elapsed()
    time.sleep(0.3)
    # elapsed must not advance while paused
    assert abs(c.elapsed() - at_pause) < 0.05
    # paused_offset includes the currently-open pause
    assert c.paused_offset >= 0.3
    c.resume()
    assert c.is_paused is False
    assert c.paused_offset >= 0.3
    # after resume, elapsed advances again
    before = c.elapsed()
    time.sleep(0.2)
    assert c.elapsed() >= before + 0.15


def test_pause_resume_are_idempotent():
    c = _clock(seconds_ago=10)
    c.pause()
    first_since = c._paused_since
    c.pause()  # no-op
    assert c._paused_since == first_since
    c.resume()
    offset_after_first = c.paused_offset
    c.resume()  # no-op, must not add more
    assert c.paused_offset == offset_after_first


def test_multiple_pause_cycles_accumulate():
    c = _clock(seconds_ago=10)
    c.pause()
    time.sleep(0.2)
    c.resume()
    c.pause()
    time.sleep(0.2)
    c.resume()
    # two ~0.2s pauses
    assert 0.35 <= c.paused_offset <= 0.6


def test_pause_aware_sleep_excludes_paused_time():
    async def scenario():
        c = _clock(seconds_ago=0)

        async def sleeper():
            t0 = time.time()
            await c.sleep(0.5)
            return time.time() - t0

        task = asyncio.create_task(sleeper())
        await asyncio.sleep(0.2)
        c.pause()
        await asyncio.sleep(0.4)  # paused window — should not count down the sleep
        c.resume()
        wall = await task
        # ~0.5s active sleep + ~0.4s paused gap
        assert wall >= 0.85
        assert 0.35 <= c.paused_offset <= 0.55

    asyncio.run(scenario())


def test_from_iso_parses_z_suffix_and_invalid():
    iso = (
        (datetime.now(timezone.utc) - timedelta(seconds=50))
        .isoformat()
        .replace("+00:00", "Z")
    )
    c = SessionClock.from_iso(iso)
    assert 49.0 <= c.elapsed() <= 51.0

    # invalid / missing -> falls back to now()
    c2 = SessionClock.from_iso("not-a-date")
    assert c2.elapsed() < 1.0
    c3 = SessionClock.from_iso(None)
    assert c3.elapsed() < 1.0
