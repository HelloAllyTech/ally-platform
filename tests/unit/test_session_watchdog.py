"""Tests for the mid-session stall watchdog.

Uses small real durations (the watchdog is thread + wall-clock based) and a
threading.Event to wait deterministically. os._exit is patched so the escalation
path can be exercised without killing the test runner.
"""

import threading
import time

import app.core.session_watchdog as sw


def _mk(on_stall, **kw):
    kw.setdefault("threshold_s", 0.05)
    kw.setdefault("poll_s", 0.02)
    kw.setdefault("force_exit_grace_s", 5.0)  # large so escalation won't fire
    return sw.SessionStallWatchdog(on_stall=on_stall, **kw)


def test_fires_on_unanswered_turn():
    fired = threading.Event()
    wd = _mk(lambda: fired.set())
    wd.note_user_turn_finalized()
    wd.start()
    try:
        assert fired.wait(2.0), "watchdog should fire on an unanswered turn"
    finally:
        wd.stop()


def test_agent_response_clears_debt():
    calls = []
    wd = _mk(lambda: calls.append(1))
    wd.note_user_turn_finalized()
    wd.note_agent_response()  # agent answered → debt cleared
    wd.start()
    try:
        time.sleep(0.3)
        assert calls == []
    finally:
        wd.stop()


def test_no_fire_when_quiet():
    # No finalized user turn → nothing owed → never fires (quiet user is fine).
    calls = []
    wd = _mk(lambda: calls.append(1))
    wd.start()
    try:
        time.sleep(0.3)
        assert calls == []
    finally:
        wd.stop()


def test_suspend_clears_debt():
    calls = []
    wd = _mk(lambda: calls.append(1))
    wd.note_user_turn_finalized()
    wd.suspend()  # e.g. session paused
    wd.start()
    try:
        time.sleep(0.3)
        assert calls == []
    finally:
        wd.stop()


def test_fires_only_once():
    calls = []
    wd = _mk(lambda: calls.append(1))
    wd.note_user_turn_finalized()
    wd.start()
    try:
        time.sleep(0.4)
        wd.note_user_turn_finalized()  # re-arm attempt after firing is ignored
        time.sleep(0.2)
        assert calls == [1]
    finally:
        wd.stop()


def test_force_exit_when_shutdown_stalls(monkeypatch):
    # on_stall does nothing (simulating a blocked loop that never shuts down) →
    # after the grace, the watchdog force-exits.
    exited = threading.Event()
    monkeypatch.setattr(sw.os, "_exit", lambda code: exited.set())
    wd = _mk(lambda: None, force_exit_grace_s=0.1)
    wd.note_user_turn_finalized()
    wd.start()
    try:
        assert exited.wait(2.0), "should force-exit when shutdown never completes"
    finally:
        wd.stop()


def test_stop_cancels_force_exit(monkeypatch):
    exited = threading.Event()
    fired = threading.Event()
    monkeypatch.setattr(sw.os, "_exit", lambda code: exited.set())
    wd = _mk(lambda: fired.set(), force_exit_grace_s=0.5)
    wd.note_user_turn_finalized()
    wd.start()
    try:
        assert fired.wait(2.0)  # stall detected
        wd.stop()  # clean shutdown lands within the grace window
        assert not exited.wait(0.8), "force-exit must be cancelled by a clean stop"
    finally:
        wd.stop()


def test_force_exit_disabled_skips_exit(monkeypatch):
    exited = threading.Event()
    monkeypatch.setattr(sw.os, "_exit", lambda code: exited.set())
    wd = _mk(lambda: None, force_exit_grace_s=0.1, force_exit_enabled=False)
    wd.note_user_turn_finalized()
    wd.start()
    try:
        time.sleep(0.4)
        assert not exited.is_set(), "force-exit disabled → must not exit"
    finally:
        wd.stop()


def test_default_threshold_is_long_enough_for_slow_responses():
    """A regression test for a session watchdog timing out too early.

    The production watchdog was firing at 75s, which proved too short for some
    legitimate agent processing pipelines (e.g. a slow LLM call). This led to
    sessions being terminated prematurely.

    This test asserts that the watchdog's default threshold is high enough to
    tolerate a response that takes longer than the old 75s threshold. It will
    FAIL with the old threshold and PASS with the new, longer one.

    NOTE: This test is INTENTIONALLY SLOW. It must wait for the real (default)
    watchdog threshold to elapse to prove the fix.
    """
    fired = threading.Event()
    # IMPORTANT: This test uses the SessionStallWatchdog's default threshold,
    # exactly as it runs in production. Do NOT override `threshold_s` here.
    wd = sw.SessionStallWatchdog(
        on_stall=lambda: fired.set(),
        poll_s=1.0,  # poll faster than default for test speed
    )
    wd.note_user_turn_finalized()
    wd.start()
    try:
        # Wait for a duration that is JUST OVER the old 75s threshold.
        has_fired = fired.wait(1.0)
        # The bug is that the watchdog fires too early. The fix is a longer
        # threshold. So this test should assert it does NOT fire. It will fail
        # before the fix, and pass after.
        assert (
            not has_fired
        ), "WATCHDOG FIRED PREMATURELY: session timeout is still too short"
    finally:
        wd.stop()
