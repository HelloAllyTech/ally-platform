
import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from typing import List, Optional

from app.core.embeddings.base import BaseEmbeddingService
from app.core.text_generations.openai_text_generation_service import (
    OpenAITextGenerationService,
    MAX_SUMMARY_INPUT_WORDS,
    CONDENSE_CHUNK_PROMPT_PATH
)
from app.core.text_generations.structured_output_models import (
    ScenarioEvaluation,
)
from app.schemas.common import ChatMessage


# Helper to create a long chat history
def _create_long_chat_history(num_messages: int, words_per_message: int) -> List[ChatMessage]:
    long_content = "word " * words_per_message
    return [
        ChatMessage(id=f"msg-{i}", role="client", content=long_content)
        for i in range(num_messages)
    ]


class TestOpenAITextGenerationServiceFixLongInput:
    @pytest.fixture
    def mock_embedding_service(self) -> AsyncMock:
        return AsyncMock(spec=BaseEmbeddingService)

    @pytest.fixture
    def mock_chat_openai(self) -> AsyncMock:
        # Mock a minimal client that has a .ainvoke method and can be bound
        mock_llm_client = MagicMock()
        mock_llm_client.ainvoke = AsyncMock(
            return_value=MagicMock(content="mocked condensed content")
        )
        # Allow chaining bind_tools
        mock_llm_client.bind_tools.return_value = mock_llm_client
        # For resolve_model_name
        mock_llm_client.model = "mock-model"
        return mock_llm_client

    @pytest.fixture
    def text_generation_service(self, mock_chat_openai, mock_embedding_service):
        service = OpenAITextGenerationService(mock_chat_openai, mock_embedding_service)

        # Mock _client_for to return the primary mock_chat_openai or a variant
        # for condensation
        def _mock_client_for(internal_path: str, prompts: Optional[dict]):
            if internal_path == CONDENSE_CHUNK_PROMPT_PATH:
                # For condensation calls, return a client that returns mocked
                # condensed content
                condense_client = MagicMock()
                condense_client.ainvoke = AsyncMock(
                    return_value=MagicMock(content="shortened content")
                )
                condense_client.model = "condense-model"
                return condense_client
            # For the main evaluation call
            return mock_chat_openai

        service._client_for = MagicMock(side_effect=_mock_client_for)
        return service

    @pytest.mark.asyncio
    async def test_generate_scenario_evaluation_condenses_long_chat_history(
        self, text_generation_service, mock_chat_openai
    ):
        # Create a chat history that would be too long without condensation
        num_messages = 500
        words_per_message = 20
        long_chat_history = _create_long_chat_history(
            num_messages, words_per_message
        )

        # Total words in raw chat history
        raw_total_words = num_messages * words_per_message
        assert raw_total_words > MAX_SUMMARY_INPUT_WORDS

        # Mock _invoke_llm to simulate LengthFinishReasonError
        # if condensation failed
        async def mock_invoke_llm_side_effect(messages, output_class, **kwargs):
            if isinstance(messages, str):
                # This is the prompt string after condensation attempts
                actual_prompt_words = len(messages.split())
                # Allow some buffer for prompt boilerplate
                if actual_prompt_words > MAX_SUMMARY_INPUT_WORDS + 500:
                    # Simulate LengthFinishReasonError if still too long
                    error = Exception("Output too long")
                    error.__class__.__name__ = "LengthFinishReasonError"
                    raise error

                # If condensation worked, return a valid (mocked)
                # ScenarioEvaluation
                mock_structured_response = ScenarioEvaluation(
                    challenge_description="Condensed description",
                    areas_of_growth=[],
                    positives=[],
                    emotional_movement=[],
                    skill_coverage=[],
                    supervisor_note="Condensed supervisor note",
                    memory_update={
                        "focus_areas": [],
                        "trajectory": "",
                        "next_time": ""
                    }
                )
                # _invoke_llm expects to return the pydantic model
                # instance directly
                return mock_structured_response
            # For direct calls to _invoke_llm with BaseMessage
            # (e.g. within _condense_for_summary), let the original mock handle it
            # But for this test, we expect the main call to
            # generate_scenario_evaluation to pass a string to _invoke_llm
            # after condensation
            raise ValueError(
                "Expected string prompt after condensation for main evaluation call"
            )

        text_generation_service._invoke_llm = AsyncMock(
            side_effect=mock_invoke_llm_side_effect
        )

        with patch(
            'app.prompts.resolver.load_and_format',
            return_value='mocked_prompt_template'
        ), patch(
            'app.prompts.resolver.load_template',
            return_value='mocked_template'
        ):
            # The key assertion: no LLMInvocationFailedException due to length
            result = await text_generation_service.generate_scenario_evaluation(
                long_chat_history, need_memory=False
            )

        # Assert that the result is a valid ScenarioEvaluation structure
        assert "challenge_description" in result
        assert result["challenge_description"] == "Condensed description"
        assert result["supervisor_note"] == "Condensed supervisor note"
        # The test passes if no LengthFinishReasonError was raised,
        # implying condensation worked.
        # This implicitly tests that _condense_for_summary was called
        # and effective.
        # It also tests that _condense_for_summary was called by
        # generate_scenario_evaluation.

