"""Comprehensive tests for metadata_parser module."""

import json
import threading
import time
from unittest.mock import Mock, patch

import pytest

from app.core.agent.factory import parse_room_metadata
from app.core.config import settings
from app.core.constants import Environment
from app.core.livekit.livekit_models import RoomMetadataEnvelope
from tests.utils.test_helpers import AssertionHelpers, DataBuilder

# Deterministic SCENARIO_SAMPLE used for LOCAL fallback tests
LOCAL_SCENARIO_SAMPLE = {
    "version": "local-sample",
    "scenario": {"title": "Local Sample", "description": "Used in local tests"},
}


class TestParseRoomMetadata:
    """Test cases for parse_room_metadata function."""

    @pytest.mark.unit
    def test_parse_valid_json_metadata(
        self, sample_room_metadata_json, mock_logger, monkeypatch
    ):
        """Test parsing valid JSON metadata in PROD (uses incoming metadata)."""
        monkeypatch.setattr(settings, "ENV", Environment.PROD)

        parsed_expected = json.loads(sample_room_metadata_json)
        with patch(
            "app.core.livekit.livekit_models.RoomMetadataEnvelope.create"
        ) as mock_create:
            mock_envelope = Mock()
            mock_create.return_value = mock_envelope

            result = parse_room_metadata(sample_room_metadata_json)

            assert result == mock_envelope
            mock_create.assert_called_once_with(
                parsed_expected, embedding_client=None, branching_llm_config=None
            )

    @pytest.mark.unit
    def test_parse_empty_metadata_in_prod_raises(self, mock_logger, monkeypatch):
        """Empty metadata in PROD should raise ValueError (no fallback)."""
        monkeypatch.setattr(settings, "ENV", Environment.PROD)

        with pytest.raises(ValueError):
            parse_room_metadata("")

    @pytest.mark.unit
    def test_parse_none_metadata_in_local_uses_sample(self, mock_logger, monkeypatch):
        """None metadata in LOCAL should use SCENARIO_SAMPLE fallback."""
        monkeypatch.setattr(settings, "ENV", Environment.LOCAL)

        # Patch the module-level import used inside the function:
        # implementation does `from scenario_sample import SCENARIO_SAMPLE`.
        import scenario_sample

        monkeypatch.setattr(scenario_sample, "SCENARIO_SAMPLE", LOCAL_SCENARIO_SAMPLE)

        with patch(
            "app.core.livekit.livekit_models.RoomMetadataEnvelope.create"
        ) as mock_create:
            mock_envelope = Mock()
            mock_create.return_value = mock_envelope

            result = parse_room_metadata(None)

            mock_create.assert_called_once_with(
                LOCAL_SCENARIO_SAMPLE, embedding_client=None, branching_llm_config=None
            )
            assert result == mock_envelope

    @pytest.mark.unit
    def test_parse_invalid_json_in_prod_raises(
        self, invalid_json_metadata, mock_logger, monkeypatch
    ):
        """Invalid JSON in PROD should raise ValueError (no silent fallback)."""
        monkeypatch.setattr(settings, "ENV", Environment.PROD)

        with pytest.raises(ValueError):
            parse_room_metadata(invalid_json_metadata)

    @pytest.mark.unit
    def test_parse_metadata_when_envelope_creation_raises_propagates(
        self, sample_room_metadata_json, monkeypatch
    ):
        """If RoomMetadataEnvelope.create raises, the exception should propagate."""
        monkeypatch.setattr(settings, "ENV", Environment.PROD)
        parsed_expected = json.loads(sample_room_metadata_json)

        with patch(
            "app.core.livekit.livekit_models.RoomMetadataEnvelope.create"
        ) as mock_create:
            mock_create.side_effect = Exception("creation failed")

            with pytest.raises(Exception) as exc:
                parse_room_metadata(sample_room_metadata_json)

            assert "creation failed" in str(exc.value)
            mock_create.assert_called_once_with(
                parsed_expected, embedding_client=None, branching_llm_config=None
            )

    @pytest.mark.unit
    @pytest.mark.parametrize(
        "metadata_input,should_raise,expected_dict",
        [
            ('{"test": "value"}', False, {"test": "value"}),
            ("{}", False, {}),
            ("null", True, None),  # `null` JSON => parsed is None => raises in PROD
            ("[]", False, []),
            ("42", False, 42),
            ('"string"', False, "string"),
        ],
    )
    def test_parse_various_json_types(
        self, metadata_input, should_raise, expected_dict, mock_logger, monkeypatch
    ):
        """Test parsing of different JSON types."""
        monkeypatch.setattr(settings, "ENV", Environment.PROD)

        if should_raise:
            with pytest.raises(ValueError):
                parse_room_metadata(metadata_input)
            return

        with patch(
            "app.core.livekit.livekit_models.RoomMetadataEnvelope.create"
        ) as mock_create:
            mock_envelope = Mock()
            mock_create.return_value = mock_envelope

            result = parse_room_metadata(metadata_input)
            mock_create.assert_called_once_with(
                expected_dict, embedding_client=None, branching_llm_config=None
            )
            assert result == mock_envelope

    @pytest.mark.unit
    @pytest.mark.parametrize(
        "invalid_json",
        [
            '{"invalid": json}',
            '{"incomplete":',
            "{invalid}",
            "undefined",
            '{"trailing": "comma",}',
        ],
    )
    def test_parse_various_invalid_json_raise(
        self, invalid_json, mock_logger, monkeypatch
    ):
        """Various invalid JSON inputs should raise ValueError in PROD."""
        monkeypatch.setattr(settings, "ENV", Environment.PROD)
        with pytest.raises(ValueError):
            parse_room_metadata(invalid_json)

    @pytest.mark.unit
    def test_parse_metadata_preserves_complex_structure(self, mock_logger, monkeypatch):
        """Complex nested structure should be passed into the envelope as-is."""
        monkeypatch.setattr(settings, "ENV", Environment.PROD)
        complex_metadata = {
            "version": "2.0",
            "scenario": {
                "nested": {"deeply": {"structure": "value"}},
                "array": [1, 2, {"nested": "in_array"}],
                "boolean": True,
                "null_value": None,
            },
        }
        metadata_json = json.dumps(complex_metadata)

        with patch(
            "app.core.livekit.livekit_models.RoomMetadataEnvelope.create"
        ) as mock_create:
            mock_envelope = Mock()
            mock_create.return_value = mock_envelope

            result = parse_room_metadata(metadata_json)
            mock_create.assert_called_once_with(
                complex_metadata, embedding_client=None, branching_llm_config=None
            )
            assert result == mock_envelope

    @pytest.mark.unit
    def test_parse_metadata_handles_unicode(self, mock_logger, monkeypatch):
        """Unicode characters should parse correctly."""
        monkeypatch.setattr(settings, "ENV", Environment.PROD)
        unicode_metadata = {
            "scenario": {
                "title": "测试场景",
                "description": "Тестовый сценарий",
                "emoji": "🎭🎪🎨",
                "special": "café naïve résumé",
            }
        }
        metadata_json = json.dumps(unicode_metadata, ensure_ascii=False)

        with patch(
            "app.core.livekit.livekit_models.RoomMetadataEnvelope.create"
        ) as mock_create:
            mock_envelope = Mock()
            mock_create.return_value = mock_envelope

            result = parse_room_metadata(metadata_json)
            mock_create.assert_called_once_with(
                unicode_metadata, embedding_client=None, branching_llm_config=None
            )
            assert result == mock_envelope

    @pytest.mark.unit
    def test_parse_metadata_performance_large_json(
        self, large_metadata, mock_logger, monkeypatch
    ):
        """Performance test for large JSON payloads."""
        monkeypatch.setattr(settings, "ENV", Environment.PROD)
        large_json = json.dumps(large_metadata)

        with patch(
            "app.core.livekit.livekit_models.RoomMetadataEnvelope.create"
        ) as mock_create:
            mock_envelope = Mock()
            mock_create.return_value = mock_envelope

            start_time = time.time()
            result = parse_room_metadata(large_json)
            end_time = time.time()

            execution_time = end_time - start_time
            assert execution_time < 1.0

            mock_create.assert_called_once_with(
                large_metadata, embedding_client=None, branching_llm_config=None
            )
            assert result == mock_envelope

    @pytest.mark.unit
    def test_parse_metadata_error_recovery(self, mock_logger, monkeypatch):
        """Ensure explicit behaviors for valid/invalid inputs in PROD."""
        monkeypatch.setattr(settings, "ENV", Environment.PROD)
        test_cases = [
            ('{"valid": "json"}', False),
            ("invalid json", True),
            (None, True),  # None -> parsed None -> raises in PROD
            ("", True),  # Empty string -> raises in PROD
        ]

        for metadata_input, should_raise in test_cases:
            mock_logger.reset_mock()

            if should_raise:
                with pytest.raises(ValueError):
                    parse_room_metadata(metadata_input)
            else:
                with patch(
                    "app.core.livekit.livekit_models.RoomMetadataEnvelope.create"
                ) as mock_create:
                    mock_envelope = Mock()
                    mock_create.return_value = mock_envelope

                    result = parse_room_metadata(metadata_input)
                    assert result == mock_envelope

    @pytest.mark.unit
    def test_parse_metadata_thread_safety(
        self, sample_room_metadata_json, mock_logger, monkeypatch
    ):
        """Function should be safe to call from multiple threads (no
        shared mutable state)."""
        monkeypatch.setattr(settings, "ENV", Environment.PROD)
        results = []
        errors = []

        def worker():
            try:
                with patch(
                    "app.core.livekit.livekit_models.RoomMetadataEnvelope.create"
                ) as mock_create:
                    mock_envelope = Mock()
                    mock_create.return_value = mock_envelope

                    result = parse_room_metadata(sample_room_metadata_json)
                    results.append(result)
            except Exception as e:
                errors.append(e)

        threads = []
        for _ in range(10):
            thread = threading.Thread(target=worker)
            threads.append(thread)
            thread.start()

        for thread in threads:
            thread.join()

        assert len(errors) == 0
        assert len(results) == 10

    @pytest.mark.unit
    def test_parse_metadata_with_builder_pattern(self, mock_logger, monkeypatch):
        """Parsing metadata created by DataBuilder should work."""
        monkeypatch.setattr(settings, "ENV", Environment.PROD)
        builder = DataBuilder()
        metadata = (
            builder.with_version("2.0")
            .with_scenario(title="Builder Test", description="Test with builder")
            .with_voice("test_voice", "deepgram", model="nova-2")
            .build()
        )

        metadata_json = json.dumps(metadata)

        with patch(
            "app.core.livekit.livekit_models.RoomMetadataEnvelope.create"
        ) as mock_create:
            mock_envelope = Mock()
            mock_create.return_value = mock_envelope

            result = parse_room_metadata(metadata_json)
            mock_create.assert_called_once_with(
                metadata, embedding_client=None, branching_llm_config=None
            )
            assert result == mock_envelope


