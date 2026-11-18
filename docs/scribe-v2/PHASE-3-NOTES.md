# Scribe v2 — phase 3 build notes (note harness, shadow mode)

Branch `feat/scribe-v2`. Design: [DESIGN.md](DESIGN.md) §6–7.

## What runs

For an org with the switch on, every scribe/dictation transcription does exactly what it
does today, and then, once the v1 result has been delivered:

1. ally-ai runs `NoteHarness` in a detached task (capped at 10 min) over the diarized turns.
2. It posts the report to `POST /api/v1/chats/note-drafts` (API key).
3. ally-be stores it in `scribe_note_drafts`. Nothing reads it into the counsellor's note.

A harness failure, a timeout, or a failed callback is logged and stored as `error`. None of
them can touch the v1 summary, and none of them hold the SQS message.

## Code map

| Piece | Where |
|---|---|
| Harness: flow, map-reduce, repair | `ally-ai/app/core/note_harness/harness.py` |
| Budget (base + per-minute bonus, cap) | `ally-ai/app/core/note_harness/budget.py` |
| Turns, timestamps, splitting | `ally-ai/app/core/note_harness/transcript.py` |
| JSON schema from the NoteSpec | `ally-ai/app/core/note_harness/schema.py` |
| Validation (option ids, evidence, time order) | `ally-ai/app/core/note_harness/validate.py` |
| Shadow run + callback | `ally-ai/app/core/queue/transcription_request_handler.py` (`_run_note_harness_shadow`) |
| Prompts (defaults) | `ally-ai/app/prompts/scribe_note/{generate,map_segment,repair}.txt` |
| NoteSpec from custom fields; switch; storing drafts | `ally-be/src/chat/service/scribe-note-harness.service.ts` |
| Attaching the request to the SQS message | `ally-be/src/ai/service/ai-event.service.ts` |
| Table | `scribe_note_drafts` (migration `1984100000000-AddScribeNoteDrafts`) |

## Where this differs from DESIGN.md

- **No `summary_jobs` table.** `chat_summary_attempts` already records each pipeline
  attempt: trigger, outcome, the furthest phase reached, STT provider, model and timings.
  Phase 6 extends it (per-stage timings, budget) instead of adding a second job table.
  Harness output has its own table, `scribe_note_drafts`, because it is a different thing:
  a draft per run, not a pipeline attempt.
- **The budget is computed in ally-ai**, not ally-be. The transcript's length isn't known
  when ally-be publishes the job, so ally-be sends the knobs (`budget_settings`, the
  platform defaults for now) and ally-ai computes the budget once STT is done.
- **Turns come from today's diarization** (with the phase 0 overlap fix), not the
  canonical transcript. Phase 2 swaps the source; the harness only needs
  `{id, speaker, start, text}`.
- **Repair floor.** The narrative is "short" only when it is under 60 % of the smaller of
  two numbers: the budget, and half the transcript's words. Without the second limit, a
  one-minute dictation would be padded to reach the 200-word base.
- **Model.** The new prompts start on ally-ai's default (gpt-4o-mini). The design wants
  the reasoning tier; set it per prompt in the Skills Store once the eval confirms it.
  The budget's `max_output_tokens` is recorded, but it isn't yet sent as a limit.
- **Session number** is filtered out of the NoteSpec by label ("Session No", "Session
  number", "Session #").

## Turning it on for one org

1. Deploy ally-ai, then ally-be (either order is safe; the switch is off everywhere).
2. On first deploy, ally-ai's prompt sync creates `ally_ai_scribe_note_generate`,
   `_map_segment` and `_repair` in the Skills Store from the default files. Tune them
   there.
3. As a super admin:
   `PUT /v1/settings/scribe-note-harness-shadow-enabled {"tenantId": "<org>", "enabled": true}`.

## Comparing v1 and v2 (read-only)

Numbers only, no note content:

```sql
SELECT d."chatId", d.mode, d.path, d.segments, d."llmCalls", d.repaired,
       d."transcriptMinutes", d."narrativeWordsTarget", d."narrativeWords",
       d."narrativePoints", d."fieldsFilled",
       d.validation->>'reordered'       AS reordered,
       d.validation->'dropped_fields'   AS dropped_fields,
       d."durationMs", d.error
FROM scribe_note_drafts d
WHERE d."createdAt" > now() - interval '7 days'
ORDER BY d."createdAt" DESC;
```

The side-by-side review of a v2 draft against the v1 summary for the same chat is the
phase 1 eval. It needs the annotated session set and its owner (DESIGN §12, item 6).

## Tests

- ally-ai: `poetry run pytest tests/core/note_harness tests/core/queue` covers budget,
  turns, schema, validation, the single-pass, map-reduce and repair flows with a fake
  model, the shadow run (delivery first, never raising), and the v1 cached-prompt
  fallback not needing the v2 prompts.
- ally-be: `npx jest src/chat/service/test/scribe-note-harness.service.spec.ts
  src/ai/service/test/ai-event.service.spec.ts`.

## Open

- A live run. The flow has only been exercised with a fake model; the JSON schema has not
  yet been sent to OpenAI. A smoke test on a made-up 8-minute session (no real data):
  `cd ally-ai && OPENAI__API_KEY=sk-... poetry run python ../docs/scribe-v2/scripts/live_harness_smoke.py`
  (add any argument to force the map-reduce path). It prints the report: check the
  narrative order, that option ids came back, and that `dropped_fields` is sensible.
- The Skills Store key in hand can't push, so the phase 0 prompt drafts are not yet
  published.
- Phase 4 (note API, provenance, label→id migration) is where a v2 draft would be shown.
  Shadow mode stops at storing it.
