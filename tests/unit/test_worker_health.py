"""Unit tests for app.core.worker_health.registration_health.

This module is the fix for the 2026-08-09 incident (see its own module
docstring): a worker whose LiveKit connection was permanently lost stayed
registered with nobody for 19 hours while every health signal, including
FastAPI's old hardcoded /api/health, read green. These tests exist because
that module previously shipped with no coverage at all.
"""

import json

import pytest

from app.core import worker_health


@pytest.fixture(autouse=True)
def _isolated_heartbeat(tmp_path, monkeypatch):
    """Point the heartbeat file at a scratch path so tests never touch the
    real container-local file, and never see another test's state."""
    path = tmp_path / "worker-health.json"
    monkeypatch.setattr(worker_health, "heartbeat_path", lambda: str(path))
    yield path


def _write_heartbeat(path, **overrides):
    body = {
        "pid": 123,
        "updated_at": 1_000.0,
        "started_at": 900.0,
        "registered_ever": True,
        "last_registered_at": 950.0,
        "connection_failed": False,
        "active_jobs": 0,
    }
    body.update(overrides)
    path.write_text(json.dumps(body))
    return body


class TestNoHeartbeat:
    def test_within_startup_grace_reports_healthy_starting(self, monkeypatch):
        monkeypatch.setattr(worker_health, "_api_started_at", 1_000.0)
        monkeypatch.setattr(worker_health, "_startup_grace_s", lambda: 180.0)

        result = worker_health.registration_health(now=1_050.0)

        assert result["healthy"] is True
        assert result["livekit"] == "starting"

    def test_past_startup_grace_reports_unhealthy(self, monkeypatch):
        monkeypatch.setattr(worker_health, "_api_started_at", 1_000.0)
        monkeypatch.setattr(worker_health, "_startup_grace_s", lambda: 180.0)

        result = worker_health.registration_health(now=1_500.0)

        assert result["healthy"] is False
        assert result["livekit"] == "worker_unreachable"


class TestConnectionFailed:
    def test_connection_failed_is_unhealthy_even_with_a_fresh_heartbeat(
        self, _isolated_heartbeat, monkeypatch
    ):
        # This is the exact incident: the SDK exhausted its retry budget, but
        # the process never exits and can keep writing a "fresh" heartbeat.
        # connection_failed must win over heartbeat freshness.
        monkeypatch.setattr(worker_health, "_api_started_at", 0.0)
        monkeypatch.setattr(worker_health, "_stale_after_s", lambda: 45.0)
        _write_heartbeat(
            _isolated_heartbeat,
            updated_at=1_000.0,
            connection_failed=True,
        )

        result = worker_health.registration_health(now=1_001.0)

        assert result["healthy"] is False
        assert result["livekit"] == "connection_lost"
        assert result["worker_pid"] == 123


class TestStaleHeartbeat:
    def test_stale_within_startup_grace_reports_healthy_starting(
        self, _isolated_heartbeat, monkeypatch
    ):
        monkeypatch.setattr(worker_health, "_api_started_at", 1_000.0)
        monkeypatch.setattr(worker_health, "_startup_grace_s", lambda: 180.0)
        monkeypatch.setattr(worker_health, "_stale_after_s", lambda: 45.0)
        _write_heartbeat(_isolated_heartbeat, updated_at=900.0)

        result = worker_health.registration_health(now=1_050.0)

        assert result["healthy"] is True
        assert result["livekit"] == "starting"

    def test_stale_past_startup_grace_reports_unhealthy(
        self, _isolated_heartbeat, monkeypatch
    ):
        # A transient reconnect must not fail the probe (see module docstring)
        # but a heartbeat that has gone stale well past grace means the worker
        # process itself is dead or wedged, which must fail.
        monkeypatch.setattr(worker_health, "_api_started_at", 0.0)
        monkeypatch.setattr(worker_health, "_startup_grace_s", lambda: 180.0)
        monkeypatch.setattr(worker_health, "_stale_after_s", lambda: 45.0)
        _write_heartbeat(_isolated_heartbeat, updated_at=1_000.0)

        result = worker_health.registration_health(now=1_100.0)

        assert result["healthy"] is False
        assert result["livekit"] == "worker_unreachable"
        assert result["worker_pid"] == 123


class TestFreshHeartbeat:
    def test_never_registered_is_healthy_connecting(
        self, _isolated_heartbeat, monkeypatch
    ):
        # Deliberately healthy: a worker mid-startup that has not yet
        # registered with LiveKit must not fail a fleet-wide health check.
        monkeypatch.setattr(worker_health, "_api_started_at", 0.0)
        monkeypatch.setattr(worker_health, "_stale_after_s", lambda: 45.0)
        _write_heartbeat(_isolated_heartbeat, updated_at=1_000.0, registered_ever=False)

        result = worker_health.registration_health(now=1_001.0)

        assert result["healthy"] is True
        assert result["livekit"] == "connecting"

    def test_registered_and_fresh_is_healthy_registered(
        self, _isolated_heartbeat, monkeypatch
    ):
        monkeypatch.setattr(worker_health, "_api_started_at", 0.0)
        monkeypatch.setattr(worker_health, "_stale_after_s", lambda: 45.0)
        _write_heartbeat(
            _isolated_heartbeat,
            updated_at=1_000.0,
            registered_ever=True,
            active_jobs=2,
        )

        result = worker_health.registration_health(now=1_001.0)

        assert result["healthy"] is True
        assert result["livekit"] == "registered"
        assert result["active_jobs"] == 2


class TestReadHealthState:
    def test_missing_file_returns_none(self, _isolated_heartbeat):
        assert worker_health.read_health_state() is None

    def test_malformed_json_returns_none_not_raise(self, _isolated_heartbeat):
        _isolated_heartbeat.write_text("not json")
        assert worker_health.read_health_state() is None

    def test_non_dict_json_returns_none(self, _isolated_heartbeat):
        _isolated_heartbeat.write_text("[1, 2, 3]")
        assert worker_health.read_health_state() is None


class TestWorkerHealthMonitor:
    def test_note_registered_updates_state(self):
        monitor = worker_health.WorkerHealthMonitor(exit_on_connection_lost=False)
        snap_before = monitor.snapshot()
        assert snap_before["registered_ever"] is False

        monitor.note_registered()
        snap_after = monitor.snapshot()

        assert snap_after["registered_ever"] is True
        assert snap_after["last_registered_at"] is not None

    def test_observe_server_reads_connection_failed_flag(self):
        monitor = worker_health.WorkerHealthMonitor(exit_on_connection_lost=False)

        class FakeServer:
            _connection_failed = True

            def on(self, *args, **kwargs):
                pass

        monitor.observe_server(FakeServer())

        assert monitor.snapshot()["connection_failed"] is True

    def test_observe_server_tolerates_a_server_with_no_on_method(self):
        # wrap_load_fnc's whole contract is "a version bump that renames
        # things degrades to no exit signal, never to a broken worker."
        monitor = worker_health.WorkerHealthMonitor(exit_on_connection_lost=False)

        class BareServer:
            pass

        monitor.observe_server(BareServer())  # must not raise

        assert monitor.snapshot()["connection_failed"] is False


class TestWrapLoadFnc:
    def test_none_load_fnc_stays_none(self):
        assert worker_health.wrap_load_fnc(None) is None

    def test_wrapped_load_fnc_still_returns_the_original_value(self):
        def load_fnc(server):
            return 0.42

        wrapped = worker_health.wrap_load_fnc(load_fnc)

        assert wrapped(object()) == 0.42
