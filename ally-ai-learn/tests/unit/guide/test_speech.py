"""Ally's STT, TTS and turn detection, resolved from the session language."""

import json

import pytest

from app.core.config import settings
from app.core.guide import speech
from app.core.guide.session import provider_language_code


@pytest.fixture(autouse=True)
def _defaults(monkeypatch):
    monkeypatch.setattr(settings, "GUIDE_STT_CONFIG", None, raising=False)
    monkeypatch.setattr(settings, "GUIDE_TTS_CONFIG", None, raising=False)
    monkeypatch.setattr(settings, "GUIDE_TTS_GOOGLE_VOICE", "Kore", raising=False)
    monkeypatch.setattr(settings, "GUIDE_VAD_ENDPOINTING_DELAY", 1.2, raising=False)
    monkeypatch.setattr(settings, "TURN_MIN_ENDPOINTING_DELAY", 0.5, raising=False)
    monkeypatch.setattr(settings, "TURN_MAX_ENDPOINTING_DELAY", 3.0, raising=False)
    monkeypatch.setattr(
        settings, "SEMANTIC_TURN_DETECTION_ENABLED", True, raising=False
    )


@pytest.mark.parametrize(
    "language, code",
    [
        ("en", "en-IN"),
        ("hi", "hi-IN"),
        ("ta", "ta-IN"),
        ("", "en-IN"),
        ("hi-IN", "hi-IN"),
    ],
)
def test_languages_map_to_indian_locales(language, code):
    assert provider_language_code(language) == code


def test_defaults_are_chirp2_stt_and_a_fixed_chirp3_voice():
    config = speech.resolve_speech_config("mr")

    assert config.language_code == "mr-IN"
    assert config.stt_config == {
        "provider": "google",
        "config": {"model": "chirp_2", "location": "asia-southeast1"},
    }
    assert config.tts_config == {
        "provider": "google",
        "config": {"voice_name": "mr-IN-Chirp3-HD-Kore", "model_name": "chirp_3"},
    }
    assert config.stt_meta == ("google", "chirp_2")
    assert config.tts_meta == ("google", "mr-IN-Chirp3-HD-Kore")


def test_per_language_overrides_win(monkeypatch):
    monkeypatch.setattr(
        settings,
        "GUIDE_TTS_CONFIG",
        json.dumps(
            {
                "hi": {"provider": "sarvam", "config": {"speaker": "anushka"}},
                "default": {"provider": "elevenlabs", "config": {"voice_id": "v1"}},
            }
        ),
    )
    monkeypatch.setattr(
        settings,
        "GUIDE_STT_CONFIG",
        json.dumps({"hi": {"provider": "sarvam", "config": {"model": "saarika"}}}),
    )

    hindi = speech.resolve_speech_config("hi")
    english = speech.resolve_speech_config("en")

    assert hindi.tts_config["provider"] == "sarvam"
    assert hindi.stt_meta == ("sarvam", "saarika")
    assert english.tts_config["provider"] == "elevenlabs"
    assert english.stt_config["provider"] == "google"


@pytest.mark.parametrize("raw", ["not json", "[1, 2]", '{"en": {"config": {}}}'])
def test_unusable_overrides_fall_back_to_the_default(monkeypatch, raw):
    monkeypatch.setattr(settings, "GUIDE_TTS_CONFIG", raw)
    assert speech.resolve_speech_config("en").tts_config["provider"] == "google"


def test_build_clients_use_the_shared_factories(monkeypatch):
    import app.stt as stt_pkg
    import app.tts as tts_pkg

    calls = {}

    def fake_stt(stt_config=None, language_code=None):
        calls["stt"] = (stt_config, language_code)
        return "stt-client"

    def fake_tts(tts_config=None, language_code=None, gender=None):
        calls["tts"] = (tts_config, language_code, gender)
        return "tts-client"

    monkeypatch.setattr(stt_pkg, "create_stt_client", fake_stt)
    monkeypatch.setattr(tts_pkg, "create_tts_client", fake_tts)
    config = speech.resolve_speech_config("kn")

    assert speech.build_stt_client(config) == "stt-client"
    assert speech.build_tts_client(config) == "tts-client"
    assert calls["stt"][1] == "kn-IN"
    assert calls["tts"][0]["config"]["voice_name"] == "kn-IN-Chirp3-HD-Kore"
    # The factories may mutate what they're given; the session config must not
    # change underneath.
    calls["tts"][0]["config"]["voice_name"] = "mutated"
    assert config.tts_config["config"]["voice_name"] == "kn-IN-Chirp3-HD-Kore"


def test_stt_falls_back_to_the_platform_default(monkeypatch):
    import app.stt as stt_pkg

    seen = []

    def flaky(stt_config=None, language_code=None):
        seen.append(stt_config)
        if stt_config is not None:
            raise ValueError("bad config")
        return "default-stt"

    monkeypatch.setattr(stt_pkg, "create_stt_client", flaky)
    assert speech.build_stt_client(speech.resolve_speech_config("en")) == "default-stt"
    assert seen[-1] is None


# -- turn detection -------------------------------------------------------------


class FakeModel:
    pass


@pytest.fixture
def fake_eou(monkeypatch):
    import livekit.plugins.turn_detector.multilingual as ml

    monkeypatch.setattr(ml, "MultilingualModel", FakeModel)


@pytest.mark.parametrize("language", ["en", "hi", "hi-IN"])
def test_english_and_hindi_get_semantic_turn_detection(fake_eou, language):
    detection, kwargs = speech.resolve_turn_detection(language, "hands_free", "VAD")
    assert isinstance(detection, FakeModel)
    assert kwargs == {"min_endpointing_delay": 0.5, "max_endpointing_delay": 3.0}


@pytest.mark.parametrize("language", ["mr", "ta", "kn"])
def test_other_languages_use_vad_with_a_longer_delay(fake_eou, language):
    detection, kwargs = speech.resolve_turn_detection(language, "hands_free", "VAD")
    assert detection == "vad"
    assert kwargs == {"min_endpointing_delay": 1.2}


def test_semantic_off_falls_back_to_vad(monkeypatch, fake_eou):
    monkeypatch.setattr(settings, "SEMANTIC_TURN_DETECTION_ENABLED", False)
    detection, kwargs = speech.resolve_turn_detection("en", "hands_free", "VAD")
    assert (detection, kwargs) == ("vad", {"min_endpointing_delay": 1.2})


def test_model_unavailable_falls_back_to_vad(monkeypatch):
    import livekit.plugins.turn_detector.multilingual as ml

    def boom():
        raise RuntimeError("weights missing")

    monkeypatch.setattr(ml, "MultilingualModel", boom)
    assert speech.resolve_turn_detection("hi", "hands_free", "VAD")[0] == "vad"


def test_push_to_talk_is_manual_whatever_the_language(fake_eou):
    assert speech.resolve_turn_detection("en", "push_to_talk", "VAD") == ("manual", {})
    assert speech.resolve_turn_detection("ta", "push_to_talk", None) == ("manual", {})


def test_no_vad_means_no_turn_detection():
    assert speech.resolve_turn_detection("en", "hands_free", None) == (None, {})
