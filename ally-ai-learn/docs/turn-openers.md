# Turn openers: the delivery plan

What the learner hears before each reply: a pause, a filler ("hmm…", "um…", a
breath), and the **interim** (a few holding words like "It's just that…"), then
the reply itself. This replaced the LLM-generated thinking filler
(`DELIVERY_PLAN_ENABLED`, default on; `False` restores the old filler path, which
plays no interim).

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

And in 2026-10 (prod 10-03 → 10-12, plus learner reports): a filler, then a
separately generated sentence, then the reply on 13% of turns felt scripted; the
reply never learned the interim's words; a sentence-length interim made learners
answer it and cut off the real reply; and the rules overrode working memory's
choice of sound on ~60% of turns (a "pause" plan played a sound 16 of 16 times).

## How it works

```
character finishes speaking
  └─ graph: publish_done_thinking ─ update_working_memory
        (WM scenarios: ProposedUpdate.delivery → DeliveryPlan → TurnDelivery)

learner is speaking (scenarios WITHOUT working memory, interimReplyEnabled on)
  └─ worker: interim generator writes one line from the partial transcript
        → OpenerPlayer.set_live_interim

learner finishes → agent "thinking"
  └─ worker: OpenerPlayer asks OpenerPolicy → decision recorded on TurnDelivery
        ├─ pause → [filler] → [interim piece] → [piece] … (learner speech cancels)
        └─ graph: generate_response reads TurnDelivery.reply_note
             → names the filler, QUOTES the interim, "continue straight on from it"
  └─ agent llm_node: trim a restated filler/interim; cap v3 tags at 1
  └─ real reply starts → everything still playing is cut
```

- **The plan** (`app/core/livekit/delivery.py`) is proposed off the reply path by
  the working-memory updater, validated in code (unknown catalog ids dropped; the
  interim's 1-3 pieces capped, safety-checked and de-duplicated against the
  character's recent lines — a failed piece ends the interim there), and used on
  the NEXT turn. Scenarios without working memory keep `DEFAULT_PLAN`: no planner
  call, fillers rotated by kind, and pauses.
- **The interim** has one source per scenario. Working memory writes it into the
  plan (`interim` field of the updater prompt), as short pieces that run on from
  each other, each rendered as its own clip so the turn can stop after any of
  them. Without working memory the separate interim generator
  (`interim_reply.py`, prompt `filler/interim_reply`) writes one line while the
  learner speaks; if it is still rendering when the turn's decision is made it
  can still play after the filler when the wait leaves room. Either way the
  player plays it — it is never chained as a second holding sentence.
- **The catalog** (`app/core/livekit/opener_catalog.json`,
  `opener_catalog.py`) is curated per language in native script, tagged by
  `kind` (state fit) and `family` (repeat detection). Studio `allowedFillers`
  are added as lexical entries. Rendered once per voice and cached worker-wide.
  `breath` plays bundled audio from `app/assets/openers/`.
- **The predicted wait** (`gap_predictor.py`) is learned from each turn's
  measured wait, from the agent starting to think to the reply's first audio.
  The earlier estimate (LLM time-to-first-token + TTS time-to-first-byte) read
  ~0.8x the real wait in prod V2V, so no interim piece ever fit; it is only the
  starting point until the first measured turn.
- **The policy** (`opener_policy.py`) is pure and deterministic:
  - **pause first** — a randomised `OPENER_HOLD_*`, and a real pause
    (`OPENER_LONG_HOLD_*`, 1.2-2 s) when the plan says one fits;
  - **one filler at most, the plan's own** — its ids in order, then its kind;
    when every family of that kind was heard recently it stays with the kind and
    takes the least recent, never the one just played; a breath at most once
    per `OPENER_BODY_MIN_GAP_TURNS`; no family repeated inside
    `OPENER_REPEAT_WINDOW`;
  - **then the interim, piece by piece, while the wait lasts** — the gap before
    piece *k* is `OPENER_PIECE_GAP_MS · OPENER_PIECE_GAP_GROWTHᵏ` (0.35, 0.49,
    0.69 s…), a piece plays only if it ends `OPENER_TAIL_MS` before the predicted
    reply, speech never exceeds `OPENER_MAX_SPEECH_SHARE` of the wait, and at
    most `OPENER_MAX_INTERIM_PIECES` play;
  - nothing when the learner's words read as unfinished, when they are saying
    goodbye, or on a predicted-fast turn.

  So a short wait gets nothing, a medium one a pause and a filler, and a long
  one (ElevenLabs v3, 6-8 s) a filler and two or three pieces.
- **The player** (`opener_player.py`) plays on the shared background-audio
  track, cancels and flushes on any learner speech, is cut the moment the real
  reply starts, and records one transcript line for the interim as far as it got.
- **Reply shaping** (`reply_shaping.py`, in `GlossarySwapAgent.llm_node`):
  `LeadingHesitationTrimmer` (also strips a restated interim) and
  `AudioTagLimiter` (`AUDIO_TAG_MAX_PER_REPLY`). The interim's first piece loses
  a leading hesitation and any "I see…"-style claim before it is rendered.

## Reading it in metrics

Per turn (`scenario_session_turn_metrics.metadata`): `fillerDecision`
(`played`, `skipped_policy`, `skipped_learner_unfinished`, `skipped_closing`,
`cancelled_before_play`, `skipped_same_reply`, …), `openerCategory`, `openerId`,
`openerHoldMs`, `openerPlanSource`, `openerCancelledByLearner`,
`postFillerSilenceMs`, and for the interim `interimPiecesPlanned`,
`interimPiecesRendered`, `interimPiecesScheduled`, `interimPiecesPlayed` and
`cuesPlayed` (everything heard before the reply). Stored values kept for ally-be's
analytics split: `openerBridge` is true when an interim followed a filler, and
`interimSource` is `bridge` (written by working memory) or `legacy` (the interim
generator) on interim-first turns. Per session: the `[OPENER] session totals`
log line.

## Cost

Working-memory scenarios: no extra call (one more field on the updater's
existing output), plus one clip render per interim piece. Others: no planner
call; the interim generator (`interim_reply`) runs only where it is enabled.
Catalog clips are mostly cache hits after the first session on a worker.
