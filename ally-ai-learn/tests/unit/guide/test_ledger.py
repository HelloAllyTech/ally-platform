"""SpokenReplyLedger edge cases (the turn-level flows are in test_turns)."""

from app.core.guide.ledger import Interruption, SpokenReplyLedger


def _reply(ledger, *segments, turn_id="t1"):
    ledger.begin_reply()
    for text, is_reply in segments:
        if is_reply:
            ledger.note_reply_text(text)
        else:
            ledger.note_other_text(text)
    if turn_id:
        ledger.note_turn(turn_id)


def test_a_fixed_line_spoken_later_is_not_taken_for_the_reply():
    ledger = SpokenReplyLedger()
    _reply(ledger, ("", True), turn_id="t1")  # an empty reply
    ledger.on_assistant_message("Voice is off for now.", interrupted=True)
    assert ledger.pending is None


def test_a_message_that_is_not_this_reply_is_ignored():
    ledger = SpokenReplyLedger()
    _reply(ledger, ("Let's open the article.", True))
    ledger.on_assistant_message("Something else entirely", interrupted=True)
    assert ledger.pending is None


def test_heard_beyond_the_reply_is_capped_at_its_length():
    ledger = SpokenReplyLedger()
    _reply(ledger, ("Short.", True), (" It's just below. ", False))
    ledger.on_assistant_message("Short. It's just below.", interrupted=True)
    assert ledger.pending == Interruption("t1", len("Short."))


def test_a_newer_interruption_replaces_an_older_one():
    ledger = SpokenReplyLedger()
    _reply(ledger, ("First reply.", True), turn_id="t1")
    ledger.on_assistant_message("First", interrupted=True)
    _reply(ledger, ("Second reply.", True), turn_id="t2")
    ledger.on_assistant_message("Sec", interrupted=True)
    assert ledger.take_pending() == Interruption("t2", 3)
    assert ledger.pending is None


def test_restore_never_overwrites_a_newer_interruption():
    ledger = SpokenReplyLedger()
    _reply(ledger, ("Newer.", True), turn_id="t9")
    ledger.on_assistant_message("New", interrupted=True)
    ledger.restore_pending(Interruption("t1", 4))
    assert ledger.pending == Interruption("t9", 3)
