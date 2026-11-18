# Scribe v2: end-to-end redesign

Status: **proposal, partly built.** Phase 3 — the note harness in shadow mode, behind the org preference `SCRIBE_NOTE_HARNESS_SHADOW_ENABLED` — is on `master` (`ally-ai/app/core/note_harness/`); what it does and what it does not touch is in [PHASE-3-NOTES.md](PHASE-3-NOTES.md). Treat the rest of the phases in §11 as unbuilt unless their code says otherwise.
Scope: everything from the moment a counsellor presses Record (or Dictate) to the moment a
saved, correct note is on screen. Web and mobile.

## 1. Why

Users report four problems with Scribe and dictation:

| # | User report | Cause found in code |
|---|---|---|
| 1 | The summary gets the order of events wrong | Diarization chunks overlap by 300 words and are joined without removing the overlap, so boundary turns appear twice and speakers can swap between chunks. The summariser gets no timestamps. Long sessions are condensed with no rule to keep order. |
| 2 | Session number is AI generated | `session_number` is a field the LLM fills ([structured_output_models.py:184](../../ally-ai/app/core/text_generations/structured_output_models.py)). Nothing computes it. |
| 3 | The summary is shortened | An LLM rewrites and translates the whole transcript before the summary is written, and content is lost there. There is one fixed length rule for every session length. Sessions over 8,000 words are condensed. The default model is gpt-4o-mini. |
| 4 | Risk fields are lost after Submit (dictation) | In the mobile app, Save skips custom fields; only the section's tick saves them. A dictation reload wipes picks that weren't saved yet. Mobile stores option labels where web stores option ids. |

**The live prompt text** in the production Skills Store, pulled 2026-11-18, confirms the causes above:

| Prompt (live version) | What it says | Effect |
|---|---|---|
| `ally_ai_summary_summary` v3, the **scribe** summary | "detailed summary **mostly independent sentences**", "**Responses shorter than 300 words are invalid**", "**Avoid leaving fields as null/empty**". It says nothing about order. | Summaries grouped by topic instead of time. One length floor for every session length. Pressure to fill unknown fields, which is how `session_number` gets invented. |
| `ally_ai_summary_dictation_summary` v6 | Already fixed: chronological, grounded, "do not reorganize by theme". | Good, but it applies only to dictation **recordings that carry `mode`**. Uploaded dictations miss `mode` and get the scribe prompt above. |
| `scribe_voice_note_field_extraction_system` v3, the **dictation note screen** | Session Summary is "a complete account", but **"For 'multiline' write clear, concise prose"**. It says nothing about order. | Dictation summaries come out shortened and out of order. This is the path behind the dictation complaints. |
| `ally_ai_audio_diarization` v2 | "Translate the text into English", rewrite every line as Client/Counselor. | Confirms that the stored and summarised transcript is an LLM rewrite. |
| `ally_ai_summary_dynamic_summary` v2, used by `fillAiCustomFields` | "Keep values concise", "use an empty string if it cannot be determined", values as strings. | Multi-select comes back as a plain string, and lists are cut short. |
| All of them | **No model override set**, so every ally-ai step runs on the default `gpt-4o-mini-2024-07-18`. Only the dictation note screen pins a reasoning model, in code. | The weakest model handles the longest and most important input. |

So the dictation prompt was fixed once, but only on the recording path. The note-screen path, which is where dictation is used, and the scribe path never got the fix. This is why the prompts and code paths need to be unified (goal 6), not patched one at a time.

Problems found beyond those four:

- The summary never sees the tenant's note format: it always fills one fixed schema, and a second
  LLM call (`fillAiCustomFields`) fills the tenant's AI fields afterwards.
- Scribe, dictation-from-upload, the dictation note screen and summary retry each have their own
  code path and their own prompts.
- The upload path and the retry path don't send `mode`, so a dictation uploaded as a file is
  summarised with the scribe prompt.
- A dictation (one speaker) is still split into Client/Counselor turns.
- A mobile recording is finalised only when the socket disconnects. A drop the server doesn't
  see, or a server restart, loses audio (a recovery job only covers part of this).
- Multi-select values filled by the AI are stored as `"a,b"`, which the UI cannot read.
- Nobody measures how often a session ends in a good note.

## 2. Goals

1. Every recorded minute that reaches the device reaches the server, even with a network drop,
   backgrounding or a server restart.
2. The note follows the tenant's own format (its sections and fields) and is filled in one pass.
3. The narrative summary is in time order and its length grows with the session.
4. The AI only fills what it can know. The system computes system fields, and the counsellor owns
   manual fields (risk assessments stay manual).
5. What the counsellor enters is never lost or overwritten, on web or mobile.
6. One pipeline for scribe, dictation, uploads and retries.
7. Every stage is measured, so "it works" is shown with numbers.

