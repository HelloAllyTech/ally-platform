"""The tool registry and search_knowledge."""

import pytest

from app.core.agent_runtime.schemas import step_schema
from app.core.agent_runtime.tools import REGISTRY, ToolContext, allowed_tools
from app.core.agent_runtime.tools.search_knowledge import SearchKnowledgeInput
from app.core.knowledge_agent.agent import KnowledgeAgentService
from tests.core.agent_runtime.conftest import make_bot
from tests.core.knowledge_agent.test_agent import CHUNK_A, CHUNK_B, passage

pytestmark = pytest.mark.asyncio

LIMITS = KnowledgeAgentService.resolve_limits()


def actions(schema):
    return schema["$defs"]["AgentAction"]["enum"]


class TestRegistry:
    async def test_every_tool_declares_name_schema_risk_and_handler(self):
        for name, tool in REGISTRY.items():
            assert tool.name == name
            assert tool.risk in ("low", "medium", "high")
            assert tool.description
            tool.input_model()  # every input field has a default

    async def test_without_a_gateway_every_bot_gets_the_search_tools(self):
        names = [t.name for t in allowed_tools(make_bot())]
        assert names == ["search_knowledge"]

    async def test_the_step_schema_names_only_offered_tools(self):
        tools = allowed_tools(make_bot())
        schema = step_schema(tools).model_json_schema()
        assert actions(schema) == ["reply", "search_knowledge"]
        reply_only = step_schema([]).model_json_schema()
        # An `enum` even with one value: not every provider accepts `const`.
        assert actions(reply_only) == ["reply"]
        assert "search_knowledge" not in reply_only["properties"]
        search_only = step_schema(tools, reply=False).model_json_schema()
        assert actions(search_only) == ["search_knowledge"]
        # Nothing to search with: replying stays possible.
        assert actions(step_schema([], reply=False).model_json_schema()) == ["reply"]


class TestSearchKnowledge:
    @pytest.fixture
    def tool(self):
        return REGISTRY["search_knowledge"]

    def ctx(self, chunk_service, passages, log_retrieval=False, **bot):
        return ToolContext(
            service=KnowledgeAgentService(chunk_service),
            bot=make_bot(**bot),
            limits=LIMITS,
            passages=passages,
            log_retrieval=log_retrieval,
        )

    async def test_new_passages_continue_the_numbering(self, tool, chunk_service):
        chunk_service.search.return_value = [
            passage(CHUNK_A, 0.7),
            passage(CHUNK_B, 0.68),
        ]
        result = await tool.handler(
            SearchKnowledgeInput(query="sign in"),
            self.ctx(chunk_service, [passage(CHUNK_A, 0.7)]),
        )
        assert [p["chunk_id"] for p in result.passages] == [CHUNK_B]
        assert result.record["added"] == [2]
        assert result.summary == "search_knowledge: 2 hits, 1 new passages, best 0.70"

    async def test_uses_the_bots_documents_and_thresholds(self, tool, chunk_service):
        await tool.handler(
            SearchKnowledgeInput(query="q"),
            self.ctx(chunk_service, [], document_ids=["doc-1"]),
        )
        kwargs = chunk_service.search.call_args.kwargs
        assert kwargs["document_ids"] == ["doc-1"]
        assert kwargs["min_similarity"] == LIMITS["min_similarity"]
        assert kwargs["limit"] == LIMITS["top_k"]

    async def test_below_the_decline_threshold_adds_nothing(self, tool, chunk_service):
        chunk_service.search.return_value = [passage(CHUNK_A, 0.1)]
        result = await tool.handler(
            SearchKnowledgeInput(query="q"), self.ctx(chunk_service, [])
        )
        assert result.passages == []
        assert result.record["hits"] == 1
        assert result.gate == "below_threshold"
        assert result.retrieval["top_similarity"] == 0.1

    async def test_empty_query_searches_nothing(self, tool, chunk_service):
        result = await tool.handler(
            SearchKnowledgeInput(query="  "), self.ctx(chunk_service, [])
        )
        chunk_service.search.assert_not_called()
        assert result.passages == []

    async def test_reports_the_retrieval_block(self, tool, chunk_service):
        chunk_service.search.return_value = [passage(CHUNK_A, 0.7)]
        result = await tool.handler(
            SearchKnowledgeInput(query="sign in"), self.ctx(chunk_service, [])
        )
        assert result.gate is None
        assert result.retrieval["translated_query"] == "sign in"
        assert result.retrieval["hit_count"] == 1
        assert result.retrieval["passages_used"] == 1

    async def test_logs_only_when_told_to(self, tool, chunk_service, retrieval_log):
        chunk_service.search.return_value = [passage(CHUNK_A, 0.7)]
        await tool.handler(SearchKnowledgeInput(query="q"), self.ctx(chunk_service, []))
        retrieval_log.assert_not_called()
        await tool.handler(
            SearchKnowledgeInput(query="q"),
            self.ctx(chunk_service, [], log_retrieval=True),
        )
        assert retrieval_log.call_count == 1
        assert retrieval_log.call_args.kwargs["disposition"] == "answered"

    async def test_logs_a_search_that_found_nothing_as_its_decline(
        self, tool, chunk_service, retrieval_log
    ):
        await tool.handler(
            SearchKnowledgeInput(query="q"),
            self.ctx(chunk_service, [], log_retrieval=True),
        )
        assert retrieval_log.call_args.kwargs["disposition"] == "declined_no_hits"
