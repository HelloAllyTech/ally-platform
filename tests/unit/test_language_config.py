"""Comprehensive tests for language configuration."""

import pytest

from app.core.constants import (
    DEFAULT_LANGUAGE_CODE,
    convert_language_code_for_sarvam,
    normalize_language_code_for_providers,
)
from app.core.scenario.base import LanguageConfig, Scenario
from scenario_sample import SCENARIO_SAMPLE_EN_GB


class TestLanguageConfig:
    """Test cases for LanguageConfig model."""

    @pytest.mark.unit
    def test_language_config_creation_with_defaults(self):
        """Test creating LanguageConfig with default values."""
        config = LanguageConfig()

        assert config.language_code == DEFAULT_LANGUAGE_CODE
        assert config.stt_config is None
        assert config.llm_config is None

    @pytest.mark.unit
    def test_language_config_creation_with_language_code(self):
        """Test creating LanguageConfig with language code."""
        config = LanguageConfig(language_code="hi-IN")

        assert config.language_code == "hi-IN"
        assert config.stt_config is None
        assert config.llm_config is None

    @pytest.mark.unit
    def test_language_config_creation_with_stt_override(self):
        """Test creating LanguageConfig with STT override."""
        stt_override = {"provider": "deepgram", "config": {"model": "nova-2"}}
        config = LanguageConfig(language_code="en-IN", stt_config=stt_override)

        assert config.language_code == "en-IN"
        assert config.stt_config == stt_override
        assert config.llm_config is None

    @pytest.mark.unit
    def test_language_config_creation_with_llm_override(self):
        """Test creating LanguageConfig with LLM override."""
        llm_override = {
            "provider": "openai",
            "model": "gpt-4",
            "temperature": 0.7,
            "config": {},
        }
        config = LanguageConfig(language_code="hi-IN", llm_config=llm_override)

        assert config.language_code == "hi-IN"
        assert config.stt_config is None
        assert config.llm_config == llm_override

    @pytest.mark.unit
    def test_language_config_creation_with_all_overrides(self):
        """Test creating LanguageConfig with both STT and LLM overrides."""
        stt_override = {"provider": "deepgram", "config": {"model": "nova-2"}}
        llm_override = {"provider": "openai", "model": "gpt-4", "temperature": 0.8}
        config = LanguageConfig(
            language_code="es-ES", stt_config=stt_override, llm_config=llm_override
        )

        assert config.language_code == "es-ES"
        assert config.stt_config == stt_override
        assert config.llm_config == llm_override


class TestScenarioBuildLanguageConfig:
    """Test cases for Scenario._build_language_config method."""

    @pytest.mark.unit
    def test_build_language_config_with_default(self):
        """Test _build_language_config with no languageCode (defaults to en-IN)."""
        raw_payload = {
            "title": "Test Scenario",
            "promptData": {
                "name": "Test",
                "age": 25,
                "gender": "male",
                "currentLocation": "City",
                "context": "Context",
                "lifeHistory": "History",
                "openingStatements": ["Hello"],
            },
        }

        result = Scenario._build_language_config(raw_payload)

        assert isinstance(result, LanguageConfig)
        assert result.language_code == DEFAULT_LANGUAGE_CODE
        assert result.stt_config is None
        assert result.llm_config is None

    @pytest.mark.unit
    def test_build_language_config_with_language_code(self):
        """Test _build_language_config with languageCode specified."""
        raw_payload = {
            "languageCode": "hi-IN",
            "title": "Test Scenario",
            "promptData": {
                "name": "Test",
                "age": 25,
                "gender": "male",
                "currentLocation": "City",
                "context": "Context",
                "lifeHistory": "History",
                "openingStatements": ["Hello"],
            },
        }

        result = Scenario._build_language_config(raw_payload)

        assert isinstance(result, LanguageConfig)
        assert result.language_code == "hi-IN"
        assert result.stt_config is None
        assert result.llm_config is None

    @pytest.mark.unit
    def test_build_language_config_with_stt_override(self):
        """Test _build_language_config with STT override."""
        raw_payload = {
            "languageCode": "en-IN",
            "stt": {"provider": "deepgram", "config": {"model": "nova-2"}},
            "title": "Test Scenario",
            "promptData": {
                "name": "Test",
                "age": 25,
                "gender": "male",
                "currentLocation": "City",
                "context": "Context",
                "lifeHistory": "History",
                "openingStatements": ["Hello"],
            },
        }

        result = Scenario._build_language_config(raw_payload)

        assert isinstance(result, LanguageConfig)
        assert result.language_code == "en-IN"
        assert result.stt_config == {
            "provider": "deepgram",
            "config": {"model": "nova-2"},
        }
        assert result.llm_config is None

    @pytest.mark.unit
    def test_build_language_config_with_llm_override(self):
        """Test _build_language_config with LLM override."""
        raw_payload = {
            "languageCode": "hi-IN",
            "llm": {
                "provider": "openai",
                "model": "gpt-4",
                "temperature": 0.7,
                "config": {},
            },
            "title": "Test Scenario",
            "promptData": {
                "name": "Test",
                "age": 25,
                "gender": "male",
                "currentLocation": "City",
                "context": "Context",
                "lifeHistory": "History",
                "openingStatements": ["Hello"],
            },
        }

        result = Scenario._build_language_config(raw_payload)

        assert isinstance(result, LanguageConfig)
        assert result.language_code == "hi-IN"
        assert result.stt_config is None
        assert result.llm_config == {
            "provider": "openai",
            "model": "gpt-4",
            "temperature": 0.7,
            "config": {},
        }

    @pytest.mark.unit
    def test_build_language_config_with_all_overrides(self):
        """Test _build_language_config with both STT and LLM overrides."""
        raw_payload = {
            "languageCode": "es-ES",
            "stt": {"provider": "deepgram", "config": {"model": "nova-2"}},
            "llm": {"provider": "openai", "model": "gpt-4", "temperature": 0.8},
            "title": "Test Scenario",
            "promptData": {
                "name": "Test",
                "age": 25,
                "gender": "male",
                "currentLocation": "City",
                "context": "Context",
                "lifeHistory": "History",
                "openingStatements": ["Hello"],
            },
        }

        result = Scenario._build_language_config(raw_payload)

        assert isinstance(result, LanguageConfig)
        assert result.language_code == "es-ES"
        assert result.stt_config == {
            "provider": "deepgram",
            "config": {"model": "nova-2"},
        }
        assert result.llm_config == {
            "provider": "openai",
            "model": "gpt-4",
            "temperature": 0.8,
        }


