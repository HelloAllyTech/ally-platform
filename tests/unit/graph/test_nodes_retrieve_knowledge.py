import pytest
from langchain_core.messages import AIMessage, HumanMessage

from app.core.graph.knowledge_retrieval import RelevantKeys
from app.core.graph.nodes import retrieve_knowledge
from app.core.graph.state import SimulationState


class FakeStructuredLLM:
    def __init__(self, titles: list):
        self._titles = titles

    async def ainvoke(self, messages):
        return RelevantKeys(titles=self._titles)


class FakeLLMInstance:
    def __init__(self, titles: list):
        self._titles = titles

    def with_structured_output(self, schema):
        return FakeStructuredLLM(self._titles)


class FakeLLMClient:
    def __init__(self, titles: list):
        self._llm_instance = FakeLLMInstance(titles)

    @property
    def llm_instance(self):
        return self._llm_instance


def _make_state(**kwargs):
    defaults = dict(
        messages=[],
        permitted_events=[],
        events_accumulator=[],
        new_events=[],
        current_score=0,
        branching_and_feedback_data=[],
    )
    defaults.update(kwargs)
    return SimulationState(**defaults)


class TestRetrieveKnowledgeNode:
    @pytest.mark.asyncio
    async def test_no_scenario_returns_none(self):
        result = await retrieve_knowledge(_make_state(), {"configurable": {}})
        assert result == {"retrieved_context": None}

    @pytest.mark.asyncio
    async def test_no_llm_client_returns_none(self):
        pd = type("PD", (), {"knowledge_sources": [{"title": "a", "content": "b"}]})()
        scenario = type("S", (), {"prompt_data": pd})()
        result = await retrieve_knowledge(
            _make_state(), {"configurable": {"scenario": scenario}}
        )
        assert result == {"retrieved_context": None}

    @pytest.mark.asyncio
    async def test_no_knowledge_sources_returns_none(self):
        pd = type("PD", (), {"knowledge_sources": None})()
        scenario = type("S", (), {"prompt_data": pd})()
        result = await retrieve_knowledge(
            _make_state(),
            {"configurable": {"scenario": scenario, "llm_client": FakeLLMClient([])}},
        )
        assert result == {"retrieved_context": None}

    @pytest.mark.asyncio
    async def test_empty_knowledge_sources_returns_none(self):
        pd = type("PD", (), {"knowledge_sources": []})()
        scenario = type("S", (), {"prompt_data": pd})()
        result = await retrieve_knowledge(
            _make_state(),
            {"configurable": {"scenario": scenario, "llm_client": FakeLLMClient([])}},
        )
        assert result == {"retrieved_context": None}

    @pytest.mark.asyncio
    async def test_successful_retrieval(self):
        kb = [
            {"title": "school memories", "content": "Bullied in 8th grade"},
            {"title": "family dynamics", "content": "Parents are strict"},
        ]
        pd = type("PD", (), {"knowledge_sources": kb})()
        scenario = type("S", (), {"prompt_data": pd})()

        state = _make_state(
            messages=[
                HumanMessage(content="Tell me about school"),
                AIMessage(content="I had a tough time"),
            ]
        )
        result = await retrieve_knowledge(
            state,
            {
                "configurable": {
                    "scenario": scenario,
                    "llm_client": FakeLLMClient(["school memories"]),
                }
            },
        )
        ctx = result["retrieved_context"]
        assert ctx is not None
        assert "school memories" in ctx
        assert "Bullied in 8th grade" in ctx
        assert "family dynamics" not in ctx

    @pytest.mark.asyncio
    async def test_no_relevant_keys_returns_none(self):
        kb = [{"title": "school memories", "content": "Bullied in 8th grade"}]
        pd = type("PD", (), {"knowledge_sources": kb})()
        scenario = type("S", (), {"prompt_data": pd})()

        result = await retrieve_knowledge(
            _make_state(messages=[HumanMessage(content="How are you?")]),
            {
                "configurable": {
                    "scenario": scenario,
                    "llm_client": FakeLLMClient([]),
                }
            },
        )
        assert result == {"retrieved_context": None}


class FakeFailingLLM:
    def with_structured_output(self, schema):
        return self

    async def ainvoke(self, messages):
        raise RuntimeError("boom")


class FakeFailingClient:
    @property
    def llm_instance(self):
        return FakeFailingLLM()


class TestRetrieveKnowledgeNodeErrorHandling:
    @pytest.mark.asyncio
    async def test_llm_failure_returns_none(self):
        kb = [{"title": "k", "content": "d"}]
        pd = type("PD", (), {"knowledge_sources": kb})()
        scenario = type("S", (), {"prompt_data": pd})()

        result = await retrieve_knowledge(
            _make_state(messages=[HumanMessage(content="test")]),
            {
                "configurable": {
                    "scenario": scenario,
                    "llm_client": FakeFailingClient(),
                }
            },
        )
        assert result == {"retrieved_context": None}
