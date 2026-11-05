"""The conversational agent path (`features.agent`) through the graph.

The real KnowledgeAgentService over a mocked chunk service, as in test_graph.py,
with the agent's `generate_structured` replaced by a fake that answers by schema:
the contextualise call gets `turn`, each agent step the next scripted step.
"""

import json
from unittest.mock import patch

import pytest
from langsmith import utils as langsmith_utils

from app.core.agent_runtime.schemas import TurnUnderstanding
from app.core.config import settings
from tests.core.knowledge_agent.test_agent import CHUNK_A, CHUNK_B, passage

pytestmark = pytest.mark.asyncio

CONVERSATION = "app.core.agent_runtime.conversation"
CHUNK_C = "33333333-3333-3333-3333-333333333333"
META = {"provider": "openai", "model": "gpt-5-mini"}


def turn(turn_type="question", standalone_query="", language="en"):
    return TurnUnderstanding(
        turn_type=turn_type, standalone_query=standalone_query, language=language
    )


def reply(intent="answer", answer="Here you go.", citations=(), language="en"):
    return {
        "action": "reply",
        "intent": intent,
        "answer": answer,
        "citations": list(citations),
        "language": language,
    }


def search(query):
    return {"action": "search_knowledge", "search_knowledge": {"query": query}}


class FakeLLM:
    """Stands in for generate_structured; records every call's schema and prompt."""

    def __init__(self, understanding, *steps):
        self.understanding = understanding
        self.steps = list(steps)
        self.calls = []

    async def __call__(self, *, schema, prompt, **kwargs):
        self.calls.append({"schema": schema, "prompt": prompt, **kwargs})
        if schema is TurnUnderstanding:
            if isinstance(self.understanding, Exception):
                raise self.understanding
            return self.understanding, {"provider": "openai", "model": "gpt-4o-mini"}
        return schema.model_validate(self.steps.pop(0)), META

    @property
    def agent_calls(self):
        return [c for c in self.calls if c["schema"] is not TurnUnderstanding]


def nodes(state):
    return [step["node"] for step in state["trace"]]


@pytest.fixture
def agent_run(run):
    """`run` with the agent on and the fake model patched in."""

    async def _run(question, llm, **bot):
        bot.setdefault("features", {"agent": True})
        with patch(f"{CONVERSATION}.generate_structured", llm):
            return await run(question, **bot)

    return _run


class TestContextualize:
    async def test_follow_up_is_searched_as_the_standalone_query(
        self, agent_run, chunk_service
    ):
        chunk_service.search.return_value = [passage(CHUNK_A, 0.7)]
        llm = FakeLLM(
            turn("question", "How do I sign in to Ally after getting access?"),
            reply(citations=[1]),
        )
        history = [
            {"role": "user", "content": "how do I get access?"},
            {"role": "assistant", "content": "Ask your admin to invite you."},
        ]
        state = await agent_run(
            "and after that, how do I sign in?", llm, history=history
        )

        # The contextualise prompt carries the conversation.
        assert "Ask your admin to invite you." in llm.calls[0]["prompt"]
        searched = chunk_service.search.call_args.kwargs["query"]
        assert searched == "How do I sign in to Ally after getting access?"
        assert state["result"]["retrieval"]["translated_query"] == searched
        assert state["result"]["turn_type"] == "question"
        assert nodes(state) == [
            "contextualize",
            "prefetch",
            "agent",
            "check",
            "finalize",
        ]

    async def test_it_replaces_the_translate_call(self, agent_run, chunk_service):
        chunk_service.search.return_value = [passage(CHUNK_A, 0.7)]
        llm = FakeLLM(turn("question", "What is Ally?"), reply(citations=[1]))
        state = await agent_run("Ally kya hai?", llm, translate_query=True)
        assert len(llm.calls) == 2  # contextualise + one agent step: no translate
        assert "translate" not in nodes(state)

    async def test_failure_searches_the_original_text(self, agent_run, chunk_service):
        chunk_service.search.return_value = []
        llm = FakeLLM(RuntimeError("down"), reply("decline", "I don't have that."))
        state = await agent_run("kya haal hai", llm)

        assert chunk_service.search.call_args.kwargs["query"] == "kya haal hai"
        assert state["result"]["retrieval"]["translation_degraded"] is True
        # Weak retrieval after a failed rewrite is not evidence of a gap.
        assert state["result"]["decline_reason"] == "translation_failed"


