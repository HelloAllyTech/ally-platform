# Thinking fillers: 10x performance plan

**Status:** IMPLEMENTED (2026-09-03) for the v1 worker. Revision 2 of the plan is
kept below as the rationale and the measurement contract; see
[What shipped](#what-shipped) for the delta between plan and code.
**Scope:** the thinking-filler layer in `app/worker.py`, `app/core/livekit/fillers.py`,
`filler_clips.py`, `filler_pool.py`, `gap_predictor.py`, `predictive_filler.py`, the
`filler/predictive_filler` prompt, and the interim-reply chain that waits on the
filler. Back-channel and comfort audio are touched only where they share code.

> Stacks was not reachable from the sessions that wrote and built this. The
> product judgements (probability gate, cadence caps, continuation rule, early
> trigger, judge rubric) still need a Stacks check; the thresholds below ship as
> tunable settings precisely so that check can move them without a code change.

---

## What shipped

| Plan phase | State |
|---|---|
| **0 — measure** | Done. Per-turn `fillerDecision` / `fillerLeadMs` / `postFillerSilenceMs` and session counters are in; `scripts/filler-bench.py` runs the real decision, selection and cache code offline; and the judge rubric for character/context fit ships as ally-ai's `filler_quality` module ([ally-ai#99](https://github.com/HelloAllyTech/ally-ai/pull/99)). It emits FINDINGS, not the 1-5 scores §1 proposed — every judge on this platform emits labels, booleans and counts and never a score, rate or rating, so M7/M8 surface as finding rates computed downstream. ally-be must still build the observations and persist the rows before real numbers exist. |
| **1 — kill the wait, bridge the gap** | Done. Predicted-gap gate, duration-tiered selection, bounded continuation, event-based interim hand-off, in-memory clips. |
| **2 — in character, in context, cheaper** | Done. Persona voice block and typed output in the prompt, in-turn generation from the partial transcript, accumulating pool with type rotation and rendering variants, worker-wide clip cache, dedicated small model, exchange-driven regeneration, session-start seed batch. |
| **3 — early trigger** | Built behind `FILLER_EARLY_TRIGGER_ENABLED`, **default off**. Not A/B tested; do not enable without one. |
| **4 — cleanup and docs** | Done. The v2 controller (`naturalness.py`) and its temp-file clip path (`filler_audio.py`) were deleted on 2026-09-29: `worker_v2.py` was already gone, so nothing imported either. Turn openers have since moved to the delivery plan — see [Turn Openers](turn-openers.md). |

### What the offline bench actually shows

`python scripts/filler-bench.py --sessions 5 --turns 25` (autocorrelated latency,
30-phrase vocabulary) on this branch:

| Metric | Target | Bench result |
|---|---|---|
| Lead time p50/p95 | ≤ 40 ms | ~0 ms (the 300–600 ms wait is gone by construction) |
| Post-filler silence p50/p95 | ≤ 300 / ≤ 800 ms | 184 ms / 612 ms |
| "Filler then > 1 s gap" | ≤ 5 % | 0 % |
| TTS syntheses per session | ≥ 10x fewer | ~23 on a cold worker, ~4 once warm (cache ~63 % hit) |
| LLM calls per session | ≥ 10x cheaper | ~1.8 calls, on a small model, versus up to 6/minute on the roleplay model |
| Slow-turn coverage | ≥ 90 % | **77 %** — short of target |
| Diversity | 0 in-window repeats | **not met in the bench** |

Two targets are not met and should not be reported as if they were:

- **Coverage (77 %).** The predictor cannot beat per-turn variance; the residual
  misses are turns whose actual latency ran well above the session's recent mean.
  Raising it means lowering `FILLER_PREDICTED_GAP_MS` and accepting more
  cut-off fillers — a trade to make against real `fillerCutEarlyMs` data, not
  against a synthetic profile.
- **Diversity.** The bench's synthetic phrase catalog and its stubbed
  regeneration are a poor stand-in for real generation, so its repeat counts say
  more about the harness than the product. This needs live measurement.

**Character fit and context fit are not measured yet, though they now CAN be.**
The judge that scores them ships in [ally-ai#99](https://github.com/HelloAllyTech/ally-ai/pull/99);
what remains is the ally-be half — selecting sessions, building the observations
from the per-turn filler metadata above, and persisting the rows. Until that
runs, the claim for those two dimensions is a mechanism claim (the prompt now
receives the character's voice and the learner's current utterance) rather than
a measured one.

Three bugs were found by writing the tests and the bench, and fixed:
never-played clips were being treated as stale; the repeat window was counted in
plays while being read as turns, making it half as wide as intended; and
rendering variants were produced only as a side effect of regeneration, which is
skipped most of the time, so repeats reused the identical waveform.

---

## 1. What "performance" means for this feature

The filler exists to make the gap between the learner finishing and the character
replying feel like a person thinking, not a system loading. That has a speed side and a
quality side, and a filler that is fast but repetitive, out of character, or followed by
silence is a regression, not a win. Eight metrics, in two groups:

### Speed and cost

| # | Metric | Today (from code defaults) | Target |
|---|--------|----------------------------|--------|
| M1 | **Lead time** — agent enters `thinking` → filler audible | ~350–700 ms (300–600 ms deliberate wait + WAV open/decode/resample + mixer) | **≤ 40 ms** |
| M2 | **Slow-turn coverage** — turns whose real reply took > 1 s that heard a filler | ≤ 60 % × clip availability (probability gate 0.6; no clips on turns 1–2) | **≥ 90 %** |
| M3 | **Generation cost per session** | up to 6 LLM + 30 TTS calls/min on the *roleplay* model, for phrases that mostly repeat | **≥ 10x fewer TTS calls, ≥ 10x cheaper LLM spend** |
| M4 | **Time to first usable clip** | static: only if Studio authored `allowedFillerWords`; predictive: ≥ 10 s after the first exchange | **before the learner's first turn** |

### Quality

| # | Metric | Today (from code) | Target |
|---|--------|-------------------|--------|
| M5 | **Diversity** — exact phrase repeated within the last 6 played fillers; bit-identical waveform replayed | pool = latest batch of 5 (or the static set); anti-repeat memory capped at 3; every replay of a phrase is the same recording | **0 exact repeats within 6 turns; ≥ 80 % distinct phrases over 20 turns; no identical waveform twice in a session** |
| M6 | **Gap bridging** — silence between filler end and the next audio (interim or reply); turns where the filler is followed by > 1 s of silence | clip length ignored at selection; no continuation; interim chain adds ≥ 650 ms of its own wait | **post-filler silence p50 ≤ 300 ms, p95 ≤ 800 ms; "filler then gap" turns ≤ 5 %; early cut p95 ≤ 250 ms** |
| M7 | **Character fit** — judge score on persona register, mood and idiom | prompt sees title/name/profession/description/context/role instructions, but **not** the character's linguistic style samples, allowed discourse particles or current emotional state | **judge ≥ 4/5; 0 fillers flagged out-of-register** |
| M8 | **Context fit** — the played filler was generated with sight of the learner's *current* utterance | never: batches are generated on a timer, so the played filler predates what the learner just said | **≥ 70 % of played fillers generated in-turn; judge ≥ 4/5** |

The "today" columns are read from code paths and settings defaults, not from production
measurement. Phase 0 replaces them with real numbers; the 10x claim is against those.

## 2. Where the time, money and quality go today

A turn as the code runs now (`_on_filler_agent_state` → `_delayed_filler_play`):

1. VAD end-of-speech → LiveKit endpointing delay (0.5–3.0 s with the semantic EOU model)
   → turn committed → `agent_state_changed(thinking)`.
2. The handler spawns a task that **sleeps a random 300–600 ms** to see whether the reply
   turns up first.
3. It rolls a die (`FILLER_PLAY_PROBABILITY = 0.6`).
4. It picks a `(phrase, wav_path)` from `_dynamic_filler_clips or _filler_clips`,
   avoiding at most the last 3 phrases, and calls `bg_audio.play(AudioConfig(path))`.
   LiveKit opens the WAV, decodes and resamples it to 48 kHz on every play.
5. The clip plays to its end (or is cut when the reply's TTS starts). **Nothing looks at
   how long the clip is versus how long the gap will be.** A 0.6 s "Hmm" on a 2 s gap
   leaves 1.4 s of dead air after it, which reads worse than no filler.
6. `note_filler_started(created_at + delay_s)` credits first-audio at an *estimated*
   time.

`_predictive_filler_loop` runs on a **free-running 10 s timer**. Each cycle that sees a new
message calls the **scenario's main roleplay model** with the last 10 turns, gets 5
phrases, synthesizes all 5 to temp WAVs, and swaps the batch. Consequences:

- **Stale by construction.** The batch that plays after the learner's turn was generated
  before that turn happened (the loop is decoupled from turn boundaries and a cycle takes
  2–3 s of LLM + TTS). The filler can fit the *previous* exchange, never the current one.
- **Thin pool.** Only the latest 5 survive; the previous batch is deleted. With the
  anti-repeat memory capped at `min(len(clips) - 1, 3)`, a session cycles through a
  handful of phrases, each as the same recording.
- **Persona-blind prompt.** `_build_scenario_context` passes six descriptive fields, but
  not the `{linguistic_samples}` and `{allowed_fillers}` that the main agent prompt uses
  to give the character its voice, and nothing about the character's current emotional
  state. Fillers come out generic and can clash in register (a brisk "Right, okay" in a
  grief scenario).
- **Expensive.** Roleplay model, no cache, "Hmm" re-synthesized dozens of times.

The interim reply, when enabled, chains behind the filler with a hard-coded
`sleep(FILLER_MAX_DELAY_MS + 50 ms)` and a 50 ms poll, so it inherits the filler's delay
and adds its own. It is globally off by default and arms only after 6 s / 8 words of
learner speech.

Things that already work and must be preserved: the separate background track (a filler
can never preempt the reply), `create_clip_tts` isolation (the 2026-08-20 Marathi
outage), stop-and-flush when the reply starts, transcript emission of the spoken phrase,
the prompt's non-committal rules, and `firstAudioSource` / `replyLatencyMs` provenance.

## 3. Phase 0 — measure first (≈ 2–3 days)

No behaviour change. This is the yardstick every later phase is judged by.

- **Per-turn filler record** merged into the turn's `metadata` via `turn_metrics.record`:
  `fillerDecision` ∈ {`played`, `skipped_reply_ready`, `skipped_probability`,
  `skipped_no_clips`, `skipped_not_ready`, `disabled`}, `fillerLeadMs` (thinking → first
  frame actually captured), `fillerClipSource` ∈ {`static`, `predictive`, `in_turn`,
  `cache`}, `fillerDurationMs`, `fillerCutEarlyMs`, **`postFillerSilenceMs`** (filler end
  → next audio on either track), `fillerPhraseAgeTurns` (how many turns since this phrase
  last played), `fillerBatchAgeTurns` (turns between the batch's generation and its use).
- **Real first-frame timestamp.** Wrap the clip's frame iterator so the first frame
  handed to the mixer stamps `note_filler_started`; the interim gets the same treatment.
- **Session counters** at shutdown: predictive LLM calls, TTS syntheses, cache hits,
  distinct phrases played / fillers played, identical-waveform replays, time to first
  usable clip.
- **Offline judge.** Reuse ally-ai's language-quality judge machinery
  (`ally-ai/app/core/language_quality/judge.py`) with a small filler rubric run on sampled
  sessions: for each played filler, given the persona, the preceding learner turn and the
  reply that followed — *register fit* (1–5), *context fit* (1–5), *non-committal* (pass /
  fail: presupposes or contradicts the real reply), *repetitive* (flag). This is how M7
  and M8 get numbers; the rubric wording is a Stacks check.
- **Bench harness.** A `--filler-bench` mode on `app/v2v_tester` that drives N scripted
  turns per language and prints p50/p95 of M1 and M6, M2 coverage, M5 repeat rate and the
  M3/M4 counters. Run on English and at least one Indic language.
- **Dashboard.** ally-be already exposes `firstAudioSource`; add `fillerDecision` and
  `postFillerSilenceMs` to the voice-latency analytics.

## 4. Phase 1 — kill the wait, bridge the gap (M1, M6; ≈ 4 days)

**Predict the gap instead of waiting to see it.** Replace the 300–600 ms sleep with a
per-session predictor: an exponential moving average of `llm_ttft_ms + tts_ttfb_ms` from
`turn_metrics`, seeded from a per-model prior (~900 ms) until two turns exist. At
`thinking`: predicted first-audio ≥ `FILLER_PREDICTED_GAP_MS` (start 700 ms) → play now;
otherwise skip immediately with no sleep. `FILLER_MIN/MAX_DELAY_MS` remain the fallback
when the predictor has no data.

**Pick the clip for the gap, not at random.** Every clip now carries its duration (we hold
the PCM). Maintain the pool in three duration tiers — micro (0.3–0.6 s: a hum, "Hmm"),
short (0.8–1.3 s: "Let me think…"), long (1.6–2.5 s: a reflective "I want to sit with
that for a second") — and select from the tier whose length is closest to
`predicted_gap − 150 ms`, then apply diversity (Phase 2) within that tier. The
predictive prompt is asked for a mix of lengths (see §5) so the tiers stay populated.
This is what turns "filler, then silence" into "filler that ends as the reply begins".

**Continuation, bounded.** If the filler ends and neither the interim nor the reply has
started within `FILLER_CONTINUATION_GAP_MS` (start 450 ms — a natural intra-turn pause),
play one more filler of a *different type* (a hesitation followed by an acknowledgement,
never two hums), at most **two fillers per turn**. A third silence is left alone; a
character who keeps muttering reads as stalling. Both numbers are a Stacks check.

**Contiguous hand-off to the interim.** `_interim_play_after_filler` waits on an
`asyncio.Event` set when the filler decision resolves (played / skipped / ended),
replacing the `FILLER_MAX_DELAY_MS + 50 ms` sleep and the 50 ms poll. When an interim is
`ready`, the filler tier is chosen so the filler ends as the interim can begin; the
interim, not a second filler, is the continuation of choice.

**Pre-decoded, in-memory clips.** Store each clip as a list of 48 kHz mono int16
`AudioFrame`s at synthesis time; play via `AudioConfig(<async iterator>)` exactly as
`comfort_ambient_source` already does. Removes the temp WAV, the per-play decode, the
`pending_cleanup` one-cycle-later dance and the shutdown file sweeps. Target ≤ 40 ms from
`thinking` to first captured frame.

**Probability gate — Stacks check.** With a latency predictor the gate's original job
(avoid fillers on turns that have no gap) is done by the predictor. Proposal: 1.0 when the
predicted gap ≥ 1.2 s, 0.6 between 0.7 and 1.2 s, and a cadence cap of no more than 3
filler turns in a row so the character is not heard hesitating on every single reply.

**Guardrail.** Monitor `fillerCutEarlyMs`; if p95 exceeds ~250 ms, raise
`FILLER_PREDICTED_GAP_MS` or tighten the tier margin.

## 5. Phase 2 — in character, in context, 10x cheaper, ready from turn one (M3, M4, M5, M7, M8; ≈ 6–7 days)

### 5a. Phrases that belong to this character (M7)

- **Give the prompt the character's voice.** Pass `{linguistic_samples}` and
  `{allowed_fillers}` (the same formatted blocks `app/core/graph/prompt.py` builds for the
  main agent) into `filler/predictive_filler`, so the model reuses the character's own
  discourse particles and register instead of inventing generic ones. Today the prompt
  never sees them.
- **Pass the character's current state.** Include the last CHARACTER reply verbatim and,
  where working memory is on, its one-line emotional read, with the instruction that a
  filler continues the mood of the last reply (a distressed character hesitates
  differently from a defensive one).
- **Typed output.** Ask for each filler tagged with `type` ∈ {hesitation,
  acknowledgement, reflection, encouragement} and `length` ∈ {micro, short, long}, and
  require at least two lengths and three types per batch. Types drive the continuation
  rule (§4) and diversity (§5c); lengths populate the tiers.
- **Seed batch from the character alone.** In `_setup_deferred_naturalness`, generate one
  batch from scenario context with no history. This is the persona's baseline set: ready
  before turn 1 (M4) and the fallback whenever in-turn generation misses.

### 5b. Phrases that fit what the learner just said (M8)

The timer loop can never see the current utterance, so add a second, faster path that
does:

- **In-turn speculative generation.** While the learner speaks, `user_input_transcribed`
  already streams the partial transcript (the interim reply consumes it). Once the learner
  has spoken ≥ `FILLER_INTURN_TRIGGER_MS` (start 2000 ms) and ≥ 4 words, fire **one**
  small-model call with the partial transcript, the last 4 turns and the character block
  from §5a, asking for 3 typed fillers that fit *this* utterance and presuppose nothing
  about how it ends. Synthesize through the cache; typical readiness is well inside the
  endpointing delay. Re-fire at most once more if the utterance runs past 8 s and the
  partial has changed materially. Cancelled on barge-in or pause.
- **Selection order at `thinking`:** in-turn batch → exchange batch (§5d) → seed batch →
  static Studio set. `fillerClipSource` records which was used.
- **Cheap post-check** before a phrase enters any pool: reject anything containing a
  question mark, more than 12 words, digits, or a proper noun / content word copied from
  the partial transcript (a filler that echoes specifics stops being non-committal).
- Cost is bounded: one small-model call per learner turn, which is fewer than the timer
  loop makes today, on a model an order of magnitude cheaper.

### 5c. Diversity that survives a long session (M5)

- **Accumulating pool, not a replacing batch.** Keep every accepted phrase for the
  session (bounded, e.g. 40), keyed by normalised text, with its type, tier, and
  `last_played_turn`. New batches add to the pool; nothing is thrown away just because
  a newer batch arrived.
- **Selection rules.** Never a phrase played within the last 6 turns while an alternative
  exists in the chosen tier; never the same *type* as the previous turn's filler when
  another type is available; prefer the phrase with the oldest `last_played_turn`.
- **Two renderings per phrase.** When a phrase is about to be played a second time in a
  session, synthesize a variant — punctuation change ("Hmm." / "Hmm…"), or a small
  speaking-rate change where the provider supports it — so no bit-identical waveform
  plays twice. Variants come from the cache once made.
- **Prompt-side.** `recent_fillers` grows from "recently played" to "everything in the
  pool", so the model is asked for genuinely new phrasing rather than near-rephrasings.

### 5d. 10x cheaper (M3)

- **Phrase → audio cache.** Key = (TTS provider, hash of the client's stored voice
  parameters, language, normalised phrase, variant). Value = the pre-decoded frame list.
  Process-local LRU (~200 clips ≈ 12 MB) shared by every session on the worker, plus an
  optional Redis tier (24 h TTL) **only for phrases that do not derive from a
  conversation** — the static set and the seed batch. Conversation-derived and in-turn
  phrases stay process-local; the prompt forbids specifics, but text generated from a
  session does not cross sessions.
- **Regenerate on exchanges, not on a clock.** Replace the 10 s timer with a trigger when
  the agent *finishes* speaking (`agent_state` → `listening`), skipped when the pool has
  ≥ 5 phrases unplayed in the last 6 turns, with an 8 s minimum gap. The call never
  overlaps the reply's LLM request — the contention the isolated client was built to
  hide.
- **Small dedicated model.** `PREDICTIVE_FILLER_MODEL_PROVIDER` /
  `PREDICTIVE_FILLER_MODEL` mirroring the interim reply's fast model; both the exchange
  batch and the in-turn call use it. Five short phrases do not need the roleplay model.
- **Batch size 8**, generated less often, with the type/length mix from §5a.

## 6. Phase 3 — earlier trigger (experimental, flag off; ≈ 3 days + A/B)

The largest gap the filler does not cover is the endpointing delay itself (0.5–3.0 s
between VAD end-of-speech and `thinking`). Behind `FILLER_EARLY_TRIGGER_ENABLED`
(default off), start a *micro-tier* filler at `user_state_changed(listening)` when the
semantic EOU model's delay is collapsing toward its minimum, cancelling with flush the
instant the learner resumes. A/B on English and Hindi (the EOU model's languages); watch
learner-resumed-during-filler rate, barge-in rate, and the `replyLatencyMs`
distribution. Product judgement: a hum during a mid-thought pause can read as
interruption. Needs Stacks and a PM before it goes past an experiment.

## 7. Phase 4 — cleanup and docs (≈ 1–2 days)

- Delete the temp-file paths in `filler_audio.py`, `cleanup_clips`, `pending_cleanup` and
  the shutdown WAV sweeps; back-channel and interim use the same in-memory clips.
- Demote `FILLER_MIN/MAX_DELAY_MS` to documented fallbacks.
- Update `docs/05-tts-providers.md` (clip isolation), `docs/architecture.md`, and the wiki
  repo page (`app/worker.py` is watched by `.docs-map.yml`; the PR carries a `Wiki-PR:`
  trailer). Update the `filler/predictive_filler` prompt's contract (its variables in `app/prompts/contracts.py`).
- ally-web: `fillerDecision` and `postFillerSilenceMs` on the voice-latency tab.

## 8. Success criteria

| Metric | Before (code defaults) | After | Factor |
|--------|------------------------|-------|--------|
| M1 lead time, p50 | ~450 ms | ≤ 40 ms | > 10x |
| M2 slow-turn coverage | ≤ ~50 % | ≥ 90 % | coverage |
| M3 TTS syntheses / session | ~5 per 10 s cycle | cache misses only | ≥ 10x on a warm worker |
| M3 predictive LLM spend / session | roleplay model, ≤ 6 calls/min | small model, ≤ 1 in-turn + ~1 per exchange with skips | ≥ 10x |
| M4 time to first usable clip | ≥ 10 s after first exchange | before turn 1 | — |
| M5 exact repeat within 6 turns | common with ≤ 5 clips | 0 | — |
| M5 identical waveform replayed | every repeat | 0 | — |
| M6 post-filler silence, p95 | unbounded (clip length ignored) | ≤ 800 ms | — |
| M6 "filler then gap" turns | unmeasured, structurally frequent | ≤ 5 % | — |
| M7 character-fit judge | unmeasured; prompt persona-blind | ≥ 4/5, 0 out-of-register | — |
| M8 fillers generated in-turn | 0 % | ≥ 70 % | — |
| Temp files / session | dozens | 0 | — |

The plan fails if the Phase 0 bench does not show the M1 and M3 factors, and the judge
does not show M7/M8 movement, on English and at least one Indic language.

## 9. Risks

- **Wrong gap prediction.** Watched by `fillerCutEarlyMs` and `postFillerSilenceMs`;
  stop-and-flush prevents overlap; the tier margin and threshold are tunable.
- **Continuation reads as stalling.** Bounded to two fillers per turn and different types;
  the judge's *repetitive* flag and the Stacks check decide the numbers.
- **In-turn generation on a wrong partial.** The prompt forbids presupposing the ending
  and the post-check rejects echoes; the judge's *non-committal* pass/fail measures it.
  Same PHI posture as the interim reply, which already sends partials to the fast model.
- **Cache key misses a voice parameter.** Hash all stored TTS params, add a test per
  provider. A clip in the wrong voice is worse than silence.
- **Memory.** Bounded LRU and pool; a typical 1 s filler is ~96 KB of PCM.
- **Interim ordering.** Event-based hand-off changes sequencing; cover in
  `tests/unit/test_interim_reply.py`.
- **Provider differences per language.** Variant rendering (rate/punctuation) behaves
  differently on Sarvam vs ElevenLabs; verify on a real device per language.

## 10. Files this touches

`app/worker.py` (filler handlers, pool + tiers, continuation, in-turn trigger, predictive
loop, interim chain, deferred setup) · `app/core/livekit/filler_clips.py` (in-memory
clips, cache, variants) · `app/core/livekit/predictive_filler.py` (typed output, persona
block, in-turn call, post-check) · `app/prompts/filler/predictive_filler.txt` +
`_meta` · `app/core/config.py` (new settings) · `app/core/metrics/turn_metrics.py`
(filler record) · `app/v2v_tester/` (bench) · ally-ai `language_quality` (filler rubric)
· `tests/unit/test_filler_clips.py`, `test_interim_reply.py`, `test_worker.py` ·
`docs/05-tts-providers.md`, `docs/architecture.md` · ally-be/ally-web analytics.
