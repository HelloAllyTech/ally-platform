"""Unit tests for OpenAIEmbeddingClient."""

from unittest.mock import AsyncMock, MagicMock, patch

import numpy as np
import pytest

from app.core.embeddings.openai_embeddings import OpenAIEmbeddingClient


@pytest.fixture
def mock_openai_embeddings():
    """Create a mock OpenAIEmbeddings instance."""
    with patch("app.core.embeddings.openai_embeddings.OpenAIEmbeddings") as mock_class:
        mock_instance = MagicMock()
        mock_instance.aembed_query = AsyncMock()
        mock_instance.aembed_documents = AsyncMock()
        mock_class.return_value = mock_instance
        yield mock_instance


@pytest.fixture
def mock_settings():
    """Mock settings for testing."""
    with patch("app.core.embeddings.openai_embeddings.settings") as mock_settings:
        mock_settings.OPENAI_EMBEDDING_MODEL = "text-embedding-3-small"
        mock_settings.OPENAI_API_KEY = "test-api-key"
        yield mock_settings


class TestOpenAIEmbeddingClientInitialization:
    """Test suite for OpenAIEmbeddingClient initialization."""

    def test_init_with_default_parameters(self, mock_openai_embeddings, mock_settings):
        """Test initialization with default parameters from settings."""
        client = OpenAIEmbeddingClient()

        assert client._model == "text-embedding-3-small"
        assert client._api_key == "test-api-key"
        assert client._embeddings is not None

    def test_init_with_custom_model(self, mock_openai_embeddings, mock_settings):
        """Test initialization with custom model."""
        client = OpenAIEmbeddingClient(model="text-embedding-ada-002")

        assert client._model == "text-embedding-ada-002"
        assert client._api_key == "test-api-key"

    def test_init_with_custom_api_key(self, mock_openai_embeddings, mock_settings):
        """Test initialization with custom API key."""
        client = OpenAIEmbeddingClient(api_key="custom-api-key")

        assert client._model == "text-embedding-3-small"
        assert client._api_key == "custom-api-key"


class TestOpenAIEmbeddingClientGetEmbedding:
    """Test suite for get_embedding method."""

    @pytest.mark.asyncio
    async def test_get_embedding_success(self, mock_openai_embeddings, mock_settings):
        """Test successful embedding generation for single text."""
        mock_embedding = [0.1, 0.2, 0.3, 0.4, 0.5]
        mock_openai_embeddings.aembed_query.return_value = mock_embedding

        client = OpenAIEmbeddingClient()
        result = await client.get_embedding("test text")

        assert isinstance(result, np.ndarray)
        assert result.dtype == np.float32
        assert len(result) == 5
        np.testing.assert_array_almost_equal(
            result, np.array(mock_embedding, dtype=np.float32)
        )
        mock_openai_embeddings.aembed_query.assert_called_once_with("test text")

    @pytest.mark.asyncio
    async def test_get_embedding_empty_string(
        self, mock_openai_embeddings, mock_settings
    ):
        """Test embedding generation for empty string."""
        mock_embedding = [0.0] * 1536
        mock_openai_embeddings.aembed_query.return_value = mock_embedding

        client = OpenAIEmbeddingClient()
        result = await client.get_embedding("")

        assert isinstance(result, np.ndarray)
        assert len(result) == 1536
        mock_openai_embeddings.aembed_query.assert_called_once_with("")

    @pytest.mark.asyncio
    async def test_get_embedding_api_error(self, mock_openai_embeddings, mock_settings):
        """Test error handling when API call fails."""
        mock_openai_embeddings.aembed_query.side_effect = Exception("API Error")

        client = OpenAIEmbeddingClient()

        with pytest.raises(Exception, match="API Error"):
            await client.get_embedding("test text")


