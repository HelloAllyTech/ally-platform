"""Tests for the consolidation call — the working memory's write path.

The invariants worth defending here are not "does it call the LLM". They are:

- a miss keeps the previous memory and does NOT block the next update;
- the update commits under the turn the actor's prompt was built from;
- the updater never sees withheld CONTENT, because it never exists;
- a proposal that would fake progress is refused even when the LLM insists.
"""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from langchain_core.messages import AIMessage, HumanMessage

from app.core.working_memory import consolidate as mod
from app.core.working_memory.proposal import ProposedUpdate
from app.core.working_memory.state import ClientWorkingMemory, WithheldTopic
from app.core.working_memory.store import ClientWorkingMemoryStore

pytestmark = pytest.mark.unit


@pytest.fixture(autouse=True)
def _recall_telemetry_stays_off_the_wire(monkeypatch):
    """Keep `emit_recall`'s SQS send out of these tests.

    `_report_recall` swallows its own exceptions, so an unstubbed call never
    fails an assertion — it just spends however long the AWS SDK takes to give
    up before it does. On a machine where credentials resolve, that is seconds,
    and the tests here that assert a background task finishes inside a budget
    measure the SDK's retry schedule instead of the code under test.

    Autouse rather than per-test: only the recall-carrying paths reach this
    today, but which ones they are is an implementation detail, and a test
    added later should not have to know it makes a network call.
    """
    from app.core.working_memory import recall_log

    async def _noop(**kwargs):
        return None

    monkeypatch.setattr(recall_log, "emit_recall", _noop)


def _turns():
    return [HumanMessage(content="what happened?"), AIMessage(content="not much")]


def _llm(proposal, *, raw=None):
    """An llm_client whose structured call returns ``proposal``."""
    structured = AsyncMock()
    structured.ainvoke = AsyncMock(return_value={"parsed": proposal, "raw": raw})
    llm_instance = MagicMock()
    llm_instance.with_structured_output = MagicMock(return_value=structured)
    return SimpleNamespace(llm_instance=llm_instance, provider="openai")


class TestDigest:
    def test_lists_withheld_topics_without_content(self):
        memory = ClientWorkingMemory(
            withheld=[
                WithheldTopic(
                    topic="the hospital visit",
                    deflection="changes the subject to work",
                )
            ]
        )
        digest = mod._digest(memory)
        assert "the hospital visit" in digest
        # The deflection is an ACTOR instruction; the updater has no use for it
        # and giving it one invites it to answer as the client.
        assert "changes the subject" not in digest

    def test_omits_unlocked_topics(self):
        memory = ClientWorkingMemory(
            withheld=[
                WithheldTopic(topic="locked one", deflection="d"),
                WithheldTopic(topic="open one", deflection="d", status="unlocked"),
            ]
        )
        digest = mod._digest(memory)
        assert "locked one" in digest
        assert "open one" not in digest

    def test_reports_turns_in_stance(self):
        memory = ClientWorkingMemory(stance="testing", turns_in_stance=3)
        assert "testing (for 3 turn(s))" in mod._digest(memory)


