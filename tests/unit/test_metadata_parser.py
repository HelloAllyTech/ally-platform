"""Comprehensive tests for metadata_parser module."""
import json
import pytest
from pydantic import ValidationError
from unittest.mock import Mock, patch, MagicMock

from app.utils.metadata_parser import parse_room_metadata
from app.core.livekit.livekit_models import RoomMetadataEnvelope
from tests.utils.test_helpers import DataBuilder, AssertionHelpers


class TestParseRoomMetadata:
    """Test cases for parse_room_metadata function."""
    
    @pytest.mark.unit
    def test_parse_valid_json_metadata(self, sample_room_metadata_json, mock_logger):
        """Test parsing valid JSON metadata."""
        with patch('app.core.livekit.livekit_models.RoomMetadataEnvelope.create') as mock_create:
            mock_envelope = Mock()
            mock_create.return_value = mock_envelope
            
            result = parse_room_metadata(sample_room_metadata_json)
            
            # Verify the result
            assert result == mock_envelope
            mock_create.assert_called_once()
            
            # Verify logging
            mock_logger.debug.assert_called_once()
            debug_call_args = mock_logger.debug.call_args[0]
            assert "Parsing job metadata" in debug_call_args[0]
    
    @pytest.mark.unit
    def test_parse_empty_metadata(self, mock_logger):
        """Test parsing empty metadata string."""
        with patch('app.core.livekit.livekit_models.RoomMetadataEnvelope.create') as mock_create:
            mock_envelope = Mock()
            mock_create.return_value = mock_envelope
            
            result = parse_room_metadata("")
            
            # Should create envelope with empty dict
            mock_create.assert_called_once_with({})
            assert result == mock_envelope
    
    @pytest.mark.unit
    def test_parse_none_metadata(self, mock_logger):
        """Test parsing None metadata."""
        with patch('app.core.livekit.livekit_models.RoomMetadataEnvelope.create') as mock_create:
            mock_envelope = Mock()
            mock_create.return_value = mock_envelope
            
            result = parse_room_metadata(None)
            
            # Should create envelope with empty dict
            mock_create.assert_called_once_with({})
            assert result == mock_envelope
    
    @pytest.mark.unit
    def test_parse_invalid_json_metadata(self, invalid_json_metadata, mock_logger):
        """Test parsing invalid JSON metadata."""
        with patch('app.core.livekit.livekit_models.RoomMetadataEnvelope.create') as mock_create:
            mock_envelope = Mock()
            mock_create.return_value = mock_envelope
            
            result = parse_room_metadata(invalid_json_metadata)
            
            # Should create envelope with empty dict on JSON error
            mock_create.assert_called_once_with({})
            assert result == mock_envelope
            
            # Verify error logging
            mock_logger.error.assert_called_once()
            error_call_args = mock_logger.error.call_args[0]
            assert "Invalid JSON in metadata" in error_call_args[0]
    
    @pytest.mark.unit
    def test_parse_metadata_with_exception_in_envelope_creation(self, sample_room_metadata_json, mock_logger):
        """Test handling exception during envelope creation."""
        with patch('app.core.livekit.livekit_models.RoomMetadataEnvelope.create') as mock_create:
            # First call raises exception, second call returns mock envelope
            mock_envelope = Mock()
            mock_create.side_effect = [Exception("Test exception"), mock_envelope]
            
            result = parse_room_metadata(sample_room_metadata_json)
            
            # Should handle exception and create empty envelope
            assert mock_create.call_count == 2
            mock_create.assert_any_call({})  # Second call with empty dict
            assert result == mock_envelope
            
            # Verify exception logging
            mock_logger.exception.assert_called_once()
            exception_call_args = mock_logger.exception.call_args[0]
            assert "Unexpected error parsing metadata" in exception_call_args[0]
    
    @pytest.mark.unit
    @pytest.mark.parametrize("metadata_input,expected_dict", [
        ('{"test": "value"}', {"test": "value"}),
        ('{}', {}),
        ('null', None),
        ('[]', []),
        ('42', 42),
        ('"string"', "string"),
    ])
    def test_parse_various_json_types(self, metadata_input, expected_dict, mock_logger):
        """Test parsing various valid JSON types."""
        with patch('app.core.livekit.livekit_models.RoomMetadataEnvelope.create') as mock_create:
            mock_envelope = Mock()
            mock_create.return_value = mock_envelope
            
            result = parse_room_metadata(metadata_input)
            
            mock_create.assert_called_once_with(expected_dict)
            assert result == mock_envelope
    
    @pytest.mark.unit
    @pytest.mark.parametrize("invalid_json", [
        '{"invalid": json}',
        '{"incomplete":',
        '{invalid}',
        'undefined',
        '{"trailing": "comma",}',
    ])
    def test_parse_various_invalid_json(self, invalid_json, mock_logger):
        """Test parsing various invalid JSON strings."""
        with patch('app.core.livekit.livekit_models.RoomMetadataEnvelope.create') as mock_create:
            mock_envelope = Mock()
            mock_create.return_value = mock_envelope
            
            result = parse_room_metadata(invalid_json)
            
            # Should create envelope with empty dict
            mock_create.assert_called_once_with({})
            assert result == mock_envelope
            
            # Verify error logging
            mock_logger.error.assert_called_once()
    
    @pytest.mark.unit
    def test_parse_metadata_preserves_complex_structure(self, mock_logger):
        """Test that complex nested structures are preserved."""
        complex_metadata = {
            "version": "2.0",
            "scenario": {
                "nested": {
                    "deeply": {
                        "structure": "value"
                    }
                },
                "array": [1, 2, {"nested": "in_array"}],
                "boolean": True,
                "null_value": None
            }
        }
        metadata_json = json.dumps(complex_metadata)
        
        with patch('app.core.livekit.livekit_models.RoomMetadataEnvelope.create') as mock_create:
            mock_envelope = Mock()
            mock_create.return_value = mock_envelope
            
            result = parse_room_metadata(metadata_json)
            
            # Verify the parsed structure is passed correctly
            mock_create.assert_called_once_with(complex_metadata)
            assert result == mock_envelope
    
    @pytest.mark.unit
    def test_parse_metadata_logs_debug_info(self, sample_room_metadata_json, mock_logger):
        """Test that debug information is logged correctly."""
        with patch('app.core.livekit.livekit_models.RoomMetadataEnvelope.create') as mock_create:
            mock_envelope = Mock()
            mock_create.return_value = mock_envelope
            
            parse_room_metadata(sample_room_metadata_json)
            
            # Verify debug logging
            mock_logger.debug.assert_called_once()
            debug_call = mock_logger.debug.call_args
            assert debug_call[0][0] == "Parsing job metadata: %s"
            assert debug_call[0][1] == sample_room_metadata_json
    
    @pytest.mark.unit
    def test_parse_metadata_handles_unicode(self, mock_logger):
        """Test parsing metadata with unicode characters."""
        unicode_metadata = {
            "scenario": {
                "title": "测试场景",  # Chinese characters
                "description": "Тестовый сценарий",  # Cyrillic characters
                "emoji": "🎭🎪🎨",  # Emojis
                "special": "café naïve résumé"  # Accented characters
            }
        }
        metadata_json = json.dumps(unicode_metadata, ensure_ascii=False)
        
        with patch('app.core.livekit.livekit_models.RoomMetadataEnvelope.create') as mock_create:
            mock_envelope = Mock()
            mock_create.return_value = mock_envelope
            
            result = parse_room_metadata(metadata_json)
            
            mock_create.assert_called_once_with(unicode_metadata)
            assert result == mock_envelope
    
    @pytest.mark.unit
    def test_parse_metadata_performance_large_json(self, large_metadata, mock_logger):
        """Test performance with large JSON metadata."""
        import time
        
        large_json = json.dumps(large_metadata)
        
        with patch('app.core.livekit.livekit_models.RoomMetadataEnvelope.create') as mock_create:
            mock_envelope = Mock()
            mock_create.return_value = mock_envelope
            
            start_time = time.time()
            result = parse_room_metadata(large_json)
            end_time = time.time()
            
            # Should complete within reasonable time (1 second)
            execution_time = end_time - start_time
            assert execution_time < 1.0
            
            mock_create.assert_called_once_with(large_metadata)
            assert result == mock_envelope
    
    @pytest.mark.unit
    def test_parse_metadata_error_recovery(self, mock_logger):
        """Test that function recovers gracefully from all types of errors."""
        test_cases = [
            ('{"valid": "json"}', False, None),  # Normal case
            ('invalid json', True, json.JSONDecodeError),  # JSON decode error
            (None, False, None),  # None input
            ('', False, None),  # Empty string
        ]
        
        for metadata_input, should_error, expected_exception in test_cases:
            mock_logger.reset_mock()
            
            with patch('app.core.livekit.livekit_models.RoomMetadataEnvelope.create') as mock_create:
                mock_envelope = Mock()
                mock_create.return_value = mock_envelope
                
                result = parse_room_metadata(metadata_input)
                
                # Should always return an envelope
                assert result == mock_envelope
                
                if should_error:
                    # Should log error for invalid cases
                    assert mock_logger.error.called or mock_logger.exception.called
                else:
                    # Should not log error for valid cases
                    assert not mock_logger.error.called
    
    @pytest.mark.unit
    def test_parse_metadata_thread_safety(self, sample_room_metadata_json, mock_logger):
        """Test that the function is thread-safe (no shared mutable state)."""
        import threading
        import time
        
        results = []
        errors = []
        
        def worker():
            try:
                with patch('app.core.livekit.livekit_models.RoomMetadataEnvelope.create') as mock_create:
                    mock_envelope = Mock()
                    mock_create.return_value = mock_envelope
                    
                    result = parse_room_metadata(sample_room_metadata_json)
                    results.append(result)
            except Exception as e:
                errors.append(e)
        
        # Run multiple threads concurrently
        threads = []
        for _ in range(10):
            thread = threading.Thread(target=worker)
            threads.append(thread)
            thread.start()
        
        # Wait for all threads to complete
        for thread in threads:
            thread.join()
        
        # Verify no errors occurred and all threads completed
        assert len(errors) == 0
        assert len(results) == 10
    
    @pytest.mark.unit
    def test_parse_metadata_with_builder_pattern(self, mock_logger):
        """Test parsing metadata created with DataBuilder."""
        builder = DataBuilder()
        metadata = (builder
                   .with_version("2.0")
                   .with_scenario(title="Builder Test", description="Test with builder")
                   .with_voice("test_voice", "deepgram", model="nova-2")
                   .build())
        
        metadata_json = json.dumps(metadata)
        
        with patch('app.core.livekit.livekit_models.RoomMetadataEnvelope.create') as mock_create:
            mock_envelope = Mock()
            mock_create.return_value = mock_envelope
            
            result = parse_room_metadata(metadata_json)
            
            mock_create.assert_called_once_with(metadata)
            assert result == mock_envelope


