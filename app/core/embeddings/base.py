"""
Base embedding client interface.
"""
from abc import ABC, abstractmethod
from typing import List
import numpy as np


class BaseEmbeddingClient(ABC):
    """
    Abstract base class for embedding clients.
    
    Provides interface for generating embeddings from text.
    """
    
    @abstractmethod
    async def get_embedding(self, text: str) -> np.ndarray:
        """
        Get embedding for a single text.
        
        Args:
            text: Text to embed
            
        Returns:
            Numpy array of embedding values
        """
        pass
    
    @abstractmethod
    async def get_embeddings_batch(self, texts: List[str]) -> List[np.ndarray]:
        """
        Get embeddings for multiple texts in a batch.
        
        Args:
            texts: List of texts to embed
            
        Returns:
            List of numpy arrays containing embeddings
        """
        pass
