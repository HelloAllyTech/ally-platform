import time

from fastapi.testclient import TestClient

from app.core import worker_health
from app.main import app


class TestMain:
    def test_health_endpoint_returns_ok_and_trace_id_header(
        self, monkeypatch, tmp_path
    ):
        # /api/health now reflects real LiveKit registration state (see
        # app/core/worker_health.py) instead of a hardcoded body. With no
        # worker heartbeat present — the case in this unit test process — it
        # reports healthy-within-startup-grace: status stays "ok" (the
        # documented, additive backward-compat guarantee for existing probes
        # that match on it), with "livekit"/"detail" added rather than
        # replacing the old shape.
        #
        # The grace is measured from when worker_health was first imported, so
        # this test used to fail whenever the suite ran past 180 s before it
        # reached here (an earlier test imports the module). Start the clock now,
        # and point the heartbeat at a file that does not exist so a real
        # worker's file in the shared temp dir can't change the answer either.
        monkeypatch.setattr(worker_health, "_api_started_at", time.time())
        monkeypatch.setattr(
            worker_health,
            "heartbeat_path",
            lambda: str(tmp_path / "no-heartbeat.json"),
        )
        client = TestClient(app)
        resp = client.get("/api/health")

        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "ok"
        assert body["livekit"] == "starting"
        # X-Trace-ID should be set by LogRequestMiddleware
        assert "X-Trace-ID" in resp.headers
        assert isinstance(resp.headers["X-Trace-ID"], str)
        assert len(resp.headers["X-Trace-ID"]) > 0