Not in scope: live in-session nudges, the text helpline summary (`helpline-*` tasks), debrief.

## 3. Target shape

```
 CAPTURE                TRANSCRIBE              NOTE HARNESS                 SAVE / EDIT
 ────────               ──────────              ────────────                 ───────────
 device records   ──▶   STT with speaker  ──▶   NoteSpec (tenant format)  ─▶ one note API
 30 s segments          labels + times          + Budget (base + bonus)      (built-in + custom,
 uploads each           ──▶ canonical           + canonical transcript       option ids, version)
 to S3, then            transcript (turns,      ──▶ ordered map (long) ──▶   web + mobile share
 POST /finalize         ids, timestamps,        one structured pass          one form, autosave,
                        stored, never           ──▶ validate + repair        AI vs human provenance
                        rewritten)              ──▶ NoteDraft (versioned)

            ╰──────── summary_jobs: one row per attempt, stage, timings, model, sizes ────────╯
```

## 4. Layer 1: capture (recording and upload)

**Today.** Mobile streams raw audio over a socket. The recording exists only in server memory
until the socket closes, and there is no "I'm done" message.

**v2.**
- The device records into **segments of about 30 s** (16 kHz mono, compressed; Opus or AAC
  instead of raw PCM cuts upload size about 8×).
- Each segment is uploaded on its own (`PUT` to a presigned S3 URL, with the segment index in the
  key) while recording continues. Uploads that fail are queued on the device and retried with
  backoff, including after the app restarts.
- Stop calls **`POST /v1/chats/:id/finalize`** with the segment count. The server checks that every
  segment is present, joins them, and publishes the transcribe job.
- Safety net: a janitor finalises chats that have had no new segment for N minutes and no
  finalize call, using the segments present, and marks them `partial: true` so the UI can say so.
- Web uses the same segment upload instead of one large file.
- The live socket stays only for features that need live audio. It is no longer the path that
  saves the recording.

This removes: lost audio on server restart, chats that never finalise, and the 25 MB upload cap
on dictation.

## 5. Layer 2: transcription (canonical transcript)

**Today.** After STT, an LLM rewrites the whole transcript into Client/Counselor turns
(translated to English) in overlapping chunks, and that rewrite is what gets stored and
summarised.

**v2.**
- Use the STT provider's own speaker labels and utterance timestamps (Deepgram `diarize` +
  `utterances`; equivalents for the others). Keep the existing provider fallback chain.
- Store a **canonical transcript**: turns `{id, speaker, start, end, text, lang}` in the
  original language, exactly as heard. **It is never rewritten by an LLM.**
- **Speaker roles.** One small LLM call sees the first few minutes and answers only
  `{"speaker_0": "COUNSELOR", "speaker_1": "CLIENT"}`. The mapping is applied in code. The counsellor
  can swap roles in the UI if it's wrong.
- **Dictation.** No diarization: one speaker, role `COUNSELOR_DICTATION`.
- **Translation.** Optional and display-only (a translated view for the transcript tab). The
  harness reads the original language and writes the note in the tenant's note language.
- The existing "empty transcript is a failure" guards stay.

This removes: duplicated or reordered turns, speakers swapping mid-session, and content lost in
the rewrite.

## 6. Layer 3: the note harness (the AI part)

One service in ally-ai, `NoteHarness.run(job)`, used for scribe, dictation (recorded or uploaded),
the dictation note screen, and retry.

### 6.1 Inputs

| Input | Source |
|---|---|
| `transcript` | Canonical turns, with ids and timestamps |
| `mode` | `SCRIBE` or `DICTATION`. Required on every path, with no default. |
| `note_spec` | Built by ally-be from the tenant's `custom_field_definitions` (sections, type, options `{id,label}`, `aiInstruction`, `fillMode`), plus the narrative-summary section and the tenant's note language. **Only `fillMode=AI` fields are sent to the model.** |
| `context` | Facts the AI must not guess: session date, duration and counsellor (all SYSTEM). |
| `budget` | Computed in ally-be (6.2) |

### 6.2 Budget (fixed part + bonus for length)

```
transcript_minutes = duration of the canonical transcript
narrative_words    = clamp(BASE + PER_MIN * transcript_minutes, BASE, CAP)
                     e.g. BASE 200, PER_MIN 12, CAP 1200
                     → 10 min ≈ 320 words, 30 min ≈ 560, 60 min ≈ 920
list_items         = per section, base + bonus, same idea (e.g. key concerns 3 + 1 per 15 min, max 10)
max_output_tokens  = derived from the above, plus headroom for the fields
reasoning_effort   = low under 15 min, medium above (if the model supports it)
time_budget_s      = 60 + 4 * transcript_minutes   (feeds job timeouts, see 7)
```

