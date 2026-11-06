"""The conversational agent path (`features.agent`) through the graph.

The real KnowledgeAgentService over a mocked chunk service, as in test_graph.py,
with the agent's `generate_structured` replaced by a fake that returns the next
scripted step.
"""

import json
from unittest.mock import patch

import pytest
from langsmith import utils as langsmith_utils

from app.core.agent_runtime.check import REJECTIONS
from app.core.config import settings
from tests.core.knowledge_agent.test_agent import CHUNK_A, CHUNK_B, passage

pytestmark = pytest.mark.asyncio

CONVERSATION = "app.core.agent_runtime.conversation"
CHUNK_C = "33333333-3333-3333-3333-333333333333"
META = {"provider": "openai", "model": "gpt-5-mini"}


def reply(
    intent="answer",
    answer="Here you go.",
    citations=(),
    language="en",
    turn_type="question",
):
    return {
        "action": "reply",
        "turn_type": turn_type,
        "intent": intent,
        "answer": answer,
        "citations": list(citations),
        "language": language,
    }


def chat(answer="Hi! How can I help?", turn_type="smalltalk", **kw):
    return reply("smalltalk", answer, turn_type=turn_type, **kw)


def search(query, language="en"):
    return {
        "action": "search_knowledge",
        "turn_type": "question",
        "search_knowledge": {"query": query},
        "language": language,
    }


class FakeLLM:
    """Stands in for generate_structured; records every call's schema and prompt."""

    def __init__(self, *steps):
        self.steps = list(steps)
        self.calls = []

    async def __call__(self, *, schema, prompt, **kwargs):
        self.calls.append({"schema": schema, "prompt": prompt, **kwargs})
        return schema.model_validate(self.steps.pop(0)), META


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


class TestTheAgentDecides:
    @pytest.mark.parametrize("turn_type", ["smalltalk", "about_bot", "unclear"])
    async def test_no_search_unless_it_asks(
        self, agent_run, chunk_service, retrieval_log, turn_type
    ):
        llm = FakeLLM(chat(turn_type=turn_type))
        state = await agent_run("hello", llm, translate_query=True)

        chunk_service.search.assert_not_called()
        retrieval_log.assert_not_called()
        # One model call: no classifier, no translate, no up-front search.
        assert len(llm.calls) == 1
        assert nodes(state) == ["agent", "check", "finalize"]
        assert state["result"]["turn_type"] == turn_type

    async def test_it_writes_the_search_query_from_the_conversation(
        self, agent_run, chunk_service
    ):
        chunk_service.search.return_value = [passage(CHUNK_A, 0.7)]
        llm = FakeLLM(
            search("How do I sign in to Ally after getting access?"),
            reply(citations=[1]),
        )
        history = [
            {"role": "user", "content": "how do I get access?"},
            {"role": "assistant", "content": "Ask your admin to invite you."},
        ]
        state = await agent_run(
            "and after that, how do I sign in?", llm, history=history
        )

        assert "Ask your admin to invite you." in llm.calls[0]["prompt"]
        searched = chunk_service.search.call_args.kwargs["query"]
        assert searched == "How do I sign in to Ally after getting access?"
        result = state["result"]
        assert result["retrieval"]["translated_query"] == searched
        assert result["retrieval"]["hit_count"] == 1
        assert result["turn_type"] == "question"
        assert result["intent"] == "answer"
        assert nodes(state) == ["agent", "tool", "agent", "check", "finalize"]

    async def test_language_is_the_agents(self, agent_run, chunk_service):
        chunk_service.search.return_value = [passage(CHUNK_A, 0.7)]
        llm = FakeLLM(
            search("What is Ally?", language="hi"),
            reply(citations=[1], language="hi", answer="Ally ek platform hai."),
        )
        result = (await agent_run("Ally kya hai?", llm))["result"]
        assert result["language"] == "hi"
        assert result["retrieval"]["query_language"] == "hi"


