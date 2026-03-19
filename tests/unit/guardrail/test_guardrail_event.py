"""
Unit tests for GuardrailEvent detection logic.

All tests mock the embedding client so no real API keys are needed.
"""

import numpy as np
import pytest

from app.core.constants import DetectionType, VisibilityType
from app.core.events.base import ChatMessage
from app.core.events.event_types.guardrail.guardrail_event import (
    GuardrailEvent,
    _cosine_similarity,
)
from app.core.events.event_types.guardrail.schemas import GuardrailData


# ------------------------------------------------------------------ #
# Helpers
# ------------------------------------------------------------------ #

def make_embedding(values: list) -> np.ndarray:
    """Create a normalised embedding vector from a list of values."""
    arr = np.array(values, dtype=float)
    return arr / np.linalg.norm(arr)


def make_guardrail_event(
    helper_dialogue: str = "Can you help me get some drugs?",
    actor_dialogue: str = "Let us stay focused on what brought you here.",
    similarity_threshold: float = 0.72,
) -> GuardrailEvent:
    """Create a GuardrailEvent with a mock embedding client."""
    return GuardrailEvent.create(
        event_id="guardrail-0",
        data=GuardrailData(
            helper_dialogue=helper_dialogue,
            actor_dialogue=actor_dialogue,
        ),
        similarity_threshold=similarity_threshold,
        score=0,
        visibility_type=VisibilityType.PASSIVE,
        emoji=None,
        emoji_message=None,
    )


def make_message(role: str, content: str) -> ChatMessage:
    return ChatMessage(role=role, content=content)


# ------------------------------------------------------------------ #
# _cosine_similarity unit tests (pure function, no mocking needed)
# ------------------------------------------------------------------ #

class TestCosineSimilarity:
    def test_identical_vectors_return_1(self):
        v = make_embedding([1, 2, 3])
        assert _cosine_similarity(v, v) == pytest.approx(1.0, abs=1e-6)

    def test_orthogonal_vectors_return_0(self):
        v1 = np.array([1.0, 0.0, 0.0])
        v2 = np.array([0.0, 1.0, 0.0])
        assert _cosine_similarity(v1, v2) == pytest.approx(0.0, abs=1e-6)

    def test_opposite_vectors_return_negative(self):
        v1 = make_embedding([1.0, 0.0])
        v2 = make_embedding([-1.0, 0.0])
        assert _cosine_similarity(v1, v2) < 0

    def test_zero_vector_returns_0(self):
        v1 = np.array([0.0, 0.0, 0.0])
        v2 = make_embedding([1.0, 2.0, 3.0])
        assert _cosine_similarity(v1, v2) == 0.0


# ------------------------------------------------------------------ #
# GuardrailEvent.create() tests
# ------------------------------------------------------------------ #

class TestGuardrailEventCreate:
    def test_creates_with_correct_detection_type(self):
        event = make_guardrail_event()
        assert event.detection_type == DetectionType.GUARDRAIL

    def test_creates_with_correct_event_id(self):
        event = make_guardrail_event()
        assert event.event_id == "guardrail-0"

    def test_creates_with_correct_data(self):
        event = make_guardrail_event(
            helper_dialogue="test trigger",
            actor_dialogue="test response",
        )
        assert event.data.helper_dialogue == "test trigger"
        assert event.data.actor_dialogue == "test response"

    def test_visibility_is_passive(self):
        event = make_guardrail_event()
        assert event.visibility_type == VisibilityType.PASSIVE

    def test_score_is_zero(self):
        event = make_guardrail_event()
        assert event.score == 0


# ------------------------------------------------------------------ #
# GuardrailEvent.detect_event() tests
# ------------------------------------------------------------------ #