class TestParseRoomMetadataIntegration:
    """Integration tests for parse_room_metadata with real RoomMetadataEnvelope."""
    
    @pytest.mark.integration
    def test_parse_metadata_real_envelope_creation(self, sample_room_metadata_json):
        """Test with real RoomMetadataEnvelope creation (no mocking)."""
        # This test uses the actual RoomMetadataEnvelope.create method
        result = parse_room_metadata(sample_room_metadata_json)
        
        # Verify we get a real RoomMetadataEnvelope instance
        assert isinstance(result, RoomMetadataEnvelope)
        assert hasattr(result, 'version')
        assert hasattr(result, 'scenario')
        
        # Verify the envelope was created correctly
        AssertionHelpers.assert_valid_room_metadata_envelope(result, "1.0")
    
    @pytest.mark.integration
    def test_parse_invalid_metadata_real_envelope(self, invalid_json_metadata):
        """Test invalid metadata with real envelope creation: expect validation error."""
        # With mandatory voice/prompt_data in Scenario, invalid JSON falls back to
        # empty payload and should raise ValidationError during Scenario creation.
        with pytest.raises(ValidationError):
            parse_room_metadata(invalid_json_metadata)
    
    @pytest.mark.integration
    def test_parse_minimal_metadata_real_envelope(self, minimal_room_metadata):
        """Test minimal metadata with real envelope creation."""
        metadata_json = json.dumps(minimal_room_metadata)
        result = parse_room_metadata(metadata_json)
        
        assert isinstance(result, RoomMetadataEnvelope)
        AssertionHelpers.assert_valid_room_metadata_envelope(result)
        
        # Verify scenario was created
        assert result.scenario is not None
        AssertionHelpers.assert_scenario_has_required_fields(result.scenario)
