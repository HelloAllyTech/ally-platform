"""Trainer-authored memory locks (app/core/graph/knowledge_locks.py).

Driven through the real entry points — the retrieve_knowledge node and the
prompt builder — as well as the pure helpers, because every working-memory
defect so far sat at a seam that component-level tests fed by hand.
"""

import pytest
from langchain_core.messages import AIMessage, HumanMessage

from app.core.graph.knowledge_locks import (
    KnowledgeUnlockTracker,
    locked_topics,
    partition_sources,
    resolve_for_turn,
)
from app.core.graph.knowledge_retrieval import RelevantKeys, RetrievedContextStore
from app.core.graph.nodes import retrieve_knowledge
from app.core.graph.state import SimulationState
from app.core.working_memory.render import render_sections
from app.core.working_memory.state import ClientWorkingMemory, WithheldTopic

STATES = [
    {"id": "s-guarded", "name": "guarded", "scoreLower": -100, "scoreUpper": 50},
    {"id": "s-opening", "name": "opening", "scoreLower": 50, "scoreUpper": 100},
    {"id": "s-trusting", "name": "trusting", "scoreLower": 100, "scoreUpper": 200},
]

SOURCES = [
    {"id": "k1", "title": "Job loss", "content": "Laid off in March."},
    {
        "id": "k2",
        "title": "Husband's drinking",
        "content": "He drinks every night since the layoff.",
        "unlocksFromStateId": "s-opening",
    },
    {
        "id": "k3",
        "title": "Missed rent",
        "content": "Two months behind on rent.",
        "unlocksFromStateId": "s-trusting",
    },
]


def _titles(sources):
    return [s["title"] for s in sources]


class TestPartition:
    def test_unset_is_always_available(self):
        unlocked, locked = partition_sources(SOURCES, STATES, -1)
        assert _titles(unlocked) == ["Job loss"]
        assert _titles(locked) == ["Husband's drinking", "Missed rent"]

    def test_threshold_unlocks_that_state_and_every_later_one(self):
        unlocked, locked = partition_sources(SOURCES, STATES, 1)
        assert _titles(unlocked) == ["Job loss", "Husband's drinking"]
        assert _titles(locked) == ["Missed rent"]
        unlocked, _ = partition_sources(SOURCES, STATES, 2)
        assert len(unlocked) == 3

    def test_ladder_is_score_order_not_list_order(self):
        shuffled = [STATES[2], STATES[0], STATES[1]]
        unlocked, _ = partition_sources(SOURCES, shuffled, 1)
        assert _titles(unlocked) == ["Job loss", "Husband's drinking"]

    def test_unknown_state_fails_closed(self):
        sources = [{"title": "x", "content": "y", "unlocksFromStateId": "gone"}]
        unlocked, locked = partition_sources(sources, STATES, 2)
        assert unlocked == [] and _titles(locked) == ["x"]

    def test_lock_without_states_fails_closed(self):
        unlocked, locked = partition_sources(SOURCES, None, 5)
        assert _titles(unlocked) == ["Job loss"]
        assert len(locked) == 2

    def test_locked_topics_never_carries_content(self):
        _, locked = partition_sources(SOURCES, STATES, -1)
        topics = locked_topics(locked)
        assert topics == ["Husband's drinking", "Missed rent"]
        assert not any("drinks" in t or "behind" in t for t in topics)


class TestHighWaterMark:
    def test_unlock_survives_score_falling_back(self):
        tracker = KnowledgeUnlockTracker()
        _, _, rose = resolve_for_turn(SOURCES, STATES, STATES[1], tracker)
        assert rose
        unlocked, locked, rose = resolve_for_turn(SOURCES, STATES, STATES[0], tracker)
        assert not rose
        assert "Husband's drinking" in _titles(unlocked)
        assert _titles(locked) == ["Missed rent"]

    def test_without_tracker_uses_this_turn_only(self):
        unlocked, _, rose = resolve_for_turn(SOURCES, STATES, STATES[1], None)
        assert not rose and "Husband's drinking" in _titles(unlocked)


