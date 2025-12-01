"""Comprehensive tests for language configuration."""
import pytest
from typing import Dict, Any

from app.core.language import (
    LANGUAGE_DEFAULTS,
    DEFAULT_LANGUAGE_CODE,
    get_language_defaults
)
from app.core.scenario.base import LanguageConfig, Scenario


class TestLanguageDefaults:
    """Test cases for LANGUAGE_DEFAULTS constant."""
    
    @pytest.mark.unit
    def test_language_defaults_structure(self):
        """Test that LANGUAGE_DEFAULTS has correct structure."""
        assert isinstance(LANGUAGE_DEFAULTS, dict)
        assert DEFAULT_LANGUAGE_CODE in LANGUAGE_DEFAULTS
        
        # Check structure of each language entry
        for lang_code, config in LANGUAGE_DEFAULTS.items():
            assert "stt" in config
            assert "llm" in config
            assert "provider" in config["stt"]
            assert "model" in config["stt"]
            assert "provider" in config["llm"]
            assert "model" in config["llm"]
    
    @pytest.mark.unit
    def test_default_language_code(self):
        """Test that DEFAULT_LANGUAGE_CODE is valid."""
        assert DEFAULT_LANGUAGE_CODE == "en-IN"
        assert DEFAULT_LANGUAGE_CODE in LANGUAGE_DEFAULTS
    
    @pytest.mark.unit
    def test_en_in_defaults(self):
        """Test en-IN default configuration."""
        en_in_config = LANGUAGE_DEFAULTS["en-IN"]
        
        assert en_in_config["stt"]["provider"] == "deepgram"
        assert en_in_config["stt"]["model"] == "nova-3"
        assert en_in_config["llm"]["provider"] == "openai"
        assert en_in_config["llm"]["model"] == "gpt-4o-mini"
    
    @pytest.mark.unit
    def test_hi_in_defaults(self):
        """Test hi-IN default configuration."""
        hi_in_config = LANGUAGE_DEFAULTS["hi-IN"]
        
        assert hi_in_config["stt"]["provider"] == "deepgram"
        assert hi_in_config["stt"]["model"] == "nova-3"
        assert hi_in_config["llm"]["provider"] == "openai"
        assert hi_in_config["llm"]["model"] == "gpt-4o-mini"


