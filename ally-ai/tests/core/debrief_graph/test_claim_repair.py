from app.core.debrief_graph.claim_repair import (
    describe,
    strip_unsupported_progress_claims,
)

CLAIM = "You are consistently identifying the right moments to offer explanations."


def _cards(**over):
    cards = {
        "opening": "A calm session overall.",
        "important_moment": None,
        "what_worked": [
            {
                "skill": "reflecting",
                "turn_index": 4,
                "quote": "That sounds hard",
                "lead": "You reflected the feeling well.",
                "body": f"It gave her room to talk. {CLAIM} Keep going.",
            }
        ],
        "work_on_this": [],
        "practise_next": {"skill": "open questions", "reason": "Ask one more."},
        "progress_note": None,
    }
    cards.update(over)
    return cards


def _fail(evidence=CLAIM, code="unsupported_progress_claim"):
    return {"code": code, "evidence": evidence}


def test_removes_the_flagged_sentence_and_its_hard_fail():
    cards, fails, removed = strip_unsupported_progress_claims(_cards(), [_fail()])
    body = cards["what_worked"][0]["body"]
    assert CLAIM not in body
    assert body == "It gave her room to talk. Keep going."
    assert fails == []
    assert removed == 1


def test_leaves_other_hard_fails_alone():
    other = _fail("The client said she would hurt herself.", "missed_risk_cue")
    _, fails, removed = strip_unsupported_progress_claims(_cards(), [_fail(), other])
    assert fails == [other]
    assert removed == 1


def test_input_cards_are_not_mutated():
    original = _cards()
    strip_unsupported_progress_claims(original, [_fail()])
    assert CLAIM in original["what_worked"][0]["body"]


def test_does_not_empty_a_required_field():
    cards = _cards()
    cards["what_worked"][0]["body"] = CLAIM
    out, fails, removed = strip_unsupported_progress_claims(cards, [_fail()])
    assert out["what_worked"][0]["body"] == CLAIM
    assert fails == [_fail()]
    assert removed == 0


def test_drops_a_progress_note_that_is_only_the_claim():
    cards = _cards(progress_note=CLAIM)
    cards["what_worked"][0]["body"] = "It gave her room to talk."
    out, fails, removed = strip_unsupported_progress_claims(cards, [_fail()])
    assert out["progress_note"] is None
    assert fails == []
    assert removed == 1


def test_evidence_not_found_leaves_the_hard_fail():
    out, fails, removed = strip_unsupported_progress_claims(
        _cards(), [_fail("A sentence the cards do not contain at all.")]
    )
    assert out == _cards()
    assert len(fails) == 1
    assert removed == 0


def test_matches_through_case_quotes_and_missing_full_stop():
    evidence = (
        "“you are CONSISTENTLY identifying the right moments to offer explanations”"
    )
    out, fails, removed = strip_unsupported_progress_claims(_cards(), [_fail(evidence)])
    assert CLAIM not in out["what_worked"][0]["body"]
    assert removed == 1 and fails == []


def test_short_evidence_is_never_matched():
    out, fails, removed = strip_unsupported_progress_claims(
        _cards(), [_fail("You did well.")]
    )
    assert removed == 0 and len(fails) == 1


def test_no_claims_returns_inputs_unchanged():
    cards = _cards()
    fails = [_fail("x" * 40, "contradicts_protocol")]
    out, out_fails, removed = strip_unsupported_progress_claims(cards, fails)
    assert out is cards and out_fails is fails and removed == 0


def test_describe():
    assert describe(0, 1) is None
    assert describe(1, 2) == "Removed 1 of 2 unsupported progress claims in code."
    assert describe(1, 1) == "Removed 1 of 1 unsupported progress claim in code."
