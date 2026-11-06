"""The graph runs the knowledge pipeline's steps, with their behaviour unchanged.

Each class mirrors one behaviour from tests/core/knowledge_agent/test_agent.py, run
through the graph instead of `KnowledgeAgentService.answer`.
"""

import json
from unittest.mock import AsyncMock, patch

import pytest
from langgraph.checkpoint.memory import InMemorySaver
from langsmith import utils as langsmith_utils

from app.core.agent_runtime.graph import build_graph, run_agent
from app.core.knowledge_agent.agent import KnowledgeAgentService
from app.core.knowledge_agent.schemas import (
    AnswerIntent,
    KnowledgeAnswer,
    TranslatedQuery,
)
from app.core.knowledge_base.knowledge_chunk_service import (
    ChunkAudience,
    KnowledgeChunkService,
)
from tests.core.agent_runtime.conftest import AGENT, make_bot
from tests.core.agent_runtime.steps import nodes
from tests.core.knowledge_agent.test_agent import (
    CHUNK_A,
    CHUNK_B,
    passage,
    stub_generate,
)

pytestmark = pytest.mark.asyncio

NO_DOCUMENTS = "00000000-0000-0000-0000-000000000000"


class TestGate:
    async def test_no_hits_declines_without_a_write_call(self, run, chunk_service):
        chunk_service.search.return_value = []
        with patch(f"{AGENT}.generate_structured") as gen:
            state = await run("what is the dose?")

        gen.assert_not_called()
        assert state["result"]["intent"] == "decline"
        assert state["result"]["decline_reason"] == "no_hits"
        assert state["gate_reason"] == "no_hits"
        assert nodes(state) == ["translate", "retrieve", "gate", "finalize"]

    async def test_below_threshold_declines(self, run, chunk_service):
        chunk_service.search.return_value = [passage(CHUNK_A, 0.38)]
        with patch(f"{AGENT}.generate_structured") as gen:
            state = await run("q", limits={"decline_similarity": 0.42})

        gen.assert_not_called()
        assert state["result"]["decline_reason"] == "below_threshold"
        assert state["result"]["retrieval"]["hit_count"] == 1

    async def test_general_mode_skips_the_gate(self, run, chunk_service):
        chunk_service.search.return_value = []
        gen = stub_generate(KnowledgeAnswer(intent=AnswerIntent.ANSWER, answer="Yes."))
        with patch(f"{AGENT}.generate_structured", gen):
            state = await run("q", answer_mode="documents_and_general")

        assert gen.await_count == 1
        assert state["gate_reason"] is None
        assert state["passages"] == []
        assert state["result"]["intent"] == "answer"
        assert nodes(state) == [
            "translate",
            "retrieve",
            "gate",
            "select",
            "write",
            "check",
            "finalize",
        ]


class TestSelect:
    async def _passages(self, run, chunk_service, hits, **limits):
        chunk_service.search.return_value = hits
        gen = stub_generate(KnowledgeAnswer(intent=AnswerIntent.ANSWER, answer="A."))
        with patch(f"{AGENT}.generate_structured", gen):
            state = await run("q", limits=limits)
        return state

    async def test_similarity_band_drops_weak_hits(self, run, chunk_service):
        state = await self._passages(
            run,
            chunk_service,
            [passage(CHUNK_A, 0.80), passage(CHUNK_B, 0.60)],
            similarity_band=0.08,
        )
        assert [p["chunk_id"] for p in state["passages"]] == [CHUNK_A]
        assert state["result"]["retrieval"]["passages_used"] == 1

    async def test_count_cap(self, run, chunk_service):
        hits = [passage(f"{i:08d}-0000-0000-0000-000000000000", 0.8) for i in range(6)]
        state = await self._passages(run, chunk_service, hits, max_passages=3)
        assert len(state["passages"]) == 3

    async def test_token_budget(self, run, chunk_service):
        hits = [
            passage(CHUNK_A, 0.80, tokens=300),
            passage(CHUNK_B, 0.79, tokens=300),
        ]
        state = await self._passages(run, chunk_service, hits, max_context_tokens=400)
        assert [p["chunk_id"] for p in state["passages"]] == [CHUNK_A]