class TestGetLanguageDefaults:
    """Test cases for get_language_defaults function."""
    
    @pytest.mark.unit
    def test_get_language_defaults_existing_language(self):
        """Test getting defaults for existing language."""
        result = get_language_defaults("en-IN")
        
        assert result["stt"]["provider"] == "deepgram"
        assert result["stt"]["model"] == "nova-3"
        assert result["llm"]["provider"] == "openai"
        assert result["llm"]["model"] == "gpt-4o-mini"
    
    @pytest.mark.unit
    def test_get_language_defaults_another_language(self):
        """Test getting defaults for another existing language."""
        result = get_language_defaults("hi-IN")
        
        assert result["stt"]["provider"] == "deepgram"
        assert result["stt"]["model"] == "nova-3"
        assert result["llm"]["provider"] == "openai"
    
    @pytest.mark.unit
    def test_get_language_defaults_fallback(self):
        """Test that unknown language falls back to default."""
        result = get_language_defaults("unknown-language")
        
        # Should return defaults for DEFAULT_LANGUAGE_CODE
        default_result = get_language_defaults(DEFAULT_LANGUAGE_CODE)
        assert result == default_result
        assert result["stt"]["provider"] == "deepgram"
        assert result["llm"]["provider"] == "openai"
    
    @pytest.mark.unit
    def test_get_language_defaults_empty_string(self):
        """Test that empty string falls back to default."""
        result = get_language_defaults("")
        
        default_result = get_language_defaults(DEFAULT_LANGUAGE_CODE)
        assert result == default_result


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
        stt_override = {
            "provider": "deepgram",
            "config": {"model": "nova-2"}
        }
        config = LanguageConfig(
            language_code="en-IN",
            stt_config=stt_override
        )
        
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
            "config": {}
        }
        config = LanguageConfig(
            language_code="hi-IN",
            llm_config=llm_override
        )
        
        assert config.language_code == "hi-IN"
        assert config.stt_config is None
        assert config.llm_config == llm_override
    
    @pytest.mark.unit
    def test_language_config_creation_with_all_overrides(self):
        """Test creating LanguageConfig with both STT and LLM overrides."""
        stt_override = {
            "provider": "deepgram",
            "config": {"model": "nova-2"}
        }
        llm_override = {
            "provider": "openai",
            "model": "gpt-4",
            "temperature": 0.8
        }
        config = LanguageConfig(
            language_code="es-ES",
            stt_config=stt_override,
            llm_config=llm_override
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
                "openingStatements": ["Hello"]
            }
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
                "openingStatements": ["Hello"]
            }
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
            "stt": {
                "provider": "deepgram",
                "config": {"model": "nova-2"}
            },
            "title": "Test Scenario",
            "promptData": {
                "name": "Test",
                "age": 25,
                "gender": "male",
                "currentLocation": "City",
                "context": "Context",
                "lifeHistory": "History",
                "openingStatements": ["Hello"]
            }
        }
        
        result = Scenario._build_language_config(raw_payload)
        
        assert isinstance(result, LanguageConfig)
        assert result.language_code == "en-IN"
        assert result.stt_config == {
            "provider": "deepgram",
            "config": {"model": "nova-2"}
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
                "config": {}
            },
            "title": "Test Scenario",
            "promptData": {
                "name": "Test",
                "age": 25,
                "gender": "male",
                "currentLocation": "City",
                "context": "Context",
                "lifeHistory": "History",
                "openingStatements": ["Hello"]
            }
        }
        
        result = Scenario._build_language_config(raw_payload)
        
        assert isinstance(result, LanguageConfig)
        assert result.language_code == "hi-IN"
        assert result.stt_config is None
        assert result.llm_config == {
            "provider": "openai",
            "model": "gpt-4",
            "temperature": 0.7,
            "config": {}
        }
    
    @pytest.mark.unit
    def test_build_language_config_with_all_overrides(self):
        """Test _build_language_config with both STT and LLM overrides."""
        raw_payload = {
            "languageCode": "es-ES",
            "stt": {
                "provider": "deepgram",
                "config": {"model": "nova-2"}
            },
            "llm": {
                "provider": "openai",
                "model": "gpt-4",
                "temperature": 0.8
            },
            "title": "Test Scenario",
            "promptData": {
                "name": "Test",
                "age": 25,
                "gender": "male",
                "currentLocation": "City",
                "context": "Context",
                "lifeHistory": "History",
                "openingStatements": ["Hello"]
            }
        }
        
        result = Scenario._build_language_config(raw_payload)
        
        assert isinstance(result, LanguageConfig)
        assert result.language_code == "es-ES"
        assert result.stt_config == {
            "provider": "deepgram",
            "config": {"model": "nova-2"}
        }
        assert result.llm_config == {
            "provider": "openai",
            "model": "gpt-4",
            "temperature": 0.8
        }


