import pytest
from langchain_core.messages import AIMessage, HumanMessage

from app.core.config import settings
from app.core.graph import knowledge_retrieval as knowledge_retrieval_module
from app.core.graph.knowledge_retrieval import RelevantKeys, RetrievedContextStore
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

    def with_structured_output(self, schema, **_kwargs):
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
    async def test_no_relevant_keys_returns_empty_string(self):
        # "" (computed, nothing relevant), not None (never computed) — the
        # distinction matters for RetrievedContextStore's is-not-None gating
        # on later turns. See test_empty_result_preserved_as_empty_string_not_none.
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
        assert result["retrieved_context"] == ""


class FakeFailingLLM:
    def with_structured_output(self, schema, **_kwargs):
        return self

    async def ainvoke(self, messages):
        raise RuntimeError("boom")


class FakeFailingClient:
    @property
    def llm_instance(self):
        return FakeFailingLLM()


class TestRetrieveKnowledgeNodeErrorHandling:
    @pytest.mark.asyncio
    async def test_llm_failure_returns_empty_string(self):
        # retrieve_relevant_knowledge catches the LLM error internally and
        # returns "" ("nothing relevant or an error" per its own docstring) —
        # the node must not collapse that back to None.
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
        assert result["retrieved_context"] == ""


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

    def with_structured_output(self, schema, **_kwargs):
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
        # turns_until_refresh now lives on RetrievedContextStore, not graph
        # state — see RetrievedContextStore's docstring for why (a
        # barge-in-cancelled superstep can't discard a store mutation the
        # way it can discard an uncommitted checkpoint value).
        client = CountingLLMClient(["school memories"])
        store = RetrievedContextStore()
        result = await retrieve_knowledge(
            _make_state(messages=[HumanMessage(content="Tell me about school")]),
            {
                "configurable": {
                    "scenario": self._scenario(),
                    "llm_client": client,
                    "retrieved_context_store": store,
                }
            },
        )
        assert client.counter["calls"] == 1
        assert result["retrieved_context"] is not None
        # KNOWLEDGE_RETRIEVAL_REFRESH_TURNS default is 2 -> reuse for 1 more
        # turn after this fresh compute.
        assert store.turns_until_refresh == 1

    @pytest.mark.asyncio
    async def test_reuses_cached_context_without_calling_llm(self):
        client = CountingLLMClient(["school memories"])
        store = RetrievedContextStore()
        store.turns_until_refresh = 1
        state = _make_state(
            messages=[HumanMessage(content="Tell me about school")],
            retrieved_context="**school memories:**\nBullied in 8th grade",
        )
        result = await retrieve_knowledge(
            state,
            {
                "configurable": {
                    "scenario": self._scenario(),
                    "llm_client": client,
                    "retrieved_context_store": store,
                }
            },
        )
        assert client.counter["calls"] == 0
        assert result["retrieved_context"] == state.retrieved_context
        assert store.turns_until_refresh == 0

    @pytest.mark.asyncio
    async def test_recomputes_once_countdown_reaches_zero(self):
        # A store that exists (e.g. created at worker init) but has never
        # computed anything yet — countdown 0, both context sources still
        # None — is the real turn-1 shape: neither the reuse nor the
        # async-detach branch has anything to reuse, so it must recompute
        # synchronously rather than accidentally taking the async path.
        client = CountingLLMClient(["school memories"])
        store = RetrievedContextStore()
        store.turns_until_refresh = 0
        state = _make_state(messages=[HumanMessage(content="Tell me about school")])
        result = await retrieve_knowledge(
            state,
            {
                "configurable": {
                    "scenario": self._scenario(),
                    "llm_client": client,
                    "retrieved_context_store": store,
                }
            },
        )
        assert client.counter["calls"] == 1
        assert "school memories" in result["retrieved_context"]

    @pytest.mark.asyncio
    async def test_no_store_always_recomputes(self):
        # No retrieved_context_store in config at all — there's nowhere to
        # keep a countdown, so the cadence-reuse branch is skipped entirely
        # rather than erroring; this computes fresh every call.
        client = CountingLLMClient(["school memories"])
        state = _make_state(
            messages=[HumanMessage(content="Tell me about school")],
            retrieved_context="stale context from a much earlier turn",
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
        store = RetrievedContextStore()
        store.turns_until_refresh = 5  # would otherwise reuse
        state = _make_state(messages=[HumanMessage(content="Tell me about school")])
        result = await retrieve_knowledge(
            state,
            {
                "configurable": {
                    "scenario": self._scenario(),
                    "llm_client": client,
                    "retrieved_context_store": store,
                }
            },
        )
        assert client.counter["calls"] == 1
        assert "school memories" in result["retrieved_context"]
        assert store.turns_until_refresh == 0

    @pytest.mark.asyncio
    async def test_non_positive_refresh_turns_disables_reuse(self, monkeypatch):
        monkeypatch.setattr(settings, "KNOWLEDGE_RETRIEVAL_REFRESH_TURNS", 0)
        client = CountingLLMClient(["school memories"])
        store = RetrievedContextStore()
        store.turns_until_refresh = 5  # would otherwise reuse
        state = _make_state(messages=[HumanMessage(content="Tell me about school")])
        result = await retrieve_knowledge(
            state,
            {
                "configurable": {
                    "scenario": self._scenario(),
                    "llm_client": client,
                    "retrieved_context_store": store,
                }
            },
        )
        assert client.counter["calls"] == 1
        assert "school memories" in result["retrieved_context"]
        assert store.turns_until_refresh == 0

    @pytest.mark.asyncio
    async def test_empty_result_preserved_as_empty_string_not_none(self):
        # Regression test: the sync-fallback branch used to collapse "" into
        # None (retrieved_context or None), which made a legitimately-empty
        # first result indistinguishable from "never computed" — forcing
        # every future refresh-due turn back into the expensive synchronous
        # path instead of the async-detach branch. Both branches must now
        # agree on "" for "computed, nothing relevant".
        client = CountingLLMClient([])  # LLM finds nothing relevant
        store = RetrievedContextStore()
        result = await retrieve_knowledge(
            _make_state(messages=[HumanMessage(content="How are you?")]),
            {
                "configurable": {
                    "scenario": self._scenario(),
                    "llm_client": client,
                    "retrieved_context_store": store,
                }
            },
        )
        assert result["retrieved_context"] == ""
        assert store.context == ""
        assert store.context is not None

    @pytest.mark.asyncio
    async def test_empty_stored_context_takes_async_path_not_sync(self, monkeypatch):
        # With the fix, a store holding "" (not None) from a prior empty
        # result must satisfy the async-detach gate's `is not None` check on
        # the next refresh-due turn — proving it no longer falls back to a
        # blocking synchronous recompute for the rest of the session.
        monkeypatch.setattr(settings, "KNOWLEDGE_RETRIEVAL_ASYNC", True)
        client = CountingLLMClient(["school memories"])
        store = RetrievedContextStore()
        store.context = ""
        store.turns_until_refresh = 0  # refresh due
        result = await retrieve_knowledge(
            _make_state(messages=[HumanMessage(content="Tell me about school")]),
            {
                "configurable": {
                    "scenario": self._scenario(),
                    "llm_client": client,
                    "retrieved_context_store": store,
                }
            },
        )
        # Returned immediately without awaiting the LLM call in-gate.
        assert result["retrieved_context"] == ""
        assert client.counter["calls"] == 0
        assert store.in_flight
        await store._task
        assert client.counter["calls"] == 1
        assert "school memories" in store.context


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


class _UsageStructuredLLM:
    """Honours include_raw, returning a raw message that carries usage."""

    def __init__(self, titles):
        self._titles = titles

    async def ainvoke(self, messages):
        from langchain_core.messages import AIMessage as _AI

        return {
            "raw": _AI(
                content="",
                usage_metadata={
                    "input_tokens": 400,
                    "output_tokens": 6,
                    "total_tokens": 406,
                },
            ),
            "parsed": RelevantKeys(titles=self._titles),
            "parsing_error": None,
        }


class _UsageLLMClient:
    provider = "openai"

    def __init__(self, titles):
        self.calls = []
        outer = self

        class _Instance:
            model_name = "gpt-4.1-mini"

            def with_structured_output(self, schema, **kwargs):
                outer.calls.append(kwargs)
                return _UsageStructuredLLM(titles)

        self._instance = _Instance()

    @property
    def llm_instance(self):
        return self._instance


class TestRetrieveKnowledgeUsage:
    """AI-cost: the selection call is attributed to the node's room."""

    @pytest.mark.asyncio
    async def test_selection_call_recorded_against_the_graph_room(self, ai_usage_calls):
        import types as _types

        kb = [{"title": "usage topic", "content": "A usage-only memory 7f3a"}]
        pd = type("PD", (), {"knowledge_sources": kb})()
        scenario = type("S", (), {"prompt_data": pd})()
        client = _UsageLLMClient(["usage topic"])

        result = await retrieve_knowledge(
            _make_state(messages=[HumanMessage(content="usage probe 7f3a")]),
            {
                "configurable": {
                    "scenario": scenario,
                    "llm_client": client,
                    "room": _types.SimpleNamespace(name="room-kb"),
                }
            },
        )

        assert "usage topic" in result["retrieved_context"]
        assert client.calls == [{"include_raw": True}]
        assert len(ai_usage_calls) == 1
        call = ai_usage_calls[0]
        assert (call["room_id"], call["task"]) == ("room-kb", "knowledge_retrieval")
        assert (call["provider"], call["model"]) == ("openai", "gpt-4.1-mini")
        assert call["prompt_tokens"] == 400

    @pytest.mark.asyncio
    async def test_room_reaches_the_call_through_the_compiled_subgraph(
        self, ai_usage_calls
    ):
        """In production the node runs inside its own compiled subgraph; the
        room must still come through LangGraph's config, not be "unknown"."""
        import types as _types

        from app.core.graph.graph_builder import build_retrieve_knowledge_subgraph

        kb = [{"title": "subgraph topic", "content": "A subgraph memory 91c2"}]
        pd = type("PD", (), {"knowledge_sources": kb})()
        scenario = type("S", (), {"prompt_data": pd})()

        await build_retrieve_knowledge_subgraph().ainvoke(
            _make_state(messages=[HumanMessage(content="subgraph probe 91c2")]),
            {
                "configurable": {
                    "scenario": scenario,
                    "llm_client": _UsageLLMClient(["subgraph topic"]),
                    "room": _types.SimpleNamespace(name="room-sub"),
                    "thread_id": "room-sub",
                }
            },
        )

        assert [(c["room_id"], c["task"]) for c in ai_usage_calls] == [
            ("room-sub", "knowledge_retrieval")
        ]
