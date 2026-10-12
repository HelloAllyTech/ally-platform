"""Comprehensive tests for scenario.base models."""

from typing import List
from unittest.mock import patch

import pytest

from app.core.events.base import BaseEvent, ChatMessage
from app.core.scenario.base import PromptData, Scenario, ScenarioVoice, VoiceConfig
from tests.utils.test_helpers import AssertionHelpers


class DummyEvent(BaseEvent):
    """Minimal concrete event for tests."""

    async def detect_event(
        self, conversations: List[ChatMessage]
    ) -> bool:  # type: ignore[override]
        return False


class TestVoiceConfig:
    """Test cases for VoiceConfig model."""

    @pytest.mark.unit
    def test_voice_config_creation_with_all_fields(self):
        """Test creating VoiceConfig with all fields."""
        config = VoiceConfig(
            model="nova-2", voice_id="test_voice_id", speaker="test_speaker"
        )

        assert config.model == "nova-2"
        assert config.voice_id == "test_voice_id"
        assert config.speaker == "test_speaker"

    @pytest.mark.unit
    def test_voice_config_creation_with_defaults(self):
        """Test creating VoiceConfig with default values."""
        config = VoiceConfig()

        assert config.model is None
        assert config.voice_id is None
        assert config.speaker is None

    @pytest.mark.unit
    def test_voice_config_partial_fields(self):
        """Test creating VoiceConfig with partial fields."""
        config = VoiceConfig(model="eleven_multilingual_v2")

        assert config.model == "eleven_multilingual_v2"
        assert config.voice_id is None
        assert config.speaker is None

    @pytest.mark.unit
    def test_build_voice_carries_cartesia_keys_through(self):
        """Cartesia's voice id survives the metadata -> VoiceConfig hop.

        Regression: VoiceConfig is a fixed whitelist and `_build_voice` maps
        keys one by one, so Cartesia's `voice` (ally-be stores it under that
        key, not `voice_id`) used to be dropped here. The TTS factory then hit
        Cartesia's required-field check, swallowed the error and fell back to
        the default English Deepgram voice — a Hindi scenario spoken by
        aura-2-helena-en, with only a WARNING to show for it.
        """
        voice = Scenario._build_voice(
            {
                "voice": {
                    "name": "Kavya",
                    "provider": "CARTESIA",
                    "config": {
                        "voice": "voice-uuid-123",
                        "model": "sonic-3",
                        "speed": "slow",
                        "emotion": "positivity:high",
                    },
                }
            }
        )

        assert voice is not None
        assert voice.provider == "cartesia"
        assert voice.config.voice == "voice-uuid-123"
        assert voice.config.model == "sonic-3"
        assert voice.config.speed == "slow"
        assert voice.config.emotion == "positivity:high"


class TestScenarioVoice:
    """Test cases for ScenarioVoice model."""

    @pytest.mark.unit
    def test_scenario_voice_creation(self):
        """Test creating ScenarioVoice with all fields."""
        config = VoiceConfig(model="nova-2", voice_id="test_id")
        voice = ScenarioVoice(name="test_voice", provider="deepgram", config=config)

        assert voice.name == "test_voice"
        assert voice.provider == "deepgram"
        assert voice.config == config

    @pytest.mark.unit
    def test_scenario_voice_with_aliases(self):
        """Test creating ScenarioVoice using field aliases."""
        config = VoiceConfig()
        voice_data = {"name": "alias_voice", "provider": "elevenlabs", "config": config}

        voice = ScenarioVoice(**voice_data)

        assert voice.name == "alias_voice"
        assert voice.provider == "elevenlabs"
        assert voice.config == config

    @pytest.mark.unit
    def test_scenario_voice_validation_errors(self):
        """Test ScenarioVoice validation with invalid data."""
        from pydantic import ValidationError

        config = VoiceConfig()

        # Missing required fields
        with pytest.raises(ValidationError):
            ScenarioVoice(config=config)  # Missing name and provider

        with pytest.raises(ValidationError):
            ScenarioVoice(name="test", config=config)  # Missing provider


