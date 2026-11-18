"""POST /api/v1/debrief/runs: the service API key, the request and response
shapes of CONTRACT.md, and the graph behind it (with fake steps and gateway)."""

from fastapi.testclient import TestClient

from app.api.v1.endpoints import debrief as debrief_endpoint
from app.core.config import settings
from tests.core.debrief_graph.fakes import (
    PRICES,
    SESSION,
    FakeGateway,
    FakeSteps,
    bundle,
    new_graph,
)


class TestEndpoint:
    def test_runs_the_graph_and_answers_the_contract(self, monkeypatch):
        from app.main import app

        steps, gateway = FakeSteps(), FakeGateway()
        monkeypatch.setattr(debrief_endpoint, "InProcessSteps", lambda: steps)
        monkeypatch.setattr(debrief_endpoint, "HttpGateway", lambda url, token: gateway)
        graph = new_graph()
        app.dependency_overrides[debrief_endpoint.get_graph] = lambda: graph
        try:
            client = TestClient(app)
            res = client.post(
                "/api/v1/debrief/runs",
                headers={"x-api-key": settings.API.X_API_KEY},
                json={
                    "run_id": "run-http",
                    "scenario_session_id": "sess-1",
                    "mode": "live",
                    "release": {"id": None, "version": None},
                    "bundle": bundle(),
                    "prompts": {"debrief_writer_system": None},
                    "ceiling_usd": 0.5,
                    "prices": PRICES,
                    "session": SESSION,
                    "transcript": [
                        {"turn_index": 1, "role": "counselor", "text": "Hi."},
                        {"turn_index": 2, "role": "client", "text": "Hello."},
                    ],
                    "context": {"practice_options": []},
                    "run_token": "t",
                    "gateway_url": "http://be/api/v1/internal/debrief",
                },
            )
        finally:
            app.dependency_overrides.pop(debrief_endpoint.get_graph, None)

        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "published"
        assert data["error"] is None
        writer = [c for c in steps.calls if c["path"] == "writer"][0]
        assert writer["body"]["system_prompt"] is None

    def test_needs_the_api_key(self):
        from app.main import app

        res = TestClient(app).post("/api/v1/debrief/runs", json={})
        assert res.status_code in (401, 403)


class TestResponseModelKeepsTheContract:
    """Every field the graph's result carries must survive the API's response
    model: FastAPI drops undeclared keys silently (the progress reading once
    never reached ally-be this way)."""

    def test_every_result_key_is_a_response_field(self):
        from types import SimpleNamespace

        from app.core.debrief_graph.result import build_result
        from app.core.debrief_graph.schemas import DebriefRunResponse

        progress = {
            "report": {"skills": [], "followups": [], "focus": None},
            "vetoes": [{"skill": "empathy", "veto": "too_few_sessions"}],
            "shown_as": "line",
            "model": "m",
            "window_session_ids": [],
            "analyst_versions": [2],
        }
        state = {
            "outcome": {"status": "published"},
            "progress_result": progress,
        }
        ctx = SimpleNamespace(language="en", resumed=False, inputs={})
        out = build_result(state, ctx)

        dumped = DebriefRunResponse(**out).model_dump()
        missing = set(out) - set(DebriefRunResponse.model_fields)
        assert not missing, f"undeclared response fields: {missing}"
        assert dumped["progress"] == progress