class TestSmalltalk:
    async def test_uncited_smalltalk_is_an_answer_with_no_citations(
        self, agent_run, chunk_service
    ):
        llm = FakeLLM(chat("You're welcome!"))
        result = (await agent_run("thanks!", llm))["result"]
        assert result["intent"] == "answer"
        assert result["decline_reason"] == "none"
        assert result["citations"] == []
        assert result["turn_type"] == "smalltalk"
        assert result["retrieval"]["unsupported"] is False
        assert result["retrieval"]["hit_count"] == 0

    async def test_rules_persona_topics_and_decline_wording_reach_the_prompt(
        self, agent_run, chunk_service
    ):
        llm = FakeLLM(chat("I'm Ally Helper.", turn_type="about_bot"))
        await agent_run(
            "who are you?",
            llm,
            persona={"display_name": "Ally Helper", "tone": "warm"},
            knowledge_topics=["Ally FAQ – About Ally", "Ally FAQ – Privacy and Data"],
            decline_text="A colleague or supervisor is the better route.",
        )
        prompt = llm.calls[0]["prompt"]
        assert prompt.startswith("# Who you are\nYou are Ally Helper.")
        assert "- Ally FAQ – Privacy and Data" in prompt
        assert "A colleague or supervisor is the better route." in prompt
        assert "You are not a crisis service" in prompt
        assert "Don't repeat yourself" in prompt
        assert "search_knowledge" in prompt
        assert "Your previous draft" not in prompt


