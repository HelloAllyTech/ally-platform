"""create_clip_tts on the REAL provider clients, built the way a session builds them.

Replaces a mock-based test that passed while clips were disabled in production:
its stub client called ``super().__init__()``, and four of the real clients did
not, so ``create_clip_tts`` hit an AttributeError, swallowed it and returned
None for ElevenLabs, Sarvam, Deepgram and Google (d35bb31, shipped in v1.45.0).
Every assertion here runs against ``app.tts.factory.create_tts_client`` and the
pinned LiveKit plugins, so a client that drifts from the base contract fails
here rather than silently in a live session.

It also pins the clip policy (``BaseTTSClient.allows_clip_synthesis``): a clip is
an independent generation played just before the reply, so it is allowed only
for fixed-speaker voices. Changing a row below is a product decision about
whether a voice may be heard twice in a row from two separate generations.

No network: plugin instances are constructed, never asked to synthesize. Vendor
keys are the dummy values set in tests/conftest.py.
"""

import copy
import dataclasses

import pytest

from app.core.livekit.filler_clips import clip_tts_available, voice_fingerprint
from app.tts.base import BaseTTSClient
from app.tts.factory import create_tts_client

# (case id, provider, config, clip synthesis allowed, expected client class)
CASES = [
    # Fixed-speaker voices: clips allowed.
    (
        "deepgram",
        "deepgram",
        {"model": "aura-2-thalia-en"},
        True,
        "DeepgramTTSClient",
    ),
    (
        "elevenlabs_flash",
        "elevenlabs",
        {"voice_id": "v1", "model": "eleven_flash_v2_5"},
        True,
        "ElevenLabsTTSClient",
    ),
    (
        "elevenlabs_turbo",
        "elevenlabs",
        {"voice_id": "v1", "model": "eleven_turbo_v2_5"},
        True,
        "ElevenLabsTTSClient",
    ),
    (
        "elevenlabs_multilingual_v2",
        "elevenlabs",
        {"voice_id": "v1", "model": "eleven_multilingual_v2"},
        True,
        "ElevenLabsTTSClient",
    ),
    (
        "sarvam_bulbul_v2",
        "sarvam",
        {"model": "bulbul:v2", "speaker": "anushka"},
        True,
        "SarvamTTSClient",
    ),
    (
        "google_chirp3_hd",
        "google",
        {"voice_name": "hi-IN-Chirp3-HD-Achernar"},
        True,
        "GoogleTTSClient",
    ),
    (
        "cartesia",
        "cartesia",
        {"voice": "abc-uuid", "model": "sonic-3"},
        True,
        "CartesiaTTSClient",
    ),
    # v3: the live reply is already one generation per sentence under fixed
    # voice settings; a clip on the same model and settings is one more.
    (
        "elevenlabs_v3",
        "elevenlabs",
        {"voice_id": "v1", "model": "eleven_v3"},
        True,
        "ElevenLabsTTSClient",
    ),
    (
        "elevenlabs_v3_conversational",
        "elevenlabs",
        {"voice_id": "v1", "model": "eleven_v3_conversational"},
        True,
        "ElevenLabsTTSClient",
    ),
    # Generative voices: a clip would be a second draw of the speaker.
    (
        "google_gemini_bare_name",
        "google",
        {"voice_name": "Kore"},
        False,
        "GoogleTTSClient",
    ),
    (
        "google_gemini_model",
        "google",
        {"voice_name": "Charon", "model_name": "gemini-2.5-flash-tts"},
        False,
        "GoogleTTSClient",
    ),
    (
        "google_no_voice_name",
        "google",
        {},
        False,
        "GoogleTTSClient",
    ),
    ("hume", "hume", {"voice_name": "Ito"}, False, "HumeTTSClient"),
    # Unclassified: fails closed until someone checks speaker consistency.
    (
        "sarvam_bulbul_v3",
        "sarvam",
        {"model": "bulbul:v3", "speaker": "aditya"},
        False,
        "SarvamTTSClient",
    ),
    (
        "smallestai",
        "smallestai",
        {"voice_id": "v1", "model": "lightning_v3.1_pro"},
        False,
        "SmallestAITTSClient",
    ),
]

