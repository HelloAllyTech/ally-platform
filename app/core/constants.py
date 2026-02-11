from enum import Enum
from typing import Dict, Final

# Default language code when not specified
DEFAULT_LANGUAGE_CODE: Final[str] = "en-IN"

# Default capability configurations (fallback when not provided in metadata)
DEFAULT_STT_CONFIG: Final[Dict[str, str]] = {"provider": "deepgram", "model": "nova-3"}

DEFAULT_LLM_CONFIG: Final[Dict[str, str]] = {
    "provider": "openai",
    "model": "gpt-4o-mini",
}

# Default LLM config for branching instruction resolution (structured output support)
DEFAULT_BRANCHING_LLM_CONFIG: Final[Dict[str, str]] = {
    "provider": "openai",
    "model": "gpt-4o-mini",
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
    GOOGLE = "google"
    SARVAM = "sarvam"


class LLMProvider(str, Enum):
    OPENAI = "openai"
    GEMINI = "gemini"
    OLLAMA = "ollama"
    VLLM = "vllm"


class VisibilityType(str, Enum):
    ACTIVE = "ACTIVE"
    PASSIVE = "PASSIVE"


class DetectionType(str, Enum):
    SENTENCE_SIMILARITY = "SENTENCE_SIMILARITY"
    SEMANTIC_SIMILARITY = "SEMANTIC_SIMILARITY"
    BINARY_CLASSIFIER = "BINARY_CLASSIFIER"
    TIME = "TIME"
    SCORE = "SCORE"
    COMBINATION = "COMBINATION"
    HELPER_UTTERANCE_LENGTH = "HELPER_UTTERANCE_LENGTH"
    HELPER_INTERRUPTED = "HELPER_INTERRUPTED"
    HELPER_PARAPHRASED = "HELPER_PARAPHRASED"


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


class GoogleSTTConfig:
    """Configuration constants for Google Cloud STT."""

    DEFAULT_MODEL: Final[str] = "chirp"
    DEFAULT_LOCATION: Final[str] = "global"
    SPOKEN_PUNCTUATION: Final[bool] = False

    # Model name mappings for backward compatibility
    MODEL_MAPPING: Final[Dict[str, str]] = {
        "default": "chirp",
        "command_and_search": "latest_short",
        "phone_call": "latest_long",
    }


class ExpressionType(str, Enum):
    IDENTIFIER = "IDENTIFIER"
    NOT = "NOT"
    AND = "AND"
    OR = "OR"


# Core service endpoint paths
AUTH_VERIFY_ENDPOINT: Final[str] = "/api/v1/authorization/permissions/validate"

# Worker configuration constants
DEFAULT_VAD_ACTIVATION_THRESHOLD: Final[float] = 0.7
SESSION_TERMINATED_MESSAGE: Final[str] = "Session terminated"
