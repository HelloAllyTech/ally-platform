"""Comprehensive tests for livekit_models module."""

from unittest.mock import Mock, patch

import pytest
from pydantic import ValidationError

from app.core.livekit.livekit_models import RoomMetadataEnvelope
from app.core.scenario.base import Scenario
from tests.utils.test_helpers import AssertionHelpers, DataBuilder


class TestRoomMetadataEnvelope:
    """Test cases for RoomMetadataEnvelope model."""

    @pytest.mark.unit
    def test_create_with_full_payload(self, sample_room_metadata):
        """Test creating envelope with full payload."""
        envelope = RoomMetadataEnvelope.create(sample_room_metadata)

        assert isinstance(envelope, RoomMetadataEnvelope)
        assert envelope.version == "1.0"
        assert isinstance(envelope.scenario, Scenario)
        AssertionHelpers.assert_valid_room_metadata_envelope(envelope, "1.0")

    @pytest.mark.unit
    def test_create_with_minimal_payload(self):
        """Test creating envelope with minimal payload."""
        minimal_payload = {
            "scenario": {
                "title": "Minimal Test",
                "description": "Minimal description",
                "promptData": {
                    "name": "Test Character",
                    "age": 25,
                    "gender": "female",
                    "currentLocation": "Test City",
                    "context": "Test context",
                    "lifeHistory": "Test history",
                    "openingStatements": ["Hello!"],
                },
                # Include minimal voice config to satisfy Scenario.voice requirement
                "voice": {"name": "test_voice", "provider": "deepgram", "config": {}},
            }
        }

        envelope = RoomMetadataEnvelope.create(minimal_payload)

        assert isinstance(envelope, RoomMetadataEnvelope)
        assert envelope.version == "1.0"  # Default version
        assert isinstance(envelope.scenario, Scenario)

    @pytest.mark.unit
    def test_create_with_custom_version(self):
        """Test creating envelope with custom version."""
        payload = {
            "version": "2.5",
            "scenario": {
                "title": "Version Test",
                "description": "Test with custom version",
                "promptData": {
                    "name": "Version Character",
                    "age": 30,
                    "gender": "male",
                    "currentLocation": "Version City",
                    "context": "Version context",
                    "lifeHistory": "Version history",
                    "openingStatements": ["Version greeting!"],
                },
                "voice": {"name": "test_voice", "provider": "deepgram", "config": {}},
            },
        }

        envelope = RoomMetadataEnvelope.create(payload)

        assert envelope.version == "2.5"
        AssertionHelpers.assert_valid_room_metadata_envelope(envelope, "2.5")

    @pytest.mark.unit
    def test_create_with_empty_payload(self):
        """An empty payload yields an empty envelope rather than raising.

        This used to assert ValidationError, but the error was the incidental
        symptom of `_build_prompt_data` returning None for absent/empty
        `promptData` and that None hitting the non-optional
        `Scenario.prompt_data`. Missing prompt data is now a default
        PromptData, so the envelope builds and the scenario is simply empty.
        """
        envelope = RoomMetadataEnvelope.create({})

        assert isinstance(envelope.scenario, Scenario)
        assert envelope.scenario.name == ""
        assert envelope.scenario.prompt_data.name is None

    @pytest.mark.unit
    def test_create_with_scenario_only_payload(self):
        """Test creating envelope from scenario-only payload."""
        scenario_payload = {
            "title": "Direct Scenario",
            "description": "Direct scenario test",
            "promptData": {
                "name": "Direct Character",
                "age": 28,
                "gender": "non-binary",
                "currentLocation": "Direct City",
                "context": "Direct context",
                "lifeHistory": "Direct history",
                "openingStatements": ["Direct greeting!"],
            },
            # Include minimal voice to satisfy validation
            "voice": {"name": "test_voice", "provider": "deepgram", "config": {}},
        }

        envelope = RoomMetadataEnvelope.create(scenario_payload)

        assert envelope.version == "1.0"  # Default version
        assert isinstance(envelope.scenario, Scenario)
        assert envelope.scenario.name == "Direct Scenario"

    @pytest.mark.unit
    def test_create_preserves_scenario_data(self, sample_room_metadata):
        """Test that scenario data is preserved correctly."""
        envelope = RoomMetadataEnvelope.create(sample_room_metadata)

        scenario = envelope.scenario
        assert scenario.name == "Test Scenario"

        # Verify voice configuration is preserved
        if hasattr(scenario, "voice") and scenario.voice:
            assert scenario.voice.name == "test_voice"
            assert scenario.voice.provider == "deepgram"

    def test_create_with_nested_scenario_payload(self):
        """Test creating envelope with nested scenario in payload."""
        nested_payload = {
            "version": "1.5",
            "scenario": {
                "scenario": {
                    "title": "Nested Test",
                    "description": "Nested scenario test",
                    "promptData": {
                        "name": "Nested Character",
                        "age": 32,
                        "gender": "male",
                        "currentLocation": "Nested City",
                        "context": "Nested context",
                        "lifeHistory": "Nested history",
                        "openingStatements": ["Nested greeting!"],
                    },
                    "voice": {
                        "name": "test_voice",
                        "provider": "deepgram",
                        "config": {},
                    },
                }
            },
        }
        # Current implementation doesn't extract from non-standard nesting:
        # the inner `scenario` key is never unwrapped, so none of the nested
        # title/promptData/voice is picked up. That used to surface as a
        # ValidationError (None prompt data); it is now an empty scenario.
        envelope = RoomMetadataEnvelope.create(nested_payload)

        assert envelope.version == "1.5"
        assert envelope.scenario.name == ""
        assert envelope.scenario.voice is None
        assert envelope.scenario.prompt_data.name is None

    @pytest.mark.unit
    def test_create_with_mock_scenario(self):
        """Test creating envelope with mocked Scenario.create."""
        payload = {"test": "data"}
        mock_scenario = Mock(spec=Scenario)

        with patch(
            "app.core.scenario.base.Scenario.create", return_value=mock_scenario
        ) as mock_create:
            envelope = RoomMetadataEnvelope.create(payload)

            assert envelope.scenario == mock_scenario
            assert envelope.version == "1.0"  # Default
            mock_create.assert_called_once_with(
                payload, embedding_client=None, branching_llm_config=None
            )

    @pytest.mark.unit
    def test_envelope_model_validation(self):
        """Test Pydantic model validation."""
        # Test with valid data
        scenario = Mock(spec=Scenario)
        envelope = RoomMetadataEnvelope(version="1.0", scenario=scenario)

        assert envelope.version == "1.0"
        assert envelope.scenario == scenario

    @pytest.mark.unit
    def test_envelope_model_validation_errors(self):
        """Test Pydantic model validation with invalid data."""
        # Test missing required fields
        with pytest.raises(ValidationError):
            RoomMetadataEnvelope()

        with pytest.raises(ValidationError):
            RoomMetadataEnvelope(version="1.0")  # Missing scenario

        with pytest.raises(ValidationError):
            RoomMetadataEnvelope(scenario=Mock())  # Missing version

    @pytest.mark.unit
    def test_envelope_serialization(self, sample_room_metadata):
        """Test envelope serialization to dict."""
        envelope = RoomMetadataEnvelope.create(sample_room_metadata)

        # Test model_dump (Pydantic v2)
        envelope_dict = envelope.model_dump()

        assert isinstance(envelope_dict, dict)
        assert "version" in envelope_dict
        assert "scenario" in envelope_dict
        assert envelope_dict["version"] == "1.0"

    @pytest.mark.unit
    def test_create_with_builder_pattern(self):
        """Test creating envelope using DataBuilder."""
        builder = DataBuilder()
        payload = (
            builder.with_version("3.0")
            .with_scenario(
                title="Builder Test",
                description="Test with builder pattern",
            )
            .with_voice("builder_voice", "elevenlabs", model="eleven_multilingual_v2")
            .with_prompt_data(
                name="Builder Character",
                age=27,
                gender="female",
                currentLocation="Builder City",
                context="Builder context",
                lifeHistory="Builder history",
                openingStatements=["Builder greeting!"],
            )
            .build()
        )

        envelope = RoomMetadataEnvelope.create(payload)

        assert envelope.version == "3.0"
        assert isinstance(envelope.scenario, Scenario)
        AssertionHelpers.assert_valid_room_metadata_envelope(envelope, "3.0")

    @pytest.mark.unit
    def test_create_performance_large_payload(self, large_metadata):
        """Test performance with large payload."""
        import time

        start_time = time.time()
        envelope = RoomMetadataEnvelope.create(large_metadata)
        end_time = time.time()

        # Should complete within reasonable time
        execution_time = end_time - start_time
        assert execution_time < 2.0  # 2 seconds max

        assert isinstance(envelope, RoomMetadataEnvelope)
        AssertionHelpers.assert_valid_room_metadata_envelope(envelope)

    @pytest.mark.unit
    def test_create_thread_safety(self, sample_room_metadata):
        """Test thread safety of create method."""
        import threading

        results = []
        errors = []

        def worker():
            try:
                envelope = RoomMetadataEnvelope.create(sample_room_metadata)
                results.append(envelope)
            except Exception as e:
                errors.append(e)

        # Run multiple threads
        threads = []
        for _ in range(5):
            thread = threading.Thread(target=worker)
            threads.append(thread)
            thread.start()

        for thread in threads:
            thread.join()

        # Verify no errors and all completed
        assert len(errors) == 0
        assert len(results) == 5

        # Verify all results are valid
        for envelope in results:
            assert isinstance(envelope, RoomMetadataEnvelope)
            AssertionHelpers.assert_valid_room_metadata_envelope(envelope)

    @pytest.mark.unit
    @pytest.mark.parametrize(
        "payload_type",
        ["full_payload", "minimal_payload", "empty_payload", "scenario_only"],
    )
    def test_create_with_various_payload_types(
        self, payload_type, room_metadata_factory
    ):
        """Test create method with various payload types."""
        payloads = {
            "full_payload": room_metadata_factory(
                version="1.0",
                scenario={
                    "title": "Full Test",
                    "voice": {"name": "test", "provider": "deepgram", "config": {}},
                },
            ),
            # Include minimal voice config to satisfy Scenario.voice requirement
            "minimal_payload": room_metadata_factory(
                scenario={
                    "title": "Minimal",
                    "voice": {"name": "test", "provider": "deepgram", "config": {}},
                }
            ),
            "empty_payload": {},
            "scenario_only": {"title": "Direct", "description": "Direct test"},
        }

        payload = payloads[payload_type]

        # Every shape builds, including the two without `promptData` — those
        # used to raise ValidationError because `_build_prompt_data` returned
        # None for absent prompt data.
        envelope = RoomMetadataEnvelope.create(payload)

        assert isinstance(envelope, RoomMetadataEnvelope)
        assert envelope.version  # Should have some version
        assert isinstance(envelope.scenario, Scenario)