BASE, PER_MIN and CAP are tenant settings with platform defaults, so a tenant that wants terse
notes can have them. The budget is sent to the prompt as variables and is checked after
generation (6.5).

### 6.3 Flow

```
if transcript_tokens <= SINGLE_PASS_LIMIT (≈ 30k tokens, ~90 min of speech on current models):
    one structured call(note_spec, budget, transcript)
else:
    split at turn boundaries into ~15 min segments (no overlap)
    map in parallel: each segment → timeline notes [{t_start, t_end, text, turn_ids}]
                     + candidate field evidence
    join the timeline notes in time order (deterministic, in code)
    one structured call(note_spec, budget, timeline + candidate evidence)
```

Running the map steps in parallel keeps it fast, and order is kept because every note carries
its timestamps and the join is done in code, not by a model.

### 6.4 Output contract

The JSON schema is **generated from `note_spec`** (strict structured output):

```json
{
  "narrative": [{"t": "00:04:10", "text": "...", "turn_ids": [12, 13]}],
  "fields": {
    "<fieldDefinitionId>": {"value": "<option id | text | number | [ids]>", "evidence_turn_ids": [31]}
  }
}
```

- `narrative` is an ordered list, so time order is part of the format, not a request in a prompt.
- Select fields must answer with **option ids** from an enum in the schema.
- Every field may be `null`, meaning "not discussed". The prompt prefers null to a guess.
- Evidence turn ids let the UI link a field to the moment it was said, and let validation drop
  values with no support.

### 6.5 Validation and repair (in code)

1. Validate against the schema. Option ids must exist, and numbers and dates must parse.
2. Evidence check: if a field cites turn ids that don't exist, drop the value and log it.
3. Length check: if the narrative is under 60 % of `narrative_words`, run one repair call that
   asks it to expand using the transcript.
4. Check that the narrative timestamps don't go backwards (re-sort if needed and log it).
5. On failure, the transcript is still saved (as today), and the summary is marked as retryable.

### 6.6 Who fills what

