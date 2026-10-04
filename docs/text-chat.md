# Text-Chat Roleplays

**Purpose.** How a roleplay runs when the learner types instead of speaking — built to train
staff on text-based mental-health helplines. Read this before touching anything that branches
on `Scenario.is_text_chat`.

---

## What it is

A text-chat roleplay is the **same session** as a voice one, with the audio pipeline taken out.
Dispatch, room metadata, the persona graph, events, guardrails, behaviours, ScoreKeeper, the
transcript sent to Core over SQS, termination and the `end-of-session` score are all shared.
Nothing new is stateful: the session still lives in one worker job, keyed by its LiveKit room.

| | Voice | Text chat |
|---|---|---|
| Learner input | mic → STT → turn detection | text stream on `lk.chat` → `text_input_cb` |
| Persona output | LLM → TTS → audio track | text stream on `lk.transcription` (one per reply) |
| `AgentSession` | STT, TTS, VAD, turn detector | none of them; `user_away_timeout=None` |
| Comfort audio, fillers, back-channel, interim reply, opener clips | per their own flags | off (`_setup_background_audio` is skipped) |
| Audio-tag guidance (ElevenLabs v3) | when the TTS supports it | off (no TTS client) |
| Noise cancellation, video actor | per their own gates | off |
| COHERENCE guardrails (STT repair) | authored + platform default | **dropped** — a typed message is what the learner meant |
| Pause | when `pauseEnabled` | ignored (it gates audio I/O; the chat client has no pause) |
| Opening statement, termination message, LLM-timeout line | spoken | sent as text, same code path (`session.say`) |

## How a session becomes text

ally-be adds `interactionMode: "TEXT"` to the room-metadata envelope's `scenario` section, and
only for a text session — a voice envelope carries no key at all. `parse_interaction_mode`
(`app/core/scenario/interaction_mode.py`) is lenient: anything but an explicit `TEXT` is VOICE.

ally-be allows a TEXT start only when the learner's org has the `TEXT_CHAT_ROLEPLAY_ENABLED`
preference on **and** the scenario's `metadata.textChatEnabled` is true; admin previews may run
as TEXT regardless. Everything is off by default.

## Input handling

`text_chat_input_cb` (`app/core/livekit/text_chat.py`) replaces LiveKit's default callback, which
interrupts the agent first. In a chat that would cut a reply off half-written, so a message that
lands while a reply is being written queues behind it instead. Blank messages are ignored and
messages are capped at `TEXT_CHAT_MAX_MESSAGE_CHARS` (2000, matching the client composer).

## Persona style

The main-agent prompts are written for a call ("how you speak", filler words) and are
curator-owned in prompt management, so they are not forked per mode. Instead, `generate_response`
appends **`system/text_chat_guidance`** (prompt code `ally_ai_learn_system_text_chat_guidance`)
for a text session only: short messages, no stage directions or bracketed actions, no markdown,
hesitation shown in words. It is synced to ally-be like every other prompt, so it can be edited
from the admin dashboard's Prompt Management with a dashboard override, no deploy needed.

## Key source files

- `app/core/scenario/interaction_mode.py` — constants and the lenient parser
- `app/core/scenario/base.py` — `Scenario.interaction_mode`, `is_text_chat`, COHERENCE skip
- `app/core/livekit/text_chat.py` — room options and the input callback
- `app/worker.py` — `_is_text_chat` branches in `configure`, `_create_session`, `start`, `_pause_impl`
- `app/core/graph/nodes.py`, `app/core/graph/prompt.py` — guidance resolution and append
- `app/prompts/system/text_chat_guidance.txt` — the default guidance
