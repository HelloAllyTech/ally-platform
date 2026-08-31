# TTS Providers

**Purpose.** This document describes the TTS provider abstraction layer, the `BaseTTSClient` interface, the five supported providers, and the factory that instantiates them.

---

## Overview

TTS (Text-to-Speech) converts the AI client's text responses into audio. The system supports five providers, each implemented as a subclass of `BaseTTSClient`. The factory selects the provider based on scenario metadata.

## BaseTTSClient Interface

**File:** `app/tts/base.py`

```python
class BaseTTSClient(ABC):
    _current_params: Dict[str, Any]
    _default_params: Dict[str, Any]

    @property
    @abstractmethod
    def tts_instance(self): ...

    def get_parameter_metadata(self) -> Dict[str, Any]: ...
    def get_tools(self) -> List[BaseTool]: ...
    def get_text_enhancement_instructions(self) -> Optional[str]: ...
    def get_defaults_for_learn_service(self) -> dict: ...
    def _validate_parameters_dict(self, params_dict) -> Dict[str, Any]: ...
    def _apply_parameters_dict(self, params_dict) -> None: ...
```

### Key Methods

| Method | Description |
|--------|-------------|
| `tts_instance` | Returns the underlying LiveKit TTS plugin instance |
| `get_parameter_metadata()` | Returns `PARAMETER_METADATA` class constant (voice parameter names, types, ranges) |
| `get_text_enhancement_instructions()` | Returns `TEXT_ENHANCEMENT_METADATA` instructions (e.g., SSML rules) |
| `_validate_parameters_dict()` | Validates parameters against metadata (type checking, range clamping) |
| `_apply_parameters_dict()` | Applies parameters to TTS instance via `update_options()` |

### Voice Expression Support

Providers optionally define two class constants:

- **`PARAMETER_METADATA`** -- dict describing available voice parameters (speed, pitch, etc.) with types, ranges, and defaults
- **`TEXT_ENHANCEMENT_METADATA`** -- dict with `instructions` key describing provider-specific text markup (SSML, audio tags, etc.)

`TEXT_ENHANCEMENT_METADATA` (via `supports_text_enhancement()`) drives inline audio-tag generation for v3 ElevenLabs voices in `generate_response`. `PARAMETER_METADATA` is retained on the clients but is no longer actively consumed — the voice-parameter generation pipeline has been removed.

## Supported Providers

| Provider | Class | Enum | Voice Parameters | Text Enhancement |
|----------|-------|------|-------------------|-----------------|
| Deepgram | `DeepgramTTSClient` | `TTSProvider.DEEPGRAM` | No | No |
| ElevenLabs | `ElevenLabsTTSClient` | `TTSProvider.ELEVENLABS` | Yes (speed, stability, similarity_boost, style) | Yes (SSML-like tags) |
| Sarvam | `SarvamTTSClient` | `TTSProvider.SARVAM` | No | No |
| Google Cloud | `GoogleTTSClient` | `TTSProvider.GOOGLE` | Yes (speed, pitch, volume_gain_db) | No |
| Hume | `HumeTTSClient` | `TTSProvider.HUME` | Yes (speed, description) | No |

### Provider Details

**Deepgram** -- Default TTS provider. Low latency, no voice parameters. Uses `model` for voice selection. Falls back to gender-based default voices.

**ElevenLabs** -- High-quality voices with expressive parameters. Supports voice ID-based selection, speed control, and SSML-like text enhancement for emphasis and pauses.

**Sarvam** -- Specialized for Indian languages. Uses `speaker` for voice selection.

**Google Cloud** -- Uses `voice_name` and `gender` for voice selection. Supports voice cloning via `voice_cloning_key`. Voice parameters only (no SSML) when streaming is enabled.

**Hume** -- Emotion-aware TTS. Uses `voice_id` with optional `voice_provider` (HUME_AI for pre-existing, CUSTOM_VOICE for custom). Supports `instant_mode` for lower latency. Voice parameters include a text `description` of desired emotional expression.

## Factory

**File:** `app/tts/factory.py`

`create_tts_client(tts_config, language_code, gender)` creates a client:

1. If `tts_config` is `None`, returns a default Deepgram client based on `gender`
2. Reads `provider` from config
3. Reads `config` dict from config (provider-specific settings)
4. Calls `<Provider>TTSClient.from_config(config, language_code)` to instantiate
5. Falls back to default Deepgram on error

Config structure from metadata:
```json
{
  "provider": "elevenlabs",
  "name": "Voice Name",
  "config": {
    "model": "eleven_turbo_v2",
    "voice_id": "abc123"
  }
}
```