class TestOpenAIEmbeddingClientGetEmbeddingsBatch:
    """Test suite for get_embeddings_batch method."""

    @pytest.mark.asyncio
    async def test_get_embeddings_batch_success(
        self, mock_openai_embeddings, mock_settings
    ):
        """Test successful batch embedding generation."""
        mock_embeddings = [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6], [0.7, 0.8, 0.9]]
        mock_openai_embeddings.aembed_documents.return_value = mock_embeddings

        client = OpenAIEmbeddingClient()
        texts = ["text1", "text2", "text3"]
        results = await client.get_embeddings_batch(texts)

        assert isinstance(results, list)
        assert len(results) == 3
        for i, result in enumerate(results):
            assert isinstance(result, np.ndarray)
            assert result.dtype == np.float32
            np.testing.assert_array_almost_equal(
                result, np.array(mock_embeddings[i], dtype=np.float32)
            )
        mock_openai_embeddings.aembed_documents.assert_called_once_with(texts)

    @pytest.mark.asyncio
    async def test_get_embeddings_batch_single_text(
        self, mock_openai_embeddings, mock_settings
    ):
        """Test batch embedding with single text."""
        mock_embeddings = [[0.1, 0.2, 0.3]]
        mock_openai_embeddings.aembed_documents.return_value = mock_embeddings

        client = OpenAIEmbeddingClient()
        results = await client.get_embeddings_batch(["single text"])

        assert len(results) == 1
        assert isinstance(results[0], np.ndarray)

    @pytest.mark.asyncio
    async def test_get_embeddings_batch_empty_list(
        self, mock_openai_embeddings, mock_settings
    ):
        """Test batch embedding with empty list."""
        mock_openai_embeddings.aembed_documents.return_value = []

        client = OpenAIEmbeddingClient()
        results = await client.get_embeddings_batch([])

        assert results == []
        mock_openai_embeddings.aembed_documents.assert_called_once_with([])

    @pytest.mark.asyncio
    async def test_get_embeddings_batch_api_error(
        self, mock_openai_embeddings, mock_settings
    ):
        """Test error handling when batch API call fails."""
        mock_openai_embeddings.aembed_documents.side_effect = Exception(
            "Batch API Error"
        )

        client = OpenAIEmbeddingClient()

        with pytest.raises(Exception, match="Batch API Error"):
            await client.get_embeddings_batch(["text1", "text2"])


class TestOpenAIEmbeddingClientIntegration:
    """Integration tests for OpenAIEmbeddingClient."""

    @pytest.mark.asyncio
    async def test_sequential_calls(self, mock_openai_embeddings, mock_settings):
        """Test multiple sequential embedding calls."""
        mock_openai_embeddings.aembed_query.side_effect = [
            [0.1, 0.2, 0.3],
            [0.4, 0.5, 0.6],
            [0.7, 0.8, 0.9],
        ]

        client = OpenAIEmbeddingClient()

        result1 = await client.get_embedding("text1")
        result2 = await client.get_embedding("text2")
        result3 = await client.get_embedding("text3")

        assert len(result1) == 3
        assert len(result2) == 3
        assert len(result3) == 3
        assert mock_openai_embeddings.aembed_query.call_count == 3

    @pytest.mark.asyncio
    async def test_mixed_single_and_batch_calls(
        self, mock_openai_embeddings, mock_settings
    ):
        """Test mixing single and batch embedding calls."""
        mock_openai_embeddings.aembed_query.return_value = [0.1, 0.2, 0.3]
        mock_openai_embeddings.aembed_documents.return_value = [
            [0.4, 0.5, 0.6],
            [0.7, 0.8, 0.9],
        ]

        client = OpenAIEmbeddingClient()

        single_result = await client.get_embedding("single text")
        batch_results = await client.get_embeddings_batch(["batch1", "batch2"])

        assert len(single_result) == 3
        assert len(batch_results) == 2
        mock_openai_embeddings.aembed_query.assert_called_once()
        mock_openai_embeddings.aembed_documents.assert_called_once()


