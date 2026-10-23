"""Phase 7: the semantic write-out, and the groundedness cross-check.

The check is the reason this module exists. Everything in the ledger was
proposed by an LLM, and a disclosure the client never made is worse than a
forgotten one — it returns next session as established fact, in the client's own
mouth, with nothing left to contradict it.
"""

import pytest
from langchain_core.messages import AIMessage, HumanMessage

from app.core.working_memory.state import (
    ClientWorkingMemory,
    Fact,
    Thread,
    WithheldTopic,
)
from app.core.working_memory.writeout import build_writeout, check_grounding

pytestmark = pytest.mark.unit


def _transcript():
    return [
        HumanMessage(content="how have things been since work ended?"),
        AIMessage(content="I lost the job back in March, it has been hard"),
        HumanMessage(content="and your mother?"),
        AIMessage(content="she is unwell, I visit when I can"),
    ]


class TestGrounding:
    def test_a_spoken_disclosure_survives(self):
        grounded, ungrounded = check_grounding(["lost the job in March"], _transcript())
        assert grounded == ["lost the job in March"]
        assert ungrounded == []

    def test_an_invented_disclosure_is_caught(self):
        grounded, ungrounded = check_grounding(
            ["her brother emigrated to Canada last year"], _transcript()
        )
        assert grounded == []
        assert ungrounded == ["her brother emigrated to Canada last year"]

    def test_paraphrase_survives(self):
        # The check catches invention, not deviation from quotation: the updater
        # legitimately rewrites what was said into an atomic fact.
        grounded, _ = check_grounding(
            ["mother is unwell and she visits"], _transcript()
        )
        assert grounded == ["mother is unwell and she visits"]

    def test_counsellor_wording_counts_as_grounded(self):
        # A disclosure the counsellor named and the client confirmed is real
        # even though the client never said the noun.
        grounded, _ = check_grounding(["things since work ended"], _transcript())
        assert grounded == ["things since work ended"]

    def test_no_transcript_keeps_everything(self):
        # Missing evidence is not evidence of invention. Discarding a whole
        # ledger because the checkpoint was unreadable is the worse failure.
        grounded, ungrounded = check_grounding(["anything at all"], [])
        assert grounded == ["anything at all"]
        assert ungrounded == []

    def test_contentless_text_is_dropped_from_both(self):
        grounded, ungrounded = check_grounding(["a an the", ""], _transcript())
        assert grounded == []
        assert ungrounded == []


class TestWriteout:
    def test_separates_corroborated_from_unverified(self):
        # Both are KEPT, in different fields. The check is good evidence of
        # corroboration and poor evidence of invention — Tamil grounded at 27%
        # while the client had genuinely said the things, because derivational
        # morphology changed every surface form. Discarding asserts "invented"
        # on evidence that does not support it.
        memory = ClientWorkingMemory(
            disclosed=[
                Fact(text="lost the job in March"),
                Fact(text="her brother emigrated to Canada"),
            ]
        )
        record = build_writeout(memory, _transcript())
        assert record["disclosed"] == ["lost the job in March"]
        assert record["disclosed_unverified"] == ["her brother emigrated to Canada"]
        assert record["unverified_count"] == 1

    def test_records_the_path_not_just_the_endpoint(self):
        # "guarded -> testing -> guarded" and "guarded -> testing -> engaged"
        # start the same and end differently; a trainee who caused the first
        # should not read as having caused the second.
        memory = ClientWorkingMemory(
            stance="guarded",
            stance_path=["guarded", "testing", "guarded"],
            disclosed=[Fact(text="lost the job in March")],
        )
        record = build_writeout(memory, _transcript())
        assert record["final_stance"] == "guarded"
        assert record["stance_path"] == ["guarded", "testing", "guarded"]

    def test_open_threads_are_named_as_unresolved(self):
        memory = ClientWorkingMemory(
            unresolved=[
                Thread(topic="the argument"),
                Thread(topic="done", closed_turn=3),
            ]
        )
        record = build_writeout(memory, _transcript())
        assert record["unresolved_threads"] == ["the argument"]

    def test_only_still_locked_topics_carry_forward(self):
        memory = ClientWorkingMemory(
            withheld=[
                WithheldTopic(topic="the visit", deflection="d"),
                WithheldTopic(topic="told already", deflection="d", status="revealed"),
            ]
        )
        record = build_writeout(memory, _transcript())
        assert record["still_withheld"] == ["the visit"]

    def test_carries_health_counters(self):
        # A record from a session whose updater missed half its turns is thinner
        # than one where every turn committed, and nothing downstream can tell
        # unless it is told.
        memory = ClientWorkingMemory(
            disclosed=[Fact(text="lost the job in March")],
            updates_committed=8,
            updates_missed=3,
        )
        record = build_writeout(memory, _transcript())
        assert record["updates_committed"] == 8
        assert record["updates_missed"] == 3

    def test_an_empty_session_leaves_no_trace(self):
        # Not an empty skeleton: the next session should open fresh rather than
        # inherit a record asserting that nothing happened.
        assert build_writeout(ClientWorkingMemory(), _transcript()) is None

    def test_a_session_of_only_unverified_facts_still_leaves_a_record(self):
        # Reversed deliberately on 2026-08-24. This previously returned None, on
        # the reasoning that an all-invented session should leave no trace. The
        # Tamil run showed the premise was wrong: an all-UNVERIFIED session is
        # usually a real conversation the check could not corroborate, and
        # returning None destroyed the stance path with it. The unverified items
        # are quarantined by field name, not deleted.
        memory = ClientWorkingMemory(
            disclosed=[Fact(text="her brother emigrated to Canada")]
        )
        record = build_writeout(memory, _transcript())
        assert record is not None
        assert record["disclosed"] == []
        assert record["disclosed_unverified"] == ["her brother emigrated to Canada"]

    def test_withheld_alone_is_worth_keeping(self):
        # Nothing was disclosed, but "this subject is still closed" is exactly
        # what a next session needs in order not to reopen it cold.
        memory = ClientWorkingMemory(
            withheld=[WithheldTopic(topic="the visit", deflection="d")]
        )
        assert build_writeout(memory, _transcript()) is not None
