"""AI-cost of the V2V tester's own model calls.

The tester is a simulated learner joining a real session's room, so its calls
record against that room and session -- under tester labels, which is what lets
Core keep them out of the session's delivery cost. Recording must never cost
the tester a reply.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.v2v_tester.tester_bot import V2VTesterBot


def _bot(scenario_session_id="sess-v2v"):
    return V2VTesterBot(
        room_name="room-under-test",
        tester_token="t",
        max_exchanges=3,
        language="en-IN",
        scenario_title="",
        scenario_context="",
        scenario_session_id=scenario_session_id,
        counselor_id=1,
    )


def _completion(text="How are you feeling today?"):
    return SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=text))],
        usage=SimpleNamespace(
            prompt_tokens=300,
            completion_tokens=12,
            total_tokens=312,
            prompt_tokens_details=SimpleNamespace(cached_tokens=256),
        ),
    )


def _llm(result=None, error=None):
    llm = MagicMock()
    llm.chat.completions.create = AsyncMock(return_value=result, side_effect=error)
    return llm


class TestTesterReplyUsage:
    @pytest.mark.asyncio
    async def test_records_against_the_room_and_session(self, ai_usage_calls):
        reply = await _bot()._generate_reply(_llm(_completion()), "sys", [])

        assert reply == "How are you feeling today?"
        assert len(ai_usage_calls) == 1
        call = ai_usage_calls[0]
        assert call["task"] == "v2v_tester_reply"
        assert call["room_id"] == "room-under-test"
        assert call["scenario_session_id"] == "sess-v2v"
        assert (call["provider"], call["model"]) == ("openai", "gpt-4o-mini")
        assert (call["prompt_tokens"], call["completion_tokens"]) == (300, 12)
        assert call["cached_tokens"] == 256

    @pytest.mark.asyncio
    async def test_an_empty_session_id_is_not_sent(self, ai_usage_calls):
        """Core stores it in a uuid column; "" would lose the row."""
        await _bot(scenario_session_id="")._generate_reply(
            _llm(_completion()), "sys", []
        )

        assert ai_usage_calls[0]["scenario_session_id"] is None
        assert ai_usage_calls[0]["room_id"] == "room-under-test"

    @pytest.mark.asyncio
    async def test_a_failed_call_records_nothing(self, ai_usage_calls):
        reply = await _bot()._generate_reply(
            _llm(error=RuntimeError("api down")), "sys", []
        )

        assert reply == ""
        assert ai_usage_calls == []

    @pytest.mark.asyncio
    async def test_a_failing_emitter_does_not_cost_the_reply(self, monkeypatch):
        def _boom(*a, **k):
            raise RuntimeError("queue down")

        monkeypatch.setattr("app.core.llm_usage.emitter.emit_ai_usage", _boom)

        reply = await _bot()._generate_reply(_llm(_completion()), "sys", [])

        assert reply == "How are you feeling today?"


class TestRoleFidelityJudgeUsage:
    @pytest.mark.asyncio
    async def test_records_against_the_room_and_session(self, ai_usage_calls):
        bot = _bot()
        bot._conversation = [
            {"role": "assistant", "content": "I feel low."},
            {"role": "user", "content": "Tell me more."},
        ]
        with patch("openai.AsyncOpenAI", return_value=_llm(_completion("1"))):
            await bot._assess_role_fidelity()

        assert bot._metrics["roleDriftTurns"] == 1
        assert len(ai_usage_calls) == 1
        call = ai_usage_calls[0]
        assert call["task"] == "v2v_role_fidelity_judge"
        assert call["room_id"] == "room-under-test"
        assert call["scenario_session_id"] == "sess-v2v"
        assert call["model"] == "gpt-4o-mini"

    @pytest.mark.asyncio
    async def test_no_learner_turns_makes_no_call(self, ai_usage_calls):
        bot = _bot()
        bot._conversation = [{"role": "assistant", "content": "Hello?"}]
        llm = _llm(_completion("0"))
        with patch("openai.AsyncOpenAI", return_value=llm):
            await bot._assess_role_fidelity()

        llm.chat.completions.create.assert_not_called()
        assert ai_usage_calls == []
