from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.core.scenario.base import PromptData, Scenario, ScenarioVoice, VoiceConfig
from app.speech_prosody.service import SpeechProsodyService


@pytest.fixture
def mock_scenario():
    prompt_data = PromptData(
        name="Test",
        age="25",
        gender="neutral",
        current_location="Earth",
        context="Test context",
        opening_statements=["Hello"],
        tone="Happy",
        emotional_needs="None",
        agent_goal="Test",
        personality="Helpful",
    )
    voice = ScenarioVoice(
        name="TestVoice",
        provider="elevenlabs",
        config=VoiceConfig(model="model1", voice_id="voice1"),
    )
    return Scenario(scenarioName="Test Scenario", prompt_data=prompt_data, voice=voice)


@pytest.fixture
def mock_tts_client():
    client = MagicMock()
    client.get_parameter_metadata.return_value = {"pitch": {"default": 1.0}}
    client._validate_parameters_dict.side_effect = lambda x: x
    client._default_params = {}
    return client


@pytest.fixture
def mock_llm_client():
    client = MagicMock()
    return client


@pytest.mark.asyncio
async def test_caching_behavior(mock_scenario, mock_tts_client, mock_llm_client):
    # Clear cache before test
    SpeechProsodyService._DEFAULTS_CACHE.clear()

    service = SpeechProsodyService(mock_tts_client)

    # Mock the generator function AND file operations
    with (
        patch(
            "app.speech_prosody.service.generate_default_parameters",
            new_callable=AsyncMock,
        ) as mock_generate,
        patch("builtins.open", new_callable=MagicMock),
        patch("app.speech_prosody.service.os.path.exists") as mock_exists,
        patch("app.speech_prosody.service.json.dump") as mock_json_dump,
        patch("app.speech_prosody.service.os.rename"),
    ):

        mock_generate.return_value = {"pitch": 1.5}
        mock_exists.return_value = False  # Simulate no cache file initially

        # 1. First call - should trigger generation and save to file
        await service.generate_and_set_defaults(mock_scenario, mock_llm_client)

        assert mock_generate.call_count == 1
        assert service._default_params == {"pitch": 1.5}
        assert mock_json_dump.called  # Should verify save was called

        # 2. Second call - should use in-memory cache
        await service.generate_and_set_defaults(mock_scenario, mock_llm_client)

        assert mock_generate.call_count == 1  # Still 1, not 2
        assert service._default_params == {"pitch": 1.5}


@pytest.mark.asyncio
async def test_cache_invalidation_on_scenario_change(
    mock_scenario, mock_tts_client, mock_llm_client
):
    SpeechProsodyService._DEFAULTS_CACHE.clear()
    service = SpeechProsodyService(mock_tts_client)

    with (
        patch(
            "app.speech_prosody.service.generate_default_parameters",
            new_callable=AsyncMock,
        ) as mock_generate,
        patch("builtins.open", new_callable=MagicMock),
        patch("app.speech_prosody.service.os.path.exists", return_value=False),
        patch("app.speech_prosody.service.json.dump"),
        patch("app.speech_prosody.service.os.rename"),
    ):

        mock_generate.return_value = {"pitch": 1.0}

        # Call with first scenario
        await service.generate_and_set_defaults(mock_scenario, mock_llm_client)
        assert mock_generate.call_count == 1

        # Create different scenario
        other_scenario = mock_scenario.model_copy(deep=True)
        other_scenario.prompt_data.tone = "Sad"  # Change tone

        # Call with second scenario
        await service.generate_and_set_defaults(other_scenario, mock_llm_client)
        assert mock_generate.call_count == 2  # Should trigger new generation


@pytest.mark.asyncio
async def test_load_from_disk(mock_scenario, mock_tts_client, mock_llm_client):
    """Test that cache is loaded from disk if memory is empty."""
    SpeechProsodyService._DEFAULTS_CACHE.clear()

    service = SpeechProsodyService(mock_tts_client)

    # Calculate what the key WOULD be
    expected_key = service._generate_cache_key(mock_scenario)

    # Mock data to return from file
    mock_file_data = {expected_key: {"pitch": 2.0}}

    with (
        patch(
            "app.speech_prosody.service.generate_default_parameters",
            new_callable=AsyncMock,
        ) as mock_generate,
        patch("builtins.open", new_callable=MagicMock),
        patch("app.speech_prosody.service.os.path.exists") as mock_exists,
        patch("app.speech_prosody.service.json.load") as mock_json_load,
    ):

        mock_exists.return_value = True
        mock_json_load.return_value = mock_file_data

        # Call service - should hit disk cache
        await service.generate_and_set_defaults(mock_scenario, mock_llm_client)

        # Should NOT have called generator
        assert mock_generate.call_count == 0

        # Should be using value from "disk"
        assert service._default_params == {"pitch": 2.0}

        # Memory cache should now be populated
        assert expected_key in SpeechProsodyService._DEFAULTS_CACHE
