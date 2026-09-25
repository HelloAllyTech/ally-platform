"""Unit tests for SemanticSimilarityEvent."""

from unittest.mock import AsyncMock, MagicMock, patch

import numpy as np
import pytest

from app.core.constants import DetectionType
from app.core.events.base import ChatMessage
from app.core.events.event_types.semantic_similarity.semantic_similarity_event import (
    SemanticSimilarityEvent,
)


@pytest.fixture
def mock_embedding_client():
    """Create a mock embedding client for testing."""
    client = MagicMock()
    client.get_embedding = AsyncMock()
    client.get_embeddings_batch = AsyncMock()
    return client


class TestSemanticSimilarityEvent:
    """Test suite for SemanticSimilarityEvent class."""

    @pytest.mark.asyncio
    async def test_create_event_with_default_threshold(self, mock_embedding_client):
        """Test creating a semantic similarity event with default threshold."""
        from app.core.events.event_types.semantic_similarity.constants import (
            SEMANTIC_SIMILARITY_THRESHOLD,
        )

        event = SemanticSimilarityEvent.create(
            embedding_client=mock_embedding_client,
            event_id="semantic_test_1",
            custom_sentences=["How are you feeling today?", "What's on your mind?"],
            score=10,
        )

        assert event.event_id == "semantic_test_1"
        assert event.sentences == ["How are you feeling today?", "What's on your mind?"]
        assert event.score == 10
        assert (
            event.similarity_threshold == SEMANTIC_SIMILARITY_THRESHOLD
        )  # Default threshold from settings
        assert event.detection_type == DetectionType.SENTENCE_SIMILARITY  # Default

    @pytest.mark.asyncio
    async def test_create_event_with_custom_threshold(self, mock_embedding_client):
        """Test creating a semantic similarity event with custom threshold."""
        event = SemanticSimilarityEvent.create(
            embedding_client=mock_embedding_client,
            event_id="semantic_test_2",
            custom_sentences=["I feel anxious"],
            similarity_threshold=0.85,
            score=5,
        )

        assert event.similarity_threshold == 0.85
        assert event.sentences == ["I feel anxious"]

    @pytest.mark.asyncio
    async def test_detect_event_empty_conversations(self, mock_embedding_client):
        """Test that empty conversations return False."""
        event = SemanticSimilarityEvent.create(
            embedding_client=mock_embedding_client,
            event_id="semantic_test_3",
            custom_sentences=["hello"],
        )

        result = await event.detect_event([])
        assert result is False

    @pytest.mark.asyncio
    async def test_detect_event_non_counselor_message(self, mock_embedding_client):
        """Test that non-counselor messages don't trigger detection."""
        event = SemanticSimilarityEvent.create(
            embedding_client=mock_embedding_client,
            event_id="semantic_test_4",
            custom_sentences=["hello"],
        )

        conversations = [ChatMessage(role="user", content="hello there")]

        result = await event.detect_event(conversations)
        assert result is False

    @pytest.mark.asyncio
    async def test_cosine_similarity_identical_vectors(self, mock_embedding_client):
        """Test cosine similarity with identical vectors."""
        vec1 = np.array([1.0, 2.0, 3.0])
        vec2 = np.array([1.0, 2.0, 3.0])

        similarity = SemanticSimilarityEvent._cosine_similarity(vec1, vec2)

        # Identical vectors should have similarity close to 1.0
        assert 0.99 <= similarity <= 1.0

    @pytest.mark.asyncio
    async def test_cosine_similarity_orthogonal_vectors(self, mock_embedding_client):
        """Test cosine similarity with orthogonal vectors."""
        vec1 = np.array([1.0, 0.0, 0.0])
        vec2 = np.array([0.0, 1.0, 0.0])

        similarity = SemanticSimilarityEvent._cosine_similarity(vec1, vec2)

        # Orthogonal vectors should have similarity close to 0.0
        assert -0.01 <= similarity <= 0.01

    @pytest.mark.asyncio
    async def test_cosine_similarity_opposite_vectors(self, mock_embedding_client):
        """Test cosine similarity with opposite vectors."""
        vec1 = np.array([1.0, 2.0, 3.0])
        vec2 = np.array([-1.0, -2.0, -3.0])

        similarity = SemanticSimilarityEvent._cosine_similarity(vec1, vec2)

        # Opposite vectors should have similarity close to -1.0
        assert -1.0 <= similarity <= -0.99

    @pytest.mark.asyncio
    async def test_match_semantic_with_mocked_embeddings_high_similarity(
        self, mock_embedding_client
    ):
        """Test semantic matching with mocked embeddings showing high similarity."""
        event = SemanticSimilarityEvent.create(
            embedding_client=mock_embedding_client,
            event_id="semantic_test_5",
            custom_sentences=["How are you feeling?"],
            similarity_threshold=0.8,
        )

        # Mock the embedding methods
        target_embedding = np.array([1.0, 2.0, 3.0, 4.0])
        input_embedding = np.array([1.1, 2.1, 3.1, 4.1])  # Very similar to target

        with patch.object(
            event._EMBEDDING_CLIENT, "get_embeddings_batch", new_callable=AsyncMock
        ) as mock_batch:
            with patch.object(
                event._EMBEDDING_CLIENT, "get_embedding", new_callable=AsyncMock
            ) as mock_single:
                mock_batch.return_value = [target_embedding]
                mock_single.return_value = input_embedding

                result = await event._match_semantic("How do you feel?")

                assert result is True
                mock_batch.assert_called_once()
                mock_single.assert_called_once_with(
                    "How do you feel?", task="event_embedding"
                )

    @pytest.mark.asyncio
    async def test_match_semantic_with_mocked_embeddings_low_similarity(
        self, mock_embedding_client
    ):
        """Test semantic matching with mocked embeddings showing low similarity."""
        event = SemanticSimilarityEvent.create(
            embedding_client=mock_embedding_client,
            event_id="semantic_test_6",
            custom_sentences=["How are you feeling?"],
            similarity_threshold=0.8,
        )

        # Mock the embedding methods with orthogonal vectors (no similarity)
        target_embedding = np.array([1.0, 0.0, 0.0, 0.0])
        input_embedding = np.array([0.0, 1.0, 0.0, 0.0])

        with patch.object(
            event._EMBEDDING_CLIENT, "get_embeddings_batch", new_callable=AsyncMock
        ) as mock_batch:
            with patch.object(
                event._EMBEDDING_CLIENT, "get_embedding", new_callable=AsyncMock
            ) as mock_single:
                mock_batch.return_value = [target_embedding]
                mock_single.return_value = input_embedding

                result = await event._match_semantic("What's the weather?")

                assert result is False

    @pytest.mark.asyncio
    async def test_match_semantic_empty_sentence(self, mock_embedding_client):
        """Test that empty sentences don't match."""
        event = SemanticSimilarityEvent.create(
            embedding_client=mock_embedding_client,
            event_id="semantic_test_7",
            custom_sentences=["hello"],
        )

        with patch.object(event, "_ensure_patterns_built", new_callable=AsyncMock):
            result = await event._match_semantic("")
            assert result is False

            result = await event._match_semantic("   ")
            assert result is False

    @pytest.mark.asyncio
    async def test_match_semantic_no_patterns(self, mock_embedding_client):
        """Test that matching with no patterns returns False."""
        event = SemanticSimilarityEvent.create(
            embedding_client=mock_embedding_client,
            event_id="semantic_test_8",
            custom_sentences=[],  # Empty sentences
        )

        result = await event._match_semantic("hello")
        assert result is False

    @pytest.mark.asyncio
    async def test_ensure_patterns_built_caching(self, mock_embedding_client):
        """Test that pattern building uses caching correctly."""
        event1 = SemanticSimilarityEvent.create(
            embedding_client=mock_embedding_client,
            event_id="semantic_test_9",
            custom_sentences=["hello", "hi there"],
            similarity_threshold=0.75,
        )

        event2 = SemanticSimilarityEvent.create(
            embedding_client=mock_embedding_client,
            event_id="semantic_test_10",
            custom_sentences=["hello", "hi there"],
            similarity_threshold=0.75,
        )

        mock_embeddings = [np.array([1.0, 2.0, 3.0]), np.array([4.0, 5.0, 6.0])]

        with patch.object(
            event1._EMBEDDING_CLIENT, "get_embeddings_batch", new_callable=AsyncMock
        ) as mock_batch:
            mock_batch.return_value = mock_embeddings

            # Build patterns for event1
            await event1._ensure_patterns_built()
            assert event1._instance_built is True
            assert len(event1._instance_patterns) == 2
            assert mock_batch.call_count == 1

            # Build patterns for event2 (should use cache)
            with patch.object(
                event2._EMBEDDING_CLIENT, "get_embeddings_batch", new_callable=AsyncMock
            ) as mock_batch2:
                await event2._ensure_patterns_built()
                assert event2._instance_built is True
                assert len(event2._instance_patterns) == 2
                # Should not call API again due to caching
                mock_batch2.assert_not_called()

                # Verify both events share the same cached patterns
                assert event1._instance_patterns is event2._instance_patterns

    @pytest.mark.asyncio
    async def test_ensure_patterns_built_deduplication(self, mock_embedding_client):
        """Test that duplicate sentences are deduplicated."""
        # Clear the cache to ensure this test runs independently
        SemanticSimilarityEvent._PATTERN_CACHE.clear()

        event = SemanticSimilarityEvent.create(
            embedding_client=mock_embedding_client,
            event_id="semantic_test_11",
            custom_sentences=["hello", "hello", "hi there", "hi there"],
            similarity_threshold=0.75,
        )

        mock_embeddings = [np.array([1.0, 2.0, 3.0]), np.array([4.0, 5.0, 6.0])]

        with patch.object(
            event._EMBEDDING_CLIENT, "get_embeddings_batch", new_callable=AsyncMock
        ) as mock_batch:
            mock_batch.return_value = mock_embeddings

            await event._ensure_patterns_built()

            # Should only have 2 patterns after deduplication
            assert len(event._instance_patterns) == 2
            mock_batch.assert_called_once()
            # Verify the call was made with deduplicated sentences
            call_args = mock_batch.call_args[0][0]
            assert len(call_args) == 2
            assert "hello" in call_args
            assert "hi there" in call_args

    @pytest.mark.asyncio
    async def test_ensure_patterns_built_strips_quotes(self, mock_embedding_client):
        """Test that quotes are stripped from sentences."""
        event = SemanticSimilarityEvent.create(
            embedding_client=mock_embedding_client,
            event_id="semantic_test_12",
            custom_sentences=['"hello"', "'hi there'", '  "goodbye"  '],
            similarity_threshold=0.75,
        )

        mock_embeddings = [
            np.array([1.0, 2.0, 3.0]),
            np.array([4.0, 5.0, 6.0]),
            np.array([7.0, 8.0, 9.0]),
        ]

        with patch.object(
            event._EMBEDDING_CLIENT, "get_embeddings_batch", new_callable=AsyncMock
        ) as mock_batch:
            mock_batch.return_value = mock_embeddings

            await event._ensure_patterns_built()

            # Verify the call was made with cleaned sentences (no quotes)
            call_args = mock_batch.call_args[0][0]
            assert "hello" in call_args
            assert "hi there" in call_args
            assert "goodbye" in call_args

    @pytest.mark.asyncio
    async def test_detect_event_with_full_flow(self, mock_embedding_client):
        """Test full detection flow with counselor message."""
        event = SemanticSimilarityEvent.create(
            embedding_client=mock_embedding_client,
            event_id="semantic_test_13",
            custom_sentences=["How are you feeling today?"],
            similarity_threshold=0.8,
        )

        conversations = [
            ChatMessage(role="user", content="I'm struggling"),
            ChatMessage(role="counselor", content="How do you feel right now?"),
        ]

        # Mock embeddings to simulate high similarity
        target_embedding = np.array([1.0, 2.0, 3.0, 4.0])
        input_embedding = np.array([1.05, 2.05, 3.05, 4.05])  # Very similar

        with patch.object(
            event._EMBEDDING_CLIENT, "get_embeddings_batch", new_callable=AsyncMock
        ) as mock_batch:
            with patch.object(
                event._EMBEDDING_CLIENT, "get_embedding", new_callable=AsyncMock
            ) as mock_single:
                mock_batch.return_value = [target_embedding]
                mock_single.return_value = input_embedding

                result = await event.detect_event(conversations)

                assert result is True

    @pytest.mark.asyncio
    async def test_embedding_api_error_handling(self, mock_embedding_client):
        """Test that API errors are handled gracefully."""
        event = SemanticSimilarityEvent.create(
            embedding_client=mock_embedding_client,
            event_id="semantic_test_14",
            custom_sentences=["hello"],
            similarity_threshold=0.75,
        )

        # Mock API to raise an exception
        with patch.object(
            event._EMBEDDING_CLIENT, "get_embeddings_batch", new_callable=AsyncMock
        ) as mock_batch:
            with patch.object(
                event._EMBEDDING_CLIENT, "get_embedding", new_callable=AsyncMock
            ) as mock_single:
                mock_batch.side_effect = Exception("API Error")
                mock_single.return_value = np.array([1.0, 2.0, 3.0])

                # Ensure patterns built should handle the error
                await event._ensure_patterns_built()

                # Should have empty patterns due to error
                assert event._instance_patterns == []
                assert event._instance_built is True

    @pytest.mark.asyncio
    async def test_match_semantic_with_get_embedding_error(self, mock_embedding_client):
        """Test that errors during input embedding are handled."""
        event = SemanticSimilarityEvent.create(
            embedding_client=mock_embedding_client,
            event_id="semantic_test_15",
            custom_sentences=["hello"],
            similarity_threshold=0.75,
        )

        target_embedding = np.array([1.0, 2.0, 3.0])

        with patch.object(
            event._EMBEDDING_CLIENT, "get_embeddings_batch", new_callable=AsyncMock
        ) as mock_batch:
            with patch.object(
                event._EMBEDDING_CLIENT, "get_embedding", new_callable=AsyncMock
            ) as mock_single:
                mock_batch.return_value = [target_embedding]
                mock_single.side_effect = Exception("API Error")

                result = await event._match_semantic("test input")

                assert result is False

    @pytest.mark.asyncio
    async def test_multiple_target_sentences_matching(self, mock_embedding_client):
        """Test matching against multiple target sentences."""
        event = SemanticSimilarityEvent.create(
            embedding_client=mock_embedding_client,
            event_id="semantic_test_16",
            custom_sentences=[
                "How are you feeling?",
                "What's troubling you?",
                "Tell me more about that",
            ],
            similarity_threshold=0.8,
        )

        # First target is similar, others are not
        target_embeddings = [
            np.array([1.0, 2.0, 3.0, 4.0]),
            np.array([5.0, 6.0, 7.0, 8.0]),
            np.array([9.0, 10.0, 11.0, 12.0]),
        ]

        # Input matches first target
        input_embedding = np.array([1.1, 2.1, 3.1, 4.1])

        with patch.object(
            event._EMBEDDING_CLIENT, "get_embeddings_batch", new_callable=AsyncMock
        ) as mock_batch:
            with patch.object(
                event._EMBEDDING_CLIENT, "get_embedding", new_callable=AsyncMock
            ) as mock_single:
                mock_batch.return_value = target_embeddings
                mock_single.return_value = input_embedding

                result = await event._match_semantic("How do you feel?")

                # Should match because first target is similar
                assert result is True

    @pytest.mark.asyncio
    async def test_threshold_boundary_conditions(self, mock_embedding_client):
        """Test matching at exact threshold boundary."""
        event = SemanticSimilarityEvent.create(
            embedding_client=mock_embedding_client,
            event_id="semantic_test_17",
            custom_sentences=["hello"],
            similarity_threshold=0.85,
        )

        target_embedding = np.array([1.0, 0.0, 0.0, 0.0])

        # Create an embedding that gives slightly above 0.85 similarity
        # to account for floating point precision
        # For normalized vectors, cosine similarity is the dot product
        # So we need vec2 such that vec1 · vec2 >= 0.85
        input_embedding = np.array([0.86, np.sqrt(1 - 0.86**2), 0.0, 0.0])

        with patch.object(
            event._EMBEDDING_CLIENT, "get_embeddings_batch", new_callable=AsyncMock
        ) as mock_batch:
            with patch.object(
                event._EMBEDDING_CLIENT, "get_embedding", new_callable=AsyncMock
            ) as mock_single:
                mock_batch.return_value = [target_embedding]
                mock_single.return_value = input_embedding

                result = await event._match_semantic("test")

                # Should match because similarity >= threshold
                assert result is True


