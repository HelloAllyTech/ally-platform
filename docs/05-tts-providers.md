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

## Default Voice Selection

When no TTS config is provided, the factory selects a Deepgram voice based on the persona's gender:

| Gender | Setting |
|--------|---------|
| Male | `DEFAULT_MALE_VOICE_MODEL` |
| Female | `DEFAULT_FEMALE_VOICE_MODEL` |
| Non-binary | `DEFAULT_NON_BINARY_VOICE_MODEL` |

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