_SCALARS = (str, int, float, bool, type(None))


def _build(provider, config):
    return create_tts_client(
        tts_config={"provider": provider, "config": copy.deepcopy(config)},
        language_code="hi-IN",
        gender="female",
    )


def _inner(instance):
    """The plugin TTS under a StreamAdapter, or the instance itself."""
    return getattr(instance, "_wrapped_tts", None) or instance


def _scalar_opts(instance) -> dict:
    opts = getattr(_inner(instance), "_opts", None)
    if opts is None:
        return {}
    fields = (
        {f.name: getattr(opts, f.name) for f in dataclasses.fields(opts)}
        if dataclasses.is_dataclass(opts)
        else vars(opts)
    )
    return {k: v for k, v in fields.items() if isinstance(v, _SCALARS)}


@pytest.mark.unit
@pytest.mark.parametrize(
    "provider,config,allowed,client_cls",
    [c[1:] for c in CASES],
    ids=[c[0] for c in CASES],
)
def test_clip_tts_on_real_client(provider, config, allowed, client_cls):
    client = _build(provider, config)

    # The factory falls back to Deepgram on any construction error; without
    # this every other assertion could be testing the wrong provider.
    assert type(client).__name__ == client_cls
    # The regression itself: every client must initialise the base state.
    assert isinstance(client._current_params, dict)

    assert client.allows_clip_synthesis() is allowed
    assert client.can_create_clip_tts() is allowed
    assert clip_tts_available(client) is allowed

    session_instance = client.tts_instance
    fingerprint = voice_fingerprint(client)
    clip = client.create_clip_tts()

    # Creating (or refusing) a clip never touches the session's voice.
    assert client.tts_instance is session_instance
    assert voice_fingerprint(client) == fingerprint

    if not allowed:
        assert clip is None
        return

    assert clip is not None, "clips silently disabled for an allowed voice"
    assert clip is not session_instance
    assert type(clip) is type(session_instance)
    assert _inner(clip) is not _inner(session_instance)
    session_opts, clip_opts = _scalar_opts(session_instance), _scalar_opts(clip)
    assert session_opts, "no scalar _opts to compare — check the plugin shape"
    assert clip_opts == session_opts


@pytest.mark.unit
def test_every_provider_client_is_covered():
    """A new provider client must be classified here, not merely inherit False."""
    from app.tts import (  # noqa: F401 - import registers the subclasses
        cartesia,
        deepgram,
        elevenlabs,
        google,
        hume,
        sarvam,
        smallestai,
    )

    provider_clients = {
        cls.__name__
        for cls in BaseTTSClient.__subclasses__()
        if cls.__module__.startswith("app.tts.")
    }
    assert len(provider_clients) == 7
    assert provider_clients <= {c[4] for c in CASES}


@pytest.mark.unit
def test_stored_parameters_carry_over_to_the_clip():
    """A non-empty _current_params is re-applied to the clip's own instance."""
    client = _build("elevenlabs", {"voice_id": "v1", "model": "eleven_flash_v2_5"})
    session_instance = client.tts_instance
    client._current_params["speed"] = 1.1

    clip = client.create_clip_tts()

    assert clip is not None
    assert clip._opts.voice_settings.speed == 1.1
    # Applied to the clip's own instance; the session instance was left alone.
    assert getattr(session_instance._opts.voice_settings, "speed", None) != 1.1


@pytest.mark.unit
def test_a_v3_clip_speaks_with_the_session_voice_settings():
    """The whole case for v3 clips: same model, voice and settings as the
    reply's own per-sentence generations. Different settings would make the
    clip a second voice."""
    client = _build("elevenlabs", {"voice_id": "v1", "model": "eleven_v3"})
    session_instance = client.tts_instance
    clip = client.create_clip_tts()

    assert clip is not None
    session_opts, clip_opts = _inner(session_instance)._opts, _inner(clip)._opts
    assert clip_opts.model == session_opts.model == "eleven_v3"
    assert clip_opts.voice_id == session_opts.voice_id
    assert clip_opts.voice_settings == session_opts.voice_settings
    assert clip_opts.voice_settings.stability == 0.95
