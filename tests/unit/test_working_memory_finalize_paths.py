"""The semantic record must survive EVERY way a session can end.

Two defects, both found by asking why one v2v run produced no record at all —
and both silent, because "no row" is indistinguishable from "the feature had
nothing to say".

1. The emergency finalize path never had the store. The two normal shutdown
   handlers were wired and this third one was missed, so a session that
   finalized there produced no record.
2. The record rode inside the session_memory message, which is only sent when a
   rolling summary exists. An 8-exchange run had boundary=0 on every turn, so
   compaction never fired and the record was dropped — for exactly the short
   sessions where a stance path is most of what there is to keep.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

# app.core.queue.utils imports the graph package, which imports back into
# queue.utils. Loading the graph side FIRST leaves queue.utils fully initialised
# by the time the tests import it, which is why this looks like an odd import.
import app.core.graph  # noqa: F401
from app.core.emergency_finalize import EmergencyFinalizer
from app.core.working_memory.state import ClientWorkingMemory, Fact
from app.core.working_memory.store import ClientWorkingMemoryStore

pytestmark = pytest.mark.unit


def _store_with_content():
    store = ClientWorkingMemoryStore()
    store._state = ClientWorkingMemory(
        stance="disclosing",
        stance_path=["guarded", "testing", "opening", "disclosing"],
        disclosed=[Fact(text="lost the job in March")],
        updates_committed=6,
    )
    return store


class TestEmergencyPath:
    def _finalizer(self, wm_store, summary="a maintained summary"):
        sent = []
        queue = SimpleNamespace(
            send_message_sync=lambda payload: sent.append(payload) or True
        )
        rs = SimpleNamespace(
            summary=summary, covered_count=4, total_count=8, structured={"a": 1}
        )
        f = EmergencyFinalizer(
            room_id="ss_x",
            thread_id="ss_x",
            score_keeper=None,
            rolling_summary_store=rs,
            client_working_memory_store=wm_store,
            language_code="hi-IN",
            queue=queue,
        )
        return f, sent

    def test_the_record_rides_the_emergency_message(self):
        f, sent = self._finalizer(_store_with_content())
        assert f._send_memory_sync() is True
        assert "client_working_memory" in sent[0]
        assert "disclosing" in sent[0]

    def test_the_existing_structured_payload_is_preserved(self):
        # The rolling summary's own structured data must not be clobbered.
        f, sent = self._finalizer(_store_with_content())
        f._send_memory_sync()
        assert '"a": 1' in sent[0] or '"a":1' in sent[0]

    def test_no_store_is_not_an_error(self):
        f, sent = self._finalizer(None)
        assert f._send_memory_sync() is True
        assert "client_working_memory" not in sent[0]

    def test_an_empty_memory_adds_nothing(self):
        f, sent = self._finalizer(ClientWorkingMemoryStore())
        f._send_memory_sync()
        assert "client_working_memory" not in sent[0]

    def test_a_broken_store_never_blocks_the_emergency_path(self):
        # This path exists because the loop is already gone; it must not raise.
        broken = SimpleNamespace()  # no _state attribute at all
        f, sent = self._finalizer(broken)
        assert f._send_memory_sync() is True

    def test_it_reads_state_without_the_event_loop(self):
        # No await: the whole point is that the loop is not running.
        f, _ = self._finalizer(_store_with_content())
        record = f._build_working_memory_record()
        assert record["final_stance"] == "disclosing"


class TestNoRollingSummary:
    async def _emit(self, wm_store, monkeypatch):
        # Imported here, not at module scope: app.core.queue.utils pulls in the
        # graph package, which imports back into queue.utils — the same reason
        # tests/unit/scoring/test_score_keeper.py imports it inside the test.
        from app.core.queue import utils as qu

        sent = []
        monkeypatch.setattr(
            qu, "send_message_to_queue", AsyncMock(side_effect=lambda p: sent.append(p))
        )
        # No maintained summary, and no llm_client to upgrade one.
        rs = SimpleNamespace(
            summary="", covered_count=0, total_count=0, structured=None
        )
        monkeypatch.setattr(qu, "_tail_messages_for_grounding", lambda thread_id: [])
        await qu._emit_session_memory(
            room_id="ss_y",
            thread_id="ss_y",
            llm_client=None,
            language_code="hi-IN",
            prompt_data=None,
            rolling_summary_store=rs,
            client_working_memory_store=wm_store,
        )
        return sent

    async def test_the_record_ships_without_an_episodic_summary(self, monkeypatch):
        sent = await self._emit(_store_with_content(), monkeypatch)
        assert sent, "the record was dropped because no rolling summary existed"
        assert "client_working_memory" in sent[0]

    async def test_the_placeholder_summary_does_not_pretend_to_be_one(
        self, monkeypatch
    ):
        # ally-be requires a non-empty summary, so one travels with the record —
        # but it must state only the stance path, never a fabricated narrative.
        sent = await self._emit(_store_with_content(), monkeypatch)
        assert "no conversation summary was produced" in sent[0]
        assert "guarded -> testing" in sent[0]

    async def test_nothing_is_sent_when_there_is_nothing_at_all(self, monkeypatch):
        sent = await self._emit(ClientWorkingMemoryStore(), monkeypatch)
        assert sent == []


class TestRollingSummaryDisabled:
    """Working memory is independent of ROLLING_SUMMARY_ENABLED — turning off
    the rolling summary must not silently take working memory down with it."""

    async def _emit(self, wm_store, monkeypatch):
        from app.core.config import settings
        from app.core.queue import utils as qu

        sent = []
        monkeypatch.setattr(
            qu, "send_message_to_queue", AsyncMock(side_effect=lambda p: sent.append(p))
        )
        monkeypatch.setattr(qu, "_tail_messages_for_grounding", lambda thread_id: [])
        monkeypatch.setattr(settings, "ROLLING_SUMMARY_ENABLED", False)
        rs = SimpleNamespace(
            summary="a maintained summary",
            covered_count=4,
            total_count=8,
            structured={"a": 1},
        )
        await qu._emit_session_memory(
            room_id="ss_z",
            thread_id="ss_z",
            llm_client=None,
            language_code="hi-IN",
            prompt_data=None,
            rolling_summary_store=rs,
            client_working_memory_store=wm_store,
        )
        return sent

    async def test_the_record_ships_even_though_rolling_summary_is_off(
        self, monkeypatch
    ):
        sent = await self._emit(_store_with_content(), monkeypatch)
        assert sent, (
            "client working memory was dropped because ROLLING_SUMMARY_ENABLED "
            "was off"
        )
        assert "client_working_memory" in sent[0]

    async def test_the_rolling_summary_itself_stays_suppressed(self, monkeypatch):
        # The kill switch must still work for the thing it targets.
        sent = await self._emit(_store_with_content(), monkeypatch)
        assert "a maintained summary" not in sent[0]

    async def test_nothing_is_sent_without_a_working_memory_store_either(
        self, monkeypatch
    ):
        sent = await self._emit(None, monkeypatch)
        assert sent == []


class TestNoEarlyReturnCanDropTheRecord:
    """Every return path in the summary logic must still ship the record.

    Three separate paths have now dropped it: the emergency finalizer, the
    `elif not maintained` branch, and `if upgraded is None: return` — the last
    of which threw away an 18-item record from a completed 8/8 Tamil session.
    Hence a `finally`, not a fourth branch.
    """

    async def _emit(self, monkeypatch, *, maintained, compaction):
        from app.core.queue import utils as qu

        sent = []
        monkeypatch.setattr(
            qu, "send_message_to_queue", AsyncMock(side_effect=lambda p: sent.append(p))
        )
        monkeypatch.setattr(qu, "_tail_messages_for_grounding", lambda t: [])
        # A real conversation exists, so the final-compaction path is entered.
        monkeypatch.setattr(
            qu, "get_simulation_state_messages", lambda t: ["m"] * 6, raising=False
        )
        monkeypatch.setattr(
            qu,
            "update_rolling_summary",
            AsyncMock(side_effect=compaction),
            raising=False,
        )
        rs = SimpleNamespace(
            summary=maintained, covered_count=0, total_count=6, structured=None
        )
        await qu._emit_session_memory(
            room_id="ss_z",
            thread_id="ss_z",
            llm_client=object(),
            language_code="ta-IN",
            prompt_data=None,
            rolling_summary_store=rs,
            client_working_memory_store=_store_with_content(),
        )
        return sent

    async def test_a_failed_final_compaction_still_ships_the_record(self, monkeypatch):
        # THE observed failure: 8/8 exchanges, an 18-item record, nothing stored.
        sent = await self._emit(
            monkeypatch, maintained="", compaction=RuntimeError("compaction died")
        )
        assert sent, "the record was dropped when the final compaction failed"
        assert "client_working_memory" in sent[-1]

    async def test_the_standalone_summary_is_not_a_narrative(self, monkeypatch):
        sent = await self._emit(
            monkeypatch, maintained="", compaction=RuntimeError("boom")
        )
        assert "no conversation summary was produced" in sent[-1]
        assert "guarded -> testing" in sent[-1]

    async def test_the_record_is_not_shipped_twice(self, monkeypatch):
        # When the summary path DOES send, the fallback must stay quiet.
        async def ok(*a, **k):
            return ("a real summary", {"disclosures": []})

        sent = await self._emit(monkeypatch, maintained="", compaction=ok)
        assert sum("client_working_memory" in m for m in sent) == 1


class TestTheRecordShipsBeforeTheSlowWork:
    """A finally cannot save a coroutine that is never allowed to finish.

    Fourth path to lose the record, and the one that defeated the try/finally:
    finalize_session awaits _emit_session_memory, and the shutdown drain gives it
    wait_for(shield(...), timeout=16.0). The final compaction can spend 14s of
    that on its own, so the drain expires mid-coroutine — observed on a clean 8/8
    Tamil run that built a 6-item record and stored nothing.
    """

    async def test_the_record_goes_out_before_the_compaction_runs(self, monkeypatch):
        from app.core.queue import utils as qu

        order = []
        monkeypatch.setattr(
            qu,
            "send_message_to_queue",
            AsyncMock(side_effect=lambda p: order.append("ship")),
        )
        monkeypatch.setattr(qu, "_tail_messages_for_grounding", lambda t: [])

        async def slow_compaction(*a, **k):
            order.append("compaction")
            raise RuntimeError("drain would have expired here")

        monkeypatch.setattr(
            qu,
            "update_rolling_summary",
            AsyncMock(side_effect=slow_compaction),
            raising=False,
        )
        rs = SimpleNamespace(
            summary="", covered_count=0, total_count=6, structured=None
        )
        await qu._emit_session_memory(
            room_id="ss_order",
            thread_id="ss_order",
            llm_client=object(),
            language_code="ta-IN",
            prompt_data=None,
            rolling_summary_store=rs,
            client_working_memory_store=_store_with_content(),
        )
        assert order, "nothing was sent at all"
        assert order[0] == "ship", f"record did not ship first: {order}"

    async def test_a_failed_early_ship_still_falls_back(self, monkeypatch):
        from app.core.queue import utils as qu

        calls = {"n": 0}

        async def flaky(payload):
            calls["n"] += 1
            if calls["n"] == 1:
                raise RuntimeError("transient SQS failure")

        monkeypatch.setattr(qu, "send_message_to_queue", flaky)
        monkeypatch.setattr(qu, "_tail_messages_for_grounding", lambda t: [])
        rs = SimpleNamespace(
            summary="", covered_count=0, total_count=0, structured=None
        )
        await qu._emit_session_memory(
            room_id="ss_retry",
            thread_id="ss_retry",
            llm_client=None,
            language_code="ta-IN",
            prompt_data=None,
            rolling_summary_store=rs,
            client_working_memory_store=_store_with_content(),
        )
        # First attempt raised; the finally must try again.
        assert calls["n"] >= 2