class TestParseRoomMetadataIntegration:
    """Integration tests for parse_room_metadata with real RoomMetadataEnvelope."""

    @pytest.mark.integration
    def test_parse_metadata_real_envelope_creation(
        self, sample_room_metadata_json, monkeypatch
    ):
        """Valid metadata in PROD should create a real RoomMetadataEnvelope."""
        monkeypatch.setattr(settings, "ENV", Environment.PROD)
        result = parse_room_metadata(sample_room_metadata_json)

        assert isinstance(result, RoomMetadataEnvelope)
        assert hasattr(result, "version")
        assert hasattr(result, "scenario")
        AssertionHelpers.assert_valid_room_metadata_envelope(result, "1.0")

    @pytest.mark.integration
    def test_parse_invalid_metadata_real_envelope_raises(
        self, invalid_json_metadata, monkeypatch
    ):
        """Invalid metadata in PROD should raise ValueError before envelope creation."""
        monkeypatch.setattr(settings, "ENV", Environment.PROD)
        with pytest.raises(ValueError):
            parse_room_metadata(invalid_json_metadata)

    @pytest.mark.integration
    def test_parse_minimal_metadata_real_envelope(
        self, minimal_room_metadata, monkeypatch
    ):
        """Minimal valid metadata should produce a valid envelope in PROD."""
        monkeypatch.setattr(settings, "ENV", Environment.PROD)
        metadata_json = json.dumps(minimal_room_metadata)
        result = parse_room_metadata(metadata_json)

        assert isinstance(result, RoomMetadataEnvelope)
        AssertionHelpers.assert_valid_room_metadata_envelope(result)
        assert result.scenario is not None
        AssertionHelpers.assert_scenario_has_required_fields(result.scenario)