class TestToolLoop:
    async def test_a_second_search_continues_the_passage_numbering(
        self, agent_run, chunk_service
    ):
        chunk_service.search.side_effect = [
            [passage(CHUNK_A, 0.7)],  # passage 1
            [passage(CHUNK_A, 0.7), passage(CHUNK_B, 0.66)],  # B is new: 2
        ]
        llm = FakeLLM(
            search("sign in"),
            search("sign in after access"),
            reply(citations=[2]),
        )
        state = await agent_run("q", llm)

        assert [p["chunk_id"] for p in state["passages"]] == [CHUNK_A, CHUNK_B]
        assert state["tool_calls"][1]["added"] == [2]
        assert "[2] WHO mhGAP" in llm.calls[2]["prompt"]
        assert state["result"]["citations"][0]["chunk_id"] == CHUNK_B
        assert state["result"]["citations"][0]["passage_number"] == 2
        # The response's retrieval block is the first search's.
        assert state["result"]["retrieval"]["translated_query"] == "sign in"
        assert nodes(state) == [
            "agent",
            "tool",
            "agent",
            "tool",
            "agent",
            "check",
            "finalize",
        ]

    async def test_tool_step_has_counts_only(self, agent_run, chunk_service):
        chunk_service.search.return_value = [passage(CHUNK_A, 0.7)]
        llm = FakeLLM(search("secret query text"), reply(citations=[1]))
        state = await agent_run("secret question text", llm)
        step = next(s for s in state["trace"] if s["node"] == "tool")
        assert step["summary"] == "search_knowledge: 1 hits, 1 new passages, best 0.70"
        assert "secret" not in json.dumps(state["trace"])

    async def test_a_weak_search_offers_no_passages(self, agent_run, chunk_service):
        chunk_service.search.return_value = [passage(CHUNK_A, 0.2)]
        llm = FakeLLM(
            search("refund policy"),
            reply("decline", "I don't have anything on refunds, sorry."),
        )
        state = await agent_run("refund policy?", llm)
        assert state["passages"] == []
        assert "nothing relevant or new" in llm.calls[1]["prompt"]

    async def test_loop_stops_at_the_cap(self, agent_run, chunk_service):
        assert settings.AGENT_RUNTIME.MAX_TOOL_CALLS == 2
        chunk_service.search.side_effect = [
            [passage(CHUNK_A, 0.7)],
            [passage(CHUNK_B, 0.7)],
        ]
        llm = FakeLLM(
            search("try 1"),
            search("try 2"),
            reply(citations=[1, 2]),
        )
        state = await agent_run("q", llm)

        assert len(state["tool_calls"]) == 2
        assert len(llm.calls) == 3
        # The third call can only reply: no tool is in its schema.
        last = llm.calls[-1]["schema"]
        assert set(last.model_fields) == {
            "action",
            "turn_type",
            "intent",
            "answer",
            "citations",
            "language",
        }
        assert "searches left: 0" in llm.calls[-1]["prompt"]
        assert state["result"]["intent"] == "answer"

    async def test_no_search_after_one_that_added_nothing(
        self, agent_run, chunk_service
    ):
        """The Preview loop: four rephrasings of the same miss, about 25 seconds."""
        chunk_service.search.return_value = [passage(CHUNK_A, 0.7)]
        llm = FakeLLM(
            search("What is Ally?"),
            search("What is Ally and what does it do?"),  # finds the same passage
            reply(citations=[1]),
        )
        state = await agent_run("ally kya hai?", llm)
        assert len(state["tool_calls"]) == 2
        assert state["tool_calls"][1]["added"] == []
        assert "searches left: 0" in llm.calls[2]["prompt"]
        assert "search_knowledge" not in llm.calls[2]["schema"].model_fields

    async def test_past_the_time_budget_it_replies_and_is_not_rewritten(
        self, agent_run, chunk_service, monkeypatch
    ):
        monkeypatch.setattr(settings.AGENT_RUNTIME, "RUN_BUDGET_SECONDS", 0.000001)
        chunk_service.search.return_value = [passage(CHUNK_A, 0.7)]
        llm = FakeLLM(
            search("q"),
            reply("answer", "An uncited claim."),  # would be sent back in time
        )
        state = await agent_run("q", llm)
        assert len(llm.calls) == 2
        assert "search_knowledge" not in llm.calls[1]["schema"].model_fields
        # Final: declined with no text rather than a rewrite past ally-be's timeout.
        assert state["result"]["intent"] == "decline"
        assert nodes(state)[-2:] == ["check", "finalize"]

    async def test_reads_only_the_last_ten_messages(self, agent_run, chunk_service):
        history = [
            {"role": "user" if i % 2 == 0 else "assistant", "content": f"message {i}"}
            for i in range(14)
        ]
        llm = FakeLLM(chat())
        await agent_run("hi", llm, history=history)
        prompt = llm.calls[0]["prompt"]
        assert "message 3" not in prompt
        assert "message 4" in prompt and "message 13" in prompt

    async def test_a_lower_cap_is_honoured(self, agent_run, chunk_service, monkeypatch):
        monkeypatch.setattr(settings.AGENT_RUNTIME, "MAX_TOOL_CALLS", 1)
        chunk_service.search.return_value = []
        llm = FakeLLM(search("first"), reply("decline", "No."))
        state = await agent_run("q", llm)
        assert len(state["tool_calls"]) == 1
        assert len(llm.calls) == 2