class TestSemanticSimilarityEventIntegration:
    """Integration tests that verify the event works with the factory and registry."""

    @pytest.mark.asyncio
    async def test_event_creation_via_factory(self, mock_embedding_client):
        """Test creating semantic similarity event via factory."""
        from app.core.constants import DetectionType
        from app.core.events.factory import build_events_from_metadata

        metadata = {
            "events": [
                {
                    "id": "semantic_event_1",
                    "detectionType": "SEMANTIC_SIMILARITY",
                    "data": {
                        "sentences": ["How are you feeling?", "What's on your mind?"],
                        "threshold": 0.8,
                    },
                    "score": 15,
                    "visibilityType": "ACTIVE",
                }
            ]
        }

        events = build_events_from_metadata(
            metadata, embedding_client=mock_embedding_client
        )

        assert len(events) == 1
        assert isinstance(events[0], SemanticSimilarityEvent)
        assert events[0].event_id == "semantic_event_1"
        assert events[0].detection_type == DetectionType.SEMANTIC_SIMILARITY
        assert events[0].sentences == ["How are you feeling?", "What's on your mind?"]
        assert events[0].similarity_threshold == 0.8
        assert events[0].score == 15

    @pytest.mark.asyncio
    async def test_event_creation_via_factory_default_threshold(
        self, mock_embedding_client
    ):
        """Test creating semantic similarity event via factory with
        default threshold."""
        from app.core.events.event_types.semantic_similarity.constants import (
            SEMANTIC_SIMILARITY_THRESHOLD,
        )
        from app.core.events.factory import build_events_from_metadata

        metadata = {
            "events": [
                {
                    "id": "semantic_event_2",
                    "detectionType": "SEMANTIC_SIMILARITY",
                    "data": {"sentences": ["hello world"]},
                    "score": 10,
                }
            ]
        }

        events = build_events_from_metadata(
            metadata, embedding_client=mock_embedding_client
        )

        assert len(events) == 1
        assert (
            events[0].similarity_threshold == SEMANTIC_SIMILARITY_THRESHOLD
        )  # Default from settings

    @pytest.mark.asyncio
    async def test_event_registry_trigger_multiple_for_semantic(
        self, mock_embedding_client
    ):
        """Test that semantic similarity events have trigger_multiple=True
        in registry."""
        from unittest.mock import MagicMock

        from app.core.constants import DetectionType
        from app.core.events.event_orchestrator.event_orchestrator import (
            EventOrchestrator,
        )

        event = SemanticSimilarityEvent.create(
            embedding_client=mock_embedding_client,
            event_id="semantic_reg_test",
            custom_sentences=["hello"],
            detection_type=DetectionType.SEMANTIC_SIMILARITY,
        )

        # Create a mock scenario with the event
        mock_scenario = MagicMock()
        mock_scenario.events = [event]
        mock_scenario.trigger_events = []

        # Create mock room and thread_id
        mock_room = MagicMock()
        thread_id = "test_thread_123"

        orchestrator = EventOrchestrator(mock_scenario, mock_room, thread_id)

        # Verify the event is in the orchestrator with trigger_multiple=True
        assert "semantic_reg_test" in orchestrator.event_registry
        assert orchestrator.event_registry["semantic_reg_test"].trigger_multiple is True
        assert orchestrator.event_registry["semantic_reg_test"].happened is False


