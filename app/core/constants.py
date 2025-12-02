from enum import Enum
from typing import Final, Dict

# Default language code when not specified
DEFAULT_LANGUAGE_CODE: Final[str] = "en-IN"

# Default capability configurations (fallback when not provided in metadata)
DEFAULT_STT_CONFIG: Final[Dict[str, str]] = {
    "provider": "deepgram",
    "model": "nova-3"
}

DEFAULT_LLM_CONFIG: Final[Dict[str, str]] = {
    "provider": "openai",
    "model": "gpt-4o-mini"
}

class Environment(str, Enum):
    DEV = "DEV"
    LOCAL = "LOCAL"
    PROD = "PROD"

class TTSProvider(str, Enum):
    ELEVENLABS = "elevenlabs"
    DEEPGRAM = "deepgram"
    SARVAM = "sarvam"
    GOOGLE = "google"
    HUME = "hume"

class STTProvider(str, Enum):
    DEEPGRAM = "deepgram"

class LLMProvider(str, Enum):
    OPENAI = "openai"

class VisibilityType(str, Enum):
    ACTIVE = "ACTIVE"
    PASSIVE = "PASSIVE"

class DetectionType(str, Enum):
    SENTENCE_SIMILARITY = "SENTENCE_SIMILARITY"
    SEMANTIC_SIMILARITY = "SEMANTIC_SIMILARITY"
    TIME = "TIME"
    SCORE = "SCORE"
    COMBINATION = "COMBINATION"

class ConditionOperator(str, Enum):
    """Comparison operators for time and score conditions."""
    GT = "GT"  # Greater than
    LT = "LT"  # Less than
    GTE = "GTE"  # Greater than or equal
    LTE = "LTE"  # Less than or equal
    EQ = "EQ"  # Equal

class SimilarityEventConfig:
    match_threshold: Final[float] = 0.6
    min_match_tokens: Final[int] = 2

class ExpressionType(str, Enum):
    IDENTIFIER = "IDENTIFIER"
    NOT = "NOT"
    AND = "AND"
    OR = "OR"