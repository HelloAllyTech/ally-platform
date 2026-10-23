from enum import Enum
from typing import Dict, Final, Optional

# BCP-47 language code -> explicit language name (avoids model confusion)
# Used by generate_language_samples and other language-aware features
# Non-standard codes that TTS/STT providers don't support -> BCP-47 equivalents
LANGUAGE_CODE_NORMALIZATIONS: Final[Dict[str, str]] = {}

# Sarvam TTS/STT: map unsupported codes to Sarvam's supported equivalents.
# Sarvam only supports en-IN for English; uses od-IN for Odia (not or-IN).
SARVAM_LANGUAGE_CODE_OVERRIDES: Final[Dict[str, str]] = {
    "or-IN": "od-IN",
    "or": "od-IN",
    "en-GB": "en-IN",
    "en-US": "en-IN",
}

LANGUAGE_CODE_TO_NAME: Final[Dict[str, str]] = {
    "en-US": "English (US)",
    "en-GB": "English (UK)",
    "en-IN": "English (India)",
    "ml": "Malayalam",
    "ml-IN": "Malayalam",
    "hi": "Hindi",
    "hi-IN": "Hindi",
    "bn": "Bengali",
    "bn-IN": "Bengali",
    "ta": "Tamil",
    "ta-IN": "Tamil",
    "te": "Telugu",
    "te-IN": "Telugu",
    "kn": "Kannada",
    "kn-IN": "Kannada",
    "mr": "Marathi",
    "mr-IN": "Marathi",
    "gu": "Gujarati",
    "gu-IN": "Gujarati",
    "pa": "Punjabi",
    "pa-IN": "Punjabi",
    "ur": "Urdu",
    "ur-IN": "Urdu",
    "or": "Odia",
    "or-IN": "Odia",
    "as": "Assamese",
    "as-IN": "Assamese",
}


def get_language_name_from_code(code: str) -> str:
    """Return language name for BCP-47 code; fallback to code if unknown."""
    base = code.split("-")[0]
    return LANGUAGE_CODE_TO_NAME.get(code, LANGUAGE_CODE_TO_NAME.get(base, code))


def convert_language_code_for_sarvam(code: Optional[str]) -> str:
    """
    Convert language code to Sarvam API format.

    Sarvam only supports en-IN for English (not en-GB, en-US) and od-IN
    for Odia (not or-IN). Used by both Sarvam TTS and Sarvam STT.
    """
    if not code or not isinstance(code, str):
        return DEFAULT_LANGUAGE_CODE
    key = code.strip()
    return SARVAM_LANGUAGE_CODE_OVERRIDES.get(key, key)


def normalize_language_code_for_providers(code: Optional[str]) -> str:
    """
    Map non-standard codes to provider-supported BCP-47 codes.

    TTS/STT providers (Sarvam, Google, etc.) do not support en-GLOBAL.
    Returns normalized code for use with TTS, STT, and voice preview.
    """
    if not code or not isinstance(code, str):
        return DEFAULT_LANGUAGE_CODE
    key = code.strip()
    return LANGUAGE_CODE_NORMALIZATIONS.get(key, key)


# Default language code when not specified
DEFAULT_LANGUAGE_CODE: Final[str] = "en-IN"

# Default capability configurations (fallback when not provided in metadata)
# Google chirp_2 in asia-southeast1 is what every Indic language runs on and
# what the V2V tester uses for English, so it is the proven fallback. Deepgram
# (nova-3) was the default until 2026-10-19, when its credits ran out and every
# session on it died at join with a 402.
DEFAULT_STT_CONFIG: Final[Dict[str, str]] = {
    "provider": "google",
    "model": "chirp_2",
    "location": "asia-southeast1",
}

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
    CARTESIA = "cartesia"
    SMALLESTAI = "smallestai"


class STTProvider(str, Enum):
    DEEPGRAM = "deepgram"
    GOOGLE = "google"
    SARVAM = "sarvam"
    ELEVENLABS = "elevenlabs"


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
    GUARDRAIL = "GUARDRAIL"


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
SCENARIO_REPORT_WEBHOOK_ENDPOINT: Final[str] = "/api/v1/learn/scenarios/reports/webhook"
# Goal-based actor evaluation result is PATCHed to
# {base}{ACTOR_EVALUATION_WEBHOOK_ENDPOINT}/{scenario_session_id}/evaluation
ACTOR_EVALUATION_WEBHOOK_ENDPOINT: Final[str] = "/api/v1/learn/scenario-session"
# Worker configuration constants
DEFAULT_VAD_ACTIVATION_THRESHOLD: Final[float] = 0.7
SESSION_TERMINATED_MESSAGE: Final[str] = "Session terminated"