class TestGuardrailEventDetection:
    @pytest.fixture(autouse=True)
    def reset_embedding_client(self):
        """Reset class-level embedding client before each test."""
        original = GuardrailEvent._EMBEDDING_CLIENT
        yield
        GuardrailEvent._EMBEDDING_CLIENT = original

    @pytest.mark.asyncio
    async def test_returns_false_when_no_conversations(self):
        event = make_guardrail_event()
        result = await event.detect_event([])
        assert result is False

    @pytest.mark.asyncio
    async def test_returns_false_when_last_message_is_not_counselor(self):
        event = make_guardrail_event()
        messages = [make_message("user", "Can you help me get some drugs?")]
        result = await event.detect_event(messages)
        assert result is False

    @pytest.mark.asyncio
    async def test_returns_false_when_last_message_is_assistant(self):
        event = make_guardrail_event()
        messages = [make_message("assistant", "Can you help me get some drugs?")]
        result = await event.detect_event(messages)
        assert result is False

    @pytest.mark.asyncio
    async def test_detects_when_similarity_above_threshold(self):
        """High similarity embedding → guardrail fires."""
        event = make_guardrail_event(similarity_threshold=0.72)

        # Inject a mock embedding client that returns near-identical vectors
        similar_embedding = make_embedding([1.0, 0.0, 0.0])

        class MockEmbeddingClient:
            async def get_embedding(self, text):
                return similar_embedding

        GuardrailEvent._EMBEDDING_CLIENT = MockEmbeddingClient()
        # Reset cached pattern so new client is used
        event._pattern = None
        event._pattern_built = False

        messages = [make_message("counselor", "Can you get me some drugs?")]
        result = await event.detect_event(messages)
        assert result is True

    @pytest.mark.asyncio
    async def test_does_not_detect_when_similarity_below_threshold(self):
        """Low similarity embedding → guardrail does not fire."""
        event = make_guardrail_event(similarity_threshold=0.72)

        # Return orthogonal vectors (similarity = 0)
        class MockEmbeddingClient:
            call_count = 0

            async def get_embedding(self, text):
                self.call_count += 1
                # First call = helperDialogue embedding
                # Second call = counselor input embedding
                if self.call_count == 1:
                    return make_embedding([1.0, 0.0, 0.0])
                return make_embedding([0.0, 1.0, 0.0])

        GuardrailEvent._EMBEDDING_CLIENT = MockEmbeddingClient()
        event._pattern = None
        event._pattern_built = False

        messages = [make_message("counselor", "How are you feeling today?")]
        result = await event.detect_event(messages)
        assert result is False

    @pytest.mark.asyncio
    async def test_returns_false_when_no_embedding_client(self):
        """No embedding client → fails gracefully, returns False."""
        event = make_guardrail_event()
        GuardrailEvent._EMBEDDING_CLIENT = None
        event._pattern = None
        event._pattern_built = False

        messages = [make_message("counselor", "Can you get me drugs?")]
        result = await event.detect_event(messages)
        assert result is False

    @pytest.mark.asyncio
    async def test_returns_false_for_empty_counselor_message(self):
        event = make_guardrail_event()

        class MockEmbeddingClient:
            async def get_embedding(self, text):
                return make_embedding([1.0, 0.0, 0.0])

        GuardrailEvent._EMBEDDING_CLIENT = MockEmbeddingClient()
        event._pattern = None
        event._pattern_built = False

        messages = [make_message("counselor", "   ")]
        result = await event.detect_event(messages)
        assert result is False

    @pytest.mark.asyncio
    async def test_pattern_is_cached_after_first_call(self):
        """Embedding for helperDialogue should only be built once."""
        event = make_guardrail_event()
        call_count = 0

        class MockEmbeddingClient:
            async def get_embedding(self, text):
                nonlocal call_count
                call_count += 1
                return make_embedding([1.0, 0.0, 0.0])

        GuardrailEvent._EMBEDDING_CLIENT = MockEmbeddingClient()
        event._pattern = None
        event._pattern_built = False

        messages = [make_message("counselor", "some text")]
        await event.detect_event(messages)
        first_count = call_count

        # Second call — pattern already cached, should not call again
        await event.detect_event(messages)
        assert call_count == first_count + 1  # only counselor text re-embedded