class TestRoomMetadataEnvelopeIntegration:
    """Integration tests for RoomMetadataEnvelope."""

    @pytest.mark.integration
    def test_full_integration_with_real_scenario(self, sample_room_metadata):
        """Test full integration with real Scenario creation."""
        envelope = RoomMetadataEnvelope.create(sample_room_metadata)

        # Verify envelope structure
        assert isinstance(envelope, RoomMetadataEnvelope)
        assert envelope.version == "1.0"

        # Verify scenario integration
        scenario = envelope.scenario
        assert isinstance(scenario, Scenario)
        assert scenario.name == "Test Scenario"

        # Verify prompt data integration
        if hasattr(scenario, "prompt_data") and scenario.prompt_data:
            assert scenario.prompt_data.name == "Test Character"
            assert scenario.prompt_data.age == "25"
            assert scenario.prompt_data.gender == "non-binary"

    @pytest.mark.integration
    def test_envelope_scenario_voice_integration(self, sample_room_metadata):
        """Test integration between envelope and scenario voice configuration."""
        envelope = RoomMetadataEnvelope.create(sample_room_metadata)

        scenario = envelope.scenario
        if hasattr(scenario, "voice") and scenario.voice:
            voice = scenario.voice
            assert voice.name == "test_voice"
            assert voice.provider == "deepgram"

            if hasattr(voice, "config") and voice.config:
                config = voice.config
                AssertionHelpers.assert_voice_config_valid(config)

    @pytest.mark.integration
    def test_envelope_with_events_integration(self):
        """Test envelope integration with scenario events."""
        payload = {
            "version": "1.0",
            "scenario": {
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
                "events": [
                    {"id": "test_event_1", "type": "test", "data": {}},
                    {"id": "test_event_2", "type": "test", "data": {}},
                ],
                "voice": {
                    "name": "test_voice",
                    "provider": "deepgram",
                    "config": {"model": "test-voice"},
                },
            },
        }

        envelope = RoomMetadataEnvelope.create(payload)

        assert isinstance(envelope, RoomMetadataEnvelope)
        scenario = envelope.scenario

        # Events should be processed by scenario
        assert hasattr(scenario, "events")
        # Note: Actual event processing depends on event factory implementation
