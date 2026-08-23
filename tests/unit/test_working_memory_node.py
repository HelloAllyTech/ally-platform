"""Tests for the graph wiring: the turn opener, the update node, the kill switch.

The interesting cases are the gates, not the happy path. A node that fires when
it should not costs a call per turn on every session in the fleet; a node that
silently never fires looks identical to a working one until someone reads the
memory and finds it empty.
"""

from contextlib import suppress
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from langchain_core.messages import AIMessage, HumanMessage

from app.core.config import settings
from app.core.graph.nodes import update_working_memory
from app.core.graph.state import SimulationState
from app.core.working_memory.store import ClientWorkingMemoryStore

pytestmark = pytest.mark.unit


def _state(turns: int = 8) -> SimulationState:
    messages = []
    for i in range(turns):
        messages.append(HumanMessage(content=f"learner {i}"))
        messages.append(AIMessage(content=f"client {i}"))
    return SimulationState(
        messages=messages,
        permitted_events=[],
        events_accumulator=[],
        new_events=[],
        current_score=0,
        branching_and_feedback_data=[],
    )


def _config(store, **extra):
    configurable = {
        "client_working_memory_store": store,
        "llm_client": SimpleNamespace(llm_instance=MagicMock()),
    }
    configurable.update(extra)
    return {"configurable": configurable}


class TestKillSwitch:
    async def test_disabled_does_nothing(self, monkeypatch):
        monkeypatch.setattr(settings, "CLIENT_WORKING_MEMORY_ENABLED", False)
        store = ClientWorkingMemoryStore()
        await store.begin_turn()
        with patch("app.core.working_memory.consolidate.schedule_update") as sched:
            assert await update_working_memory(_state(), _config(store)) == {}
        sched.assert_not_called()

    async def test_disabled_at_runtime_even_though_wired(self, monkeypatch):
        # The node is in the graph because the flag was true at BUILD time.
        # Flipping it off must stop the work without a redeploy — that is the
        # whole claim being made for it as a kill switch.
        monkeypatch.setattr(settings, "CLIENT_WORKING_MEMORY_ENABLED", True)
        store = ClientWorkingMemoryStore()
        await store.begin_turn()
        with patch("app.core.working_memory.consolidate.schedule_update") as sched:
            await update_working_memory(_state(), _config(store))
            assert sched.called
            monkeypatch.setattr(settings, "CLIENT_WORKING_MEMORY_ENABLED", False)
            sched.reset_mock()
            await update_working_memory(_state(), _config(store))
            sched.assert_not_called()


class TestGates:
    @pytest.fixture(autouse=True)
    def _on(self, monkeypatch):
        monkeypatch.setattr(settings, "CLIENT_WORKING_MEMORY_ENABLED", True)
        monkeypatch.setattr(settings, "CLIENT_WORKING_MEMORY_EVERY_TURNS", 1)

    async def test_no_store_is_the_report_graph_not_an_error(self):
        # The report graph shares these nodes and has no room, no store.
        with patch("app.core.working_memory.consolidate.schedule_update") as sched:
            assert await update_working_memory(_state(), {"configurable": {}}) == {}
        sched.assert_not_called()

    async def test_missing_config_does_not_raise(self):
        assert await update_working_memory(_state(), None) == {}

    async def test_in_flight_skips(self, monkeypatch):
        store = ClientWorkingMemoryStore()
        await store.begin_turn()
        monkeypatch.setattr(type(store), "in_flight", property(lambda self: True))
        with patch("app.core.working_memory.consolidate.schedule_update") as sched:
            await update_working_memory(_state(), _config(store))
        sched.assert_not_called()

    async def test_paused_session_does_not_consolidate(self):
        store = ClientWorkingMemoryStore()
        await store.begin_turn()
        clock = SimpleNamespace(is_paused=True)
        with patch("app.core.working_memory.consolidate.schedule_update") as sched:
            await update_working_memory(_state(), _config(store, session_clock=clock))
        sched.assert_not_called()

    async def test_running_session_does_consolidate(self):
        store = ClientWorkingMemoryStore()
        await store.begin_turn()
        clock = SimpleNamespace(is_paused=False)
        with patch("app.core.working_memory.consolidate.schedule_update") as sched:
            await update_working_memory(_state(), _config(store, session_clock=clock))
        assert sched.called

    async def test_no_llm_client_skips(self):
        store = ClientWorkingMemoryStore()
        await store.begin_turn()
        config = {"configurable": {"client_working_memory_store": store}}
        with patch("app.core.working_memory.consolidate.schedule_update") as sched:
            await update_working_memory(_state(), config)
        sched.assert_not_called()

    async def test_turn_never_opened_does_not_consolidate(self):
        # turn_index is -1 until begin_turn runs. Without this guard a cancelled
        # first turn would consolidate a memory for a turn that never opened.
        store = ClientWorkingMemoryStore()
        with patch("app.core.working_memory.consolidate.schedule_update") as sched:
            await update_working_memory(_state(), _config(store))
        sched.assert_not_called()


