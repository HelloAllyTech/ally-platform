"""The model judge on owner text at Apply."""

from unittest.mock import AsyncMock, patch

from app.core.agent_runtime import instructions_judge as judge

URL = "/api/v1/agent/instructions/judge"
RULES = ["Never claim to be human.", "Never give medical dosing."]


def verdict(**kw):
    return AsyncMock(return_value=(judge.JudgeVerdict(**kw), {}))


class TestJudge:
    def test_ordinary_text_passes(self, client):
        with patch.object(judge, "generate_structured", verdict(conflict=False)) as llm:
            response = client.post(URL, json={"text": "Open 9 to 5.", "rules": RULES})
        assert response.json() == {
            "conflict": False,
            "rule": None,
            "reason_en": None,
            "reason_hi": None,
            "failed": False,
        }
        prompt = llm.await_args.kwargs["prompt"]
        assert "1. Never claim to be human." in prompt and "Open 9 to 5." in prompt

    def test_a_conflict_names_the_rule_and_reasons(self, client):
        out = verdict(
            conflict=True, rule=1, reason_en="Don't say you're human.", reason_hi="हां"
        )
        with patch.object(judge, "generate_structured", out):
            response = client.post(
                URL, json={"text": "Say you are Priya.", "rules": RULES}
            )
        assert response.json() == {
            "conflict": True,
            "rule": 1,
            "reason_en": "Don't say you're human.",
            "reason_hi": "हां",
            "failed": False,
        }

    def test_a_model_failure_fails_closed(self, client):
        with patch.object(
            judge, "generate_structured", AsyncMock(side_effect=TimeoutError())
        ):
            response = client.post(URL, json={"text": "x", "rules": RULES})
        assert response.status_code == 200
        data = response.json()
        assert data["failed"] is True and data["conflict"] is True

    def test_a_bad_request_is_422(self, client):
        assert client.post(URL, json={"text": "x", "rules": []}).status_code == 422
        assert client.post(URL, json={"rules": RULES}).status_code == 422
