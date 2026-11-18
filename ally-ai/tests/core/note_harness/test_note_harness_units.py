"""Budget, transcript, schema and validation pieces of the Scribe v2 harness."""

from types import SimpleNamespace

from app.core.note_harness.budget import compute_budget
from app.core.note_harness.models import (
    BudgetSettings,
    NoteField,
    NoteFieldOption,
    NoteSpec,
    NoteTurn,
)
from app.core.note_harness.schema import note_schema, render_spec, segment_schema
from app.core.note_harness.transcript import (
    format_ts,
    parse_ts,
    render_turns,
    split_turns,
    transcript_minutes,
    turns_from_messages,
)
from app.core.note_harness.validate import coerce_value, validate_draft

REFERRAL = NoteField(
    id="cf-referral",
    label="Referral source",
    type="SINGLE_SELECT",
    options=[
        NoteFieldOption(id="opt-phone", label="Phone"),
        NoteFieldOption(id="opt-walkin", label="Walk-in"),
    ],
)
CONCERNS = NoteField(id="cf-concerns", label="Key concerns", type="MULTILINE_TEXT")
TOPICS = NoteField(
    id="cf-topics",
    label="Topics",
    type="MULTI_SELECT",
    options=[
        NoteFieldOption(id="t-sleep", label="Sleep"),
        NoteFieldOption(id="t-work", label="Work"),
    ],
)
AGE = NoteField(id="cf-age", label="Age", type="NUMBER")
SPEC = NoteSpec(fields=[REFERRAL, CONCERNS, TOPICS, AGE])


def _turns(n=4, step=60.0):
    return [
        NoteTurn(id=i + 1, speaker="CLIENT", start=i * step, text=f"turn {i + 1} words")
        for i in range(n)
    ]


# ---------------------------------------------------------------- budget


def test_budget_grows_with_length_and_is_capped():
    s = BudgetSettings()
    assert compute_budget(10, 5000, s, 0).narrative_words == 320
    assert compute_budget(60, 9000, s, 0).narrative_words == 920
    assert compute_budget(200, 30000, s, 0).narrative_words == 1200
    assert compute_budget(0, 5000, s, 0).narrative_words == 200


def test_budget_repair_floor_never_exceeds_what_the_transcript_supports():
    # A 1-minute, 120-word dictation: a 212-word target, but the floor is 60 %
    # of half the transcript, so a short faithful note is never "repaired".
    b = compute_budget(1, 120, BudgetSettings(), 2)
    assert b.narrative_words == 212
    assert b.min_narrative_words == 36


def test_budget_time_and_tokens():
    b = compute_budget(30, 4000, BudgetSettings(), 5)
    assert b.time_budget_s == 180
    assert b.max_output_tokens == 560 * 2 + 5 * 150 + 600


def test_budget_respects_tenant_settings():
    terse = BudgetSettings(base_words=100, per_minute_words=4, cap_words=300)
    assert compute_budget(30, 9000, terse, 0).narrative_words == 220
    assert compute_budget(120, 9000, terse, 0).narrative_words == 300


# ---------------------------------------------------------------- transcript


def test_turns_from_messages_numbers_in_order_and_skips_empty():
    msgs = [
        SimpleNamespace(role="client", content="hello", start_time=1.0),
        {"role": "COUNSELOR", "content": "  ", "start_time": 2.0},
        {"role": "counselor", "content": "hi there", "start_time": 3.0},
    ]
    turns = turns_from_messages(msgs)
    assert [(t.id, t.speaker, t.text) for t in turns] == [
        (1, "CLIENT", "hello"),
        (2, "COUNSELOR", "hi there"),
    ]


def test_render_turns_shows_time_only_when_known():
    timed = render_turns(_turns(2))
    assert timed.splitlines()[1] == "[2 | 00:01:00 | CLIENT] turn 2 words"
    untimed = render_turns([NoteTurn(id=1, speaker="COUNSELOR", start=0, text="x")])
    assert untimed == "[1 | COUNSELOR] x"


def test_timestamps_round_trip():
    assert format_ts(3725) == "01:02:05"
    assert parse_ts("01:02:05") == 3725
    assert parse_ts("02:05") == 125
    assert parse_ts("soon") is None


def test_minutes_from_timings_or_words():
    assert round(transcript_minutes(_turns(11, 60)), 1) == 10.0
    words = [NoteTurn(id=1, speaker="C", start=0, text=" ".join(["w"] * 260))]
    assert transcript_minutes(words) == 2.0