class TestScenarioWithLanguageConfig:
    """Test cases for Scenario creation with language configuration."""

    @pytest.mark.unit
    def test_scenario_create_with_default_language(self):
        """Test Scenario.create with no languageCode (defaults to en-IN)."""
        payload = {
            "title": "Test Scenario",
            "description": "Test description",
            "promptData": {
                "name": "Test Character",
                "age": 25,
                "gender": "male",
                "currentLocation": "City",
                "context": "Context",
                "lifeHistory": "History",
                "openingStatements": ["Hello"],
            },
        }

        scenario = Scenario.create(payload)

        assert scenario.language_config is not None
        assert scenario.language_config.language_code == DEFAULT_LANGUAGE_CODE
        assert scenario.language_config.stt_config is None
        assert scenario.language_config.llm_config is None

    @pytest.mark.unit
    def test_scenario_create_with_language_code(self):
        """Test Scenario.create with languageCode specified."""
        payload = {
            "title": "Test Scenario",
            "description": "Test description",
            "languageCode": "hi-IN",
            "promptData": {
                "name": "Test Character",
                "age": 25,
                "gender": "male",
                "currentLocation": "City",
                "context": "Context",
                "lifeHistory": "History",
                "openingStatements": ["Hello"],
            },
        }

        scenario = Scenario.create(payload)

        assert scenario.language_config is not None
        assert scenario.language_config.language_code == "hi-IN"
        assert scenario.language_config.stt_config is None
        assert scenario.language_config.llm_config is None

    @pytest.mark.unit
    def test_scenario_create_with_stt_override(self):
        """Test Scenario.create with STT override."""
        payload = {
            "title": "Test Scenario",
            "description": "Test description",
            "languageCode": "en-IN",
            "stt": {"provider": "deepgram", "config": {"model": "nova-2"}},
            "promptData": {
                "name": "Test Character",
                "age": 25,
                "gender": "male",
                "currentLocation": "City",
                "context": "Context",
                "lifeHistory": "History",
                "openingStatements": ["Hello"],
            },
        }

        scenario = Scenario.create(payload)

        assert scenario.language_config is not None
        assert scenario.language_config.language_code == "en-IN"
        assert scenario.language_config.stt_config == {
            "provider": "deepgram",
            "config": {"model": "nova-2"},
        }
        assert scenario.language_config.llm_config is None

    @pytest.mark.unit
    def test_scenario_create_with_llm_override(self):
        """Test Scenario.create with LLM override."""
        payload = {
            "title": "Test Scenario",
            "description": "Test description",
            "languageCode": "hi-IN",
            "llm": {"provider": "openai", "model": "gpt-4", "temperature": 0.7},
            "promptData": {
                "name": "Test Character",
                "age": 25,
                "gender": "male",
                "currentLocation": "City",
                "context": "Context",
                "lifeHistory": "History",
                "openingStatements": ["Hello"],
            },
        }

        scenario = Scenario.create(payload)

        assert scenario.language_config is not None
        assert scenario.language_config.language_code == "hi-IN"
        assert scenario.language_config.stt_config is None
        assert scenario.language_config.llm_config == {
            "provider": "openai",
            "model": "gpt-4",
            "temperature": 0.7,
        }

    @pytest.mark.unit
    def test_scenario_create_with_nested_scenario_and_language(self):
        """Test Scenario.create with nested scenario and language config."""
        payload = {
            "version": "1.0",
            "scenario": {
                "title": "Nested Test",
                "description": "Nested description",
                "languageCode": "es-ES",
                "stt": {"provider": "deepgram", "config": {"model": "nova-2"}},
                "llm": {"provider": "openai", "model": "gpt-4", "temperature": 0.8},
                "promptData": {
                    "name": "Nested Character",
                    "age": 28,
                    "gender": "female",
                    "currentLocation": "Nested City",
                    "context": "Nested context",
                    "lifeHistory": "Nested history",
                    "openingStatements": ["Nested greeting!"],
                },
            },
        }

        scenario = Scenario.create(payload)

        assert scenario.language_config is not None
        assert scenario.language_config.language_code == "es-ES"
        assert scenario.language_config.stt_config == {
            "provider": "deepgram",
            "config": {"model": "nova-2"},
        }
        assert scenario.language_config.llm_config == {
            "provider": "openai",
            "model": "gpt-4",
            "temperature": 0.8,
        }

    @pytest.mark.unit
    def test_scenario_create_backward_compatibility(self):
        """Test that existing scenarios without languageCode still work."""
        payload = {
            "title": "Backward Compat Test",
            "description": "Test backward compatibility",
            "promptData": {
                "name": "Test Character",
                "age": 25,
                "gender": "male",
                "currentLocation": "City",
                "context": "Context",
                "lifeHistory": "History",
                "openingStatements": ["Hello"],
            },
            "voice": {"name": "test_voice", "provider": "deepgram", "config": {}},
        }

        scenario = Scenario.create(payload)

        # Should have language_config with defaults
        assert scenario.language_config is not None
        assert scenario.language_config.language_code == DEFAULT_LANGUAGE_CODE
        # Other fields should still work
        assert scenario.name == "Backward Compat Test"
        assert scenario.voice is not None