class TestCadence:
    @pytest.fixture(autouse=True)
    def _on(self, monkeypatch):
        monkeypatch.setattr(settings, "CLIENT_WORKING_MEMORY_ENABLED", True)

    async def test_every_turn_by_default(self, monkeypatch):
        monkeypatch.setattr(settings, "CLIENT_WORKING_MEMORY_EVERY_TURNS", 1)
        store = ClientWorkingMemoryStore()
        fired = 0
        with patch("app.core.working_memory.consolidate.schedule_update") as sched:
            for _ in range(4):
                await store.begin_turn()
                await update_working_memory(_state(), _config(store))
            fired = sched.call_count
        assert fired == 4

    async def test_every_other_turn(self, monkeypatch):
        monkeypatch.setattr(settings, "CLIENT_WORKING_MEMORY_EVERY_TURNS", 2)
        store = ClientWorkingMemoryStore()
        with patch("app.core.working_memory.consolidate.schedule_update") as sched:
            for _ in range(6):
                await store.begin_turn()
                await update_working_memory(_state(), _config(store))
            assert sched.call_count == 3

    async def test_zero_is_treated_as_every_turn(self, monkeypatch):
        # A misconfigured 0 must not become a division by zero on the reply path.
        monkeypatch.setattr(settings, "CLIENT_WORKING_MEMORY_EVERY_TURNS", 0)
        store = ClientWorkingMemoryStore()
        await store.begin_turn()
        with patch("app.core.working_memory.consolidate.schedule_update") as sched:
            await update_working_memory(_state(), _config(store))
        assert sched.called


class TestWindow:
    @pytest.fixture(autouse=True)
    def _on(self, monkeypatch):
        monkeypatch.setattr(settings, "CLIENT_WORKING_MEMORY_ENABLED", True)
        monkeypatch.setattr(settings, "CLIENT_WORKING_MEMORY_EVERY_TURNS", 1)

    async def test_passes_only_the_recent_window(self, monkeypatch):
        monkeypatch.setattr(settings, "CLIENT_WORKING_MEMORY_WINDOW_TURNS", 4)
        store = ClientWorkingMemoryStore()
        await store.begin_turn()
        with patch("app.core.working_memory.consolidate.schedule_update") as sched:
            await update_working_memory(_state(turns=10), _config(store))
        messages = sched.call_args.kwargs["new_messages"]
        assert len(messages) == 4
        # The newest, not the oldest — the summary already covers what is older.
        assert messages[-1].content == "client 9"

    async def test_commits_under_the_opened_turn(self, monkeypatch):
        monkeypatch.setattr(settings, "CLIENT_WORKING_MEMORY_WINDOW_TURNS", 6)
        store = ClientWorkingMemoryStore()
        await store.begin_turn()
        await store.begin_turn()
        with patch("app.core.working_memory.consolidate.schedule_update") as sched:
            await update_working_memory(_state(), _config(store))
        assert sched.call_args.kwargs["memory"].turn_index == 1


class TestTurnOpener:
    """begin_turn lives inside generate_response, not in a node of its own.

    Driving that node to completion needs the whole LiveKit/LLM surface, so
    these exercise the real code path and assert only what the placement
    claims: the turn is opened, and it is opened BEFORE anything that could
    generate a reply.
    """

    async def test_generate_response_opens_the_turn(self, monkeypatch):
        monkeypatch.setattr(settings, "CLIENT_WORKING_MEMORY_ENABLED", True)
        from app.core.graph.nodes import generate_response

        store = ClientWorkingMemoryStore()
        # No scenario, no llm_client: the node will fail somewhere downstream.
        # That is the point — the opener sits above the failure, which is what
        # "before the reply" means in practice.
        with suppress(Exception):
            await generate_response(_state(), _config(store))
        assert (await store.snapshot()).turn_index == 0

    async def test_opener_respects_the_kill_switch(self, monkeypatch):
        monkeypatch.setattr(settings, "CLIENT_WORKING_MEMORY_ENABLED", False)
        from app.core.graph.nodes import generate_response

        store = ClientWorkingMemoryStore()
        with suppress(Exception):
            await generate_response(_state(), _config(store))
        assert (await store.snapshot()).turn_index == -1

    async def test_unopened_store_is_distinguishable_from_turn_zero(self):
        # The reason turn_index defaults to -1 rather than 0: begin_turn
        # pre-increments, so a 0 default would make "no turn has opened" look
        # exactly like "turn 0 is in progress" and the update node could not
        # refuse to consolidate a turn that never happened.
        store = ClientWorkingMemoryStore()
        assert (await store.snapshot()).turn_index == -1
        await store.begin_turn()
        assert (await store.snapshot()).turn_index == 0


class TestGraphWiring:
    def test_node_is_present_when_enabled(self, monkeypatch):
        monkeypatch.setattr(settings, "CLIENT_WORKING_MEMORY_ENABLED", True)
        from app.core.graph.graph_builder import build_simulation_graph

        graph = build_simulation_graph()
        assert "update_working_memory" in graph.nodes

    def test_node_is_absent_when_disabled(self, monkeypatch):
        monkeypatch.setattr(settings, "CLIENT_WORKING_MEMORY_ENABLED", False)
        from app.core.graph.graph_builder import build_simulation_graph

        graph = build_simulation_graph()
        assert "update_working_memory" not in graph.nodes

    def test_runs_after_the_reply_has_streamed(self, monkeypatch):
        monkeypatch.setattr(settings, "CLIENT_WORKING_MEMORY_ENABLED", True)
        from app.core.graph.graph_builder import build_simulation_graph

        graph = build_simulation_graph()
        compiled = graph.compile()
        # publish_done_thinking is the "reply is fully out" marker. Anything
        # upstream of it would put an LLM call on the voice-to-voice path.
        edges = {(e.source, e.target) for e in compiled.get_graph().edges}
        assert ("publish_done_thinking", "update_working_memory") in edges

    def test_is_parallel_to_compaction_not_chained(self, monkeypatch):
        monkeypatch.setattr(settings, "CLIENT_WORKING_MEMORY_ENABLED", True)
        monkeypatch.setattr(settings, "ROLLING_SUMMARY_ENABLED", True)
        from app.core.graph.graph_builder import build_simulation_graph

        compiled = build_simulation_graph().compile()
        edges = {(e.source, e.target) for e in compiled.get_graph().edges}
        assert ("compact_history", "update_working_memory") not in edges
        assert ("update_working_memory", "compact_history") not in edges
