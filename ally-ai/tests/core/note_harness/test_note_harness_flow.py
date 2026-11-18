"""The NoteHarness flow with a fake model: single pass, map-reduce, repair."""

import pytest

from app.core.note_harness.harness import (
    GENERATE_PATH,
    MAP_SEGMENT_PATH,
    REPAIR_PATH,
    NoteHarness,
)
from app.core.note_harness.models import (
    BudgetSettings,
    NoteField,
    NoteHarnessRequest,
    NoteSpec,
    NoteTurn,
)

SPEC = NoteSpec(
    fields=[NoteField(id="cf-concerns", label="Key concerns", type="MULTILINE_TEXT")]
)


def _turns(n, words_each=10, step=60.0):
    return [
        NoteTurn(
            id=i + 1,
            speaker="CLIENT" if i % 2 else "COUNSELOR",
            start=i * step,
            text=" ".join([f"w{i}"] * words_each),
        )
        for i in range(n)
    ]


def _render(path, **variables):
    # The real render fills Skills Store text; the fake records what it got.
    return f"{path}|{variables['mode']}|{variables['transcript']}"


class FakeModel:
    def __init__(self, answers):
        self.answers = answers
        self.calls = []

    async def __call__(self, prompt, schema, path, max_tokens):
        self.calls.append((path, prompt, schema["title"], max_tokens))
        answer = self.answers[path]
        return answer(prompt) if callable(answer) else answer


def _note(n_words, turn_ids=(1,)):
    return {
        "narrative": [
            {
                "t": "00:00:00",
                "text": " ".join(["word"] * n_words),
                "turn_ids": list(turn_ids),
            }
        ],
        "fields": {"cf-concerns": {"value": "Sleep.", "evidence_turn_ids": [1]}},
    }


@pytest.mark.asyncio
async def test_short_session_takes_one_pass():
    model = FakeModel({GENERATE_PATH: _note(30)})
    harness = NoteHarness(_render, model)
    report = await harness.run(_turns(6), NoteHarnessRequest(note_spec=SPEC), "scribe")

    assert report.error is None
    assert report.path == "single" and report.segments == 1
    assert [c[0] for c in model.calls] == [GENERATE_PATH]
    assert model.calls[0][1].startswith("scribe_note/generate|SCRIBE|[1 | 00:00:00")
    assert report.draft.fields["cf-concerns"].value == "Sleep."
    assert (
        report.budget.narrative_words
        == 200 + 12 * report.budget.transcript_minutes // 1
    )
    assert report.llm_calls == 1 and not report.repaired


@pytest.mark.asyncio
async def test_long_session_maps_parts_in_parallel_and_joins_in_order():
    turns = _turns(9, words_each=10)  # 90 words

    def map_answer(prompt):
        # Each part cites its own first turn id.
        first = int(prompt.split("|")[2].split("[", 1)[1].split(" ", 1)[0])
        return {
            "points": [{"t": "", "text": f"part from {first}", "turn_ids": [first]}],
            "field_notes": [],
        }

    model = FakeModel({MAP_SEGMENT_PATH: map_answer, GENERATE_PATH: _note(30)})
    harness = NoteHarness(_render, model, single_pass_words=50, segment_words=30)
    report = await harness.run(turns, NoteHarnessRequest(note_spec=SPEC), "SCRIBE")

    assert report.path == "map_reduce" and report.segments == 3
    assert [c[0] for c in model.calls].count(MAP_SEGMENT_PATH) == 3
    final_prompt = [c[1] for c in model.calls if c[0] == GENERATE_PATH][0]
    # The reduce pass reads the timeline in part order, not the raw turns.
    assert final_prompt.index("part from 1") < final_prompt.index("part from 4")
    assert final_prompt.index("part from 4") < final_prompt.index("part from 7")
    assert report.llm_calls == 4


@pytest.mark.asyncio
async def test_short_narrative_gets_one_repair_and_keeps_the_longer_one():
    # 30 turns over 29 minutes: the narrative target is ~560 words.
    turns = _turns(30, words_each=60)
    model = FakeModel({GENERATE_PATH: _note(20), REPAIR_PATH: _note(400)})
    report = await NoteHarness(_render, model).run(
        turns, NoteHarnessRequest(note_spec=SPEC), "SCRIBE"
    )
    assert report.repaired is True
    assert report.draft.narrative_words() == 400
    assert [c[0] for c in model.calls] == [GENERATE_PATH, REPAIR_PATH]


@pytest.mark.asyncio
async def test_repair_that_is_no_better_is_ignored():
    turns = _turns(30, words_each=60)
    model = FakeModel({GENERATE_PATH: _note(20), REPAIR_PATH: _note(10)})
    report = await NoteHarness(_render, model).run(
        turns, NoteHarnessRequest(note_spec=SPEC), "SCRIBE"
    )
    assert report.repaired is False
    assert report.draft.narrative_words() == 20


@pytest.mark.asyncio
async def test_dictation_is_never_padded():
    # A one-minute dictation: a 20-word note is faithful, not short.
    turns = [NoteTurn(id=1, speaker="COUNSELOR", start=0, text=" ".join(["w"] * 60))]
    model = FakeModel({GENERATE_PATH: _note(20)})
    report = await NoteHarness(_render, model).run(
        turns,
        NoteHarnessRequest(
            note_spec=SPEC, budget_settings=BudgetSettings(base_words=200)
        ),
        "DICTATION",
    )
    assert report.mode == "DICTATION"
    assert report.repaired is False and report.llm_calls == 1


@pytest.mark.asyncio
async def test_failures_land_on_the_report():
    async def broken(*_):
        raise RuntimeError("model down")

    report = await NoteHarness(_render, broken).run(
        _turns(3), NoteHarnessRequest(note_spec=SPEC), "SCRIBE"
    )
    assert report.draft is None
    assert report.error == "RuntimeError: model down"

    empty = await NoteHarness(_render, broken).run(
        [], NoteHarnessRequest(note_spec=SPEC), "SCRIBE"
    )
    assert empty.error == "empty_transcript"
