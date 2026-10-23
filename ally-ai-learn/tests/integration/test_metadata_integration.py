"""Integration tests for metadata parsing and scenario creation."""

import json

import pytest

from app.core.agent.factory import parse_room_metadata
from app.core.livekit.livekit_models import RoomMetadataEnvelope
from app.core.scenario.base import PromptData, Scenario, ScenarioVoice
from tests.fixtures.scenario_fixtures import (
    COMPLEX_SCENARIO_PAYLOAD,
    MINIMAL_SCENARIO_PAYLOAD,
    create_room_metadata_envelope_payload,
)


class TestMetadataParsingIntegration:
    """Integration tests for the complete metadata parsing flow."""

    @pytest.mark.integration
    def test_full_metadata_parsing_flow(self):
        """Test the complete flow from JSON to parsed scenario."""
        # Create a complete payload
        payload = create_room_metadata_envelope_payload(
            version="2.0",
            scenario={
                "title": "Integration Test Scenario",
                "description": "Full integration test",
                "voice": {
                    "name": "integration_voice",
                    "provider": "deepgram",
                    "config": {"model": "nova-2", "voice_id": "test_id"},
                },
            },
        )

        # Convert to JSON
        json_metadata = json.dumps(payload)

        # Parse through the complete flow
        envelope = parse_room_metadata(json_metadata)

        # Verify envelope structure
        assert isinstance(envelope, RoomMetadataEnvelope)
        assert envelope.version == "2.0"

        # Verify scenario was created correctly
        scenario = envelope.scenario
        assert isinstance(scenario, Scenario)
        assert scenario.name == "Integration Test Scenario"

        # Verify voice integration
        assert isinstance(scenario.voice, ScenarioVoice)
        assert scenario.voice.name == "integration_voice"
        assert scenario.voice.provider == "deepgram"
        assert scenario.voice.config.model == "nova-2"

        # Verify prompt data integration
        assert isinstance(scenario.prompt_data, PromptData)
        assert scenario.prompt_data.name == "Test Character"

    @pytest.mark.integration
    def test_minimal_metadata_integration(self):
        """Test integration with minimal metadata."""
        payload = {"scenario": MINIMAL_SCENARIO_PAYLOAD}
        json_metadata = json.dumps(payload)

        envelope = parse_room_metadata(json_metadata)

        assert isinstance(envelope, RoomMetadataEnvelope)
        assert envelope.version == "1.0"  # Default version

        scenario = envelope.scenario
        assert scenario.name == "Minimal Scenario"
        assert isinstance(scenario.voice, ScenarioVoice)  # Minimal voice present
        assert isinstance(scenario.prompt_data, PromptData)

    @pytest.mark.integration
    def test_complex_metadata_integration(self):
        """Test integration with complex metadata."""
        payload = {"version": "3.0", "scenario": COMPLEX_SCENARIO_PAYLOAD}
        json_metadata = json.dumps(payload)

        envelope = parse_room_metadata(json_metadata)

        assert isinstance(envelope, RoomMetadataEnvelope)
        assert envelope.version == "3.0"

        scenario = envelope.scenario
        assert scenario.name == "Complex Scenario"
        assert scenario.metadata["complexity"] == "high"
        assert "advanced" in scenario.metadata["tags"]

        # Verify voice configuration
        assert isinstance(scenario.voice, ScenarioVoice)
        assert scenario.voice.provider == "elevenlabs"
        assert scenario.voice.config.model == "eleven_multilingual_v2"

    @pytest.mark.integration
    def test_error_recovery_integration(self, monkeypatch):
        """Test error recovery in the complete integration flow."""
        from app.core.config import settings
        from app.core.constants import Environment

        # Ensure we're in PROD mode so ValueError is raised for invalid JSON
        monkeypatch.setattr(settings, "ENV", Environment.PROD)

        # Test with invalid JSON
        invalid_json = '{"invalid": json}'
        # With the updated parse_room_metadata behavior, invalid/missing
        # metadata in non-LOCAL environments raises ValueError before
        # model creation.
        with pytest.raises(ValueError):
            parse_room_metadata(invalid_json)

    @pytest.mark.integration
    def test_unicode_handling_integration(self):
        """Test Unicode character handling in integration."""
        payload = create_room_metadata_envelope_payload(
            scenario={
                "title": "Unicode Test 测试 🎭",
                "description": "Testing unicode characters: café naïve résumé",
                "promptData": {
                    "name": "Unicode Character 角色",
                    "currentLocation": "São Paulo, Brasil 🇧🇷",
                },
            }
        )

        json_metadata = json.dumps(payload, ensure_ascii=False)
        envelope = parse_room_metadata(json_metadata)

        assert isinstance(envelope, RoomMetadataEnvelope)
        scenario = envelope.scenario
        assert "测试" in scenario.name
        assert "🎭" in scenario.name
        assert "角色" in scenario.prompt_data.name
        assert "🇧🇷" in scenario.prompt_data.current_location

    @pytest.mark.integration
    def test_custom_fields_filtering_integration(self):
        """Test that custom fields include useInDefaultPrompt flag correctly."""
        payload = create_room_metadata_envelope_payload(
            scenario={
                "promptData": {
                    "customFields": [
                        {
                            "name": "Field 1",
                            "value": "Visible",
                            "useInDefaultPrompt": True,
                        },
                        {
                            "name": "Field 2",
                            "value": "Hidden",
                            "useInDefaultPrompt": False,
                        },
                        {
                            "name": "Field 3",
                            "value": "Default Visible",
                        },  # No flag, should default to True
                    ]
                }
            }
        )

        json_metadata = json.dumps(payload)
        envelope = parse_room_metadata(json_metadata)
        scenario = envelope.scenario

        # Verify parsing
        custom_fields = scenario.prompt_data.custom_fields
        assert len(custom_fields) == 3
        assert custom_fields[0]["useInDefaultPrompt"] is True
        assert custom_fields[1]["useInDefaultPrompt"] is False
        assert "useInDefaultPrompt" not in custom_fields[2]

        # Verify prompt generation filtering
        from app.core.graph.prompt import _format_custom_fields_text

        formatted = _format_custom_fields_text(custom_fields)

        assert "Field 1" in formatted
        assert "Visible" in formatted
        assert "Field 2" not in formatted
        assert "Hidden" not in formatted
        assert "Field 3" in formatted
        assert "Default Visible" in formatted

    @pytest.mark.integration
    @pytest.mark.parametrize("provider", ["deepgram", "elevenlabs", "sarvam"])
    def test_voice_provider_integration(self, provider):
        """Test integration with different voice providers."""
        voice_configs = {
            "deepgram": {"model": "nova-2"},
            "elevenlabs": {"model": "eleven_multilingual_v2", "voice_id": "test_id"},
            "sarvam": {"model": "bulbul:v2", "voice_id": "karun"},
        }

        payload = create_room_metadata_envelope_payload(
            scenario={
                "voice": {
                    "name": f"{provider}_voice",
                    "provider": provider,
                    "config": voice_configs[provider],
                }
            }
        )

        json_metadata = json.dumps(payload)
        envelope = parse_room_metadata(json_metadata)

        scenario = envelope.scenario
        assert isinstance(scenario.voice, ScenarioVoice)
        assert scenario.voice.provider == provider
        assert scenario.voice.config.model == voice_configs[provider]["model"]

    @pytest.mark.integration
    def test_large_payload_integration(self):
        """Test integration with large payload."""
        # Create a large payload
        large_prompt_data = {
            "name": "Large Character",
            "age": 35,
            "gender": "female",
            "currentLocation": "Large City",
            "context": "A" * 1000,  # Large context
            "lifeHistory": "B" * 2000,  # Large history
            "openingStatements": [
                f"Statement {i}" for i in range(50)
            ],  # Many statements
        }

        payload = create_room_metadata_envelope_payload(
            scenario={
                "title": "Large Scenario",
                "description": "C" * 500,  # Large description
                "promptData": large_prompt_data,
                "metadata": {
                    f"key_{i}": f"value_{i}" for i in range(100)
                },  # Large metadata
            }
        )

        json_metadata = json.dumps(payload)

        # Should handle large payload without issues
        envelope = parse_room_metadata(json_metadata)

        assert isinstance(envelope, RoomMetadataEnvelope)
        scenario = envelope.scenario
        assert len(scenario.prompt_data.context) == 1000
        assert len(scenario.prompt_data.opening_statements) == 50
        assert len(scenario.metadata) == 100

    @pytest.mark.integration
    def test_nested_scenario_extraction_integration(self):
        """Test integration with deeply nested scenario data."""
        nested_payload = {
            "version": "1.5",
            "outer_wrapper": {
                "scenario": {
                    "title": "Nested Integration Test",
                    "description": "Testing nested extraction",
                    "promptData": {
                        "name": "Nested Character",
                        "age": 28,
                        "gender": "male",
                        "currentLocation": "Nested City",
                        "context": "Nested context",
                        "lifeHistory": "Nested history",
                        "openingStatements": ["Nested greeting!"],
                    },
                    "voice": {
                        "name": "Nested Voice",
                        "provider": "deepgram",
                        "config": {"model": "aura-2-pandora-en"},
                    },
                }
            },
        }

        json_metadata = json.dumps(nested_payload)
        # Current implementation does not support extracting scenario data from
        # non-standard nested keys (e.g., "outer_wrapper"), so nothing from the
        # wrapper is picked up. That used to surface as a ValidationError
        # (absent promptData -> None -> non-optional Scenario.prompt_data);
        # absent prompt data now defaults instead, so parsing succeeds and
        # simply yields an empty scenario.
        envelope = parse_room_metadata(json_metadata)

        assert envelope.version == "1.5"
        assert envelope.scenario.name == ""
        assert envelope.scenario.voice is None
        assert envelope.scenario.prompt_data.name is None

    @pytest.mark.integration
    def test_concurrent_parsing_integration(self):
        """Test concurrent parsing of metadata (thread safety)."""
        import threading

        payload = create_room_metadata_envelope_payload()
        json_metadata = json.dumps(payload)

        results = []
        errors = []

        def worker():
            try:
                envelope = parse_room_metadata(json_metadata)
                results.append(envelope)
            except Exception as e:
                errors.append(e)

        # Run multiple threads concurrently
        threads = []
        for _ in range(10):
            thread = threading.Thread(target=worker)
            threads.append(thread)
            thread.start()

        # Wait for all threads
        for thread in threads:
            thread.join()

        # Verify all succeeded
        assert len(errors) == 0
        assert len(results) == 10

        # Verify all results are valid
        for envelope in results:
            assert isinstance(envelope, RoomMetadataEnvelope)
            assert isinstance(envelope.scenario, Scenario)

    @pytest.mark.integration
    def test_memory_usage_integration(self):
        """Test memory usage with repeated parsing."""
        import gc

        payload = create_room_metadata_envelope_payload()
        json_metadata = json.dumps(payload)

        # Parse multiple times to check for memory leaks
        envelopes = []
        for _ in range(100):
            envelope = parse_room_metadata(json_metadata)
            envelopes.append(envelope)

        # Force garbage collection
        gc.collect()

        # Verify all envelopes are still valid
        for envelope in envelopes:
            assert isinstance(envelope, RoomMetadataEnvelope)
            assert isinstance(envelope.scenario, Scenario)

        # This test mainly ensures no exceptions occur during repeated parsing