class TestPromptData:
    """Test cases for PromptData model."""

    @pytest.mark.unit
    def test_prompt_data_creation_full(self):
        """Test creating PromptData with all fields."""
        prompt_data = PromptData(
            name="Test Character",
            age="25",
            gender="non-binary",
            gender_identity="non-binary",
            sexual_orientation="pansexual",
            current_location="San Francisco",
            profession="Software Engineer",
            context="Test context",
            character_profile_text="Friendly, professional, calm and supportive",
            opening_statements=["Hello!", "How are you?"],
        )

        assert prompt_data.name == "Test Character"
        assert prompt_data.age == "25"
        assert prompt_data.gender == "non-binary"
        assert prompt_data.gender_identity == "non-binary"
        assert prompt_data.sexual_orientation == "pansexual"
        assert prompt_data.current_location == "San Francisco"
        assert prompt_data.profession == "Software Engineer"
        assert len(prompt_data.opening_statements) == 2

    @pytest.mark.unit
    def test_prompt_data_required_fields_only(self):
        """Test creating PromptData with only required fields."""
        prompt_data = PromptData(
            name="Minimal Character",
            age="30",
            gender="female",
            current_location="Test City",
            opening_statements=["Hi!"],
        )

        assert prompt_data.name == "Minimal Character"
        assert prompt_data.age == "30"
        assert prompt_data.gender == "female"
        assert prompt_data.profession is None  # Optional field
        assert prompt_data.character_profile_text is None  # Optional field

    @pytest.mark.unit
    def test_prompt_data_all_fields_optional(self):
        """All PromptData fields are optional now (only title, competency and
        role instructions are mandatory upstream), so empty construction must
        succeed and apply defaults rather than raising."""
        prompt_data = PromptData()
        assert prompt_data.name is None
        assert prompt_data.age is None
        assert prompt_data.gender is None
        assert prompt_data.current_location is None
        assert prompt_data.opening_statements == []

        # A partial construction is fine too.
        partial = PromptData(name="Test")
        assert partial.name == "Test"
        assert partial.gender is None

    @pytest.mark.unit
    def test_prompt_data_rejects_wrong_types(self):
        """Type validation still applies: a strictly-typed field given the
        wrong type must raise."""
        from pydantic import ValidationError

        with pytest.raises(ValidationError):
            PromptData(prompts=123)  # prompts must be a dict / None

    @pytest.mark.unit
    def test_prompt_data_normalizes_language_label_from_camelcase(self):
        """Scenario._build_prompt_data maps backend `languageLabel` (camelCase)
        onto PromptData.language_label (snake_case) so the prompt renderer can
        inject the human-readable name (e.g. 'Tamil (India)')."""
        raw_payload = {
            "promptData": {
                "name": "Lang Label Test",
                "age": "30",
                "gender": "female",
                "currentLocation": "Chennai",
                "context": "Tamil session",
                "lifeHistory": "Grew up in Chennai.",
                "openingStatements": ["Vanakkam"],
                "languageLabel": "Tamil (India)",
            }
        }

        result = Scenario._build_prompt_data(raw_payload)

        assert result is not None
        assert result.language_label == "Tamil (India)"

    @pytest.mark.unit
    def test_prompt_data_normalizes_language_characteristics_from_camelcase(self):
        """Scenario._build_prompt_data maps backend `languageCharacteristics`
        (camelCase) onto PromptData.language_characteristics (snake_case),
        carrying the free-text per-language style guidance through to the
        prompt builder."""
        raw_payload = {
            "promptData": {
                "name": "Chars Test",
                "age": "30",
                "gender": "female",
                "currentLocation": "Chennai",
                "context": "Tamil session",
                "lifeHistory": "Background.",
                "openingStatements": ["Vanakkam"],
                "languageCharacteristics": "Speaks Chennai-style Tamil.",
            }
        }

        result = Scenario._build_prompt_data(raw_payload)

        assert result is not None
        assert result.language_characteristics == "Speaks Chennai-style Tamil."

    @pytest.mark.unit
    def test_prompt_data_language_label_defaults_to_none_when_absent(self):
        """When backend doesn't supply `languageLabel`, PromptData.language_label
        stays None — the prompt renderer falls back to the locale code."""
        raw_payload = {
            "promptData": {
                "name": "No Label Test",
                "age": "30",
                "gender": "female",
                "currentLocation": "Chennai",
                "context": "Session without label",
                "lifeHistory": "Background.",
                "openingStatements": ["Hi"],
            }
        }

        result = Scenario._build_prompt_data(raw_payload)

        assert result is not None
        assert result.language_label is None

    @pytest.mark.unit
    @pytest.mark.parametrize(
        "temperature_input,expected_temperature",
        [
            (0.2, 0.2),
            (0, 0.0),
            ("0.4", 0.4),  # numeric string coerced
            (None, None),  # absent -> None (falls back to provider/global)
            (2.5, 2.0),  # above range -> clamped
            (-0.5, 0.0),  # below range -> clamped
            ("hot", None),  # unparseable -> None, never crashes parse
        ],
    )
    def test_prompt_data_temperature_mapping(
        self, temperature_input, expected_temperature
    ):
        """Scenario._build_prompt_data maps `temperature` onto PromptData and the
        validator coerces/clamps it to [0.0, 2.0]. Bad values degrade to None so
        the whole PromptData is never nulled out over a misconfigured field."""
        prompt_data = {
            "name": "Temperature Test",
            "age": "30",
            "gender": "female",
            "currentLocation": "Chennai",
            "context": "Session",
            "lifeHistory": "Background.",
            "openingStatements": ["Hi"],
        }
        if temperature_input is not None:
            prompt_data["temperature"] = temperature_input

        result = Scenario._build_prompt_data({"promptData": prompt_data})

        assert result is not None
        assert result.temperature == expected_temperature

    @pytest.mark.unit
    @pytest.mark.parametrize(
        "payload_keys",
        [
            ("turnMinEndpointingDelay", "turnMaxEndpointingDelay"),  # from ally-be
            ("turn_min_endpointing_delay", "turn_max_endpointing_delay"),  # direct
        ],
    )
    def test_prompt_data_endpointing_pair_reaches_prompt_data(self, payload_keys):
        """ally-be's globally admin-configured endpointing pair must survive
        _build_prompt_data.

        PromptData is assembled from a hand-maintained mapped_data dict — a
        field defined on the model but missing there is silently always None,
        so the whole pipeline ships inert with every other layer (admin, DTO,
        metadata, promptData) looking right.
        """
        min_key, max_key = payload_keys
        result = Scenario._build_prompt_data(
            {
                "promptData": {
                    "name": "Endpointing Test",
                    "age": "30",
                    "gender": "female",
                    "currentLocation": "Chennai",
                    "context": "Session",
                    "lifeHistory": "Background.",
                    "openingStatements": ["Hi"],
                    min_key: 0.3,
                    max_key: 1.8,
                }
            }
        )

        assert result is not None
        assert result.turn_min_endpointing_delay == 0.3
        assert result.turn_max_endpointing_delay == 1.8

    @pytest.mark.unit
    def test_prompt_data_endpointing_pair_defaults_to_none(self):
        """Absent per-sim bounds leave both None so the worker uses globals."""
        result = Scenario._build_prompt_data(
            {
                "promptData": {
                    "name": "No Endpointing Override",
                    "age": "30",
                    "gender": "female",
                    "currentLocation": "Chennai",
                    "context": "Session",
                    "lifeHistory": "Background.",
                    "openingStatements": ["Hi"],
                }
            }
        )

        assert result is not None
        assert result.turn_min_endpointing_delay is None
        assert result.turn_max_endpointing_delay is None

    @pytest.mark.unit
    def test_prompt_data_temperature_defaults_to_none(self):
        """Absent `temperature` leaves PromptData.temperature None."""
        result = Scenario._build_prompt_data(
            {
                "promptData": {
                    "name": "No Temp",
                    "age": "30",
                    "gender": "male",
                    "currentLocation": "Chennai",
                    "context": "Session",
                    "openingStatements": ["Hi"],
                }
            }
        )

        assert result is not None
        assert result.temperature is None

    @pytest.mark.unit
    @pytest.mark.parametrize(
        "age_input,expected_age",
        [(25, "25"), ("30", "30"), (35.5, "35.5"), ("forty", "forty")],  # String input
    )
    def test_prompt_data_age_conversion(self, age_input, expected_age):
        """Test age field conversion to string."""
        # Build via Scenario._build_prompt_data which handles age casting
        raw_payload = {
            "promptData": {
                "name": "Age Test",
                "age": age_input,
                "gender": "male",
                "currentLocation": "Test City",
                "context": "Age test",
                "lifeHistory": "Age history",
                "openingStatements": ["Hello!"],
            }
        }

        result = Scenario._build_prompt_data(raw_payload)

        assert result is not None
        assert result.age == expected_age