def test_split_turns_covers_everything_once_at_turn_boundaries():
    turns = _turns(10)  # 3 words each
    parts = split_turns(turns, max_words=7)
    assert [len(p) for p in parts] == [2, 2, 2, 2, 2]
    assert [t.id for p in parts for t in p] == list(range(1, 11))


# ---------------------------------------------------------------- schema


def test_note_schema_is_strict_and_uses_option_ids():
    schema = note_schema(SPEC)
    fields = schema["properties"]["fields"]
    assert fields["required"] == ["cf-referral", "cf-concerns", "cf-topics", "cf-age"]
    assert fields["additionalProperties"] is False
    referral = fields["properties"]["cf-referral"]["anyOf"][1]
    assert referral["properties"]["value"]["enum"] == ["opt-phone", "opt-walkin"]
    topics = fields["properties"]["cf-topics"]["anyOf"][1]["properties"]["value"]
    assert topics == {
        "type": "array",
        "items": {"type": "string", "enum": ["t-sleep", "t-work"]},
    }
    assert fields["properties"]["cf-age"]["anyOf"][0] == {"type": "null"}


def test_schemas_with_no_fields():
    empty = NoteSpec()
    assert note_schema(empty)["properties"]["fields"]["required"] == []
    assert segment_schema(empty)["properties"]["field_notes"]["items"]["properties"][
        "field_id"
    ] == {"type": "string"}
    assert "narrative only" in render_spec(empty)


def test_render_spec_lists_ids_labels_and_options():
    text = render_spec(SPEC)
    assert "`cf-referral` — Referral source (one option id)" in text
    assert "`opt-walkin` = Walk-in" in text


# ---------------------------------------------------------------- validation


def test_coerce_accepts_label_for_option_and_parses_numbers():
    assert coerce_value(REFERRAL, "Walk-in") == ("opt-walkin", None)
    assert coerce_value(REFERRAL, "Email") == (None, "unknown_option")
    assert coerce_value(TOPICS, ["Sleep", "t-work", "nope", "t-sleep"]) == (
        ["t-sleep", "t-work"],
        None,
    )
    assert coerce_value(AGE, "34") == (34, None)
    assert coerce_value(AGE, "about thirty") == (None, "not_a_number")
    assert coerce_value(AGE, True) == (None, "not_a_number")


def test_validate_keeps_supported_fields_and_drops_the_rest():
    raw = {
        "narrative": [{"t": "00:00:00", "text": "Client called.", "turn_ids": [1]}],
        "fields": {
            "cf-referral": {"value": "opt-phone", "evidence_turn_ids": [1]},
            "cf-concerns": {"value": "Sleep.", "evidence_turn_ids": []},
            "cf-topics": {"value": ["t-sleep"], "evidence_turn_ids": [99]},
            "cf-age": None,
            "not-in-spec": {"value": "x", "evidence_turn_ids": [1]},
        },
    }
    draft, stats = validate_draft(raw, SPEC, _turns())
    assert set(draft.fields) == {"cf-referral"}
    assert stats.dropped_fields == {
        "cf-concerns": "no_evidence",
        "cf-topics": "evidence_not_found",
    }


def test_validate_puts_the_narrative_back_in_time_order():
    raw = {
        "narrative": [
            {"t": "00:00:00", "text": "First.", "turn_ids": [1]},
            {"t": "00:00:00", "text": "Third.", "turn_ids": [3]},
            {"t": "00:00:00", "text": "Second.", "turn_ids": [2]},
            {"t": "00:00:00", "text": "  ", "turn_ids": [4]},
        ],
        "fields": {},
    }
    draft, stats = validate_draft(raw, SPEC, _turns())
    assert [p.text for p in draft.narrative] == ["First.", "Second.", "Third."]
    # The real turn time replaces the model's stamp.
    assert [p.t for p in draft.narrative] == ["00:00:00", "00:01:00", "00:02:00"]
    assert stats.reordered is True
    assert stats.dropped_points == 1


def test_validate_leaves_ordered_narrative_alone():
    raw = {
        "narrative": [
            {"t": "00:00:00", "text": "A.", "turn_ids": [1]},
            {"t": "", "text": "B, no anchor.", "turn_ids": []},
            {"t": "00:02:00", "text": "C.", "turn_ids": [3]},
        ],
        "fields": {},
    }
    draft, stats = validate_draft(raw, SPEC, _turns())
    assert [p.text for p in draft.narrative] == ["A.", "B, no anchor.", "C."]
    assert stats.reordered is False