class TestNormalizeLanguageCodeForProviders:
    """Test cases for normalize_language_code_for_providers."""

    @pytest.mark.unit
    def test_standard_codes_pass_through(self):
        """Standard BCP-47 codes should pass through unchanged."""
        assert normalize_language_code_for_providers("en-IN") == "en-IN"
        assert normalize_language_code_for_providers("en-US") == "en-US"
        assert normalize_language_code_for_providers("en-GB") == "en-GB"
        assert normalize_language_code_for_providers("hi-IN") == "hi-IN"

    @pytest.mark.unit
    def test_none_or_empty_returns_default(self):
        """None or empty string should return DEFAULT_LANGUAGE_CODE."""
        assert normalize_language_code_for_providers(None) == DEFAULT_LANGUAGE_CODE
        assert normalize_language_code_for_providers("") == DEFAULT_LANGUAGE_CODE


class TestConvertLanguageCodeForSarvam:
    """Test convert_language_code_for_sarvam (Sarvam TTS/STT fallbacks)."""

    @pytest.mark.unit
    def test_en_gb_and_en_us_fallback_to_en_in(self):
        """Sarvam only supports en-IN; en-GB and en-US should fallback."""
        assert convert_language_code_for_sarvam("en-GB") == "en-IN"
        assert convert_language_code_for_sarvam("en-US") == "en-IN"

    @pytest.mark.unit
    def test_odia_maps_to_od_in(self):
        """Sarvam uses od-IN for Odia, not or-IN."""
        assert convert_language_code_for_sarvam("or-IN") == "od-IN"
        assert convert_language_code_for_sarvam("or") == "od-IN"

    @pytest.mark.unit
    def test_en_in_and_indic_pass_through(self):
        """en-IN and Indic codes should pass through unchanged."""
        assert convert_language_code_for_sarvam("en-IN") == "en-IN"
        assert convert_language_code_for_sarvam("hi-IN") == "hi-IN"
        assert convert_language_code_for_sarvam("ml-IN") == "ml-IN"


class TestScenarioBuildLanguageConfigEnGB:
    """Test that en-GB in metadata parses correctly."""

    @pytest.mark.unit
    def test_build_language_config_en_gb(self):
        """_build_language_config should parse en-GB correctly."""
        raw_payload = {
            "languageCode": "en-GB",
            "title": "Test Scenario",
            "promptData": {
                "name": "Test",
                "age": 25,
                "gender": "male",
                "currentLocation": "City",
                "context": "Context",
                "lifeHistory": "History",
                "openingStatements": ["Hello"],
            },
        }

        result = Scenario._build_language_config(raw_payload)

        assert result.language_code == "en-GB"


class TestScenarioSampleEnGb:
    """Test SCENARIO_SAMPLE_EN_GB parses correctly with en-GB."""

    @pytest.mark.unit
    def test_scenario_sample_en_gb_has_en_gb_language_code(self):
        """SCENARIO_SAMPLE_EN_GB should use en-GB and parse correctly."""
        payload = SCENARIO_SAMPLE_EN_GB.get("scenario") or SCENARIO_SAMPLE_EN_GB
        scenario = Scenario.create(payload)

        assert scenario.language_config is not None
        assert scenario.language_config.language_code == "en-GB"
        assert scenario.voice is not None
        assert scenario.voice.provider == "google"