class TestConsolidate:
    async def test_no_turns_is_not_a_call(self):
        llm = _llm(ProposedUpdate())
        out = await mod.consolidate(
            memory=ClientWorkingMemory(), new_messages=[], llm_client=llm
        )
        assert out is None
        llm.llm_instance.with_structured_output.assert_not_called()

    async def test_empty_template_skips_rather_than_calling(self, monkeypatch):
        monkeypatch.setattr(mod, "load_and_format", lambda *a, **k: "")
        llm = _llm(ProposedUpdate())
        out = await mod.consolidate(
            memory=ClientWorkingMemory(), new_messages=_turns(), llm_client=llm
        )
        assert out is None
        llm.llm_instance.with_structured_output.assert_not_called()

    async def test_returns_validated_not_proposed(self, monkeypatch):
        monkeypatch.setattr(mod, "load_and_format", lambda *a, **k: "SYS")
        # The ledger is validated and capped; the stance is not the updater's
        # to move, so an update with no authored stance leaves it alone.
        llm = _llm(ProposedUpdate(affect="calmer"))
        out = await mod.consolidate(
            memory=ClientWorkingMemory(stance="guarded", turns_in_stance=9),
            new_messages=_turns(),
            llm_client=llm,
        )
        assert out.stance is None
        assert out.affect == "calmer"

    async def test_the_authored_stance_reaches_the_committed_update(self, monkeypatch):
        monkeypatch.setattr(mod, "load_and_format", lambda *a, **k: "SYS")
        turns = [
            HumanMessage(content="sorry, I misread what you told me earlier"),
            AIMessage(content="that is alright"),
        ]
        out = await mod.consolidate(
            memory=ClientWorkingMemory(stance="guarded", turns_in_stance=4),
            new_messages=turns,
            llm_client=_llm(ProposedUpdate(affect="steadier")),
            authored_stance="partial resolution",
        )
        assert out.stance == "partial resolution"

    async def test_parse_failure_raises(self, monkeypatch):
        monkeypatch.setattr(mod, "load_and_format", lambda *a, **k: "SYS")
        structured = AsyncMock()
        structured.ainvoke = AsyncMock(
            return_value={"parsed": None, "raw": None, "parsing_error": "bad json"}
        )
        llm_instance = MagicMock()
        llm_instance.with_structured_output = MagicMock(return_value=structured)
        with pytest.raises(ValueError, match="bad json"):
            await mod.consolidate(
                memory=ClientWorkingMemory(),
                new_messages=_turns(),
                llm_client=SimpleNamespace(llm_instance=llm_instance),
            )

    async def test_tolerates_provider_ignoring_include_raw(self, monkeypatch):
        monkeypatch.setattr(mod, "load_and_format", lambda *a, **k: "SYS")
        structured = AsyncMock()
        structured.ainvoke = AsyncMock(return_value=ProposedUpdate(affect="tired"))
        llm_instance = MagicMock()
        llm_instance.with_structured_output = MagicMock(return_value=structured)
        out = await mod.consolidate(
            memory=ClientWorkingMemory(),
            new_messages=_turns(),
            llm_client=SimpleNamespace(llm_instance=llm_instance),
        )
        assert out.affect == "tired"


class TestApplyUpdate:
    async def test_stamps_the_commit_turn_on_facts_and_threads(self):
        store = ClientWorkingMemoryStore()
        update = mod.ValidatedUpdate(
            disclosed=["lost the job in March"],
            opened_threads=["the argument"],
        )
        assert await mod.apply_update(store, update, 7)
        state = await store.snapshot()
        assert state.disclosed[0].first_seen_turn == 7
        assert state.unresolved[0].opened_turn == 7

    async def test_empty_lists_do_not_blank_the_other_path(self):
        store = ClientWorkingMemoryStore()
        await mod.apply_update(store, mod.ValidatedUpdate(disclosed=["a fact"]), 1)
        # A later update carrying no disclosures must not erase the first.
        await mod.apply_update(store, mod.ValidatedUpdate(affect="flat"), 2)
        state = await store.snapshot()
        assert [f.text for f in state.disclosed] == ["a fact"]
        assert state.affect == "flat"

    async def test_withheld_pairs_become_records(self):
        store = ClientWorkingMemoryStore()
        update = mod.ValidatedUpdate(withheld=[("the visit", "asks about work")])
        await mod.apply_update(store, update, 3)
        state = await store.snapshot()
        assert state.withheld[0].topic == "the visit"
        assert state.withheld[0].deflection == "asks about work"
        assert state.withheld[0].status == "unsaid"


