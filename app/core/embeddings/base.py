"""
Base embedding client interface.
"""

from abc import ABC, abstractmethod
from typing import List, Optional

import numpy as np


class BaseEmbeddingClient(ABC):
    """
    Abstract base class for embedding clients.

    Provides interface for generating embeddings from text.
    """

    @abstractmethod
    async def get_embedding(
        self,
        text: str,
        *,
        task: Optional[str] = None,
        room_id: Optional[str] = None,
    ) -> np.ndarray:
        """
        Get embedding for a single text.

        Args:
            text: Text to embed
            task: LLMTask label to record usage under (None: record nothing)
            room_id: Room to attribute the usage to

        Returns:
            Numpy array of embedding values
        """
        pass

    @abstractmethod
    async def get_embeddings_batch(
        self,
        texts: List[str],
        *,
        task: Optional[str] = None,
        room_id: Optional[str] = None,
    ) -> List[np.ndarray]:
        """
        Get embeddings for multiple texts in a batch.

        Args:
            texts: List of texts to embed
            task: LLMTask label to record usage under (None: record nothing)
            room_id: Room to attribute the usage to

        Returns:
            List of numpy arrays containing embeddings
        """
        pass
