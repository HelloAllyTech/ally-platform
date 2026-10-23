# STT Providers

**Purpose.** This document describes the STT provider abstraction layer, the `BaseSTTClient` interface, the four supported providers, and language format handling.

---

## Overview

STT (Speech-to-Text) transcribes the counselor's voice into text for the LangGraph pipeline. The system supports four providers, each implemented as a subclass of `BaseSTTClient`.

## BaseSTTClient Interface

**File:** `app/stt/base.py`

```python
class BaseSTTClient(ABC):
    LANGUAGE_FORMAT: Literal["bcp47", "iso6391"] = "bcp47"

    @property
    @abstractmethod
    def stt_instance(self): ...

    @classmethod
    def convert_language_code(cls, language_code: str) -> str: ...
```

### Key Members

| Member | Description |
|--------|-------------|
| `LANGUAGE_FORMAT` | Class attribute declaring the provider's language code format |
| `stt_instance` | Returns the underlying LiveKit STT plugin instance |
| `convert_language_code()` | Converts BCP 47 code to the provider's format |

### Language Format Handling

Providers declare their expected language code format:

- **`bcp47`** -- uses codes like `en-IN`, `hi-IN` (returned as-is)
- **`iso6391`** -- uses codes like `en`, `hi` (extracted from BCP 47 by splitting on `-`)

The `convert_language_code()` class method handles the conversion:

```python
@classmethod
def convert_language_code(cls, language_code: str) -> str:
    if cls.LANGUAGE_FORMAT == "iso6391":
        return language_code.split("-")[0].lower()  # "en-IN" -> "en"
    return language_code  # "en-IN" -> "en-IN"
```

## Supported Providers

| Provider | Class | Enum | Language Format | Default Model |
|----------|-------|------|----------------|---------------|
| Deepgram | `DeepgramSTTClient` | `STTProvider.DEEPGRAM` | `bcp47` | `nova-3` |
| Google Cloud | `GoogleSTTClient` | `STTProvider.GOOGLE` | `bcp47` | `chirp` |
| Sarvam | `SarvamSTTClient` | `STTProvider.SARVAM` | `iso6391` | -- |
| ElevenLabs | `ElevenLabsSTTClient` | `STTProvider.ELEVENLABS` | `iso6391` | `scribe_v2_realtime` |

### Provider Details

**Deepgram** -- Legacy provider, no longer the default: the account has no credits (every call 402s since 2026-10-18), and the admin registry form no longer offers it. The client is kept only so an old row can be read; do not point anything new at it.

**Google Cloud** -- Uses the Chirp model by default. Requires `GOOGLE_APPLICATION_CREDENTIALS` environment variable. Supports model mapping for backward compatibility (`default` -> `chirp`, `command_and_search` -> `latest_short`, `phone_call` -> `latest_long`).

**Sarvam** -- Specialized for Indian languages. Requires `SARVAM_API_KEY`. Uses ISO 639-1 codes (2-letter).

**ElevenLabs** -- Scribe v2 realtime. Requires `ELEVEN_API_KEY`. Commits a final after 0.5 s of silence (`COMMIT_SILENCE_S`; the plugin default of 1.5 s delayed every final by ~1.9 s). The turn cannot end before the final arrives, so this is the learner-to-reply latency floor.

**The final-transcript delay is the latency floor, so it should decide the provider.** Prod 2026-10-18 → 22, `sttFinalizeMs` p50: Google chirp_2 en-IN 2.4 s vs Sarvam hi-IN 0.85 s (Hindi and Marathi point their `sttConfigId` at Sarvam). Google v2 has no setting for how long its English endpointer waits. Deepgram en-IN was 0.4 s before it was retired. Local streaming benchmark (2026-10-22): Sarvam en-IN 0.7–0.95 s, ElevenLabs 0.8–0.9 s with the 0.5 s commit.

## Factory

**File:** `app/stt/factory.py`

`create_stt_client(stt_config, language_code)` creates a client:

1. If `stt_config` is `None`, returns a default Google client with `chirp_2` in `asia-southeast1` (the region matters: chirp_2 is not served from `global`, and a Google row with no model inherits the default region along with the default model)
2. Reads `provider` from config
3. Supports both nested (`{"provider": "google", "config": {"model": "chirp_2"}}`) and flat (`{"provider": "google", "model": "chirp_2"}`) config structures
4. Calls `<Provider>STTClient.from_config(config, language_code)` to instantiate

Default configuration:
```python
DEFAULT_STT_CONFIG = {"provider": "google", "model": "chirp_2", "location": "asia-southeast1"}
```

---

## Key Source Files

- `app/stt/base.py` -- `BaseSTTClient`
- `app/stt/factory.py` -- `create_stt_client()`
- `app/stt/deepgram.py` -- `DeepgramSTTClient`
- `app/stt/google.py` -- `GoogleSTTClient`
- `app/stt/sarvam.py` -- `SarvamSTTClient`
- `app/stt/elevenlabs.py` -- `ElevenLabsSTTClient`
- `app/core/constants.py` -- `STTProvider` enum, `GoogleSTTConfig`
