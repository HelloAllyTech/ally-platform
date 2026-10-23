# Ally guide voice worker

**Purpose.** How the Ally guide's voice sessions work on this side: what the worker does, what
it never does, the browser-facing protocol, and how to run and deploy it.

---

## What it is

A second LiveKit worker in this repo, `app/guide_worker.py`, with its own deployment and agent
name. When a learner turns on voice in a guided course, ally-be creates a `guide-` room and
dispatches this worker into it by name.

**Speech in, speech out, nothing else.** Each final transcript is posted to ally-be, and the
reply that streams back is spoken. ally-be runs the whole turn: safety, course logic, the model.
The worker never calls a model, and never touches the roleplay agent's graph, persona or prompts.

```
learner mic ─► STT ─► GuideVoiceAgent.llm_node ──POST /api/v1/guide/voice/turns──► ally-be
                                 ▲                       (NDJSON: delta, card_hint,
learner ear ◄─ TTS ◄─────────────┘                        done | error)
```

| Piece | Where |
|---|---|
| Entry point, lifecycle, push-to-talk RPCs | `app/guide_worker.py` |
| ally-be client (session, turns, ended) | `app/core/guide/client.py` |
| NDJSON decoding | `app/core/guide/ndjson.py` |
| The relay (`llm_node`) and crisis pacing (`tts_node`) | `app/core/guide/agent.py` |
| Turn outcomes, retries, the slow-turn line | `app/core/guide/turns.py` |
| Barge-in bookkeeping (`interruptedTurnId`, `spokenChars`) | `app/core/guide/ledger.py` |
| STT, TTS and turn detection by language | `app/core/guide/speech.py` |
| Usage rows and the latency log line | `app/core/guide/usage.py` |
| Wire models (generated — never edit) | `app/core/guide/contract.py` |

## ally-be API

All under `{CORE_SERVICE_BASE_URL}/api/v1/guide/voice`, with `x-api-key: CORE_SERVICE_API_KEY`.
The dispatch's `voiceSessionToken` binds every call to one thread, learner and organisation. It
travels in the `x-guide-voice-session` header (or the turn body), never the URL path, which
reaches access logs.

| Call | Used for |
|---|---|
| `GET /session` | At startup: thread, room, language, turn mode. 401 → the session is over |
| `POST /turns` | One utterance. Streams NDJSON; closing the connection cancels the turn (barge-in) |
| `POST /session/ended` | On every way out, so the token stops working |

## What the learner hears

| ally-be says | Ally says |
|---|---|
| `start` | Nothing: it names the turn before any audio, for barge-in |
| `delta` | The text, as it arrives (`kind: "crisis"` — see Crisis) |
| `card_hint` | The hint, in line |
| `error: turn_in_progress` | Nothing (retried twice first, with a fresh `clientTurnId`) |
| `error: guide_disabled` | "Voice is off for now. You can keep going by typing." — then leaves. ally-be checks the voice switch on every turn, so flipping it ends open sessions |
| 401 (startup or any turn) | "This voice session has ended. You can keep going by typing." — then leaves |
| any other error, or unreachable | "Sorry, I lost that. Could you say it again?" |
| nothing for 8 s | "This one's taking me a moment…" (once; `GUIDE_SLOW_TURN_LINE_AFTER_S`) |
| unreachable at startup | "Voice isn't working right now. You can keep going by typing." — then leaves |

Ally does not speak first: the learner opened voice to talk. These lines are English in every
language until translated (`app/core/guide/lines.py`, same policy as `app/core/fallback_lines.py`).

## Barge-in

Hands-free: speaking over Ally interrupts her (LiveKit's own interruption handling). Every turn
stream opens with a `start` frame carrying the `turnId`. If ally-be is still streaming, the
worker closes the stream: ally-be cancels the turn but keeps what it had already sent as the
turn's reply (plain text, marked interrupted). Either way the next turn sends
`interruptedTurnId` and `spokenChars` — the characters of that reply's own text the learner
heard, taken from LiveKit's playout-synchronised transcript, card hints excluded — and ally-be
tells the model what was really heard. A reply cut off before any audio reports
`spokenChars: 0`.

## Push-to-talk

When the session's `turnMode` is `push_to_talk`, the worker uses LiveKit's manual turn
detection and registers three RPC methods on its participant. The browser calls them on the
agent participant with an empty payload:

| RPC | When | Effect |
|---|---|---|
| `start_turn` | Talk pressed | Interrupts Ally (the barge-in), opens the mic |
| `end_turn` | Talk released | Closes the mic, ends the turn (waits up to 10 s for the final transcript) |
| `cancel_turn` | Discard | Closes the mic, drops what was said |

The mode is fixed per session: switching needs a new voice session from ally-be.

## Language

| | Default | Override |
|---|---|---|
| STT | Google `chirp_2` (`DEFAULT_STT_CONFIG`), `<lang>-IN` | `GUIDE_STT_CONFIG` |
| TTS | Google Chirp 3 HD, speaker `GUIDE_TTS_GOOGLE_VOICE` (Kore) | `GUIDE_TTS_CONFIG` |
| Turn end | en, hi: semantic EOU model; others: VAD, `GUIDE_VAD_ENDPOINTING_DELAY` (1.2 s) | — |

The overrides are JSON objects keyed by base language or `default`, holding the provider config
shape scenario voices use, e.g. `{"hi": {"provider": "google", "config": {"voice_name": "hi-IN-Chirp3-HD-Aoede"}}}`.
Ally's default voice is a fixed speaker on purpose: a generative voice is redrawn per request,
and Ally would change voice between replies.

## Crisis

ally-be marks the fixed crisis message with `kind: "crisis"` on its `delta` frame, whatever the
copy (code default or clinically approved per tenant and language). The worker also still
recognises the code-default copy by text (mirrored in `app/core/guide/crisis.py`, held to ally-be
by a test) as a fallback. It speaks the message a sentence at a time, at `GUIDE_CRISIS_SPEAKING_RATE` where the voice supports a rate, with
`GUIDE_CRISIS_SENTENCE_PAUSE_S` between sentences. The session stays open. There is no filler or
back-channel layer in this worker at all, so nothing is ever spoken inside the message.

## Captions, usage, latency

- Captions: LiveKit's built-in `lk.transcription` (learner and Ally). Typed text never goes
  through the room; it uses ally-be's HTTP API.
- Usage: STT and TTS rows on the `llm_usage` message, tasks `guide_voice_stt` /
  `guide_voice_tts`, `metadata.guideThreadId`.
- Latency: one `[GUIDE_LATENCY] response_latency_ms=…` log line per turn (end of speech → first
  audio), and one `[GUIDE_TURN]` line with ally-be's time to first frame and the trace id sent as
  `traceparent`.

## Running it

```bash
python -m app.download_files              # once (VAD and the EOU model)
python -m app.guide_worker dev            # local; registers as ${AGENT_NAME}Guide
```

It needs ally-be with the guide module running at `CORE_SERVICE_BASE_URL`, and the same LiveKit
credentials as the roleplay worker. Gotcha: with `ENV=LOCAL` the **roleplay** worker registers
with an empty agent name, which makes LiveKit auto-dispatch it into every room — `guide-` rooms
included. Use `ENV=DEV` for the roleplay worker while testing voice locally.

Deployed: same image as learn-core, command `./start-guide.sh` (uvicorn for `/api/health` plus
the guide worker). Give the service its own `GUIDE_ECS_METRICS_SERVICE` dimension (default
`ally-prd-svc-learn-guide`) so guide sessions never drive the roleplay fleet's autoscaling.