class TestRevision:
    async def test_an_uncited_claim_is_rewritten_in_the_agents_words(
        self, agent_run, chunk_service
    ):
        chunk_service.search.return_value = []
        llm = FakeLLM(
            reply("answer", "Refunds take 5 days."),
            search("refund policy"),
            reply("decline", "I don't have anything on refunds — your admin would."),
        )
        state = await agent_run("refund policy?", llm)
        result = state["result"]

        assert result["intent"] == "decline"
        assert (
            result["answer"] == "I don't have anything on refunds — your admin would."
        )
        # The rewrite is told why, never shown the refused claim.
        second = llm.calls[1]["prompt"]
        assert "# Your previous draft was not sent" in second
        assert REJECTIONS["uncited"] in second
        assert "You haven't searched yet: search before you reply." in second
        assert "Refunds take 5 days." not in second
        # Nothing searched yet: that step could only search.
        assert "reply" not in [
            a.value for a in llm.calls[1]["schema"].model_fields["action"].annotation
        ]
        assert nodes(state) == [
            "agent",
            "check",
            "agent",
            "tool",
            "agent",
            "check",
            "finalize",
        ]
        check = state["trace"][1]
        assert check["summary"] == "check: sent back (uncited)"

    async def test_the_rewrite_may_search_then_answer(self, agent_run, chunk_service):
        chunk_service.search.return_value = [passage(CHUNK_A, 0.7)]
        llm = FakeLLM(
            reply("answer", "Ask your admin."),
            search("how to get access"),
            reply(citations=[1], answer="Ask your admin to invite you."),
        )
        result = (await agent_run("access?", llm))["result"]
        assert result["intent"] == "answer"
        assert [c["chunk_id"] for c in result["citations"]] == [CHUNK_A]

    async def test_a_refused_rewrite_falls_back_to_the_first_draft(
        self, agent_run, chunk_service
    ):
        """Preview: "what is ally?" with only the Progress document attached."""
        chunk_service.search.return_value = [passage(CHUNK_A, 0.7)]
        llm = FakeLLM(
            search("What is Ally?"),
            reply("decline", "The documents don't describe what Ally is."),
            reply("answer", "Ally is a not-for-profit platform."),  # uncited
        )
        state = await agent_run("what is ally?", llm)
        result = state["result"]
        assert result["intent"] == "decline"
        assert result["answer"] == "The documents don't describe what Ally is."

    async def test_a_second_refusal_is_final_and_sends_no_text(
        self, agent_run, chunk_service
    ):
        chunk_service.search.return_value = []
        llm = FakeLLM(
            reply("answer", "Refunds take 5 days."),
            search("refund policy"),
            reply("answer", "Refunds take five days."),
        )
        state = await agent_run("refund policy?", llm)
        result = state["result"]
        assert len(llm.calls) == 3
        assert result["intent"] == "decline"
        # The refused claim never reaches the person; ally-be sends its decline text.
        assert result["answer"] == ""

    async def test_smalltalk_with_an_unsourced_detail_is_sent_back(
        self, agent_run, chunk_service
    ):
        llm = FakeLLM(
            chat("Hi! Call us on 1800-123-456."),
            chat("Hi! What can I help you with today?"),
        )
        state = await agent_run("hi", llm)
        second = llm.calls[1]["prompt"]
        assert REJECTIONS["unsourced_detail"] + " It contained a number." in second
        assert "1800-123-456" not in second
        assert state["result"]["answer"] == "Hi! What can I help you with today?"
        assert state["result"]["intent"] == "answer"

    async def test_a_models_own_decline_is_not_sent_back(
        self, agent_run, chunk_service
    ):
        llm = FakeLLM(reply("decline", "I can't help with medication questions."))
        state = await agent_run("what dose?", llm)
        assert len(llm.calls) == 1
        assert state["result"]["answer"] == "I can't help with medication questions."