class TestSmalltalk:
    @pytest.mark.parametrize("turn_type", ["smalltalk", "about_bot", "unclear"])
    async def test_skips_retrieval(
        self, agent_run, chunk_service, retrieval_log, turn_type
    ):
        llm = FakeLLM(turn(turn_type), reply("smalltalk", "Hi! How can I help?"))
        state = await agent_run("hello", llm)

        chunk_service.search.assert_not_called()
        retrieval_log.assert_not_called()
        assert nodes(state) == ["contextualize", "agent", "check", "finalize"]
        assert "(no passages were retrieved)" in llm.agent_calls[0]["prompt"]

    async def test_uncited_smalltalk_is_an_answer_with_no_citations(
        self, agent_run, chunk_service
    ):
        llm = FakeLLM(turn("smalltalk"), reply("smalltalk", "You're welcome!"))
        result = (await agent_run("thanks!", llm))["result"]
        assert result["intent"] == "answer"
        assert result["decline_reason"] == "none"
        assert result["citations"] == []
        assert result["turn_type"] == "smalltalk"
        assert result["retrieval"]["unsupported"] is False

    async def test_persona_topics_and_decline_wording_reach_the_prompt(
        self, agent_run, chunk_service
    ):
        llm = FakeLLM(turn("about_bot"), reply("smalltalk", "I'm Ally Helper."))
        await agent_run(
            "who are you?",
            llm,
            persona={"display_name": "Ally Helper", "tone": "warm"},
            knowledge_topics=["Ally FAQ – About Ally", "Ally FAQ – Privacy and Data"],
            decline_text="A colleague or supervisor is the better route.",
        )
        prompt = llm.agent_calls[0]["prompt"]
        assert prompt.startswith("# Who you are\nYou are Ally Helper.")
        assert "- Ally FAQ – Privacy and Data" in prompt
        assert "A colleague or supervisor is the better route." in prompt
        assert "(Understood as: about bot)" in prompt


class TestToolLoop:
    async def test_search_again_continues_the_passage_numbering(
        self, agent_run, chunk_service
    ):
        chunk_service.search.side_effect = [
            [passage(CHUNK_A, 0.7)],  # prefetch → passage 1
            [passage(CHUNK_A, 0.7), passage(CHUNK_B, 0.66)],  # tool → B is new: 2
        ]
        llm = FakeLLM(
            turn("question", "sign in"),
            search("sign in after access"),
            reply(citations=[2]),
        )
        state = await agent_run("q", llm)

        assert [p["chunk_id"] for p in state["passages"]] == [CHUNK_A, CHUNK_B]
        assert state["tool_calls"][0]["added"] == [2]
        assert "[2] WHO mhGAP" in llm.agent_calls[1]["prompt"]
        assert state["result"]["citations"][0]["chunk_id"] == CHUNK_B
        assert state["result"]["citations"][0]["passage_number"] == 2
        assert nodes(state) == [
            "contextualize",
            "prefetch",
            "agent",
            "tool",
            "agent",
            "check",
            "finalize",
        ]

    async def test_tool_step_has_counts_only(self, agent_run, chunk_service):
        chunk_service.search.side_effect = [[], [passage(CHUNK_A, 0.7)]]
        llm = FakeLLM(
            turn("question", "secret question text"),
            search("secret query text"),
            reply(citations=[1]),
        )
        state = await agent_run("secret question text", llm)
        step = next(s for s in state["trace"] if s["node"] == "tool")
        assert step["summary"] == "search_knowledge: 1 hits, 1 new passages, best 0.70"
        assert "secret" not in json.dumps(state["trace"])

    async def test_loop_stops_at_the_cap(self, agent_run, chunk_service, monkeypatch):
        assert settings.AGENT_RUNTIME.MAX_TOOL_CALLS == 4
        chunk_service.search.return_value = []
        llm = FakeLLM(
            turn("question", "q"),
            *[search(f"try {i}") for i in range(4)],
            reply("decline", "I don't have that information."),
        )
        state = await agent_run("q", llm)

        assert len(state["tool_calls"]) == 4
        assert len(llm.agent_calls) == 5
        # The fifth call can only reply: no tool is in its schema.
        last = llm.agent_calls[-1]["schema"]
        assert set(last.model_fields) == {
            "action",
            "intent",
            "answer",
            "citations",
            "language",
        }
        assert "searches left: 0" in llm.agent_calls[-1]["prompt"]
        assert state["result"]["intent"] == "decline"

    async def test_a_lower_cap_is_honoured(self, agent_run, chunk_service, monkeypatch):
        monkeypatch.setattr(settings.AGENT_RUNTIME, "MAX_TOOL_CALLS", 1)
        chunk_service.search.return_value = []
        llm = FakeLLM(turn("question", "q"), search("again"), reply("decline", "No."))
        state = await agent_run("q", llm)
        assert len(state["tool_calls"]) == 1
        assert len(llm.agent_calls) == 2


