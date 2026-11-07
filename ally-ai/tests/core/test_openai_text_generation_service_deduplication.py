
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app.core.text_generations.openai_text_generation_service import (
    OpenAITextGenerationService,
    ScenarioEvaluation,
)
from app.schemas.common import ChatMessage


@pytest.mark.asyncio
@patch("app.core.text_generations.openai_text_generation_service.load_and_format")
@patch("app.core.text_generations.openai_text_generation_service.load_template")
async def test_generate_scenario_evaluation_condenses_once(
    mock_load_template, mock_load_and_format
):
    """
    Tests that _condense_for_summary is called only once in
    generate_scenario_evaluation.
    """
    # Arrange
    mock_client = MagicMock()
    mock_embedding_service = MagicMock()
    service = OpenAITextGenerationService(mock_client, mock_embedding_service)

    # Mock the response from _invoke_llm
    mock_llm_response = MagicMock(spec=ScenarioEvaluation)
    mock_llm_response.supervisor_note = "A valid note."
    mock_llm_response.areas_of_growth = []
    mock_llm_response.positives = []
    mock_llm_response.emotional_movement = []
    mock_llm_response.skill_coverage = []
    mock_llm_response.memory_update = MagicMock()
    mock_llm_response.memory_update.focus_areas = []
    mock_llm_response.memory_update.trajectory = ""
    mock_llm_response.memory_update.next_time = ""
    mock_llm_response.challenge_description = ""

    # Mock the internal methods
    service._condense_for_summary = AsyncMock(return_value="condensed_transcript")
    service._invoke_llm = AsyncMock(return_value=mock_llm_response)

    # Mock prompt loading
    mock_load_and_format.return_value = "formatted_prompt"
    mock_load_template.return_value = "template_content"

    chat_history = [
        ChatMessage(id="1", role="Client", content="Hello"),
        ChatMessage(id="2", role="Counselor", content="Hi"),
    ]

    # Act
    await service.generate_scenario_evaluation(chat_history=chat_history)

    # Assert
    service._condense_for_summary.assert_called_once()
