# TTS Providers

**Purpose.** This document describes the TTS provider abstraction layer, the `BaseTTSClient` interface, the seven supported providers, and the factory that instantiates them.

---

## Overview

TTS (Text-to-Speech) converts the AI client's text responses into audio. The system supports seven providers, each implemented as a subclass of `BaseTTSClient`. The factory selects the provider based on scenario metadata.

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
    def allows_clip_synthesis(self) -> bool: ...   # clip policy, fails closed
    def can_create_clip_tts(self) -> bool: ...
    def create_clip_tts(self): ...                  # isolated instance or None
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
| Cartesia | `CartesiaTTSClient` | `TTSProvider.CARTESIA` | No | No |
| Smallest.ai | `SmallestAITTSClient` | `TTSProvider.SMALLESTAI` | No | No |

### Provider Details

**Deepgram** -- Default TTS provider. Low latency, no voice parameters. Uses `model` for voice selection. Falls back to gender-based default voices.

**ElevenLabs** -- High-quality voices with expressive parameters. Supports voice ID-based selection, speed control, and SSML-like text enhancement for emphasis and pauses.
  Model families split by transport: `flash`, `turbo` and `multilingual_v2` stream over
  the plugin's text-to-speech multi-stream-input WebSocket; the generative **v3 and v4**
  families (`eleven_v3`, `eleven_v3_conversational`, `eleven_v4`, `eleven_v4_turbo`) are
  rejected on that socket (verified live 2026-10-14), so the client wraps them in
  `StreamAdapter` over HTTP `/stream` with fixed stability (0.95) and enables inline audio
  tags. Detection is `ElevenLabsTTSClient.GENERATIVE_MODEL_MARKERS` (`"v3"`, `"v4"`), and
  the worker's generative-voice interim/gap timing keys off the same families. The
  Voices admin lists the live model ids from ElevenLabs' `/models` endpoint.
  **v4 loudness:** v4 renders 6.6-10.4 dB quieter than v3 for the same voice (speech RMS
  -24..-28 dBFS vs -14..-19, measured 2026-10-14 on five voices) and the API has no loudness
  control, so v4-family instances are wrapped in `app/tts/gain.py::GainTTS` with
  `settings.ELEVENLABS_V4_GAIN_DB` (default +8 dB). Its limiter caps the boost at
  `min(gain, 32000 / running_peak)`, so nothing clips and the gain only steps down within a
  synthesis; clips built by `create_clip_tts` inherit the same wrapper. Set the setting to 0
  to disable.

**Sarvam** -- Specialized for Indian languages. Uses `speaker` for voice selection.

Two Sarvam traps, both handled in `app/tts/sarvam.py`:
- **The configured `model` must be passed to `sarvam.TTS`.** Omitted, the plugin uses its own default
  (`bulbul:v2`), which Sarvam has retired (400 "has been deprecated"). v3 shares none of v2's
  speakers; prod voices were remapped by ally-be migration `1973600000000`. Don't call the plugin's
  `update_options(model=…)` — 1.3.12 rejects anything but v2 there.
- **Stale pooled WebSockets.** The plugin reuses one socket per instance for up to an hour, but
  Sarvam drops idle sockets after ~30-45 s while aiohttp still reports `closed=False`. Unguarded,
  the first synthesis of nearly every turn failed with "Cannot write to closing transport" and
  only worked on the plugin's retry. `guard_stale_websockets` makes the pool discard a socket whose
  transport is gone before reusing it.

**Google Cloud** -- Uses `voice_name` and `gender` for voice selection. Supports voice cloning via `voice_cloning_key`. Voice parameters only (no SSML) when streaming is enabled.

**Hume** -- Emotion-aware TTS. Uses `voice_id` with optional `voice_provider` (HUME_AI for pre-existing, CUSTOM_VOICE for custom). Supports `instant_mode` for lower latency. Voice parameters include a text `description` of desired emotional expression.

**Cartesia** -- Uses `voice` (a Cartesia voice-library UUID) for voice selection, `model` (default `sonic-3`). Keeps a single WebSocket open and reuses it across turns instead of reconnecting per synthesis.

**Smallest.ai** -- Uses `voice_id` for voice selection, `model` (default `lightning_v3.1_pro`). Broad Indian-language coverage (Hindi plus 9 Indian languages with code-switching on the Pro model).

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
entirely — silence is strictly better than a dead session. `filler_clips`
additionally falls back from `synthesize()` to the websocket `stream()` path
per phrase, which is the route the live agent speaks through and works where
Sarvam's one-shot endpoint is broken.

Every provider client must call `super().__init__()`. Four of them (ElevenLabs,
Sarvam, Deepgram, Google) did not, so `_current_params` was missing,
`create_clip_tts()` raised, swallowed it and returned `None`, and every filler,
back-channel and interim clip was skipped for those providers from v1.45.0
(d35bb31) while the LLM calls that wrote the phrases still ran.
`create_clip_tts()` now reads the parameters defensively, logs a failure at
WARNING with the traceback, and closes any instance it built before failing.
`tests/unit/test_tts_clip_real_clients.py` checks all of this against the real
clients built by the factory, not a stub.

## Clip policy (`allows_clip_synthesis`)

Each clip is an independent generation on a separate TTS instance, played on the
background track just before the reply. For a fixed-speaker voice that is the
same voice. For a generative model each request is a new draw of the speaker, so
the clip sounds like a second voice speaking just before the character.
`BaseTTSClient.allows_clip_synthesis()` decides which voices may have clips. It
**fails closed**: the base returns `False` and a client opts in only for the
configs known to keep one speaker across generations.