class TestTheOrganisationIsNeverGeneralKnowledge:
    """The Preview finding: "Ally kya hai?" on a documents_and_general bot."""

    BOT = dict(
        answer_mode="documents_and_general",
        persona={"display_name": "Ally FAQ"},
        knowledge_topics=["Ally FAQ – About Ally"],
    )

    async def test_a_decline_that_ignores_the_found_passage_is_rewritten(
        self, agent_run, chunk_service
    ):
        chunk_service.search.return_value = [passage(CHUNK_A, 0.7)]
        llm = FakeLLM(
            search("What is Ally?", language="hi"),
            reply(
                "decline",
                "Yeh general jankari hai — documents mein iska varnan nahi hai. "
                "[www.helloally.ai](https://www.helloally.ai)",
                language="hi",
            ),
            reply(citations=[1], answer="Ally ek platform hai.", language="hi"),
        )
        state = await agent_run("Ally kya hai?", llm, **self.BOT)

        assert REJECTIONS["use_found"] in llm.calls[2]["prompt"]
        result = state["result"]
        assert result["intent"] == "answer"
        assert [c["chunk_id"] for c in result["citations"]] == [CHUNK_A]
        assert result["retrieval"]["unsupported"] is False

    async def test_an_uncited_answer_without_a_search_is_sent_to_search(
        self, agent_run, chunk_service
    ):
        chunk_service.search.return_value = [passage(CHUNK_A, 0.7)]
        llm = FakeLLM(
            reply("answer", "Ally is a not-for-profit platform."),
            search("What is Ally?"),
            reply(citations=[1], answer="Ally is a practice platform."),
        )
        state = await agent_run("What is Ally?", llm, **self.BOT)

        assert "You haven't searched yet: search before you reply." in (
            llm.calls[1]["prompt"]
        )
        assert state["result"]["citations"][0]["chunk_id"] == CHUNK_A

    async def test_a_decline_without_searching_must_search(
        self, agent_run, chunk_service
    ):
        chunk_service.search.return_value = [passage(CHUNK_A, 0.7)]
        llm = FakeLLM(
            reply("decline", "I don't have that information."),
            search("Does Ally store audio of real sessions?"),
            reply(
                citations=[1], answer="No: the audio is deleted after transcription."
            ),
        )
        state = await agent_run(
            "Does Ally store the audio of my real sessions?", llm, **self.BOT
        )
        assert REJECTIONS["search_first"] in llm.calls[1]["prompt"]
        assert state["result"]["intent"] == "answer"
        assert state["result"]["citations"][0]["chunk_id"] == CHUNK_A

    async def test_a_general_topic_is_answered_after_a_search_found_nothing(
        self, agent_run, chunk_service
    ):
        chunk_service.search.return_value = []
        llm = FakeLLM(
            search("What is CBT?"),
            reply("answer", "CBT is a talking therapy. This is general information."),
        )
        state = await agent_run("What is CBT?", llm, **self.BOT)
        result = state["result"]
        assert result["intent"] == "answer"
        assert result["retrieval"]["unsupported"] is True
        assert "general knowledge" in llm.calls[0]["prompt"]

    async def test_a_documents_only_bot_is_told_it_has_no_general_knowledge(
        self, agent_run, chunk_service
    ):
        llm = FakeLLM(chat())
        await agent_run("hi", llm)
        assert "you don't answer from general knowledge" in llm.calls[0]["prompt"]


class TestDeclineReason:
    async def test_nothing_found_keeps_the_gate_reason(self, agent_run, chunk_service):
        chunk_service.search.return_value = [passage(CHUNK_A, 0.2)]
        llm = FakeLLM(search("weather"), reply("decline", "I can't help with that."))
        result = (await agent_run("weather tomorrow?", llm))["result"]
        assert result["decline_reason"] == "below_threshold"
        assert result["answer"] == "I can't help with that."

    async def test_no_hits(self, agent_run, chunk_service):
        chunk_service.search.return_value = []
        llm = FakeLLM(search("tax"), reply("decline", "Not something I cover."))
        result = (await agent_run("tax rules?", llm))["result"]
        assert result["decline_reason"] == "no_hits"

    async def test_without_a_search_it_is_the_models(self, agent_run, chunk_service):
        llm = FakeLLM(reply("decline", "I can't tell jokes, but I can help with Ally."))
        result = (await agent_run("tell me a joke", llm))["result"]
        assert result["decline_reason"] == "model_declined"


