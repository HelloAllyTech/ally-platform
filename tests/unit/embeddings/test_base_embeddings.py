"""Unit tests for BaseEmbeddingClient."""

import numpy as np
import pytest

from app.core.embeddings.base import BaseEmbeddingClient


class ConcreteEmbeddingClient(BaseEmbeddingClient):
    """Concrete implementation of BaseEmbeddingClient for testing."""

    async def get_embedding(self, text: str) -> np.ndarray:
        """Return a simple embedding for testing."""
        return np.array([0.1, 0.2, 0.3], dtype=np.float32)

    async def get_embeddings_batch(self, texts: list[str]) -> list[np.ndarray]:
        """Return simple embeddings for testing."""
        return [np.array([0.1, 0.2, 0.3], dtype=np.float32) for _ in texts]


class IncompleteEmbeddingClient(BaseEmbeddingClient):
    """Incomplete implementation missing required methods."""

    pass


class TestBaseEmbeddingClient:
    """Test suite for BaseEmbeddingClient abstract class."""

    def test_cannot_instantiate_base_class(self):
        """Test that BaseEmbeddingClient cannot be instantiated directly."""
        with pytest.raises(TypeError):
            BaseEmbeddingClient()

    def test_cannot_instantiate_incomplete_implementation(self):
        """Test that incomplete implementations cannot be instantiated."""
        with pytest.raises(TypeError):
            IncompleteEmbeddingClient()

    def test_can_instantiate_complete_implementation(self):
        """Test that complete implementations can be instantiated."""
        client = ConcreteEmbeddingClient()
        assert isinstance(client, BaseEmbeddingClient)


class CustomEmbeddingClient(BaseEmbeddingClient):
    """Custom implementation with different behavior for testing."""

    def __init__(self, dimension: int = 768):
        self.dimension = dimension
        self.call_count = 0

    async def get_embedding(self, text: str) -> np.ndarray:
        """Return embedding with custom dimension."""
        self.call_count += 1
        return np.random.rand(self.dimension).astype(np.float32)

    async def get_embeddings_batch(self, texts: list[str]) -> list[np.ndarray]:
        """Return batch embeddings with custom dimension."""
        self.call_count += len(texts)
        return [np.random.rand(self.dimension).astype(np.float32) for _ in texts]


class TestCustomEmbeddingImplementation:
    """Test suite for custom embedding client implementations."""

    @pytest.mark.asyncio
    async def test_custom_dimension(self):
        """Test custom embedding dimension."""
        client = CustomEmbeddingClient(dimension=512)
        result = await client.get_embedding("test")

        assert len(result) == 512
        assert result.dtype == np.float32

    @pytest.mark.asyncio
    async def test_custom_batch_dimension(self):
        """Test custom dimension in batch processing."""
        client = CustomEmbeddingClient(dimension=1024)
        results = await client.get_embeddings_batch(["text1", "text2"])

        assert len(results) == 2
        for result in results:
            assert len(result) == 1024
            assert result.dtype == np.float32

    @pytest.mark.asyncio
    async def test_multiple_clients_independent(self):
        """Test that multiple client instances are independent."""
        client1 = CustomEmbeddingClient(dimension=256)
        client2 = CustomEmbeddingClient(dimension=512)

        result1 = await client1.get_embedding("test")
        result2 = await client2.get_embedding("test")

        assert len(result1) == 256
        assert len(result2) == 512
        assert client1.call_count == 1
        assert client2.call_count == 1


class ErrorHandlingEmbeddingClient(BaseEmbeddingClient):
    """Implementation that simulates errors for testing."""

    def __init__(self, fail_on_single: bool = False, fail_on_batch: bool = False):
        self.fail_on_single = fail_on_single
        self.fail_on_batch = fail_on_batch

    async def get_embedding(self, text: str) -> np.ndarray:
        """Simulate potential errors in single embedding."""
        if self.fail_on_single:
            raise ValueError("Simulated error in get_embedding")
        return np.array([0.1, 0.2, 0.3], dtype=np.float32)

    async def get_embeddings_batch(self, texts: list[str]) -> list[np.ndarray]:
        """Simulate potential errors in batch embedding."""
        if self.fail_on_batch:
            raise ValueError("Simulated error in get_embeddings_batch")
        return [np.array([0.1, 0.2, 0.3], dtype=np.float32) for _ in texts]


class TestErrorHandlingInImplementations:
    """Test suite for error handling in embedding client implementations."""

    @pytest.mark.asyncio
    async def test_single_embedding_error(self):
        """Test error handling in get_embedding."""
        client = ErrorHandlingEmbeddingClient(fail_on_single=True)

        with pytest.raises(ValueError, match="Simulated error in get_embedding"):
            await client.get_embedding("test")

    @pytest.mark.asyncio
    async def test_batch_embedding_error(self):
        """Test error handling in get_embeddings_batch."""
        client = ErrorHandlingEmbeddingClient(fail_on_batch=True)

        with pytest.raises(ValueError, match="Simulated error in get_embeddings_batch"):
            await client.get_embeddings_batch(["test1", "test2"])


class TestBaseEmbeddingClientInterface:
    """Test suite for verifying the interface contract."""

    def test_get_embedding_is_abstract(self):
        """Test that get_embedding is marked as abstract."""
        assert hasattr(BaseEmbeddingClient.get_embedding, "__isabstractmethod__")
        assert BaseEmbeddingClient.get_embedding.__isabstractmethod__

    def test_get_embeddings_batch_is_abstract(self):
        """Test that get_embeddings_batch is marked as abstract."""
        assert hasattr(BaseEmbeddingClient.get_embeddings_batch, "__isabstractmethod__")
        assert BaseEmbeddingClient.get_embeddings_batch.__isabstractmethod__

    @pytest.mark.asyncio
    async def test_implementations_return_correct_types(self):
        """Test that implementations return correct types."""
        client = ConcreteEmbeddingClient()

        single_result = await client.get_embedding("test")
        assert isinstance(single_result, np.ndarray)

        batch_results = await client.get_embeddings_batch(["test1", "test2"])
        assert isinstance(batch_results, list)
        assert all(isinstance(r, np.ndarray) for r in batch_results)
