# Thinking fillers: 10x performance plan

**Status:** proposal (2026-09-02). Nothing here is implemented yet.
**Scope:** the thinking-filler layer in `app/worker.py`, `app/core/livekit/fillers.py`,
`filler_audio.py`, `predictive_filler.py`, and the interim-reply chain that waits on it.
Back-channel and comfort audio are only touched where they share code with the filler.

> Stacks was not reachable from the session that wrote this plan, so the two product
> judgements below (the probability gate, the early trigger) are flagged for a Stacks
> check before they ship rather than decided here.

---

## 1. What "performance" means for this feature

The filler exists to shrink the *perceived* gap between the learner finishing and the
character saying something. So the performance of the feature is measured on four axes,
not one:

| # | Metric | Where it comes from | Today (from code defaults) | Target |
|---|--------|---------------------|----------------------------|--------|
| M1 | **Filler lead time** — agent enters `thinking` → filler audible | new per-turn field, see §3 | ~350–700 ms (300–600 ms deliberate wait + WAV open/decode/resample + mixer) | **≤ 40 ms** |
| M2 | **Slow-turn coverage** — share of turns whose real reply took > 1 s that heard a filler | `firstAudioSource` already in `scenario_session_turn_metrics` | ≤ 60 % × clip availability (probability gate 0.6; no clips on turns 1–2) | **≥ 90 %** |
| M3 | **Generation cost per session** — LLM calls, TTS calls, cost | new session counters | up to 6 LLM + 30 TTS calls/min, on the *roleplay* model, for phrases that mostly repeat | **≥ 10x fewer TTS calls, ≥ 10x cheaper LLM spend** |
| M4 | **Time to first usable clip** — session start → a filler could play | new session counter | static: seconds into deferred setup, and only if Studio authored `allowedFillerWords`; predictive: ≥ 10 s after the first exchange (turn 2–3 at best) | **before the learner's first turn** |

The "today" column is derived from the code paths and settings defaults, not from
production measurement. Phase 0 exists to replace it with real numbers before anything
else lands; the 10x claim is against those.

## 2. Where the time and money go today

A turn, as the code runs now (`_on_filler_agent_state` → `_delayed_filler_play`):

1. VAD end-of-speech → LiveKit endpointing delay (0.5–3.0 s, semantic EOU) → turn
   committed → `agent_state_changed(thinking)`.
2. The handler spawns a task that **sleeps a random 300–600 ms** to see whether the reply
   turns up first.
3. It rolls a die (`FILLER_PLAY_PROBABILITY = 0.6`).
4. It picks a `(phrase, wav_path)` and calls `bg_audio.play(AudioConfig(path))`. LiveKit
   opens the WAV, decodes and resamples it to 48 kHz on every play, then feeds the mixer.
5. `note_filler_started(created_at + delay_s)` credits first-audio at an *estimated*
   time, not the time the first frame was actually captured.

Meanwhile, `_predictive_filler_loop` runs on a **free-running 10 s timer** for the whole
session. Each cycle that sees a new message calls the **scenario's main roleplay model**
with structured output, then synthesizes **all 5 phrases** to fresh temp WAVs, and a cycle
later deletes the previous 5. Nothing is cached, so "Hmm…", "I see", "अच्छा" get
re-synthesized many times per session. The isolated LLM client exists precisely because
this loop was measured to add ~270 ms to the real reply's TTFT when it shared a
connection.

The interim reply chains behind the filler with a hard-coded
`sleep(FILLER_MAX_DELAY_MS + 50 ms)` and then a 50 ms polling loop, so it inherits the
filler's delay and adds its own.

Things that already work and must be preserved: the separate background track (a filler
can never preempt the reply), `create_clip_tts` isolation (the 2026-08-20 Marathi
outage), stop-and-flush when the reply starts, transcript emission of the spoken phrase,
and `firstAudioSource` / `replyLatencyMs` provenance in the metrics.

## 3. Phase 0 — measure first (≈ 2 days)

No behaviour change. This is the yardstick every later phase is judged by.

- **Per-turn filler record** merged into the turn's `metadata` via `turn_metrics.record`:
  `fillerDecision` ∈ {`played`, `skipped_reply_ready`, `skipped_probability`,
  `skipped_no_clips`, `skipped_not_ready`, `disabled`}, `fillerLeadMs` (thinking → first
  frame captured), `fillerClipSource` ∈ {`static`, `predictive`, `cache`},
  `fillerCutEarlyMs` (how much of the clip was cut when the reply arrived).