### Constructor validation is structural only

`DeepgramTTSClient`, `ElevenLabsTTSClient`, and `SarvamTTSClient.__init__` only
check that required fields (`model`, `voice_id`/`speaker`) are non-empty. They
do **not** make a live API call to confirm the value is genuinely valid — an
earlier version did, via each provider's own `validate_voice()` (still present
as a static method, still unit-tested, just no longer called from `__init__`).

That live check was removed because it ran on every single session start —
including Sarvam's via the same one-shot `text_to_speech.convert()` endpoint
called out as flaky below — and any transient failure (network blip, rate
limit, timeout) was silently swallowed by `create_tts_client`'s fallback,
which produced a session speaking a hardcoded English Deepgram voice instead
of the requested (often non-English) one, with only a log warning. A
genuinely invalid `model`/`voice_id`/`speaker` now fails at actual synthesis
time instead, where the existing timeout/retry handling already applies.
Google's and Hume's clients already validated structurally only.

## Default Voice Selection

When no TTS config is provided, the factory selects a Deepgram voice based on the persona's gender:

| Gender | Setting |
|--------|---------|
| Male | `DEFAULT_MALE_VOICE_MODEL` |
| Female | `DEFAULT_FEMALE_VOICE_MODEL` |
| Non-binary | `DEFAULT_NON_BINARY_VOICE_MODEL` |

---

## Clip synthesis isolation (`create_clip_tts`)

Offline clip rendering (thinking fillers, backchannels, interim replies) must
NEVER run on the AgentSession's own TTS instance: the session subscribes to
that instance's error events and closes the whole session after a few
unrecoverable ones. In production (2026-08-20) Sarvam's broken one-shot
`synthesize()` (libav `InvalidDataError`, zero frames) emitted enough TTSErrors
during clip rendering to kill live Marathi sessions mid-reply.

`BaseTTSClient.create_clip_tts()` returns a SEPARATE underlying instance for
clip work (a shallow clone with the lazily-cached instance cleared — every
provider client builds `tts_instance` lazily, so the clone rebuilds fresh). If
isolation is impossible it returns `None` and callers skip clip synthesis
entirely — silence is strictly better than a dead session. `filler_audio`
additionally falls back from `synthesize()` to the websocket `stream()` path
per phrase, which is the route the live agent speaks through and works where
Sarvam's one-shot endpoint is broken.

`filler_audio` also lowercases a phrase that arrives fully ALL-CAPS before
synthesis: several TTS providers treat a fully-uppercase token as an acronym
and spell it out letter by letter (an "MMM" hesitation heard as "M, M, M"
instead of a hum) even for plain English text.

## Isolated synthesis failures (`_register_tts_error_fallback`)

**File:** `app/worker.py`

LiveKit tees a reply's text stream into two independent consumers: one
synthesizes audio, the other commits the text to the transcript unconditionally.
A single TTS failure (after the plugin's own retries are exhausted) is swallowed
by `wait_if_not_interrupted`'s `asyncio.gather(..., return_exceptions=True)` — the
transcript still commits, but no audio plays. `AgentSession._on_error` only
closes the session after four *consecutive* unrecoverable TTS errors, resetting
that count on the next successful "speaking" state, so an isolated failure never
closes the session and never surfaces beyond one log line. Reported from a
course roleplay: the actor went silent for one turn, its dialogue still showed
up in the transcript, and the rest of the session carried on normally.

`AgentWorker._register_tts_error_fallback()` listens on the same TTS instance's
`"error"` event `_on_error` above does. On an unrecoverable error it speaks
`tts_failure_fallback_line()` (the LLM-timeout fallback line reused, since the
learner's situation — silence after saying something — is identical) and
publishes a non-fatal `session-fault`, throttled to one recovery per
`TTS_FAILURE_FALLBACK_COOLDOWN_S` so a provider outage cannot turn into a burst
of failing `say()` calls that push the session toward the four-in-a-row close
threshold above. It cannot re-speak the lost line itself — `TTSError` carries
only a label and the exception, never the failed text.

---

## Key Source Files

- `app/tts/base.py` -- `BaseTTSClient`
- `app/tts/factory.py` -- `create_tts_client()`
- `app/tts/deepgram.py` -- `DeepgramTTSClient`
- `app/tts/elevenlabs.py` -- `ElevenLabsTTSClient`
- `app/tts/sarvam.py` -- `SarvamTTSClient`
- `app/tts/google.py` -- `GoogleTTSClient`
- `app/tts/hume.py` -- `HumeTTSClient`
- `app/core/constants.py` -- `TTSProvider` enum