class TestOpenAIEmbeddingUsage:
    """AI-cost: a call made with task= records its input tokens."""

    @pytest.fixture
    def counted(self, monkeypatch):
        """Token counting stubbed: 3 tokens per text."""
        monkeypatch.setattr(
            OpenAIEmbeddingClient,
            "_count_input_tokens",
            lambda self, texts: 3 * len([t for t in texts if t]),
        )

    @pytest.mark.asyncio
    async def test_single_records_against_the_client_room(
        self, mock_openai_embeddings, mock_settings, counted, ai_usage_calls
    ):
        mock_openai_embeddings.aembed_query.return_value = [0.1, 0.2]
        client = OpenAIEmbeddingClient(room_id="room-e")

        await client.get_embedding("hello", task="event_embedding")

        assert ai_usage_calls == [
            {
                "room_id": "room-e",
                "service": "llm",
                "provider": "openai",
                "model": "text-embedding-3-small",
                "task": "event_embedding",
                "prompt_tokens": 3,
                "completion_tokens": 0,
                "total_tokens": 3,
            }
        ]

    @pytest.mark.asyncio
    async def test_batch_sums_tokens_and_call_room_wins(
        self, mock_openai_embeddings, mock_settings, counted, ai_usage_calls
    ):
        mock_openai_embeddings.aembed_documents.return_value = [[0.1], [0.2]]
        client = OpenAIEmbeddingClient(room_id="room-e")

        await client.get_embeddings_batch(
            ["a", "b"], task="working_memory_embedding", room_id="room-override"
        )

        call = ai_usage_calls[0]
        assert (call["room_id"], call["task"]) == (
            "room-override",
            "working_memory_embedding",
        )
        assert call["prompt_tokens"] == 6

    @pytest.mark.asyncio
    async def test_no_client_room_falls_back_to_graph_room(
        self, mock_openai_embeddings, mock_settings, counted, ai_usage_calls, graph_room
    ):
        mock_openai_embeddings.aembed_query.return_value = [0.1]
        client = OpenAIEmbeddingClient()

        await client.get_embedding("hello", task="event_embedding")

        assert ai_usage_calls[0]["room_id"] == graph_room

    @pytest.mark.asyncio
    async def test_no_task_records_nothing(
        self, mock_openai_embeddings, mock_settings, counted, ai_usage_calls
    ):
        mock_openai_embeddings.aembed_query.return_value = [0.1]
        await OpenAIEmbeddingClient(room_id="r").get_embedding("hello")
        assert ai_usage_calls == []

    @pytest.mark.asyncio
    async def test_failed_call_records_nothing(
        self, mock_openai_embeddings, mock_settings, counted, ai_usage_calls
    ):
        mock_openai_embeddings.aembed_query.side_effect = RuntimeError("429")
        with pytest.raises(RuntimeError):
            await OpenAIEmbeddingClient(room_id="r").get_embedding(
                "hello", task="event_embedding"
            )
        assert ai_usage_calls == []

    @pytest.mark.asyncio
    async def test_counting_failure_never_breaks_the_call(
        self, mock_openai_embeddings, mock_settings, ai_usage_calls, monkeypatch
    ):
        def _boom(self, texts):
            raise RuntimeError("no tiktoken")

        monkeypatch.setattr(OpenAIEmbeddingClient, "_count_input_tokens", _boom)
        mock_openai_embeddings.aembed_query.return_value = [0.5]

        out = await OpenAIEmbeddingClient(room_id="r").get_embedding(
            "hello", task="event_embedding"
        )

        assert out.tolist() == [0.5]
        assert ai_usage_calls == []

    def test_token_count_matches_tiktoken_for_the_model(self, mock_settings):
        import tiktoken

        with patch("app.core.embeddings.openai_embeddings.OpenAIEmbeddings"):
            client = OpenAIEmbeddingClient(model="text-embedding-3-small")
        texts = ["I have been feeling low lately.", "मुझे अच्छा नहीं लग रहा"]
        enc = tiktoken.encoding_for_model("text-embedding-3-small")
        assert client._count_input_tokens(texts) == sum(
            len(enc.encode_ordinary(t)) for t in texts
        )
