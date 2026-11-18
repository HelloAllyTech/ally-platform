"""Canonical transcript: parse STT segments, label roles by id, never rewrite."""

import pytest

from app.core.note_harness.canonical import ROLES_PATH, build_canonical, parse_segments
from app.core.note_harness.harness import GENERATE_PATH
from app.core.note_harness.models import NoteHarnessRequest, NoteSpec
from app.core.note_harness.pipeline import run_note_pipeline

STT = """0.00-3.20: Hello, thanks for calling.
3.50-9.10: Main ne paanch din se kuch nahi khaya.
   It has been hard.
9.40-12.00: Can you tell me more?

12.30-15.00:    """


def test_parse_keeps_text_and_order_and_joins_wrapped_lines():
    segs = parse_segments(STT)
    assert [(s.id, s.start, s.end) for s in segs] == [
        (1, 0.0, 3.2),
        (2, 3.5, 9.1),
        (3, 9.4, 12.0),
    ]
    # Original language, untouched; the wrapped line is joined.
    assert segs[1].text == "Main ne paanch din se kuch nahi khaya. It has been hard."


def test_parse_handles_nothing():
    assert parse_segments("") == []
    assert parse_segments(None) == []


def _render(path, **v):
    return f"{path}\nCTX:{v.get('context')}\nSEG:{v.get('segments')}"


@pytest.mark.asyncio
async def test_dictation_needs_no_roles_call():
    async def never(*_):
        raise AssertionError("no model call for dictation")

    c = await build_canonical(STT, "DICTATION", _render, never)
    assert [t.speaker for t in c.turns] == ["COUNSELOR"] * 3
    assert c.roles_calls == 0
    assert c.ends == {1: 3.2, 2: 9.1, 3: 12.0}


@pytest.mark.asyncio
async def test_roles_are_applied_by_id_and_text_is_never_taken_from_the_model():
    async def model(prompt, schema, path, max_tokens):
        assert path == ROLES_PATH and schema["title"] == "scribe_speaker_roles"
        return {
            "roles": [
                {"id": 1, "role": "COUNSELOR"},
                {"id": 2, "role": "CLIENT"},
                {"id": 99, "role": "CLIENT"},  # not a segment: ignored
                {"id": 3, "role": "THERAPIST"},  # not a role: ignored
            ]
        }

    c = await build_canonical(STT, "SCRIBE", _render, model)
    assert [(t.id, t.speaker) for t in c.turns] == [
        (1, "COUNSELOR"),
        (2, "CLIENT"),
        (3, "CLIENT"),  # unlabelled: carries the previous speaker
    ]
    assert c.unlabelled == 1 and c.roles_calls == 1
    assert c.turns[1].text.startswith("Main ne paanch din")


@pytest.mark.asyncio
async def test_long_sessions_label_in_order_with_context():
    stt = "\n".join(f"{i}.00-{i}.50: word word word word" for i in range(10))
    prompts = []

    async def model(prompt, schema, path, max_tokens):
        prompts.append(prompt)
        ids = [
            int(line[1:].split(" ")[0]) for line in prompt.split("SEG:")[1].splitlines()
        ]
        return {"roles": [{"id": i, "role": "CLIENT"} for i in ids]}

    c = await build_canonical(stt, "SCRIBE", _render, model, chunk_words=12)
    assert c.roles_calls == 4
    assert prompts[0].split("CTX:")[1].startswith("(start of session)")
    # The second chunk sees the first chunk's segments, already labelled.
    assert "[3 | 00:00:02 | CLIENT]" in prompts[1].split("SEG:")[0]
    assert c.unlabelled == 0


def _note(turn_id):
    return {
        "narrative": [
            {"t": "", "text": "Client said they had not eaten.", "turn_ids": [turn_id]}
        ],
        "fields": {},
    }


@pytest.mark.asyncio
async def test_pipeline_uses_canonical_turns_and_returns_them():
    async def model(prompt, schema, path, max_tokens):
        if path == ROLES_PATH:
            return {"roles": [{"id": i, "role": "CLIENT"} for i in (1, 2, 3)]}
        assert path == GENERATE_PATH
        return _note(2)

    report = await run_note_pipeline(
        _render,
        model,
        NoteHarnessRequest(note_spec=NoteSpec()),
        "SCRIBE",
        segments_text=STT,
    )
    assert report.error is None
    assert report.transcript_source == "canonical"
    assert report.llm_calls == 2  # roles + generate
    assert report.transcript[1] == {
        "id": 2,
        "speaker": "CLIENT",
        "start": 3.5,
        "end": 9.1,
        "text": "Main ne paanch din se kuch nahi khaya. It has been hard.",
    }
    assert report.draft.narrative[0].turn_ids == [2]


@pytest.mark.asyncio
async def test_pipeline_falls_back_to_diarized_turns_when_roles_fail():
    async def model(prompt, schema, path, max_tokens):
        if path == ROLES_PATH:
            raise RuntimeError("roles down")
        return _note(1)

    fallback = [{"role": "CLIENT", "content": "I have not eaten.", "start_time": 1.0}]
    report = await run_note_pipeline(
        _render,
        model,
        NoteHarnessRequest(note_spec=NoteSpec()),
        "SCRIBE",
        segments_text=STT,
        fallback_messages=fallback,
    )
    assert report.transcript_source == "diarized"
    assert report.canonical_error == "RuntimeError: roles down"
    assert report.transcript[0]["text"] == "I have not eaten."
    assert report.draft is not None