class TestScenario:
    """Test cases for Scenario model."""

    @pytest.mark.unit
    def test_scenario_creation_with_aliases(self):
        """Test creating Scenario using field aliases."""
        events = [DummyEvent(event_id="e1"), DummyEvent(event_id="e2")]
        voice = ScenarioVoice(
            name="test_voice", provider="deepgram", config=VoiceConfig()
        )
        prompt_data = PromptData(
            name="Prompt User",
            age="25",
            gender="male",
            current_location="City",
            context="Some context",
            character_profile_text="Friendly",
            opening_statements=["Hello!"],
        )

        scenario = Scenario(
            scenarioName="Test Scenario",
            events=events,
            metadata={"key": "value"},
            voice=voice,
            prompt_data=prompt_data,
        )

        assert scenario.name == "Test Scenario"
        assert scenario.events == events
        assert scenario.metadata == {"key": "value"}
        assert scenario.voice == voice
        assert scenario.prompt_data == prompt_data

    @pytest.mark.unit
    def test_scenario_creation_with_field_names(self):
        """Test creating Scenario using actual field names."""
        voice = ScenarioVoice(
            name="test_voice", provider="deepgram", config=VoiceConfig()
        )
        prompt_data = PromptData(
            name="Prompt User",
            age="25",
            gender="male",
            current_location="City",
            context="Some context",
            character_profile_text="Friendly",
            opening_statements=["Hello!"],
        )

        scenario = Scenario(name="Direct Name", voice=voice, prompt_data=prompt_data)

        assert scenario.name == "Direct Name"
        assert scenario.events == []  # Default empty list
        assert scenario.metadata == {}  # Default empty dict

    @pytest.mark.unit
    def test_scenario_create_with_full_payload(self, sample_room_metadata):
        """Test Scenario.create with full payload."""
        scenario = Scenario.create(sample_room_metadata)

        assert isinstance(scenario, Scenario)
        assert scenario.name == "Test Scenario"

        # Verify voice was created
        if hasattr(scenario, "voice") and scenario.voice:
            assert isinstance(scenario.voice, ScenarioVoice)
            assert scenario.voice.name == "test_voice"
            assert scenario.voice.provider == "deepgram"

        # Verify prompt data was created
        if hasattr(scenario, "prompt_data") and scenario.prompt_data:
            assert isinstance(scenario.prompt_data, PromptData)
            assert scenario.prompt_data.name == "Test Character"

    @pytest.mark.unit
    def test_scenario_create_with_nested_scenario(self):
        """Test Scenario.create with nested scenario payload."""
        nested_payload = {
            "version": "1.0",
            "scenario": {
                "title": "Nested Test",
                "description": "Nested description",
                "promptData": {
                    "name": "Nested Character",
                    "age": 28,
                    "gender": "male",
                    "currentLocation": "Nested City",
                    "context": "Nested context",
                    "lifeHistory": "Nested history",
                    "openingStatements": ["Nested greeting!"],
                },
                "voice": {"name": "test_voice", "provider": "deepgram", "config": {}},
            },
        }

        scenario = Scenario.create(nested_payload)

        assert scenario.name == "Nested Test"

    @pytest.mark.unit
    def test_scenario_create_with_direct_scenario_payload(self):
        """Test Scenario.create with direct scenario data (no wrapper)."""
        direct_payload = {
            "title": "Direct Test",
            "description": "Direct description",
            "promptData": {
                "name": "Direct Character",
                "age": 35,
                "gender": "female",
                "currentLocation": "Direct City",
                "context": "Direct context",
                "lifeHistory": "Direct history",
                "openingStatements": ["Direct greeting!"],
            },
            "voice": {"name": "test_voice", "provider": "deepgram", "config": {}},
        }

        scenario = Scenario.create(direct_payload)

        assert scenario.name == "Direct Test"

    @pytest.mark.unit
    def test_scenario_extract_scenario_section(self):
        """Test _extract_scenario_section static method."""
        # Test with envelope payload
        envelope_payload = {"version": "1.0", "scenario": {"title": "Envelope Test"}}
        result = Scenario._extract_scenario_section(envelope_payload)
        assert result == {"title": "Envelope Test"}

        # Test with direct payload
        direct_payload = {"title": "Direct Test"}
        result = Scenario._extract_scenario_section(direct_payload)
        assert result == {"title": "Direct Test"}

    @pytest.mark.unit
    def test_scenario_normalize_top_level_fields(self):
        """Test _normalize_top_level_fields static method."""
        raw_payload = {
            "title": "Test Title",
            "description": "Test Description",
            "metadata": {"key": "value"},
        }

        result = Scenario._normalize_top_level_fields(raw_payload)

        expected = {"scenarioName": "Test Title", "metadata": {"key": "value"}}
        assert result == expected

    @pytest.mark.unit
    def test_scenario_normalize_with_missing_fields(self):
        """Test _normalize_top_level_fields with missing fields."""
        raw_payload = {}

        result = Scenario._normalize_top_level_fields(raw_payload)

        expected = {"scenarioName": "", "metadata": {}}
        assert result == expected

    @pytest.mark.unit
    def test_scenario_build_voice_with_full_config(self):
        """Test _build_voice static method with full configuration."""
        raw_payload = {
            "voice": {
                "name": "test_voice",
                "provider": "DEEPGRAM",  # Test case conversion
                "config": {
                    "model": "nova-2",
                    "voice_id": "test_id",
                    "speaker": "test_speaker",
                },
            }
        }

        result = Scenario._build_voice(raw_payload)

        assert isinstance(result, ScenarioVoice)
        assert result.name == "test_voice"
        assert result.provider == "deepgram"  # Should be lowercase
        assert result.config.model == "nova-2"
        assert result.config.voice_id == "test_id"
        assert result.config.speaker == "test_speaker"

    @pytest.mark.unit
    def test_scenario_build_voice_with_minimal_config(self):
        """Test _build_voice with minimal configuration."""
        raw_payload = {"voice": {"name": "minimal_voice", "provider": "elevenlabs"}}

        result = Scenario._build_voice(raw_payload)

        assert isinstance(result, ScenarioVoice)
        assert result.name == "minimal_voice"
        assert result.provider == "elevenlabs"
        assert result.config.model is None
        assert result.config.voice_id is None
        assert result.config.speaker is None

    @pytest.mark.unit
    def test_scenario_build_voice_with_camelcase_voice_id(self):
        """Test _build_voice with camelCase voiceId (backward compatibility)."""
        raw_payload = {
            "voice": {
                "name": "test_voice",
                "provider": "elevenlabs",
                "config": {
                    "model": "eleven_multilingual_v2",
                    "voiceId": "test-voice-id-camel",  # camelCase
                },
            }
        }

        result = Scenario._build_voice(raw_payload)

        assert isinstance(result, ScenarioVoice)
        assert result.name == "test_voice"
        assert result.provider == "elevenlabs"
        assert result.config.model == "eleven_multilingual_v2"
        assert result.config.voice_id == "test-voice-id-camel"  # Should parse camelCase

    @pytest.mark.unit
    def test_scenario_build_voice_with_no_voice(self):
        """Test _build_voice with no voice configuration."""
        raw_payload = {}

        result = Scenario._build_voice(raw_payload)

        assert result is None

    @pytest.mark.unit
    def test_scenario_build_prompt_data_success(self):
        """Test _build_prompt_data with valid data."""
        raw_payload = {
            "promptData": {
                "name": "Test Character",
                "age": 25,
                "gender": "female",
                "genderIdentity": "female",
                "sexualOrientation": "heterosexual",
                "currentLocation": "Test City",
                "profession": "Teacher",
                "context": "Test context",
                "sessionBehaviorGuidelines": "Be helpful",
                "lifeHistory": "Test history",
                "coreMemories": "Important memories",
                "personality": "Friendly",
                "startingState": "Calm",
                "emotionalNeeds": "Support",
                "tone": "Professional",
                "openingStatements": ["Hello!", "How are you?"],
                "agentGoal": "Help users",
            }
        }

        result = Scenario._build_prompt_data(raw_payload)

        assert isinstance(result, PromptData)
        assert result.name == "Test Character"
        assert result.age == "25"  # Converted to string
        assert result.gender == "female"
        assert result.gender_identity == "female"
        assert result.sexual_orientation == "heterosexual"
        assert result.current_location == "Test City"
        assert result.profession == "Teacher"
        assert len(result.opening_statements) == 2

    @pytest.mark.unit
    def test_scenario_build_prompt_data_missing_key(self, mock_logger):
        """A missing `promptData` key yields a default PromptData, not None.

        Regression: `_build_prompt_data` used to return None here, and
        `Scenario.prompt_data` is a non-optional field, so the None went
        straight into the constructor and blew up with a pydantic
        ValidationError — the worker never started the agent.
        """
        raw_payload = {}

        with patch("app.core.scenario.base.logger", mock_logger):
            result = Scenario._build_prompt_data(raw_payload)

            assert isinstance(result, PromptData)
            assert result.name is None
            assert result.opening_statements == []
            mock_logger.warning.assert_called_once()
            warning_call = mock_logger.warning.call_args[0][0]
            assert "'promptData'" in warning_call

    @pytest.mark.unit
    def test_scenario_build_prompt_data_empty_dict(self, mock_logger):
        """An empty `promptData` dict yields a default PromptData, not None.

        Regression: `if not prompt_data_dict:` is true for `{}` as well as for
        a missing key, so an author who saved a scenario with empty prompt
        data crashed `Scenario.create` the same way.
        """
        raw_payload = {"promptData": {}}

        with patch("app.core.scenario.base.logger", mock_logger):
            result = Scenario._build_prompt_data(raw_payload)

        assert isinstance(result, PromptData)
        assert result.name is None

    @pytest.mark.unit
    def test_scenario_create_survives_empty_prompt_data(self):
        """`Scenario.create` must not raise when promptData is empty/absent.

        This is the crash the regression is really about: the None returned by
        `_build_prompt_data` reached the `prompt_data: PromptData` field.
        """
        for prompt_data_payload in ({}, None):
            payload = {"title": "Empty Prompt Data"}
            if prompt_data_payload is not None:
                payload["promptData"] = prompt_data_payload

            scenario = Scenario.create(payload)

            assert isinstance(scenario.prompt_data, PromptData)
            assert scenario.name == "Empty Prompt Data"

    @pytest.mark.unit
    def test_scenario_build_prompt_data_with_exception(self, mock_logger):
        """Test _build_prompt_data with exception during creation."""
        raw_payload = {
            "promptData": {
                "name": "Test",
                # Character fields are optional now, so a missing field no
                # longer fails. Pass an invalid type for a strictly-typed
                # field to trigger the ValidationError -> PromptData() path.
                "prompts": 123,
            }
        }

        with patch("app.core.scenario.base.logger", mock_logger):
            result = Scenario._build_prompt_data(raw_payload)

            assert isinstance(result, PromptData)
            mock_logger.error.assert_called_once()
            error_call = mock_logger.error.call_args[0][0]
            assert "Error instantiating PromptData" in error_call

    @pytest.mark.unit
    def test_scenario_create_with_events_mocked(self):
        """Test Scenario.create with mocked event building."""
        payload = {
            "title": "Events Test",
            "description": "Test with events",
            "promptData": {
                "name": "Events Character",
                "age": 30,
                "gender": "male",
                "currentLocation": "Events City",
                "context": "Events context",
                "lifeHistory": "Events history",
                "openingStatements": ["Events greeting!"],
            },
            "events": [{"id": "test_event", "type": "test"}],
            "voice": {"name": "test_voice", "provider": "deepgram", "config": {}},
        }

        mock_events = [DummyEvent(event_id="e1"), DummyEvent(event_id="e2")]

        with patch(
            "app.core.scenario.base.build_events_from_metadata",
            return_value=mock_events,
        ):
            scenario = Scenario.create(payload)

            assert scenario.events == mock_events

    @pytest.mark.unit
    def test_scenario_create_integration_flow(self):
        """Test the complete Scenario.create integration flow."""
        payload = {
            "version": "2.0",
            "scenario": {
                "title": "Integration Test",
                "description": "Full integration test",
                "metadata": {"test": "integration"},
                "voice": {
                    "name": "integration_voice",
                    "provider": "openai",
                    "config": {"model": "tts-1"},
                },
                "promptData": {
                    "name": "Integration Character",
                    "age": 40,
                    "gender": "non-binary",
                    "currentLocation": "Integration City",
                    "context": "Integration context",
                    "lifeHistory": "Integration history",
                    "openingStatements": ["Integration greeting!"],
                },
            },
        }

        scenario = Scenario.create(payload)

        # Verify all components were created correctly
        assert scenario.name == "Integration Test"
        assert scenario.metadata == {"test": "integration"}

        # Verify voice integration
        assert isinstance(scenario.voice, ScenarioVoice)
        assert scenario.voice.name == "integration_voice"
        assert scenario.voice.provider == "openai"

        # Verify prompt data integration
        assert isinstance(scenario.prompt_data, PromptData)
        assert scenario.prompt_data.name == "Integration Character"
        assert scenario.prompt_data.age == "40"

    # -------------------- _parse_conversation_started_at --------------------

    @pytest.mark.unit
    def test_parse_conversation_started_at_z_suffix(self):
        """Z-suffix is normalised to +00:00 offset."""
        result = Scenario._parse_conversation_started_at("2026-03-23T07:01:44.447Z")
        assert result == "2026-03-23T07:01:44.447000+00:00"

    @pytest.mark.unit
    def test_parse_conversation_started_at_plus_offset(self):
        """Explicit +00:00 offset is accepted and preserved."""
        result = Scenario._parse_conversation_started_at("2026-03-23T07:01:44+00:00")
        assert result == "2026-03-23T07:01:44+00:00"

    @pytest.mark.unit
    def test_parse_conversation_started_at_naive_assumed_utc(self):
        """Naive datetime (no tzinfo) is treated as UTC."""
        result = Scenario._parse_conversation_started_at("2026-03-23T07:01:44")
        assert result is not None
        assert "+00:00" in result

    @pytest.mark.unit
    def test_parse_conversation_started_at_none(self):
        """None input returns None."""
        assert Scenario._parse_conversation_started_at(None) is None

    @pytest.mark.unit
    def test_parse_conversation_started_at_empty_string(self):
        """Empty string returns None."""
        assert Scenario._parse_conversation_started_at("") is None

    @pytest.mark.unit
    def test_parse_conversation_started_at_invalid_returns_none(self, mock_logger):
        """Unparseable value logs a warning and returns None."""
        with patch("app.core.scenario.base.logger", mock_logger):
            result = Scenario._parse_conversation_started_at("not-a-date")
        assert result is None
        mock_logger.warning.assert_called_once()

    # -------------------- conversationStartedAt in create() --------------------

    @pytest.mark.unit
    def test_scenario_create_sets_conversation_started_at(self):
        """conversationStartedAt from top-level scenarioSession is stored
        on scenario."""
        payload = {
            "version": "1.0",
            "scenario": {
                "title": "Started At Test",
                "promptData": {
                    "name": "Test Character",
                    "age": 25,
                    "gender": "female",
                    "currentLocation": "City",
                    "context": "ctx",
                    "lifeHistory": "history",
                    "openingStatements": ["Hello!"],
                },
            },
            "scenarioSession": {
                "conversationStartedAt": "2026-03-23T07:01:44.447Z",
            },
        }
        scenario = Scenario.create(payload)
        assert scenario.conversation_started_at == "2026-03-23T07:01:44.447000+00:00"

    @pytest.mark.unit
    def test_scenario_create_conversation_started_at_absent(self):
        """When scenarioSession is absent, conversation_started_at is None."""
        payload = {
            "title": "No Started At",
            "promptData": {
                "name": "Test Character",
                "age": 25,
                "gender": "female",
                "currentLocation": "City",
                "context": "ctx",
                "lifeHistory": "history",
                "openingStatements": ["Hello!"],
            },
        }
        scenario = Scenario.create(payload)
        assert scenario.conversation_started_at is None

    @pytest.mark.unit
    def test_scenario_create_conversation_started_at_empty_session(self):
        """Empty scenarioSession leaves conversation_started_at as None."""
        payload = {
            "version": "1.0",
            "scenario": {
                "title": "Empty Session Test",
                "promptData": {
                    "name": "Test Character",
                    "age": 25,
                    "gender": "female",
                    "currentLocation": "City",
                    "context": "ctx",
                    "lifeHistory": "history",
                    "openingStatements": ["Hello!"],
                },
            },
            "scenarioSession": {},
        }
        scenario = Scenario.create(payload)
        assert scenario.conversation_started_at is None

    @pytest.mark.unit
    def test_scenario_model_config(self):
        """Test Scenario model configuration."""
        # Test populate_by_name allows both alias and field name, and
        # ensure nested models provided
        scenario_data = {
            "scenarioName": "Alias Test",  # Using alias
            "voice": ScenarioVoice(
                name="config_voice",
                provider="openai",
                config=VoiceConfig(model="tts-1"),
            ),
            "prompt_data": PromptData(
                name="Config Character",
                age="22",
                gender="female",
                current_location="Config City",
                context="Config context",
                character_profile_text="Config profile",
                opening_statements=["Hi"],
            ),
        }

        scenario = Scenario(**scenario_data)

        assert scenario.name == "Alias Test"


