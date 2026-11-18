"""NoteHarness: one path from transcript to note (DESIGN §6.3).

Short sessions take one structured call. Long ones are split at turn boundaries
(no overlap), each part is turned into timeline notes in parallel, the notes are
joined in time order in code, and one structured call writes the note from
them. Validation and at most one repair call follow.

The harness owns no model client: `render` fills a prompt from the Skills
Store's text and `invoke` runs one structured call, so tests drive it with
fakes and production plugs in OpenAITextGenerationService.
"""

import asyncio
import json
import time
from typing import Any, Awaitable, Callable, Dict, List, Optional

from app.core.note_harness.budget import compute_budget
from app.core.note_harness.models import (
    Budget,
    HarnessReport,
    NoteHarnessRequest,
    NoteSpec,
    NoteTurn,
)
from app.core.note_harness.schema import (
    note_schema,
    render_json,
    render_spec,
    segment_schema,
)
from app.core.note_harness.transcript import (
    format_ts,
    render_turns,
    split_turns,
    transcript_minutes,
    word_count,
)
from app.core.note_harness.validate import (
    merge_field_notes,
    merge_segment_points,
    validate_draft,
)

# Template paths under app/prompts/ (codes ally_ai_scribe_note_*).
GENERATE_PATH = "scribe_note/generate"
MAP_SEGMENT_PATH = "scribe_note/map_segment"
REPAIR_PATH = "scribe_note/repair"

# render(path, **variables) -> prompt text
Render = Callable[..., str]
# invoke(prompt, schema, path, max_tokens) -> parsed JSON object
Invoke = Callable[[str, Dict[str, Any], str, int], Awaitable[Dict[str, Any]]]

# ~30k tokens of transcript (about 90 minutes of speech) fits one pass.
SINGLE_PASS_WORDS = 22000
# ~15 minutes of speech per map part.
SEGMENT_WORDS = 2000
MAP_CONCURRENCY = 4
_MAP_MAX_TOKENS = 4000


def _budget_text(budget: Budget) -> str:
    return (
        f"The session lasted about {budget.transcript_minutes:.0f} minutes. "
        f"Write a narrative of about {budget.narrative_words} words in total. "
        "That is a ceiling for a full session, not a quota: if less happened, "
        "write less, and never pad or repeat."
    )


def _context_text(context: Dict[str, Any]) -> str:
    if not context:
        return "(none)"
    return "\n".join(f"- {k}: {v}" for k, v in context.items() if v is not None)


def _render_timeline(points: List[Dict[str, Any]], notes: List[Dict[str, Any]]) -> str:
    lines = ["Timeline notes, in session order:"]
    for p in points:
        ids = [i for i in (p.get("turn_ids") or []) if isinstance(i, int)]
        ref = f"turns {','.join(map(str, ids))}" if ids else "turns ?"
        lines.append(f"[{ref} | {p.get('t', '')}] {str(p.get('text', '')).strip()}")
    if notes:
        lines.append("")
        lines.append("Field notes gathered from the parts:")
        for n in notes:
            ids = ",".join(str(i) for i in (n.get("turn_ids") or []))
            lines.append(f"- {n.get('field_id')}: {n.get('note', '')} (turns {ids})")
    return "\n".join(lines)


class NoteHarness:
    def __init__(
        self,
        render: Render,
        invoke: Invoke,
        single_pass_words: int = SINGLE_PASS_WORDS,
        segment_words: int = SEGMENT_WORDS,
        map_concurrency: int = MAP_CONCURRENCY,
    ):
        self._render = render
        self._invoke = invoke
        self._single_pass_words = single_pass_words
        self._segment_words = segment_words
        self._map_concurrency = map_concurrency

    def plan_budget(self, turns: List[NoteTurn], request: NoteHarnessRequest) -> Budget:
        return compute_budget(
            transcript_minutes(turns),
            word_count(turns),
            request.budget_settings,
            len(request.note_spec.fields),
        )

    async def run(
        self,
        turns: List[NoteTurn],
        request: NoteHarnessRequest,
        mode: Optional[str],
    ) -> HarnessReport:
        started = time.monotonic()
        report = HarnessReport(mode=(mode or "SCRIBE").upper())
        try:
            await self._run(turns, request, report)
        except Exception as e:  # noqa: BLE001 - the report carries the failure
            report.error = f"{type(e).__name__}: {e}"[:500]
        report.duration_ms = int((time.monotonic() - started) * 1000)
        return report

    async def _run(
        self, turns: List[NoteTurn], request: NoteHarnessRequest, report: HarnessReport
    ) -> None:
        if not turns:
            report.error = "empty_transcript"
            return
        spec: NoteSpec = request.note_spec
        budget = self.plan_budget(turns, request)
        report.budget = budget

        common = {
            "mode": report.mode,
            "note_spec": render_spec(spec),
            "budget": _budget_text(budget),
            "context": _context_text(request.context),
            "note_language": spec.note_language or "English",
        }

        if word_count(turns) <= self._single_pass_words:
            report.path = "single"
            report.segments = 1
            source = render_turns(turns)
        else:
            report.path = "map_reduce"
            source = await self._map(turns, spec, common, report)

        prompt = self._render(GENERATE_PATH, transcript=source, **common)
        raw = await self._call(prompt, note_schema(spec), GENERATE_PATH, budget, report)
        draft, stats = validate_draft(raw, spec, turns)
        report.validation = stats

        if draft.narrative_words() < budget.min_narrative_words:
            repair_prompt = self._render(
                REPAIR_PATH,
                transcript=source,
                draft=render_json(raw),
                problem=(
                    f"The narrative has {draft.narrative_words()} words; this "
                    f"session supports about {budget.narrative_words}. Events "
                    "from the transcript are missing."
                ),
                **common,
            )
            repaired_raw = await self._call(
                repair_prompt, note_schema(spec), REPAIR_PATH, budget, report
            )
            repaired, repaired_stats = validate_draft(repaired_raw, spec, turns)
            if repaired.narrative_words() > draft.narrative_words():
                draft, report.validation = repaired, repaired_stats
                report.repaired = True

        report.draft = draft

    async def _map(
        self,
        turns: List[NoteTurn],
        spec: NoteSpec,
        common: Dict[str, Any],
        report: HarnessReport,
    ) -> str:
        parts = split_turns(turns, self._segment_words)
        report.segments = len(parts)
        gate = asyncio.Semaphore(self._map_concurrency)
        schema = segment_schema(spec)

        async def one(index: int, part: List[NoteTurn]) -> Dict[str, Any]:
            label = (
                f"Part {index + 1} of {len(parts)} "
                f"({format_ts(part[0].start)} to {format_ts(part[-1].start)})"
            )
            prompt = self._render(
                MAP_SEGMENT_PATH,
                segment=label,
                transcript=render_turns(part),
                **common,
            )
            async with gate:
                report.llm_calls += 1
                return await self._invoke(
                    prompt, schema, MAP_SEGMENT_PATH, _MAP_MAX_TOKENS
                )

        results = await asyncio.gather(*(one(i, p) for i, p in enumerate(parts)))
        return _render_timeline(
            merge_segment_points(results), merge_field_notes(results)
        )

    async def _call(
        self,
        prompt: str,
        schema: Dict[str, Any],
        path: str,
        budget: Budget,
        report: HarnessReport,
    ) -> Dict[str, Any]:
        report.llm_calls += 1
        raw = await self._invoke(prompt, schema, path, budget.max_output_tokens)
        if isinstance(raw, str):
            raw = json.loads(raw)
        if not isinstance(raw, dict):
            raise ValueError(f"structured call returned {type(raw).__name__}")
        return raw
