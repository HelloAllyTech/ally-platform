"""One shadow run: canonical transcript (or the v1 turns), then the harness."""

import time
from typing import Any, Iterable, Optional

from app.core.note_harness.canonical import Invoke, Render, build_canonical
from app.core.note_harness.harness import NoteHarness
from app.core.note_harness.models import HarnessReport, NoteHarnessRequest
from app.core.note_harness.transcript import turns_from_messages


async def run_note_pipeline(
    render: Render,
    invoke: Invoke,
    request: NoteHarnessRequest,
    mode: Optional[str],
    segments_text: Optional[str] = None,
    fallback_messages: Iterable[Any] = (),
    harness: Optional[NoteHarness] = None,
) -> HarnessReport:
    """Never raises: every failure ends up on the report."""
    started = time.monotonic()
    harness = harness or NoteHarness(render=render, invoke=invoke)

    turns, ends, source = None, {}, "diarized"
    roles_calls, unlabelled, canonical_error = 0, 0, None
    if segments_text and segments_text.strip():
        try:
            canonical = await build_canonical(segments_text, mode, render, invoke)
            if canonical.turns:
                turns, ends, source = canonical.turns, canonical.ends, "canonical"
                roles_calls, unlabelled = canonical.roles_calls, canonical.unlabelled
        except Exception as e:  # noqa: BLE001 - fall back to the v1 turns
            canonical_error = f"{type(e).__name__}: {e}"[:300]
    if turns is None:
        turns = turns_from_messages(fallback_messages)

    report = await harness.run(turns, request, mode)
    report.transcript_source = source
    report.transcript = [
        {
            "id": t.id,
            "speaker": t.speaker,
            "start": t.start,
            "end": ends.get(t.id),
            "text": t.text,
        }
        for t in turns
    ]
    report.llm_calls += roles_calls
    report.roles_unlabelled = unlabelled
    report.canonical_error = canonical_error
    report.duration_ms = int((time.monotonic() - started) * 1000)
    return report
