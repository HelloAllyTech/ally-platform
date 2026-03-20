"""
Configuration settings for the application.
"""

from typing import Optional

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.core.constants import Environment


class Settings(BaseSettings):
    """Application settings."""

    model_config = SettingsConfigDict(
        env_file=[".env", "./.env", "../.env"],
        # Ignore unknown environment variables
        # (e.g., double-underscore vars from S3)
        extra="ignore",
    )

    # Log settings
    ENV: Environment = Field(default=Environment.DEV, description="App environment")

    LOG_LEVEL: str = "INFO"

    SLACK_ALERTS_ENABLED: bool = False
    SLACK_ALERTS_API_TOKEN: str = Field(...)
    SLACK_ALERTS_CHANNEL_ID: str = Field(...)
    SLACK_ALERTS_LOG_LEVEL: str = "WARNING"
    LIVEKIT_LOG_LEVEL: str = Field(...)
    LIVEKIT_LOG_DEV_MODE: bool = Field(default=False)
    LIVEKIT_LOG_CONSOLE: bool = Field(default=False)

    LIVEKIT_API_KEY: str = Field(...)
    LIVEKIT_API_SECRET: str = Field(...)
    LIVEKIT_URL: str = Field(...)
    AGENT_NAME: str = Field(default="Agent", description="Agent name for LiveKit")

    OPENAI_API_KEY: str = Field(...)
    OPENAI_MODEL: str = Field(
        default="gpt-4o-mini", description="OpenAI model to use for LLM responses"
    )
    OPENAI_EMBEDDING_MODEL: str = Field(
        default="text-embedding-3-small",
        description="OpenAI model to use for embeddings",
    )

    # Open-source LLM settings (Ollama / vLLM)
    OLLAMA_BASE_URL: Optional[str] = Field(
        default="http://host.docker.internal:11434/v1",
        description="Base URL for Ollama's OpenAI-compatible API",
    )
    VLLM_BASE_URL: Optional[str] = Field(
        default=None,
        description="Base URL for vLLM's OpenAI-compatible API",
    )
    LOCAL_LLM_MODEL: Optional[str] = Field(
        default=None,
        description="Default model for local LLM providers (e.g., llama3.2)",
    )

    GOOGLE_API_KEY: Optional[str] = Field(
        default=None,
        description=(
            "Google API key for Gemini LLM "
            "(can also use GOOGLE_APPLICATION_CREDENTIALS)"
        ),
    )

    # Semantic similarity settings
    SEMANTIC_SIMILARITY_THRESHOLD: float = Field(
        default=0.6,
        description=(
            "Similarity threshold for cosine similarity (0-1 range). "
            "Higher threshold means stricter matching"
        ),
    )

    DEEPGRAM_API_KEY: str = Field(...)

    # AWS SES settings
    AWS_ACCESS_KEY_ID: str = Field(...)
    AWS_SECRET_ACCESS_KEY: str = Field(...)
    AWS_REGION: str = Field(default="us-east-1")
    AWS_ENDPOINT_URL: Optional[str] = Field(
        default=None, description="AWS endpoint URL (for LocalStack)"
    )
    SQS_MESSAGE_EVENT_QUEUE_NAME: str = Field(
        ..., description="SQS queue name for message and events"
    )

    ELEVEN_API_KEY: str = Field(...)
    SARVAM_API_KEY: str = Field(...)
    SARVAM_TTS_TIMEOUT: float = Field(
        default=30.0,
        description=(
            "Upper limit in seconds to wait for Sarvam TTS response before giving up"
        ),
    )
    HUME_API_KEY: str = Field(...)

    LLM_TEMPERATURE: str = Field(...)

    GOOGLE_APPLICATION_CREDENTIALS: Optional[str] = Field(
        default=None,
        description="Path to Google Cloud credentials JSON file (for Google TTS)",
    )

    DEFAULT_MALE_VOICE_MODEL: Optional[str] = Field(...)
    DEFAULT_FEMALE_VOICE_MODEL: Optional[str] = Field(...)
    DEFAULT_NON_BINARY_VOICE_MODEL: Optional[str] = Field(...)

    # Core service
    CORE_SERVICE_BASE_URL: str = Field(
        default="http://localhost:8000",
        description=(
            "Base URL of the core backend service "
            "(e.g., https://api.dev.helloally.ai)"
        ),
    )
    CORE_SERVICE_API_KEY: str = Field(
        default="dummy-key",
        description="API key sent as x-api-key header when calling the core service",
    )
    PROMPT_SERVICE_API_KEY: str = Field(
        default="dummy-key",
        description="Key used specifically for prompt synchronization and retrieval",
    )
    X_API_KEY: str = Field(
        default="dummy-key",
        description=(
            "API key for validating incoming requests to this service "
            "(callers must send this value in the x-api-key header)"
        ),
    )

    # CORS
    ALLOWED_ORIGINS: str = Field(
        default="*",
        description="Comma-separated list of allowed CORS origins",
    )

    # Multilingual settings
    MULTILINGUAL_METHOD: str = Field(
        default="none",
        description=(
            "Method to use: 'cotr', 'rag', 'prompt_engineering', "
            "'back_translation', 'none'"
        ),
    )
    EVALUATION_LOG_DIR: Optional[str] = Field(
        default="evaluation_logs",
        description="Directory to store evaluation logs",
    )
    EVALUATION_LOGGING_ENABLED: bool = Field(
        default=False,
        description=(
            "Enable conversation logging for evaluation "
            "(always logs if enabled, regardless of multilingual settings)"
        ),
    )

    # Event processing feature flags
    ENABLE_EVENT_DETECTION_OPTIMIZATIONS: bool = Field(
        default=True,
        description=(
            "Enable all event processing optimizations. "
            "When True: "
            "- Parallel processing: branching events sequential, "
            "non-branching events async "
            "- Input embedding cache: avoids duplicate API calls "
            "- Timeout handling: 10s timeout prevents blocking "
            "When False: all events processed sequentially, "
            "no cache, no timeout (old behavior)."
        ),
    )
    EVENT_DETECTION_CONCURRENCY_LIMIT: int = Field(
        default=8,
        description=(
            "Maximum number of event or behavior detection coroutines to run "
            "concurrently. Prevents remote model and embedding requests from "
            "spiking tail latency under heavy scenarios."
        ),
    )
    KNOWLEDGE_RETRIEVAL_CACHE_SIZE: int = Field(
        default=256,
        description=(
            "Maximum number of recent knowledge retrieval results to cache in "
            "memory per worker process."
        ),
    )

    # Scenario report generation settings
    REPORT_CONCURRENCY_LIMIT: int = Field(
        default=3,
        description=(
            "Maximum number of scenario reports that can run concurrently. "
            "Prevents memory spikes from too many simultaneous long-running tasks. "
            "Requests beyond this limit will queue until a slot opens."
        ),
    )

    # Speech prosody skip thresholds (reduce latency when under pressure)
    # When skipped, TTS keeps last params instead of running prosody LLM call
    PROSDY_SKIP_ENABLED: bool = Field(
        default=True,
        description=(
            "Enable skip-when-under-pressure logic. "
            "When False, always run prosody (no skip)."
        ),
    )
    PROSDY_SKIP_MIN_RESPONSE_LENGTH: int = Field(
        default=50,
        description=(
            "Skip prosody when response is shorter than this (chars). "
            "Short responses have low prosody impact."
        ),
    )
    PROSDY_SKIP_MAX_RESPONSE_LENGTH: int = Field(
        default=0,
        description=(
            "Skip prosody when response is longer than this (chars). "
            "0 = disabled. Avoids compounding latency on long responses."
        ),
    )
    PROSDY_SKIP_WHEN_EVENTS_DETECTED: bool = Field(
        default=True,
        description=(
            "Skip prosody when events detected this turn. "
            "Prioritizes responsiveness over voice expression."
        ),
    )


settings = Settings()