class TestScenarioIntegration:
    """Integration tests for Scenario with real dependencies."""

    @pytest.mark.integration
    def test_scenario_full_creation_flow(self, sample_room_metadata):
        """Test complete scenario creation with real dependencies."""
        scenario = Scenario.create(sample_room_metadata)

        # Verify scenario structure
        assert isinstance(scenario, Scenario)
        AssertionHelpers.assert_scenario_has_required_fields(scenario)

        # Verify voice integration
        if scenario.voice:
            AssertionHelpers.assert_voice_config_valid(scenario.voice.config)

        # Verify prompt data integration
        if scenario.prompt_data:
            AssertionHelpers.assert_prompt_data_valid(scenario.prompt_data)

    @pytest.mark.integration
    def test_scenario_with_real_events_factory(self):
        """Test scenario creation with real events factory."""
        payload = {
            "title": "Real Events Test",
            "description": "Test with real event factory",
            "promptData": {
                "name": "Real Events Character",
                "age": 33,
                "gender": "male",
                "currentLocation": "Real City",
                "context": "Real context",
                "lifeHistory": "Real history",
                "openingStatements": ["Real greeting!"],
            },
            "events": [],  # Empty events for now
            "voice": {"name": "test_voice", "provider": "deepgram", "config": {}},
        }

        scenario = Scenario.create(payload)

        # Should handle real event factory (even with empty events)
        assert isinstance(scenario, Scenario)
        assert isinstance(scenario.events, list)
