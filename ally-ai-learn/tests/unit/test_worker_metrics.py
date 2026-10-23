"""Tests for the ECS active-session CloudWatch metric emitter.

The emitter is best-effort and PROD-gated: these lock in that it (a) only emits
in PROD with the switch on, (b) throttles to one emit per interval, (c) sends the
right payload, (d) never raises on a boto failure, and (e) the load_fnc wrapper
returns the default load unchanged and survives an emit error.
"""

from unittest.mock import Mock

import app.core.worker_metrics as wm
from app.core.constants import Environment


def _reset_module_state():
    """Clear the lazy client + throttle timestamp between tests."""
    wm._cw_client = None
    wm._client_broken = False
    wm._last_emit_monotonic = 0.0


def _prod(monkeypatch, **overrides):
    """Point the emitter at a fake PROD settings object + fake CW client."""
    monkeypatch.setattr(wm.settings, "ENV", Environment.PROD)
    monkeypatch.setattr(wm.settings, "ECS_METRICS_ENABLED", True)
    monkeypatch.setattr(wm.settings, "ECS_METRICS_NAMESPACE", "Ally/LearnCore")
    monkeypatch.setattr(wm.settings, "ECS_METRICS_SERVICE", "svc-test")
    monkeypatch.setattr(wm.settings, "ECS_METRICS_EMIT_INTERVAL_S", 60.0)
    for k, v in overrides.items():
        monkeypatch.setattr(wm.settings, k, v)


class TestEmitGating:
    def test_no_emit_when_not_prod(self, monkeypatch):
        _reset_module_state()
        _prod(monkeypatch)
        monkeypatch.setattr(wm.settings, "ENV", Environment.DEV)
        client = Mock()
        monkeypatch.setattr(wm, "_get_cw_client", lambda: client)
        wm.emit_worker_metrics(3, 0.1)
        client.put_metric_data.assert_not_called()

    def test_no_emit_when_disabled(self, monkeypatch):
        _reset_module_state()
        _prod(monkeypatch, ECS_METRICS_ENABLED=False)
        client = Mock()
        monkeypatch.setattr(wm, "_get_cw_client", lambda: client)
        wm.emit_worker_metrics(3, 0.1)
        client.put_metric_data.assert_not_called()

    def test_emits_in_prod_with_correct_payload(self, monkeypatch):
        _reset_module_state()
        _prod(monkeypatch)
        client = Mock()
        monkeypatch.setattr(wm, "_get_cw_client", lambda: client)

        wm.emit_worker_metrics(5, 0.42)

        client.put_metric_data.assert_called_once()
        kwargs = client.put_metric_data.call_args.kwargs
        assert kwargs["Namespace"] == "Ally/LearnCore"
        by_name = {m["MetricName"]: m for m in kwargs["MetricData"]}
        assert by_name["ActiveSessions"]["Value"] == 5.0
        assert by_name["ActiveSessions"]["Unit"] == "Count"
        assert by_name["ActiveSessions"]["Dimensions"] == [
            {"Name": "Service", "Value": "svc-test"}
        ]
        assert by_name["WorkerLoad"]["Value"] == 0.42

    def test_emits_zero_sessions(self, monkeypatch):
        # Must still emit at 0 so the metric has continuous data for scaling.
        _reset_module_state()
        _prod(monkeypatch)
        client = Mock()
        monkeypatch.setattr(wm, "_get_cw_client", lambda: client)
        wm.emit_worker_metrics(0, 0.0)
        by_name = {
            m["MetricName"]: m
            for m in client.put_metric_data.call_args.kwargs["MetricData"]
        }
        assert by_name["ActiveSessions"]["Value"] == 0.0


class TestThrottle:
    def test_throttles_within_interval(self, monkeypatch):
        _reset_module_state()
        _prod(monkeypatch)
        client = Mock()
        monkeypatch.setattr(wm, "_get_cw_client", lambda: client)

        t = {"now": 1000.0}
        monkeypatch.setattr(wm.time, "monotonic", lambda: t["now"])

        wm.emit_worker_metrics(1, 0.0)  # emits
        wm.emit_worker_metrics(2, 0.0)  # throttled (same instant)
        t["now"] += 30.0
        wm.emit_worker_metrics(3, 0.0)  # throttled (< 60s)
        t["now"] += 31.0
        wm.emit_worker_metrics(4, 0.0)  # emits (> 60s since first)

        assert client.put_metric_data.call_count == 2


class TestBestEffort:
    def test_emit_swallows_boto_error(self, monkeypatch):
        _reset_module_state()
        _prod(monkeypatch)
        client = Mock()
        client.put_metric_data.side_effect = RuntimeError("throttled")
        monkeypatch.setattr(wm, "_get_cw_client", lambda: client)
        # Must not raise.
        wm.emit_worker_metrics(3, 0.1)

    def test_emit_skips_when_client_none(self, monkeypatch):
        _reset_module_state()
        _prod(monkeypatch)
        monkeypatch.setattr(wm, "_get_cw_client", lambda: None)
        wm.emit_worker_metrics(3, 0.1)  # no client → silent no-op


class TestLoadFnc:
    def test_load_fnc_returns_default_and_emits(self, monkeypatch):
        _reset_module_state()
        captured = {}

        def fake_emit(active, load):
            captured["active"] = active
            captured["load"] = load

        monkeypatch.setattr(wm, "emit_worker_metrics", fake_emit)

        load_fnc = wm.make_load_fnc()
        assert load_fnc is not None

        # Fake AgentServer with 4 active jobs; patch the default calc to a known
        # value so we assert the wrapper returns it verbatim.
        from livekit.agents.worker import _DefaultLoadCalc

        monkeypatch.setattr(
            _DefaultLoadCalc, "get_load", classmethod(lambda cls, s: 0.33)
        )
        server = Mock()
        server.active_jobs = [1, 2, 3, 4]

        result = load_fnc(server)

        assert result == 0.33  # default load returned unchanged
        assert captured == {"active": 4, "load": 0.33}

    def test_load_fnc_survives_emit_failure(self, monkeypatch):
        _reset_module_state()

        def boom(active, load):
            raise RuntimeError("emit blew up")

        monkeypatch.setattr(wm, "emit_worker_metrics", boom)
        from livekit.agents.worker import _DefaultLoadCalc

        monkeypatch.setattr(
            _DefaultLoadCalc, "get_load", classmethod(lambda cls, s: 0.5)
        )

        load_fnc = wm.make_load_fnc()
        server = Mock()
        server.active_jobs = [1]
        # Load value must still come back cleanly despite the emit raising.
        assert load_fnc(server) == 0.5
