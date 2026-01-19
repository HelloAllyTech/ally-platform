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
    HUME_API_KEY: str = Field(...)

    LLM_TEMPERATURE: str = Field(...)

    GOOGLE_APPLICATION_CREDENTIALS: Optional[str] = Field(
        default=None,
        description="Path to Google Cloud credentials JSON file (for Google TTS)",
    )

    DEFAULT_MALE_VOICE_MODEL: Optional[str] = Field(...)
    DEFAULT_FEMALE_VOICE_MODEL: Optional[str] = Field(...)
    DEFAULT_NON_BINARY_VOICE_MODEL: Optional[str] = Field(...)

    ENABLE_VOICE_EXPRESSIONS: bool = Field(
        default=False, description="Enable dynamic voice expressions feature"
    )


settings = Settings()