class TestCheckInTheGraph:
    async def test_uncited_answer_becomes_a_decline(self, agent_run, chunk_service):
        chunk_service.search.return_value = [passage(CHUNK_A, 0.7)]
        llm = FakeLLM(turn("question", "q"), reply("answer", "Refunds take 5 days."))
        result = (await agent_run("refund policy?", llm))["result"]
        assert result["intent"] == "decline"
        assert result["decline_reason"] == "model_declined"
        # The refused claim never reaches the person; ally-be sends its decline text.
        assert result["answer"] == ""

    async def test_decline_after_a_weak_prefetch_keeps_the_gate_reason(
        self, agent_run, chunk_service
    ):
        chunk_service.search.return_value = [passage(CHUNK_A, 0.2)]
        llm = FakeLLM(
            turn("question", "weather"), reply("decline", "I can't help with that.")
        )
        result = (await agent_run("weather tomorrow?", llm))["result"]
        assert result["decline_reason"] == "below_threshold"
        assert result["answer"] == "I can't help with that."


class TestRetrievalLog:
    async def test_once_for_an_answered_question(
        self, agent_run, chunk_service, retrieval_log
    ):
        chunk_service.search.side_effect = [
            [passage(CHUNK_A, 0.7)],
            [passage(CHUNK_C, 0.7)],
        ]
        llm = FakeLLM(turn("question", "q"), search("more"), reply(citations=[1, 2]))
        await agent_run("q", llm)
        assert retrieval_log.call_count == 1  # the prefetch; tool searches are not
        assert retrieval_log.call_args.kwargs["disposition"] == "answered"

    async def test_once_for_a_weak_prefetch(
        self, agent_run, chunk_service, retrieval_log
    ):
        chunk_service.search.return_value = []
        llm = FakeLLM(turn("question", "q"), reply("decline", "No."))
        await agent_run("q", llm)
        assert retrieval_log.call_count == 1
        assert retrieval_log.call_args.kwargs["disposition"] == "declined_no_hits"

    async def test_log_retrieval_false_skips_it(
        self, agent_run, chunk_service, retrieval_log
    ):
        chunk_service.search.return_value = [passage(CHUNK_A, 0.7)]
        llm = FakeLLM(turn("question", "q"), reply(citations=[1]))
        await agent_run("q", llm, log_retrieval=False)
        assert retrieval_log.call_count == 0


class TestModelAndTracing:
    async def test_the_bots_model_drives_the_agent_step(self, agent_run, chunk_service):
        llm = FakeLLM(turn("smalltalk"), reply("smalltalk", "Hi!"))
        prompts = {
            "ally_ai_agent_system": {
                "provider": "anthropic",
                "model": "claude-sonnet-4-6",
                "temperature": 0.2,
            }
        }
        await agent_run("hi", llm, prompts=prompts)
        step_call = llm.agent_calls[0]
        assert step_call["model"] == "claude-sonnet-4-6"
        assert step_call["provider"] == "anthropic"
        assert step_call["task"] == "whatsapp_agent_step"
        # The contextualise call keeps its own (cheap) model.
        assert llm.calls[0]["model"] == settings.KNOWLEDGE_AGENT.TRANSLATE_MODEL
        assert llm.calls[0]["task"] == "whatsapp_agent_contextualize"

    async def test_runs_are_never_traced_to_langsmith(
        self, agent_run, chunk_service, monkeypatch
    ):
        monkeypatch.setenv("LANGSMITH_TRACING", "true")
        assert langsmith_utils.tracing_is_enabled()
        seen = []
        llm = FakeLLM(turn("question", "q"), reply("decline", "No."))
        original = llm.__call__

        async def spy(**kwargs):
            seen.append(langsmith_utils.tracing_is_enabled())
            return await original(**kwargs)

        await agent_run("q", spy)
        assert seen and not any(seen)

    async def test_final_state_is_plain_json(self, agent_run, chunk_service):
        chunk_service.search.return_value = [passage(CHUNK_A, 0.7)]
        llm = FakeLLM(turn("question", "q"), search("more"), reply(citations=[1]))
        state = await agent_run("q", llm)
        json.dumps(state)


class TestFlag:
    async def test_off_runs_the_parity_graph(self, run, chunk_service):
        chunk_service.search.return_value = []
        with patch(f"{CONVERSATION}.generate_structured") as gen:
            state = await run("hello", features={"agent": False})
        gen.assert_not_called()
        assert nodes(state) == ["translate", "retrieve", "gate", "finalize"]
        assert "turn_type" not in state["result"]

    async def test_a_thread_can_switch_between_paths(
        self, run, agent_run, chunk_service
    ):
        """Run-scoped keys reset, so an agent run leaves nothing for a parity run."""
        chunk_service.search.return_value = [passage(CHUNK_A, 0.7)]
        llm = FakeLLM(turn("question", "q"), search("more"), reply(citations=[1]))
        await agent_run("q", llm)
        chunk_service.search.return_value = []
        # A new run id: the same id in the same thread returns the stored run.
        state = await run("hello", run_id="run-2")
        assert state["tool_calls"] is None
        assert state["turn_type"] is None
        assert nodes(state) == ["translate", "retrieve", "gate", "finalize"]