class TestScenarioWithLanguageConfig:
    """Test cases for Scenario creation with language configuration."""
    
    @pytest.mark.unit
    def test_scenario_create_with_default_language(self):
        """Test Scenario.create with no languageCode (defaults to en-IN)."""
        payload = {
            "title": "Test Scenario",
            "description": "Test description",
            "prompt": "Test prompt",
            "promptData": {
                "name": "Test Character",
                "age": 25,
                "gender": "male",
                "currentLocation": "City",
                "context": "Context",
                "lifeHistory": "History",
                "openingStatements": ["Hello"]
            }
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
            "prompt": "Test prompt",
            "languageCode": "hi-IN",
            "promptData": {
                "name": "Test Character",
                "age": 25,
                "gender": "male",
                "currentLocation": "City",
                "context": "Context",
                "lifeHistory": "History",
                "openingStatements": ["Hello"]
            }
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
            "prompt": "Test prompt",
            "languageCode": "en-IN",
            "stt": {
                "provider": "deepgram",
                "config": {"model": "nova-2"}
            },
            "promptData": {
                "name": "Test Character",
                "age": 25,
                "gender": "male",
                "currentLocation": "City",
                "context": "Context",
                "lifeHistory": "History",
                "openingStatements": ["Hello"]
            }
        }
        
        scenario = Scenario.create(payload)
        
        assert scenario.language_config is not None
        assert scenario.language_config.language_code == "en-IN"
        assert scenario.language_config.stt_config == {
            "provider": "deepgram",
            "config": {"model": "nova-2"}
        }
        assert scenario.language_config.llm_config is None
    
    @pytest.mark.unit
    def test_scenario_create_with_llm_override(self):
        """Test Scenario.create with LLM override."""
        payload = {
            "title": "Test Scenario",
            "description": "Test description",
            "prompt": "Test prompt",
            "languageCode": "hi-IN",
            "llm": {
                "provider": "openai",
                "model": "gpt-4",
                "temperature": 0.7
            },
            "promptData": {
                "name": "Test Character",
                "age": 25,
                "gender": "male",
                "currentLocation": "City",
                "context": "Context",
                "lifeHistory": "History",
                "openingStatements": ["Hello"]
            }
        }
        
        scenario = Scenario.create(payload)
        
        assert scenario.language_config is not None
        assert scenario.language_config.language_code == "hi-IN"
        assert scenario.language_config.stt_config is None
        assert scenario.language_config.llm_config == {
            "provider": "openai",
            "model": "gpt-4",
            "temperature": 0.7
        }
    
    @pytest.mark.unit
    def test_scenario_create_with_nested_scenario_and_language(self):
        """Test Scenario.create with nested scenario and language config."""
        payload = {
            "version": "1.0",
            "scenario": {
                "title": "Nested Test",
                "description": "Nested description",
                "prompt": "Nested prompt",
                "languageCode": "es-ES",
                "stt": {
                    "provider": "deepgram",
                    "config": {"model": "nova-2"}
                },
                "llm": {
                    "provider": "openai",
                    "model": "gpt-4",
                    "temperature": 0.8
                },
                "promptData": {
                    "name": "Nested Character",
                    "age": 28,
                    "gender": "female",
                    "currentLocation": "Nested City",
                    "context": "Nested context",
                    "lifeHistory": "Nested history",
                    "openingStatements": ["Nested greeting!"]
                }
            }
        }
        
        scenario = Scenario.create(payload)
        
        assert scenario.language_config is not None
        assert scenario.language_config.language_code == "es-ES"
        assert scenario.language_config.stt_config == {
            "provider": "deepgram",
            "config": {"model": "nova-2"}
        }
        assert scenario.language_config.llm_config == {
            "provider": "openai",
            "model": "gpt-4",
            "temperature": 0.8
        }
    
    @pytest.mark.unit
    def test_scenario_create_backward_compatibility(self):
        """Test that existing scenarios without languageCode still work."""
        payload = {
            "title": "Backward Compat Test",
            "description": "Test backward compatibility",
            "prompt": "Test prompt",
            "promptData": {
                "name": "Test Character",
                "age": 25,
                "gender": "male",
                "currentLocation": "City",
                "context": "Context",
                "lifeHistory": "History",
                "openingStatements": ["Hello"]
            },
            "voice": {
                "name": "test_voice",
                "provider": "deepgram",
                "config": {}
            }
        }
        
        scenario = Scenario.create(payload)
        
        # Should have language_config with defaults
        assert scenario.language_config is not None
        assert scenario.language_config.language_code == DEFAULT_LANGUAGE_CODE
        # Other fields should still work
        assert scenario.name == "Backward Compat Test"
        assert scenario.voice is not None