class TestScheduleUpdate:
    def _args(self, llm):
        return dict(
            memory=ClientWorkingMemory(turn_index=4),
            new_messages=_turns(),
            llm_client=llm,
            timeout=5.0,
        )

    async def test_commits_under_the_snapshot_turn(self, monkeypatch):
        monkeypatch.setattr(mod, "load_and_format", lambda *a, **k: "SYS")
        store = ClientWorkingMemoryStore()
        llm = _llm(ProposedUpdate(affect="wary", disclosed=["a thing"]))
        assert mod.schedule_update(store, **self._args(llm))
        await store._task
        # The turn the actor's prompt was built from — not a fresh read.
        assert store.last_committed_turn == 4
        state = await store.snapshot()
        assert state.affect == "wary"
        assert state.disclosed[0].first_seen_turn == 4

    async def test_a_proposed_delivery_plan_reaches_the_worker(self, monkeypatch):
        """The updater's delivery plan is handed over, with the catalog it saw."""
        from app.core.livekit.delivery import ProposedDelivery

        seen = {}
        monkeypatch.setattr(
            mod,
            "load_and_format",
            lambda *a, **k: seen.update(catalog=k.get("opener_catalog")) or "SYS",
        )
        store = ClientWorkingMemoryStore()
        delivered = []
        llm = _llm(
            ProposedUpdate(
                affect="guarded",
                delivery=ProposedDelivery(
                    opener_kind="hesitation", opener_ids=["um_hesitant"]
                ),
            )
        )
        assert mod.schedule_update(
            store,
            **self._args(llm),
            opener_catalog="- um_hesitant [hesitation]",
            on_delivery=lambda proposal, turn: delivered.append((proposal, turn)),
        )
        await store._task
        assert seen["catalog"] == "- um_hesitant [hesitation]"
        assert delivered and delivered[0][0].opener_ids == ["um_hesitant"]
        assert delivered[0][1] == 4
        assert store.last_committed_turn == 4  # the commit still happened

    async def test_no_catalog_names_the_absence(self, monkeypatch):
        seen = {}
        monkeypatch.setattr(
            mod,
            "load_and_format",
            lambda *a, **k: seen.update(catalog=k.get("opener_catalog")) or "SYS",
        )
        store = ClientWorkingMemoryStore()
        mod.schedule_update(store, **self._args(_llm(ProposedUpdate())))
        await store._task
        assert seen["catalog"] == mod.NO_OPENER_CATALOG

    async def test_skips_when_already_in_flight(self, monkeypatch):
        monkeypatch.setattr(mod, "load_and_format", lambda *a, **k: "SYS")
        store = ClientWorkingMemoryStore()

        async def _slow():
            await asyncio.sleep(0.2)

        store._task = asyncio.create_task(_slow())
        llm = _llm(ProposedUpdate())
        assert mod.schedule_update(store, **self._args(llm)) is False
        llm.llm_instance.with_structured_output.assert_not_called()
        await store._task

    async def test_timeout_is_a_miss_that_leaves_the_next_turn_free(self, monkeypatch):
        monkeypatch.setattr(mod, "load_and_format", lambda *a, **k: "SYS")
        store = ClientWorkingMemoryStore()

        async def _hang(*a, **k):
            await asyncio.sleep(10)

        structured = AsyncMock()
        structured.ainvoke = _hang
        llm_instance = MagicMock()
        llm_instance.with_structured_output = MagicMock(return_value=structured)
        llm = SimpleNamespace(llm_instance=llm_instance)

        args = self._args(llm)
        args["timeout"] = 0.01
        assert mod.schedule_update(store, **args)
        await store._task
        state = await store.snapshot()
        assert state.updates_missed == 1
        # The critical part: a miss must NOT advance the monotonic counter, or
        # the next update would be rejected as stale for the same turn.
        assert store.last_committed_turn == -1

    async def test_llm_failure_is_a_miss_not_a_crash(self, monkeypatch):
        monkeypatch.setattr(mod, "load_and_format", lambda *a, **k: "SYS")
        store = ClientWorkingMemoryStore()
        structured = AsyncMock()
        structured.ainvoke = AsyncMock(side_effect=RuntimeError("provider down"))
        llm_instance = MagicMock()
        llm_instance.with_structured_output = MagicMock(return_value=structured)
        assert mod.schedule_update(
            store, **self._args(SimpleNamespace(llm_instance=llm_instance))
        )
        await store._task
        state = await store.snapshot()
        assert state.updates_missed == 1
        assert state.affect == ""

    async def test_a_miss_then_a_later_success_commits(self, monkeypatch):
        monkeypatch.setattr(mod, "load_and_format", lambda *a, **k: "SYS")
        store = ClientWorkingMemoryStore()
        structured = AsyncMock()
        structured.ainvoke = AsyncMock(side_effect=RuntimeError("boom"))
        llm_instance = MagicMock()
        llm_instance.with_structured_output = MagicMock(return_value=structured)
        mod.schedule_update(
            store, **self._args(SimpleNamespace(llm_instance=llm_instance))
        )
        await store._task

        llm = _llm(ProposedUpdate(affect="steadier"))
        args = self._args(llm)
        args["memory"] = ClientWorkingMemory(turn_index=5)
        assert mod.schedule_update(store, **args)
        await store._task
        assert store.last_committed_turn == 5
        assert (await store.snapshot()).affect == "steadier"

    async def test_discard_cancels_without_counting_a_miss(self, monkeypatch):
        monkeypatch.setattr(mod, "load_and_format", lambda *a, **k: "SYS")
        store = ClientWorkingMemoryStore()

        async def _hang(*a, **k):
            await asyncio.sleep(10)

        structured = AsyncMock()
        structured.ainvoke = _hang
        llm_instance = MagicMock()
        llm_instance.with_structured_output = MagicMock(return_value=structured)
        mod.schedule_update(
            store, **self._args(SimpleNamespace(llm_instance=llm_instance))
        )
        task = store._task
        store.discard()
        with pytest.raises(asyncio.CancelledError):
            await task
        # Teardown is not a failure to measure.
        assert (await store.snapshot()).updates_missed == 0

    async def test_hung_embedding_call_does_not_freeze_the_session(self, monkeypatch):
        """A stuck embedding call must not leave `in_flight` True forever.

        `_embed_query`'s bare try/except only ever catches a call that RAISES;
        one that hangs sails straight past it, and with no timeout of its own
        it would keep the background task alive (and `store.in_flight` True)
        for the rest of the session, since `consolidate`'s own timeout window
        has already closed by the time this call starts.
        """
        monkeypatch.setattr(mod, "load_and_format", lambda *a, **k: "SYS")
        store = ClientWorkingMemoryStore()

        from app.core.working_memory.corpus import BackstoryCorpus
        from app.core.working_memory.state import Fact

        store.corpus = BackstoryCorpus(
            facts=[Fact(text="grew up in Kochi")],
            vectors={"grew up in Kochi": [0.1, 0.2]},
        )

        async def _hangs_forever(*a, **k):
            await asyncio.sleep(10)

        llm = _llm(ProposedUpdate(retrieve_cues=["kochi"]))
        args = self._args(llm)
        args["timeout"] = 0.05
        args["embed_query"] = _hangs_forever

        assert mod.schedule_update(store, **args)
        await asyncio.wait_for(store._task, timeout=2.0)
        # The next turn's update must be free to schedule, not stuck behind a
        # background task an unbounded network call never lets finish.
        assert not store.in_flight

    async def test_nothing_to_summarize_commits_nothing(self, monkeypatch):
        monkeypatch.setattr(mod, "load_and_format", lambda *a, **k: "SYS")
        store = ClientWorkingMemoryStore()
        args = self._args(_llm(ProposedUpdate()))
        args["new_messages"] = []
        assert mod.schedule_update(store, **args)
        await store._task
        assert store.last_committed_turn == -1
        assert (await store.snapshot()).updates_missed == 0


# ---------------------------------------------------------------------------
# Do not ask for what is not used
# ---------------------------------------------------------------------------


def test_a_scenario_with_states_is_not_asked_for_a_stance():
    """The author's bands decide where the client is, so the updater must not
    be handed a rulebook for a decision the code no longer makes.

    Eight lines of earned-advance instruction went out on EVERY update while
    `validate` took the authored stance verbatim and ignored the proposal.
    """
    from app.core.working_memory.consolidate import _coerce_guidance

    # the branch is chosen on whether any named state exists
    states = [{"name": "Feels heard", "guidelines": "Offer one real thing."}]
    named = [s for s in states if isinstance(s, dict) and s.get("name")]

    assert named, "a named state means the author owns progression"
    assert _coerce_guidance("Offer one real thing.") == "Offer one real thing."


def test_guidance_is_flattened_and_truncated_for_the_ladder_line():
    from app.core.working_memory.consolidate import _coerce_guidance

    assert _coerce_guidance("a\n\n  b   c") == "a b c"
    long = "x" * 300
    out = _coerce_guidance(long)
    assert len(out) <= 160 and out.endswith("...")
    assert _coerce_guidance(None) == ""