class TestRetrievalLog:
    async def test_once_for_an_answered_question(
        self, agent_run, chunk_service, retrieval_log
    ):
        chunk_service.search.side_effect = [
            [passage(CHUNK_A, 0.7)],
            [passage(CHUNK_C, 0.7)],
        ]
        llm = FakeLLM(search("q"), search("more"), reply(citations=[1, 2]))
        await agent_run("q", llm)
        assert retrieval_log.call_count == 1  # the first search only
        assert retrieval_log.call_args.kwargs["disposition"] == "answered"

    async def test_once_for_a_search_that_found_nothing(
        self, agent_run, chunk_service, retrieval_log
    ):
        chunk_service.search.return_value = []
        llm = FakeLLM(search("q"), reply("decline", "No."))
        await agent_run("q", llm)
        assert retrieval_log.call_count == 1
        assert retrieval_log.call_args.kwargs["disposition"] == "declined_no_hits"

    async def test_log_retrieval_false_skips_it(
        self, agent_run, chunk_service, retrieval_log
    ):
        chunk_service.search.return_value = [passage(CHUNK_A, 0.7)]
        llm = FakeLLM(search("q"), reply(citations=[1]))
        await agent_run("q", llm, log_retrieval=False)
        assert retrieval_log.call_count == 0


class TestModelAndTracing:
    async def test_the_bots_model_drives_the_agent_step(self, agent_run, chunk_service):
        llm = FakeLLM(chat("Hi!"))
        prompts = {
            "ally_ai_agent_system": {
                "provider": "anthropic",
                "model": "claude-sonnet-4-6",
                "temperature": 0.2,
            }
        }
        await agent_run("hi", llm, prompts=prompts)
        step_call = llm.calls[0]
        assert step_call["model"] == "claude-sonnet-4-6"
        assert step_call["provider"] == "anthropic"
        assert step_call["task"] == "whatsapp_agent_step"

    async def test_runs_are_never_traced_to_langsmith(
        self, agent_run, chunk_service, monkeypatch
    ):
        monkeypatch.setenv("LANGSMITH_TRACING", "true")
        assert langsmith_utils.tracing_is_enabled()
        seen = []
        llm = FakeLLM(reply("decline", "No."))
        original = llm.__call__

        async def spy(**kwargs):
            seen.append(langsmith_utils.tracing_is_enabled())
            return await original(**kwargs)

        await agent_run("q", spy)
        assert seen and not any(seen)

    async def test_final_state_is_plain_json(self, agent_run, chunk_service):
        chunk_service.search.return_value = [passage(CHUNK_A, 0.7)]
        llm = FakeLLM(search("q"), reply(citations=[1]))
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
        llm = FakeLLM(search("q"), reply(citations=[1]))
        await agent_run("q", llm)
        chunk_service.search.return_value = []
        # A new run id: the same id in the same thread returns the stored run.
        state = await run("hello", run_id="run-2")
        assert state["tool_calls"] is None
        assert state["turn_type"] is None
        assert nodes(state) == ["translate", "retrieve", "gate", "finalize"]

    async def test_an_agent_run_after_another_starts_clean(
        self, agent_run, chunk_service
    ):
        chunk_service.search.return_value = [passage(CHUNK_A, 0.7)]
        await agent_run("q", FakeLLM(search("q"), reply(citations=[1])))
        llm = FakeLLM(chat("You're welcome!"))
        state = await agent_run("thanks", llm, run_id="run-2")
        assert state["passages"] == []
        assert state["tool_calls"] == []
        assert state["result"]["retrieval"]["hit_count"] == 0
        assert "(none yet)" in llm.calls[0]["prompt"]


class TestReasoningEffort:
    """AGENT_RUNTIME__AGENT_REASONING_EFFORT reaches the agent step."""

    async def test_unset_sends_none(self, agent_run, chunk_service, monkeypatch):
        # Explicitly unset: a developer's ally-ai/.env may set it.
        monkeypatch.setattr(settings.AGENT_RUNTIME, "AGENT_REASONING_EFFORT", None)
        llm = FakeLLM(chat("Hi!"))
        await agent_run("hi", llm)
        assert llm.calls[0]["reasoning_effort"] is None

    async def test_setting_reaches_the_agent_step(
        self, agent_run, chunk_service, monkeypatch
    ):
        monkeypatch.setattr(settings.AGENT_RUNTIME, "AGENT_REASONING_EFFORT", "low")
        llm = FakeLLM(chat("Hi!"))
        await agent_run("hi", llm)
        assert llm.calls[0]["reasoning_effort"] == "low"