- **Real first-frame timestamp.** Wrap the clip's frame iterator so the first frame
  handed to the mixer stamps `note_filler_started`, replacing the `created_at + delay_s`
  estimate. The interim reply gets the same treatment.
- **Session counters** logged once at shutdown and shipped in the existing session
  summary: predictive LLM calls, TTS clip syntheses, cache hits/misses, time to first
  usable clip, temp files written.
- **Bench harness.** Extend `app/v2v_tester` (or `scripts/load-test-agent.py`) with a
  `--filler-bench` mode that drives N scripted turns and prints p50/p95 of M1, M2 coverage
  and the M3/M4 counters. This is what "10x" gets demonstrated on, per language, since
  Sarvam/Indic behaviour differs from English.
- **Dashboard.** ally-be already exposes `firstAudioSource`; add `fillerDecision` to the
  voice-latency analytics so slow-turn coverage is a chart, not a log grep.

## 4. Phase 1 — kill the wait (M1 ≥ 10x, ≈ 3 days)

**Predict the gap instead of waiting to see it.** The 300–600 ms sleep exists to avoid
a filler on fast turns. Replace it with a per-session predictor: an exponential moving
average of `llm_ttft_ms + tts_ttfb_ms` from the turns already recorded in
`turn_metrics`, seeded from a per-model prior (e.g. 900 ms) until two turns exist. At
`thinking`:

- predicted first-audio ≥ `FILLER_PREDICTED_GAP_MS` (start at 700 ms) → play **now**;
- otherwise → skip immediately, no sleep at all.

`FILLER_MIN/MAX_DELAY_MS` stay as the fallback when the predictor has no data. Expected
lead time drops from ~450 ms median to whatever the play path costs, which Phase 1 also
shrinks:

**Pre-decoded, in-memory clips.** Store each clip as a list of 48 kHz mono int16
`AudioFrame`s at synthesis time; play via `AudioConfig(<async iterator>)` exactly the way
`comfort_ambient_source` already does. This removes the temp WAV, the per-play
open/decode/resample, `cleanup_clips`, the `pending_cleanup` one-cycle-later dance and the
shutdown file sweeps. Target ≤ 40 ms from `thinking` to first captured frame.

**Chain the interim on an event, not a timer.** `_interim_play_after_filler` waits on an
`asyncio.Event` set when the filler decision resolves (played / skipped), replacing the
`FILLER_MAX_DELAY_MS + 50 ms` sleep and the 50 ms poll.

**Probability gate — product judgement, check Stacks.** With a latency predictor the
"unnatural on every turn" worry the 0.6 gate addressed changes shape: fillers now only
fire on turns that genuinely have a gap. Proposal: 1.0 when the predicted gap ≥ 1.2 s,
0.6 between 0.7 and 1.2 s. This directly drives M2 and must be validated against Stacks
guidance on filler cadence before it ships.

**Guardrail.** A false-positive prediction (filler plays, reply arrives 150 ms later) is
cut by the existing stop-and-flush. Track `fillerCutEarlyMs`; if p95 exceeds ~300 ms,
raise `FILLER_PREDICTED_GAP_MS`.

## 5. Phase 2 — 10x cheaper, ready from turn one (M3, M4; ≈ 4–5 days)

**Phrase → audio cache.** Key = (TTS provider, hash of the client's stored voice
parameters, language code, `_normalize_for_synthesis(phrase)`). Value = the pre-decoded
frame list from Phase 1. Two tiers:

- process-local LRU, bounded (~200 clips ≈ 12 MB), shared by every session on the worker;
- optional Redis tier (24 h TTL) **only for phrases that do not derive from a
  conversation** — the static Studio set and the session-start seed batch below.
  Conversation-derived predictive phrases stay process-local: the prompt forbids
  specifics, but a cross-session store of text generated from a session is still not
  something to put anywhere PHI rules would have to be argued about.

Synthesize only the misses. Fillers repeat heavily by construction (the prompt asks for
hesitations and acknowledgements), so hit rate after warm-up should exceed 80 % — that is
the ≥ 10x on TTS calls once several sessions have run on a worker.

**Regenerate on exchanges, not on a clock.** Trigger predictive generation when the
agent *finishes* speaking (`agent_state` → `listening`), when the pipeline is idle and
the next filler is several seconds away. Skip when the last batch still has ≥ 3 unplayed
phrases, and enforce a minimum gap (8 s). One call per exchange with skips replaces up to
six per minute, and the call never overlaps the real reply's LLM request — the contention
the isolated client was built to hide.