| Field kind | Filled by |
|---|---|
| `fillMode=SYSTEM` (call id, date, time, duration, counsellor, mode) | ally-be computes it; never the model |
| Session number | **SYSTEM when the chat is linked to a client** (count of that client's earlier chats); otherwise **MANUAL**. Removed from the AI schema. |
| `fillMode=AI` | The harness, in the one pass |
| `fillMode=MANUAL` (all risk and trauma intake, ongoing risks) | The counsellor only. *Optional later:* the harness can attach a **suggestion** with evidence, shown as "AI noticed: …", which the counsellor accepts with one tap. It is never saved as the value. |

### 6.7 Dictation

The same harness with the `DICTATION` preset: first-person counsellor note, keep everything that
was said, add nothing. The dictation note screen calls it synchronously (it already shows a
spinner). Repeat dictations on one note pass the current note values in `context` and merge
**field by field**. A field the counsellor edited is never overwritten (see 8).

### 6.8 Prompts and model

- Skills Store codes: `scribe_note_system`, `scribe_note_user_scribe`, `scribe_note_user_dictation`,
  `scribe_note_map_segment`, `scribe_note_repair`, `scribe_speaker_roles`. Variables: `note_spec`,
  `budget`, `transcript`, `context`. Each gets a registry row (`ai-task-registry.constants.ts`).
- Default model: the **reasoning tier** (dictation already moved to gpt-5-mini after the fast model
  kept 48 % of facts against 93 %). The final choice comes from the eval (10), with each prompt's
  model override still available.
- The old codes are retired at the end of the migration: `ally_ai_summary_*`,
  `ally_ai_audio_diarization`, `scribe_voice_note_field_extraction_*`, `summary/dynamic_summary`
  used by `fillAiCustomFields`.

## 7. Layer 4: orchestration and delivery

- **`summary_jobs` table**: chat_id, attempt, mode, stage (`queued → transcribing → roles →
  generating → validating → delivered | failed`), started/ended per stage, provider and model,
  input minutes and words, output words, budget, error, correlation_id. This becomes the source
  for alerts and the dashboard. It replaces guessing from logs.
- Timeouts come from `budget.time_budget_s` instead of the flat 12 min (worker) and 30 min (reaper),
  so a 90-minute session isn't killed and a 5-minute one isn't left waiting 30 minutes.
- Keep what works today: SQS redrive, delivery retried idempotently, a success never downgraded to
  an error, the transcript delivered before the summary.
- Retry reruns from the **last completed stage** (the canonical transcript is stored, so a summary
  retry never re-transcribes).

## 8. Layer 5: saving and editing (web and mobile)

- **One note API.**
  - `GET /v1/chats/:id/note` returns `{spec, values, provenance, version}`.
  - `PATCH /v1/chats/:id/note` takes `{version, changes: {fieldId: value}}` for built-in and
    custom fields alike, saved atomically. **Select values are always option ids.** The server
    rejects labels after a migration converts the labels mobile already stored.
- **Provenance per field**: `ai | counsellor | system`, plus `edited_at`. AI regeneration and
  dictation merges **only write fields whose provenance is still `ai` or empty**. This rule is what
  guarantees the counsellor's work is never lost.
- **Optimistic concurrency** using `version`: two devices or tabs can't silently overwrite each
  other. On a conflict the client merges and retries.
- **Clients**: web and Flutter both render the form from `spec`, autosave every change
  (debounced), and flush on Save, close, and leaving the screen. The section tick only closes the
  section; it is no longer the only thing that saves. After a dictation the form merges server
  values and keeps local edits that aren't saved yet.
- **Status UI**: show the job stage ("Uploading 3/40", "Transcribing", "Writing note") and a
  `partial` banner when audio was incomplete.

## 9. Observability

A dashboard built from `summary_jobs` and note edits:

- share of finished recordings that end with a note, by tenant, mode and client
- time from recording end to note (p50/p95) against duration
- failures by stage and reason
- **edit distance**: how much counsellors change the AI note (the best signal of quality)
- share of AI fields left null or overwritten by counsellors, per field (shows which fields or
  instructions are weak)

Alerts reuse the existing Slack stage alerts, driven by the table.

## 10. Quality gate (before rollout)

- **Eval set.** 30 or more real sessions (scribe and dictation; 5, 20, 45 and 90+ minutes; English
  and at least two Indian languages; including the reported sessions). For each, a reference list
  of facts with times, and the correct field values. It stays PHI-safe: stored in ally-be under
  existing access controls and never in the repo.
- **Automatic scoring**:
  - fact recall (LLM judge against the fact list)
  - order correctness (Kendall tau of the matched facts against the reference order)
  - field accuracy
  - hallucinated values (no support in the transcript)
  - length against the budget
  - latency and cost
- **Bar to switch a tenant**: v2 is at least as good as v1 on every metric and better on recall
  and order. **Shadow mode** first: v2 runs on live sessions without being shown, and the outputs
  are compared for a week.

## 11. Rollout

| Phase | What | Rough effort | Risk |
|---|---|---|---|
| 0 (now) | Quick fixes on today's code: mobile Save also saves custom fields and keeps unsaved picks on dictation reload; send `mode` on upload and retry; take `session_number` out of the AI fields; dedupe the diarization overlap. **Prompt-only, no deploy:** new Skills Store versions of the scribe summary (chronological, grounded, length that grows with the session, null rather than a guess) and of the voice-note extraction (Session Summary chronological and complete, not "concise") | 1–2 d | Low (prompts can be rolled back to the previous version) |
| 1 | Eval set + scorers, with v1 measured as the baseline | 2 d | Low |
| 2 | Canonical transcript (STT speaker labels + roles call), stored alongside the old transcript | 2–3 d | Medium |
| 3 | Note harness + budget + NoteSpec + validation; `summary_jobs`; shadow mode behind a tenant flag | 4–5 d | Medium |
| 4 | Note API + provenance + version; web and Flutter move to it; label→id data migration | 4–5 d | Medium (old app builds: keep old endpoints until min-version bump) |
| 5 | Segment upload + finalize + janitor (mobile, then web) | 4–5 d | Medium-high (needs app release) |
| 6 | Dashboard and alerts; switch tenants over; retire v1 code and prompts | 2 d | Low |

That is about **3–4 weeks of one engineer** end to end. The AI part your lead scoped (phases 1
and 3) is about a week. Phases can ship one by one, and each gives value on its own.

## 12. Decisions needed

1. Budget defaults (BASE / PER_MIN / CAP): agree platform defaults, and whether tenants can tune them.
2. Note language: always the tenant's language, or the session language?
3. Should the AI ever suggest values for MANUAL risk fields (6.6), and if so, in which phase?
4. Session number when there's no client link: manual entry, or hide the field?
5. Model: accept a higher cost per note for the reasoning tier, if the eval confirms the quality gain?
6. Who owns the eval set's reference annotations (needs clinical review)?

## 13. Risks

- **Model cost and latency** go up. The budget caps output, and the eval measures cost per note.
- **Old mobile builds** keep the old save and stream paths until the minimum version is raised.
  The server has to support both during the overlap.
- **STT speaker labels** are weaker in some Indian-language providers. The role call and the
  counsellor's swap control limit the damage. Measure it in the eval.
- **Prompt publishing order** (Skills Store): ship code that supplies the new variables before
  publishing text that uses them.
- The Context Library was not searched for this draft (its MCP isn't connected in the session
  that wrote it). Run that search before phase 3 planning is final.
