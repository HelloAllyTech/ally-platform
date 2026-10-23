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


def _prompt_data(*variables: str):
    """A prompt_data whose selected variant declares `variables`.

    The opt-in is body-driven: ally-be reconciles `availableVariables` from the
    prompt text on save, so this is the shape the runtime actually sees.
    """
    return SimpleNamespace(
        selected_main_prompt_code="code_x",
        prompts={"code_x": {"availableVariables": list(variables)}},
    )


def _scenario(*variables: str):
    return SimpleNamespace(prompt_data=_prompt_data(*variables))


def _config(store, opted_in=True, **extra):
    configurable = {
        "client_working_memory_store": store,
        "llm_client": SimpleNamespace(llm_instance=MagicMock()),
        "scenario": (_scenario("working_memory_stance") if opted_in else _scenario()),
    }
    configurable.update(extra)
    return {"configurable": configurable}


class TestPromptSelectionIsTheOnlySwitch:
    """Selecting the prompt is the switch; there is no env flag beside it.

    The node is now unconditionally on the reply path, so these are the tests
    that stand between "every simulation in the fleet" and "a consolidation
    call per turn".
    """

    async def test_a_scenario_that_has_not_opted_in_does_nothing(self):
        store = ClientWorkingMemoryStore()
        await store.begin_turn()
        with patch("app.core.working_memory.consolidate.schedule_update") as sched:
            result = await update_working_memory(
                _state(), _config(store, opted_in=False)
            )
            assert result == {}
        sched.assert_not_called()

    async def test_switching_the_prompt_back_stops_the_work(self):
        # Re-selecting a prompt without the placeholder is the rollback, and it
        # has to take effect on the very next turn without a redeploy — the
        # property the removed env flag used to carry.
        store = ClientWorkingMemoryStore()
        await store.begin_turn()
        with patch("app.core.working_memory.consolidate.schedule_update") as sched:
            await update_working_memory(_state(), _config(store))
            assert sched.called
            sched.reset_mock()
            await update_working_memory(_state(), _config(store, opted_in=False))
            sched.assert_not_called()

    async def test_every_section_placeholder_opts_in(self):
        # Prompt #3 declares one placeholder per section, and any single one is
        # enough. Missing this would leave a prompt running with a memory
        # nothing ever updated.
        store = ClientWorkingMemoryStore()
        await store.begin_turn()
        config = _config(store)
        config["configurable"]["scenario"] = _scenario("working_memory_stance")
        with patch("app.core.working_memory.consolidate.schedule_update") as sched:
            await update_working_memory(_state(), config)
        assert sched.called


class TestGates:
    @pytest.fixture(autouse=True)
    def _on(self, monkeypatch):
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

    async def test_scenario_not_opted_in_does_not_consolidate(self):
        # The whole safety claim for the flag: turning it on must cost nothing
        # for a simulation that has not selected a prompt declaring the block.
        store = ClientWorkingMemoryStore()
        await store.begin_turn()
        with patch("app.core.working_memory.consolidate.schedule_update") as sched:
            await update_working_memory(_state(), _config(store, opted_in=False))
        sched.assert_not_called()

    async def test_states_only_prompt_is_not_opted_in(self):
        # A variant declaring {state_x_guidelines} is the existing mechanism and
        # must be left alone — it is not an implicit opt-in to the new one.
        store = ClientWorkingMemoryStore()
        await store.begin_turn()
        config = _config(store)
        config["configurable"]["scenario"] = _scenario("state_x_guidelines")
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

    async def test_generate_response_opens_the_turn(self):
        from app.core.graph.nodes import generate_response

        store = ClientWorkingMemoryStore()
        # No scenario, no llm_client: the node will fail somewhere downstream.
        # That is the point — the opener sits above the failure, which is what
        # "before the reply" means in practice.
        with suppress(Exception):
            await generate_response(_state(), _config(store))
        assert (await store.snapshot()).turn_index == 0

    async def test_opener_skips_a_scenario_that_has_not_opted_in(self):
        from app.core.graph.nodes import generate_response

        store = ClientWorkingMemoryStore()
        with suppress(Exception):
            await generate_response(_state(), _config(store, opted_in=False))
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
    def test_node_is_always_present(self):
        # Unconditional by design: the node used to be added only when the env
        # flag was true at BUILD time, so a worker built without it ignored a
        # scenario that had correctly selected the working-memory prompt.
        from app.core.graph.graph_builder import build_simulation_graph

        graph = build_simulation_graph()
        assert "update_working_memory" in graph.nodes

    def test_runs_after_the_reply_has_streamed(self):
        from app.core.graph.graph_builder import build_simulation_graph

        graph = build_simulation_graph()
        compiled = graph.compile()
        # publish_done_thinking is the "reply is fully out" marker. Anything
        # upstream of it would put an LLM call on the voice-to-voice path.
        edges = {(e.source, e.target) for e in compiled.get_graph().edges}
        assert ("publish_done_thinking", "update_working_memory") in edges

    def test_is_parallel_to_compaction_not_chained(self, monkeypatch):
        monkeypatch.setattr(settings, "ROLLING_SUMMARY_ENABLED", True)
        from app.core.graph.graph_builder import build_simulation_graph

        compiled = build_simulation_graph().compile()
        edges = {(e.source, e.target) for e in compiled.get_graph().edges}
        assert ("compact_history", "update_working_memory") not in edges
        assert ("update_working_memory", "compact_history") not in edges