class TestSemanticSimilarityUsage:
    """AI-cost: target and input embeddings are recorded as event_embedding,
    attributed to the session's embedding client's room."""

    @pytest.mark.asyncio
    async def test_detection_records_both_embedding_calls(
        self, monkeypatch, ai_usage_calls
    ):
        from app.core.embeddings.openai_embeddings import OpenAIEmbeddingClient

        with patch(
            "app.core.embeddings.openai_embeddings.OpenAIEmbeddings"
        ) as lc_embeddings:
            lc = lc_embeddings.return_value
            lc.aembed_documents = AsyncMock(return_value=[[1.0, 0.0]])
            lc.aembed_query = AsyncMock(return_value=[1.0, 0.0])
            client = OpenAIEmbeddingClient(
                model="text-embedding-3-small", api_key="k", room_id="room-sem"
            )
        monkeypatch.setattr(
            OpenAIEmbeddingClient, "_count_input_tokens", lambda self, texts: 4
        )
        monkeypatch.setattr(SemanticSimilarityEvent, "_EMBEDDING_CLIENT", client)
        monkeypatch.setattr(SemanticSimilarityEvent, "_PATTERN_CACHE", {})
        monkeypatch.setattr(SemanticSimilarityEvent, "_INPUT_EMBEDDING_CACHE", {})

        event = SemanticSimilarityEvent.create(
            event_id="semantic_usage",
            custom_sentences=["How are you feeling?"],
            score=1,
        )
        matched = await event.detect_event(
            [ChatMessage(role="counselor", content="How are you feeling?")]
        )

        assert matched is True
        assert [(c["room_id"], c["task"], c["model"]) for c in ai_usage_calls] == [
            ("room-sem", "event_embedding", "text-embedding-3-small"),
            ("room-sem", "event_embedding", "text-embedding-3-small"),
        ]