# ── through the retrieve_knowledge node ─────────────────────────────────────


class RecordingLLM:
    """Records the titles the selector was offered and picks them all."""

    def __init__(self):
        self.offered = []

    @property
    def llm_instance(self):
        return self

    def with_structured_output(self, schema, **_kwargs):
        return self

    async def ainvoke(self, messages):
        system = messages[0].content
        picked = [s["title"] for s in SOURCES if s["title"] in system]
        self.offered.append(picked)
        return RelevantKeys(titles=picked)


class FakeScoreKeeper:
    def __init__(self, score):
        self.score = score

    def get_total_score(self):
        return self.score


def _scenario():
    pd = type("PD", (), {"knowledge_sources": SOURCES, "states": STATES})()
    return type("S", (), {"prompt_data": pd})()


def _state():
    return SimulationState(
        messages=[
            HumanMessage(content="How are things at home?"),
            AIMessage(content="It's been hard."),
        ],
        permitted_events=[],
        events_accumulator=[],
        new_events=[],
        current_score=0,
        branching_and_feedback_data=[],
    )


@pytest.fixture
def sync_retrieval(monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "KNOWLEDGE_RETRIEVAL_ASYNC", False)
    monkeypatch.setattr(settings, "KNOWLEDGE_RETRIEVAL_REFRESH_ENABLED", True)
    monkeypatch.setattr(settings, "KNOWLEDGE_RETRIEVAL_REFRESH_TURNS", 2)


class TestRetrieveKnowledgeNode:
    @pytest.mark.asyncio
    async def test_locked_content_is_never_offered_or_returned(self, sync_retrieval):
        llm = RecordingLLM()
        store = RetrievedContextStore()
        result = await retrieve_knowledge(
            _state(),
            {
                "configurable": {
                    "scenario": _scenario(),
                    "llm_client": llm,
                    "score_keeper": FakeScoreKeeper(0),
                    "retrieved_context_store": store,
                }
            },
        )
        ctx = result["retrieved_context"]
        assert llm.offered == [["Job loss"]]
        assert "Laid off" in ctx
        assert "drinks" not in ctx and "rent" not in ctx

    @pytest.mark.asyncio
    async def test_reaching_the_state_unlocks_and_forces_a_refresh(
        self, sync_retrieval
    ):
        llm = RecordingLLM()
        store = RetrievedContextStore()
        keeper = FakeScoreKeeper(0)
        cfg = {
            "configurable": {
                "scenario": _scenario(),
                "llm_client": llm,
                "score_keeper": keeper,
                "retrieved_context_store": store,
            }
        }
        await retrieve_knowledge(_state(), cfg)
        store.turns_until_refresh = 2  # mid-countdown: would normally reuse
        keeper.score = 60  # -> opening
        result = await retrieve_knowledge(_state(), cfg)
        assert llm.offered[-1] == ["Job loss", "Husband's drinking"]
        assert "drinks every night" in result["retrieved_context"]
        assert "rent" not in result["retrieved_context"]

        keeper.score = 0  # score falls back — unlock is kept
        store.turns_until_refresh = 0
        result = await retrieve_knowledge(_state(), cfg)
        assert "drinks every night" in result["retrieved_context"]


# ── through the working-memory render ───────────────────────────────────────


class TestRender:
    def test_locked_titles_join_the_withheld_section(self):
        memory = ClientWorkingMemory(
            withheld=[WithheldTopic(topic="her sister", deflection="talks about work")]
        )
        sections = render_sections(memory, locked_topics=["Missed rent"])
        withheld = sections["working_memory_withheld"]
        assert "Missed rent — you are not ready to talk about this yet" in withheld
        assert "her sister" in withheld

    def test_no_locks_keeps_named_absence(self):
        sections = render_sections(ClientWorkingMemory())
        assert sections["working_memory_withheld"] == (
            "(nothing has been left unsaid so far)"
        )
