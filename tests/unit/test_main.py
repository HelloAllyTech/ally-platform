from fastapi.testclient import TestClient

from app.main import app


class TestMain:
    def test_health_endpoint_returns_ok_and_trace_id_header(self):
        client = TestClient(app)
        resp = client.get("/api/health")

        assert resp.status_code == 200
        assert resp.json() == {"status": "ok"}
        # X-Trace-ID should be set by LogRequestMiddleware
        assert "X-Trace-ID" in resp.headers
        assert isinstance(resp.headers["X-Trace-ID"], str)
        assert len(resp.headers["X-Trace-ID"]) > 0
