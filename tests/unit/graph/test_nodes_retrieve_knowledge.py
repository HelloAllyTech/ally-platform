import pytest
from langchain_core.messages import AIMessage, HumanMessage

from app.core.config import settings
from app.core.graph import knowledge_retrieval as knowledge_retrieval_module
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
        assert result["retrieved_context"] is None


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
        assert result["retrieved_context"] is None


class CountingStructuredLLM:
    def __init__(self, titles: list, counter: dict):
        self._titles = titles
        self._counter = counter

    async def ainvoke(self, messages):
        self._counter["calls"] += 1
        return RelevantKeys(titles=self._titles)


class CountingLLMInstance:
    def __init__(self, titles: list, counter: dict):
        self._titles = titles
        self._counter = counter

    def with_structured_output(self, schema):
        return CountingStructuredLLM(self._titles, self._counter)


class CountingLLMClient:
    """Like FakeLLMClient, but tracks how many times the LLM was actually
    invoked so tests can prove a cadence-reused turn skips the call."""

    def __init__(self, titles: list):
        self.counter = {"calls": 0}
        self._llm_instance = CountingLLMInstance(titles, self.counter)

    @property
    def llm_instance(self):
        return self._llm_instance


class TestKnowledgeRetrievalRefreshCadence:
    KB = [{"title": "school memories", "content": "Bullied in 8th grade"}]

    @pytest.fixture(autouse=True)
    def _clear_retrieval_cache(self):
        # retrieve_relevant_knowledge's own exact-content-hash cache is a
        # module-level singleton — without clearing it, these tests' shared
        # KB/message content would hit each other's cached results and never
        # reach the CountingLLMClient, defeating the call-count assertions.
        knowledge_retrieval_module._RETRIEVAL_CACHE.clear()
        yield
        knowledge_retrieval_module._RETRIEVAL_CACHE.clear()

    def _scenario(self):
        pd = type("PD", (), {"knowledge_sources": self.KB})()
        return type("S", (), {"prompt_data": pd})()

    @pytest.mark.asyncio
    async def test_fresh_state_always_computes(self):
        client = CountingLLMClient(["school memories"])
        result = await retrieve_knowledge(
            _make_state(messages=[HumanMessage(content="Tell me about school")]),
            {"configurable": {"scenario": self._scenario(), "llm_client": client}},
        )
        assert client.counter["calls"] == 1
        assert result["retrieved_context"] is not None
        # KNOWLEDGE_RETRIEVAL_REFRESH_TURNS default is 2 -> reuse for 1 more
        # turn after this fresh compute.
        assert result["turns_until_knowledge_refresh"] == 1

    @pytest.mark.asyncio
    async def test_reuses_cached_context_without_calling_llm(self):
        client = CountingLLMClient(["school memories"])
        state = _make_state(
            messages=[HumanMessage(content="Tell me about school")],
            retrieved_context="**school memories:**\nBullied in 8th grade",
            turns_until_knowledge_refresh=1,
        )
        result = await retrieve_knowledge(
            state,
            {"configurable": {"scenario": self._scenario(), "llm_client": client}},
        )
        assert client.counter["calls"] == 0
        assert result["retrieved_context"] == state.retrieved_context
        assert result["turns_until_knowledge_refresh"] == 0

    @pytest.mark.asyncio
    async def test_recomputes_once_countdown_reaches_zero(self):
        client = CountingLLMClient(["school memories"])
        state = _make_state(
            messages=[HumanMessage(content="Tell me about school")],
            retrieved_context="stale context from a much earlier turn",
            turns_until_knowledge_refresh=0,
        )
        result = await retrieve_knowledge(
            state,
            {"configurable": {"scenario": self._scenario(), "llm_client": client}},
        )
        assert client.counter["calls"] == 1
        assert "school memories" in result["retrieved_context"]

    @pytest.mark.asyncio
    async def test_global_kill_switch_disables_reuse(self, monkeypatch):
        monkeypatch.setattr(settings, "KNOWLEDGE_RETRIEVAL_REFRESH_ENABLED", False)
        client = CountingLLMClient(["school memories"])
        state = _make_state(
            messages=[HumanMessage(content="Tell me about school")],
            turns_until_knowledge_refresh=5,  # would otherwise reuse
        )
        result = await retrieve_knowledge(
            state,
            {"configurable": {"scenario": self._scenario(), "llm_client": client}},
        )
        assert client.counter["calls"] == 1
        assert result["turns_until_knowledge_refresh"] == 0

    @pytest.mark.asyncio
    async def test_non_positive_refresh_turns_disables_reuse(self, monkeypatch):
        monkeypatch.setattr(settings, "KNOWLEDGE_RETRIEVAL_REFRESH_TURNS", 0)
        client = CountingLLMClient(["school memories"])
        state = _make_state(
            messages=[HumanMessage(content="Tell me about school")],
            turns_until_knowledge_refresh=5,  # would otherwise reuse
        )
        result = await retrieve_knowledge(
            state,
            {"configurable": {"scenario": self._scenario(), "llm_client": client}},
        )
        assert client.counter["calls"] == 1
        assert result["turns_until_knowledge_refresh"] == 0


class TestGlossarySectionsInNode:
    @pytest.mark.asyncio
    async def test_glossary_sections_alone_trigger_retrieval(self):
        """Non-English sessions can have glossary sections without any
        scenario knowledge sources — retrieval must still run."""
        title = "[Tamil (India) glossary] Clinical terms"
        pd = type(
            "PD",
            (),
            {
                "knowledge_sources": None,
                "glossary_sections": [
                    {
                        "title": title,
                        "content": '- worry: say "டென்ஷன்"',
                        "retrievalHint": "Retrieve when clinical.",
                    }
                ],
            },
        )()
        scenario = type("S", (), {"prompt_data": pd})()
        result = await retrieve_knowledge(
            _make_state(messages=[HumanMessage(content="மனசு சரியில்ல")]),
            {
                "configurable": {
                    "scenario": scenario,
                    "llm_client": FakeLLMClient([title]),
                }
            },
        )
        assert result["retrieved_context"] is not None
        assert 'worry: say "டென்ஷன்"' in result["retrieved_context"]
