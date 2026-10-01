# Turn openers: the delivery plan

What the learner hears FIRST on each turn: a hum, a hesitation, a breath or sigh,
a short bridging line, or simply the reply after a pause. This replaced the
LLM-generated thinking filler (`DELIVERY_PLAN_ENABLED`, default on; `False`
restores the old path exactly).

## Why it changed

Measured in prod, 2026-08-30 → 09-28 (1,771 turns / 229 sessions):

| Problem | Measured |
|---|---|
| Filler too short for the gap | Median real gap 3.1 s vs 0.98 s clips; 97.6% of filler turns left > 1 s dead air. The gap predictor folded LLM TTFT and TTS TTFB in as separate samples, predicting ~0.39× the real gap. |
| Talked over the learner | ~30% of filler turns started while the learner was still mid-turn |
| Stacked fillers | 67% of filler turns played two, ~0.5 s apart |
| Repetitive, off-language | 101 distinct phrases platform-wide; 62% bare hums; English "uh/um" in hi/mr sessions; no breaths or sighs |
| Disconnected from the reply | The reply never knew a filler played: 19 of 43 sampled turns were a double hesitation |
| Performative v3 tags | 41% of v3 replies carried 2+ audio tags |

## How it works

```
character finishes speaking
  └─ graph: publish_done_thinking ─┬─ update_working_memory  (WM scenarios: ProposedUpdate.delivery)
                                   └─ plan_delivery          (others: small-model planner)
                                          └─ DeliveryPlan → TurnDelivery (worker-owned)

learner finishes the next turn → agent "thinking"
  └─ worker: OpenerPlayer asks OpenerPolicy → decision recorded on TurnDelivery
        ├─ hold (randomised; learner speech cancels) → catalog clip → pause → [bridge line]
        └─ graph: generate_response reads TurnDelivery.reply_note → "you already said 'um…'"
  └─ agent llm_node: trim a leading hesitation if an opener played; cap v3 tags at 1
```

- **The plan** (`app/core/livekit/delivery.py`) is proposed off the reply path by
  whichever planner knows the character's state, validated in code (unknown
  catalog ids dropped, the bridge line capped and safety-checked), and used on
  the NEXT turn. It fits the character's state, not the learner's next words —
  that is the deliberate trade for adding nothing to the reply path.
- **The catalog** (`app/core/livekit/opener_catalog.json`,
  `opener_catalog.py`) is curated per language in native script, tagged by
  `kind` (state fit) and `family` (repeat detection). Studio `allowedFillers`
  are added as lexical entries. Rendered once per voice and cached worker-wide.
  `breath`/`sigh` entries play bundled audio from `app/assets/openers/` and are
  skipped until those files are shipped.
- **The policy** (`opener_policy.py`) is pure and deterministic, and is where
  the naturalness rubric lives: first sound varies across turns (nothing /
  vocal / body / bridge), at most `OPENER_MAX_VOCAL_RUN` vocal turns in a row,
  one opener per turn with an `OPENER_POST_PAUSE_MS` thinking beat after it, no
  sound family repeated inside `OPENER_REPEAT_WINDOW`, a randomised
  `OPENER_HOLD_*` before the sound (longer when the plan says a pause fits),
  and nothing when the learner's words read as unfinished, when they are saying
  goodbye, or on a predicted-fast turn.
- **The player** (`opener_player.py`) plays on the shared background-audio
  track, cancels and flushes on any learner speech, and is cut the moment the
  real reply starts.
- **Reply shaping** (`reply_shaping.py`, in `GlossarySwapAgent.llm_node`):
  `LeadingHesitationTrimmer` and `AudioTagLimiter` (`AUDIO_TAG_MAX_PER_REPLY`).

## First prod day (v1.48.0 → v1.48.2)

The first read (38 new-path turns, 5 sessions) confirmed the stacking, repeat
and echo fixes, and showed four problems that v1.48.2 fixes:

- **Silence on long waits.** Turns where the policy chose nothing left the
  learner in p50 5.7 s of silence. At or above `OPENER_MAX_SILENT_GAP_MS`
  (3 s predicted) silence is no longer an option; the vocal-run cap still
  applies, and breath/sigh break a run of vocal openers.
- **A withdrawn opener blocked the turn.** The one-opener-per-reply rule now
  counts only an opener that actually played; a learner speaking during the
  hold records `cancelled_before_play`, and a second pause after a heard
  opener records `skipped_same_reply`.
- **The plan was followed loosely.** The planned category now weighs 0.6 against
  0.12 for the others (last turn's category ×0.4 for variety).
- **ElevenLabs 429 bursts** from rendering a 24-entry catalog at once; clip
  synthesis is bounded by `CLIP_SYNTH_CONCURRENCY` (3).

## Reading it in metrics

Per turn (`scenario_session_turn_metrics.metadata`): `fillerDecision` (now also
`skipped_policy`, `skipped_learner_unfinished`, `skipped_closing`,
`cancelled_before_play`, `skipped_same_reply`), `openerCategory`, `openerId`, `openerHoldMs`,
`openerBridge`, `openerPlanSource`, `openerCancelledByLearner`, and
`postFillerSilenceMs` — the silence between the opener ending and the reply
starting. Per session: the `[OPENER] session totals` log line.

## Cost

Working-memory scenarios: no extra call (one more field on the updater's
existing output). Others: one small-model call per character turn, recorded as
`thinking_filler` (it replaces the filler generator in that bucket). Catalog
clips are mostly cache hits after the first session on a worker.