class TestCheck:
    async def test_out_of_range_citations_are_dropped(self, run, chunk_service):
        chunk_service.search.return_value = [passage(CHUNK_A, 0.7)]
        gen = stub_generate(
            KnowledgeAnswer(intent=AnswerIntent.ANSWER, answer="A.", citations=[1, 9])
        )
        with patch(f"{AGENT}.generate_structured", gen):
            state = await run("q")

        citations = state["result"]["citations"]
        assert [c["passage_number"] for c in citations] == [1]
        assert citations[0]["chunk_id"] == CHUNK_A

    async def test_empty_answer_becomes_a_decline(self, run, chunk_service):
        chunk_service.search.return_value = [passage(CHUNK_A, 0.7)]
        gen = stub_generate(
            KnowledgeAnswer(intent=AnswerIntent.ANSWER, answer="  ", citations=[1])
        )
        with patch(f"{AGENT}.generate_structured", gen):
            state = await run("q")

        assert state["result"]["intent"] == "decline"
        assert state["result"]["decline_reason"] == "model_declined"
        assert state["result"]["citations"] == []


class TestEmptySelection:
    async def test_placeholder_id_is_searched_as_sent_and_declines(
        self, run, chunk_service
    ):
        state = await run("What is Ally?", document_ids=[NO_DOCUMENTS])

        assert chunk_service.search.await_args.kwargs["document_ids"] == [NO_DOCUMENTS]
        assert state["result"]["decline_reason"] == "no_hits"

    async def test_an_empty_list_searches_nothing(self):
        """With the real chunk service: [] means no documents, never all of them."""
        embedding, vector_db = AsyncMock(), AsyncMock()
        real = KnowledgeAgentService(KnowledgeChunkService(vector_db, embedding))
        state = await run_agent(
            build_graph(real, InMemorySaver()),
            run_id="r",
            conversation_id="c",
            chatbot_id=None,
            question="What is Ally?",
            history=[],
            bot=make_bot(document_ids=[]),
        )
        vector_db.near_vector_search.assert_not_called()
        assert state["result"]["retrieval"]["hit_count"] == 0
        assert state["result"]["decline_reason"] == "no_hits"


class TestModelOverride:
    async def test_the_bots_model_applies_to_the_write_step_only(
        self, run, chunk_service
    ):
        """ally-be puts the bot's model on the two answer prompts only."""
        chunk_service.search.return_value = [passage(CHUNK_A, 0.7)]
        prompts = {
            "ally_ai_knowledge_whatsapp_answer": {
                "prompt": "Q: {question}\n{passages}\n{history}\n{max_chars}",
                "provider": "anthropic",
                "model": "claude-sonnet-4-6",
            }
        }
        gen = stub_generate(
            TranslatedQuery(is_english=True, language="en"),
            KnowledgeAnswer(intent=AnswerIntent.ANSWER, answer="A.", citations=[1]),
        )
        with patch(f"{AGENT}.generate_structured", gen):
            await run("q", prompts=prompts, translate_query=True)

        translate_call, write_call = gen.await_args_list
        assert translate_call.kwargs["model"] != "claude-sonnet-4-6"
        assert write_call.kwargs["model"] == "claude-sonnet-4-6"
        assert write_call.kwargs["provider"] == "anthropic"


