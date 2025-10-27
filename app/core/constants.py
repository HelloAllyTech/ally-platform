from enum import Enum
from typing import Final


class TTSProvider(str, Enum):
    ELEVENLABS = "elevenlabs"
    DEEPGRAM = "deepgram"
    SARVAM = "sarvam"

class VisibilityType(str, Enum):
    ACTIVE = "ACTIVE"
    PASSIVE = "PASSIVE"

class SimilarityEventConfig:
    match_threshold: Final[float] = 0.6
    min_match_tokens: Final[int] = 2
