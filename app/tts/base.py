"""
Base TTS client interface.
"""
from abc import ABC, abstractmethod


class BaseTTSClient(ABC):
    """
    Abstract base class for TTS clients.
    
    Provides interface for text-to-speech providers.
    
    Language resolution and configuration is handled by resolve_config,
    so provider classes only need to handle API integration.
    """
    
    @property
    @abstractmethod
    def tts_instance(self):
        """
        Get the underlying TTS instance from the provider library.
        
        Returns:
            TTS instance (e.g., deepgram.TTS, elevenlabs.TTS, sarvam.TTS)
        """
        pass