**Use a small model.** Generating five two-word phrases does not need the roleplay
model. Add `PREDICTIVE_FILLER_MODEL_PROVIDER` / `PREDICTIVE_FILLER_MODEL` mirroring the
interim reply's dedicated fast model (default `gpt-4o-mini` or equivalent), keeping the
isolated-connection behaviour. Roughly 10–20x cheaper per call and faster to first token,
so the batch is ready sooner.

**Seed batch at session start.** In `_setup_deferred_naturalness`, generate one batch
from scenario context alone (no history) so predictive clips exist before the first
learner turn, and warm the cache with the static Studio phrases. With the Redis tier, a
scenario that has run before starts with audio already decoded. This is what moves M4
from "turn 2–3" to "before turn 1".

**Raise `PREDICTIVE_FILLER_COUNT` to 8.** More variety per call, fewer calls.

## 6. Phase 3 — earlier trigger (experimental, flag off; ≈ 3 days + A/B)

The biggest gap the filler does not cover is the endpointing delay itself: 0.5–3.0 s
between VAD end-of-speech and `thinking`. Behind `FILLER_EARLY_TRIGGER_ENABLED`
(default off), start the filler at `user_state_changed(listening)` when the semantic EOU
model's delay is collapsing toward its minimum (the learner sounds finished), and cancel
with flush the instant the learner resumes speaking. Run as an A/B on English and Hindi
(the languages the EOU model supports) and watch: learner-resumed-during-filler rate,
barge-in rate, and the `replyLatencyMs` distribution. This is a **product judgement** —
talking during a mid-thought pause can read as interruption — so it needs Stacks and a PM
before it goes past an experiment.

## 7. Phase 4 — cleanup and docs (≈ 1–2 days)

- Delete the temp-file paths in `filler_audio.py`, `cleanup_clips`, `pending_cleanup`, and
  the shutdown WAV sweeps; back-channel and interim use the same in-memory clips.
- Demote `FILLER_MIN/MAX_DELAY_MS` to documented fallbacks.
- Update `docs/05-tts-providers.md` (clip isolation section), `docs/architecture.md`, and
  the wiki repo page (`app/worker.py` is watched by `.docs-map.yml`, so the PR carries a
  `Wiki-PR:` trailer).
- ally-web: add `fillerDecision` to the voice-latency tab.

## 8. Success criteria, restated

| Metric | Before (code defaults) | After | Factor |
|--------|------------------------|-------|--------|
| M1 filler lead time, p50 | ~450 ms | ≤ 40 ms | > 10x |
| M2 slow-turn coverage | ≤ ~50 % | ≥ 90 % | coverage, not a ratio |
| M3 TTS clip syntheses / session | ~5 per 10 s cycle | cache misses only | ≥ 10x on a warm worker |
| M3 predictive LLM spend / session | roleplay model, ≤ 6 calls/min | small model, ~1 call/exchange with skips | ≥ 10x |
| M4 time to first usable clip | ≥ 10 s after first exchange | before turn 1 | — |
| Temp files per session | dozens | 0 | — |

Phase 0 numbers replace the "before" column; the plan is a failure if the bench does not
show the M1 and M3 factors on at least English and one Indic language.

## 9. Risks

- **Wrong gap prediction.** Mitigated by `fillerCutEarlyMs` monitoring and a tunable
  threshold; the existing stop-and-flush keeps two voices from overlapping.
- **Cache key misses a voice parameter.** Hash *all* stored TTS params, not just voice
  id; a stale clip in the wrong voice is worse than no filler. Add a test per provider.
- **Memory.** Bound the LRU; 5 s of 48 kHz mono int16 is 480 KB, typical fillers are
  ~1 s.
- **Regression in the interim chain.** The event-based hand-off changes ordering; cover
  with tests in `tests/unit/test_interim_reply.py`.
- **HIPAA.** Only non-conversational phrases cross session boundaries (see §5).

## 10. Files this touches

`app/worker.py` (filler handlers, predictive loop, interim chain, deferred setup) ·
`app/core/livekit/filler_audio.py` (in-memory clips, cache) ·
`app/core/livekit/predictive_filler.py` (seed batch, small model) ·
`app/core/config.py` (new settings) · `app/core/metrics/turn_metrics.py`
(filler record) · `app/v2v_tester/` (bench) · `tests/unit/test_filler_audio.py`,
`test_interim_reply.py`, `test_worker.py` · `docs/05-tts-providers.md`,
`docs/architecture.md` · ally-be/ally-web analytics for `fillerDecision`.