| Provider | Clips | Configs |
|---|---|---|
| Deepgram | on | all (Aura) |
| ElevenLabs | on | `flash`, `turbo`, `multilingual_v2` models |
| ElevenLabs | on | `v3`/`v4` models (`eleven_v3`, `eleven_v3_conversational`, `eleven_v4`, `eleven_v4_turbo`) — see below |
| Sarvam | on | `bulbul:v2` |
| Sarvam | **off** | `bulbul:v3` and any other model (unclassified; v3 samples at temperature 0.6) |
| Google | on | Chirp 3 HD voices (`xx-XX-Chirp3-HD-<Name>`) |
| Google | **off** | Gemini-TTS (bare names like `Kore`, empty `voice_name`, `model_name` `gemini-*`); Standard/Neural2/WaveNet/cloned (unclassified) |
| Cartesia | on | all |
| Hume | **off** | all (Octave is generative) |
| Smallest.ai | **off** | all (unclassified) |

When the policy refuses a voice, `create_clip_tts()` returns `None` and logs
`[CLIP_TTS] clips off for this session: reason=generative_voice` once, at INFO.
Callers check `can_create_clip_tts()` (via `filler_clips.clip_tts_available`)
**before** the filler, back-channel and interim LLM calls, because those phrases
can only be heard as clips. The worker (`_setup_background_audio`) turns all
three layers off for such a voice; it may still play the bundled breath/sigh
opener recordings, which are not a generation of the voice. The comfort tone
still plays.

**Why ElevenLabs v3/v4 is on.** v3 and v4 are generative, but the live reply on them is
already one independent generation per sentence (`StreamAdapter` over the HTTP
path), held to one speaker by the fixed voice settings in `tts_instance`
(stability 0.95, similarity 0.75). A clip from `create_clip_tts()` has the same
voice id, model and settings, so it is one more such sentence, not a second
voice. Rendering a v3 voice's clips on a *different* model (flash /
multilingual_v2) would be a second voice and is never done. Enabling clips for a new model means
changing its row here and in the test's `CASES` table. That is a product
decision about voice continuity, not a code cleanup.

`filler_clips` also lowercases a phrase that arrives fully ALL-CAPS before
synthesis: several TTS providers treat a fully-uppercase token as an acronym
and spell it out letter by letter (an "MMM" hesitation heard as "M, M, M"
instead of a hum) even for plain English text.

## Persistent clip store (`clip_store`)

**File:** `app/core/livekit/clip_store.py`. Off unless `CLIP_STORE_BUCKET` is set.

The process cache below dies with its worker, and in prod every session began
with it empty (session totals showed `cache_size == cache_misses`), so each one
re-rendered its catalog. The store keeps rendered clips in S3 at
`{CLIP_STORE_PREFIX}/{voice fingerprint}/{language}/{text hash}/take-NN.pcm`
(raw 48 kHz mono int16). `synthesize_clips` serves cache misses from it before
rendering, bounded by `CLIP_STORE_TIMEOUT_MS`, and saves a fresh render as
take 0 in the background. Bridge lines (`use_cache=False`) never touch it.

`scripts/pregenerate_voice_clips.py` fills it ahead of time with curated takes:
several renders per catalog line, ranked by speaker similarity to the voice's
reply (WeSpeaker ONNX embeddings, weighted by the line's length) and by how
typical each take's length and loudness are; the best three are written as
take-00..02. `OpenerPlayer` plays the best first and rotates through the rest.
The voice fingerprint ignores the lazily built instance and the API key, so a
key rotation does not orphan the store.

Every render also has its edge silence trimmed and is dropped if its length is
implausible for its text (v3 can run on, or return near-nothing, for "Hmm.").

## In-memory clips (`filler_clips`)

**File:** `app/core/livekit/filler_clips.py`

Naturalness clips are never rendered to temp WAVs. `filler_clips`
synthesizes a phrase once into pre-decoded 48 kHz mono int16 frames held in
memory — the same shape `comfort_audio.comfort_ambient_source` already feeds the
ambient slot — and keeps the measured duration with it. Three consequences:

- **Playback is a list traversal.** No per-play open/decode/resample inside the
  mixer pull, and no file-backed source that can exceed the mixer's per-stream
  timeout and be dropped.
- **Duration is known at selection time**, so the player can pick a clip that
  ends about when the real reply starts instead of leaving dead air.
- **Clips are cacheable.** A worker-wide LRU keyed on
  `(provider + every stored voice parameter, language, phrase, variant)` means a
  phrase rendered for one session is free for the next. The key must cover all
  voice parameters, not just the voice id: serving a clip in the wrong voice is
  worse than no filler. `voice_fingerprint()` hashes the client class, both
  parameter dicts and every scalar attribute for that reason.

Providers return whatever rate they like (Sarvam 22.05 kHz, others 24 kHz) and
the mixer runs at 48 kHz, so clips are resampled and downmixed to mono once at
synthesis rather than on every play. Both isolation rules above still apply:
rendering uses `create_clip_tts()`, and when isolation is impossible nothing is
synthesized.

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
- `app/tts/cartesia.py` -- `CartesiaTTSClient`
- `app/tts/smallestai.py` -- `SmallestAITTSClient`
- `app/core/constants.py` -- `TTSProvider` enum
