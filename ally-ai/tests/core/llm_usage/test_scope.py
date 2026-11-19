"""The usage scope (CR1): ally-be's X-Ally-Usage header becomes the attribution on
every usage row emitted while the request runs, streamed replies included."""

import asyncio
import json

import pytest
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from fastapi.testclient import TestClient

from app.core.llm_usage import scope as scope_module
from app.core.llm_usage.scope import (
    MAX_HEADER_BYTES,
    current_scope,
    next_seq,
    parse_header,
    set_step,
    usage_attribution,
    use_scope,
)
from app.middleware import UsageScopeMiddleware, get_middlewares

HEADER = {
    "run_id": "run-1",
    "chatbot_id": "bot-7",
    "conversation_id": "conv-3",
    "channel": "whatsapp",
    "kind": "crisis_check",
    "creator_user_id": 42,
    "draft_id": "0b5f3c1e-0000-4000-8000-000000000001",
}


def _app() -> FastAPI:
    app = FastAPI()
    app.add_middleware(UsageScopeMiddleware)

    @app.get("/scope")
    async def read_scope():
        return {"scope": usage_attribution()}

    @app.get("/stream")
    async def stream():
        async def body():
            # Read while the response streams, after the endpoint has returned.
            await asyncio.sleep(0)
            yield json.dumps({"scope": usage_attribution()}) + "\n"
            yield json.dumps({"scope": usage_attribution()}) + "\n"

        return StreamingResponse(body(), media_type="text/event-stream")

    return app


@pytest.fixture
def client():
    return TestClient(_app())


class TestMiddleware:
    def test_header_sets_every_key(self, client):
        res = client.get("/scope", headers={"X-Ally-Usage": json.dumps(HEADER)})
        scope = res.json()["scope"]
        # Every key ally-be sent comes back, unchanged (kind is never derived).
        for key, value in HEADER.items():
            assert scope[key] == value
        assert scope["step"] is None
        assert scope["seq"] == 1

    def test_unknown_future_keys_pass_through(self, client):
        header = {**HEADER, "experiment": "b"}
        res = client.get("/scope", headers={"X-Ally-Usage": json.dumps(header)})
        assert res.json()["scope"]["experiment"] == "b"

    def test_absent_header_means_no_scope(self, client):
        assert client.get("/scope").json() == {"scope": None}

    @pytest.mark.parametrize(
        "value",
        [
            "not json",
            "[1, 2]",
            "{}",
            json.dumps({"run_id": {"nested": 1}}),
            json.dumps({"run_id": ["a"]}),
            json.dumps({"run_id": 1.5}),
            json.dumps({"run_id": True}),
            json.dumps({"run_id": None}),
            json.dumps({"run_id": "x" * (MAX_HEADER_BYTES + 1)}),
        ],
    )
    def test_invalid_header_means_no_scope(self, client, value):
        res = client.get("/scope", headers={"X-Ally-Usage": value})
        assert res.status_code == 200
        assert res.json() == {"scope": None}

    def test_reserved_keys_are_ours(self, client):
        header = {**HEADER, "seq": 99, "step": 7}
        scope = client.get(
            "/scope", headers={"X-Ally-Usage": json.dumps(header)}
        ).json()["scope"]
        assert scope["seq"] == 1
        assert scope["step"] is None

    def test_scope_is_set_while_a_streaming_response_runs(self, client):
        res = client.get("/stream", headers={"X-Ally-Usage": json.dumps(HEADER)})
        lines = [json.loads(line) for line in res.text.strip().splitlines()]
        assert [line["scope"]["run_id"] for line in lines] == ["run-1", "run-1"]
        # One counter for the whole request.
        assert [line["scope"]["seq"] for line in lines] == [1, 2]

    def test_scope_does_not_leak_between_requests(self, client):
        client.get("/scope", headers={"X-Ally-Usage": json.dumps(HEADER)})
        assert client.get("/scope").json() == {"scope": None}
        assert current_scope() is None

    def test_registered_on_the_app(self):
        assert UsageScopeMiddleware in [m.cls for m in get_middlewares()]


class TestScopeHelpers:
    def test_no_scope_no_seq(self):
        assert current_scope() is None
        assert next_seq() is None
        assert usage_attribution() is None

    def test_parse_header_accepts_bytes(self):
        scope = parse_header(json.dumps(HEADER).encode())
        assert scope.run_id == "run-1"
        assert scope.chatbot_id == "bot-7"
        assert scope.kind == "crisis_check"
        assert scope.get("creator_user_id") == 42

    @pytest.mark.asyncio
    async def test_tasks_share_the_counter_but_not_the_step(self):
        with use_scope(run_id="r"):

            async def node(step):
                set_step(step)
                await asyncio.sleep(0)
                return usage_attribution()

            a, b = await asyncio.gather(node(1), node(2))
            assert {a["step"], b["step"]} == {1, 2}
            assert sorted([a["seq"], b["seq"]]) == [1, 2]
            # The parent's scope was not renumbered by its children.
            assert current_scope().step is None
            assert usage_attribution()["seq"] == 3
        assert current_scope() is None

    def test_set_step_falls_back_to_given_ids(self):
        ctx = scope_module._scope.set(None)
        try:
            set_step(2, run_id="run-x", chatbot_id="bot-x", conversation_id=None)
            out = usage_attribution()
            assert out["run_id"] == "run-x"
            assert out["chatbot_id"] == "bot-x"
            assert out["step"] == 2
        finally:
            scope_module._scope.reset(ctx)

    def test_set_step_without_scope_or_ids_does_nothing(self):
        set_step(3)
        assert current_scope() is None
