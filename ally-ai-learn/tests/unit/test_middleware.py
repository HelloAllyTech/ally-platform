import pytest
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.testclient import TestClient

from app.middleware import LogRequestMiddleware, get_middlewares
from tests.utils.test_helpers import patch_logger


def create_test_app() -> FastAPI:
    app = FastAPI(middleware=get_middlewares())

    @app.get("/ping")
    async def ping():
        return {"pong": True}

    @app.get("/api/health")
    async def health():
        return {"status": "ok"}

    return app


class TestMiddleware:
    def test_log_request_middleware_adds_trace_id_header_and_unique_per_request(self):
        app = create_test_app()
        client = TestClient(app)

        r1 = client.get("/ping")
        r2 = client.get("/ping")

        assert r1.status_code == 200 and r2.status_code == 200
        assert "X-Trace-ID" in r1.headers and "X-Trace-ID" in r2.headers
        assert r1.headers["X-Trace-ID"] != r2.headers["X-Trace-ID"]

    def test_log_request_middleware_suppresses_logs_for_health_and_logs_for_others(
        self,
    ):
        app = create_test_app()
        client = TestClient(app)

        # Patch the logger used inside app.middleware
        with patch_logger("app.middleware") as mock_logger:
            # Health route should not be logged
            resp_health = client.get("/api/health")
            assert resp_health.status_code == 200
            # Non-health route should be logged (incoming and completed)
            resp_ping = client.get("/ping")
            assert resp_ping.status_code == 200

            # Ensure health didn't trigger info logs with our patterns
            health_incoming = any(
                "/api/health" in str(msg) for msg, _ in mock_logger.info_calls
            )
            assert health_incoming is False

            # Ensure non-health did
            non_health_incoming = any(
                "/ping" in str(msg) and "Incoming request" in str(msg)
                for msg, _ in mock_logger.info_calls
            )
            non_health_completed = any(
                "/ping" in str(msg) and "Completed request" in str(msg)
                for msg, _ in mock_logger.info_calls
            )
            assert non_health_incoming and non_health_completed

    def test_get_middlewares_contains_expected_middleware_classes(self):
        middlewares = get_middlewares()

        classes = [m.cls for m in middlewares]
        assert LogRequestMiddleware in classes
        assert CORSMiddleware in classes

    @pytest.mark.parametrize(
        "path,expect_logged",
        [
            ("/api/health", False),
            ("/api/v1/health", False),
            ("/other", True),
        ],
    )
    def test_health_paths_not_logged_parametrized(self, path, expect_logged):
        app = FastAPI(middleware=get_middlewares())

        @app.get(path)
        async def ep():
            return {"ok": True}

        client = TestClient(app)
        with patch_logger("app.middleware") as mock_logger:
            r = client.get(path)
            assert r.status_code == 200
            was_logged = any(path in str(msg) for msg, _ in mock_logger.info_calls)
            assert was_logged is expect_logged