class TestRetrievalLog:
    """The graph reports each retrieval exactly once, as the old path does."""

    async def test_once_on_a_gate_decline(self, run, chunk_service, retrieval_log):
        chunk_service.search.return_value = []
        await run("q")
        assert retrieval_log.call_count == 1
        assert retrieval_log.call_args.kwargs["disposition"] == "declined_no_hits"

    async def test_once_on_an_answer(self, run, chunk_service, retrieval_log):
        chunk_service.search.return_value = [passage(CHUNK_A, 0.7)]
        gen = stub_generate(KnowledgeAnswer(intent=AnswerIntent.ANSWER, answer="A."))
        with patch(f"{AGENT}.generate_structured", gen):
            await run("q")
        assert retrieval_log.call_count == 1
        assert retrieval_log.call_args.kwargs["disposition"] == "answered"

    async def test_same_count_as_the_old_path(
        self, run, service, chunk_service, retrieval_log
    ):
        chunk_service.search.return_value = [passage(CHUNK_A, 0.7)]
        answer = KnowledgeAnswer(intent=AnswerIntent.ANSWER, answer="A.")
        with patch(f"{AGENT}.generate_structured", stub_generate(answer)):
            await service.answer(
                "q", ChunkAudience.unrestricted(), translate_query=False
            )
        old = retrieval_log.call_count
        with patch(f"{AGENT}.generate_structured", stub_generate(answer)):
            await run("q")
        assert retrieval_log.call_count - old == old == 1

    async def test_log_retrieval_false_skips_a_gate_decline(
        self, run, chunk_service, retrieval_log
    ):
        chunk_service.search.return_value = []
        result = await run("q", log_retrieval=False)
        assert retrieval_log.call_count == 0
        assert result["result"]["decline_reason"] == "no_hits"

    async def test_log_retrieval_false_skips_an_answer(
        self, run, chunk_service, retrieval_log
    ):
        chunk_service.search.return_value = [passage(CHUNK_A, 0.7)]
        gen = stub_generate(KnowledgeAnswer(intent=AnswerIntent.ANSWER, answer="A."))
        with patch(f"{AGENT}.generate_structured", gen):
            result = await run("q", log_retrieval=False)
        assert retrieval_log.call_count == 0
        assert result["result"]["intent"] == "answer"


class TestTracingAndState:
    async def test_runs_are_never_traced_to_langsmith(
        self, run, chunk_service, monkeypatch
    ):
        """No new PHI destination, even where LangSmith tracing is switched on."""
        monkeypatch.setenv("LANGSMITH_TRACING", "true")
        assert langsmith_utils.tracing_is_enabled()
        seen = []

        async def search(**_):
            seen.append(langsmith_utils.tracing_is_enabled())
            return []

        chunk_service.search.side_effect = search
        await run("q")
        assert seen == [False]

    async def test_final_state_is_plain_json(self, run, chunk_service):
        chunk_service.search.return_value = [passage(CHUNK_A, 0.7)]
        gen = stub_generate(
            KnowledgeAnswer(intent=AnswerIntent.ANSWER, answer="A.", citations=[1])
        )
        with patch(f"{AGENT}.generate_structured", gen):
            state = await run("q")
        assert json.loads(json.dumps(state)) == state

    async def test_trace_has_no_question_text(self, run, chunk_service):
        chunk_service.search.return_value = [passage(CHUNK_A, 0.7)]
        gen = stub_generate(KnowledgeAnswer(intent=AnswerIntent.ANSWER, answer="A."))
        with patch(f"{AGENT}.generate_structured", gen):
            state = await run("my private question about a client")
        assert "private" not in json.dumps(state["trace"])
        assert all(set(s) == {"node", "ms", "summary"} for s in state["trace"])


async def test_translation_failure_is_its_own_decline(run, chunk_service):
    chunk_service.search.return_value = []
    gen = AsyncMock(side_effect=RuntimeError("down"))
    with patch(f"{AGENT}.generate_structured", gen):
        state = await run("Ally क्या है?", translate_query=True)
    assert state["result"]["decline_reason"] == "translation_failed"
    assert state["result"]["retrieval"]["translation_degraded"] is True
