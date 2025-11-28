from enum import Enum
from typing import Final

class Environment(str, Enum):
    DEV = "DEV"
    LOCAL = "LOCAL"
    PROD = "PROD"

class TTSProvider(str, Enum):
    ELEVENLABS = "elevenlabs"
    DEEPGRAM = "deepgram"
    SARVAM = "sarvam"

class STTProvider(str, Enum):
    DEEPGRAM = "deepgram"

class LLMProvider(str, Enum):
    OPENAI = "openai"

class VisibilityType(str, Enum):
    ACTIVE = "ACTIVE"
    PASSIVE = "PASSIVE"

class SimilarityEventConfig:
    match_threshold: Final[float] = 0.6
    min_match_tokens: Final[int] = 2
