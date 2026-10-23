from fastapi.testclient import TestClient

from app.main import app


class TestMain:
    def test_health_endpoint_returns_ok_and_trace_id_header(self):
        # /api/health now reflects real LiveKit registration state (see
        # app/core/worker_health.py) instead of a hardcoded body. With no
        # worker heartbeat present — the case in this unit test process — it
        # reports healthy-within-startup-grace: status stays "ok" (the
        # documented, additive backward-compat guarantee for existing probes
        # that match on it), with "livekit"/"detail" added rather than
        # replacing the old shape.
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