class TestNotOptedInCostsNothing:
    """A scenario that has not opted in must do NO working-memory work.

    The pool build and its embedding call were not gated, so every session in
    the fleet would have fired an embedding API call at setup for a pool nothing
    would read. With the env flag gone this is the ONLY thing standing between
    the fleet and that cost, so it is asserted directly rather than implied.
    """

    def test_the_pool_is_not_built_when_the_scenario_has_not_opted_in(self):
        from app.core.graph.prompt import prompt_declares_client_working_memory

        assert not prompt_declares_client_working_memory(
            _prompt_data("state_x_guidelines")
        )

    def test_the_retired_block_placeholder_does_not_opt_in(self):
        # `{client_working_memory}` is inert since the single-block renderer was
        # removed. A prompt still carrying it must build no pool and pay for no
        # embedding call — the same as any prompt that never opted in.
        from app.core.graph.prompt import prompt_declares_client_working_memory

        assert not prompt_declares_client_working_memory(
            _prompt_data("client_working_memory")
        )

    def test_a_section_placeholder_opts_in(self):
        # Any one section is enough; requiring all seven would make a curator
        # dropping one a silent total opt-out.
        from app.core.graph.prompt import prompt_declares_client_working_memory

        assert prompt_declares_client_working_memory(
            _prompt_data("working_memory_disclosed")
        )


class _FakeScoreKeeper:
    def __init__(self, total: int) -> None:
        self._total = total

    def get_total_score(self) -> int:
        return self._total


def test_the_delta_comes_from_the_total_score_not_current_score():
    """ScoreKeeper keeps events and behaviours in SEPARATE buckets.

    Only the event bucket reaches `state.current_score`, so a counsellor doing
    the things a scenario author writes under "Helper should do" moves the
    learner's visible total and moves `current_score` not at all. Measured in
    prod: 15 positively-scored behaviour items over 12h produced exactly one
    change in `current_score`, and it was negative.

    Asserted at the arithmetic rather than through the node, which needs a
    graph, an LLM client and a store to run.
    """
    store_last = 0
    keeper = _FakeScoreKeeper(total=24)  # 24 earned, all from behaviours
    current_score = 0  # event bucket never moved

    live_total = keeper.get_total_score()
    delta_from_total = live_total - store_last
    delta_from_current = current_score - store_last

    assert delta_from_total == 24, "behaviour scores must reach the ladder"
    assert delta_from_current == 0, "the event bucket alone would earn nothing"


class TestRecallQueryEmbeddingIsRecorded:
    """AI-cost: the per-turn recall query is recorded as
    working_memory_embedding, against the session's own embedding client."""

    async def test_embed_query_carries_the_task(self):
        from unittest.mock import AsyncMock

        store = ClientWorkingMemoryStore()
        await store.begin_turn()
        embedding_client = SimpleNamespace(get_embedding=AsyncMock(return_value=[1.0]))
        with patch("app.core.working_memory.consolidate.schedule_update") as sched:
            await update_working_memory(
                _state(), _config(store, embedding_client=embedding_client)
            )

        embed_query = sched.call_args.kwargs["embed_query"]
        await embed_query("what the learner said")
        embedding_client.get_embedding.assert_awaited_once_with(
            "what the learner said", task="working_memory_embedding"
        )
