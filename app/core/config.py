"""
Configuration settings for the application.
"""
import os
from typing import Any, Dict, Optional, Literal
from urllib.parse import quote_plus

from pydantic import Field, computed_field
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.core.constants import TTSProvider


class Settings(BaseSettings):
    """Application settings."""

    model_config = SettingsConfigDict(env_file=[".env", "./.env", "../.env"])

    # Log settings
    LOG_LEVEL: str = "INFO"
    SLACK_ALERTS_ENABLED: bool = False
    SLACK_ALERTS_API_TOKEN: str = Field(...)
    SLACK_ALERTS_CHANNEL_ID: str = Field(...)
    SLACK_ALERTS_LOG_LEVEL: str = "WARNING"
    
    API_V1_STR: str = "/api/v1"
    PROJECT_NAME: str = "Ally Learn Core"
    SECRET_KEY: str = Field(...)
    TOKEN_EXPIRE_MINUTES: int = Field(...)
    SESSION_TIMEOUT_MINUTES: int = Field(...)

    # Admin API Key for user management
    ADMIN_API_KEY: str = Field(..., description="API key for admin operations")

    LIVEKIT_API_KEY: str = Field(...)
    LIVEKIT_API_SECRET: str = Field(...)
    LIVEKIT_URL: str = Field(...)
    AGENT_NAME: str = Field(default="Agent", description="Agent name for LiveKit")

    OPENAI_API_KEY: str = Field(...)
    OPENAI_MODEL: str = Field(default="gpt-4o-mini", description="OpenAI model to use for LLM responses")

    DEEPGRAM_API_KEY: str = Field(...)

    # AWS SES settings
    AWS_ACCESS_KEY_ID: str = Field(...)
    AWS_SECRET_ACCESS_KEY: str = Field(...)
    AWS_REGION: str = Field(default="us-east-1")
    AWS_ENDPOINT_URL: Optional[str] = Field(default=None, description="AWS endpoint URL (for LocalStack)")
    SES_FROM_EMAIL: str = Field(..., description="Verified sender email address")
    SES_FROM_NAME: str = Field(default="Ally Learn", description="Sender name")
    SQS_MESSAGE_EVENT_QUEUE_NAME: str = Field(..., description="SQS queue name for message and events")

    # Database component settings
    DATABASE_HOST: str = Field(..., description="Database host")
    DATABASE_PORT: int = Field(default=5432, description="Database port")
    DATABASE_USER: str = Field(..., description="Database username")
    DATABASE_PASSWORD: str = Field(..., description="Database password")
    DATABASE_NAME: str = Field(..., description="Database name")

    DATABASE_ECHO: bool = Field(default=False)

    # Auto-join settings
    AUTO_JOIN_ENABLED: bool = Field(default=True)
    AUTO_LEAVE_WHEN_EMPTY: bool = Field(default=False)

    # Token settings
    ACCESS_TOKEN_EXPIRE_MINUTES: int = Field(default=15)
    REFRESH_TOKEN_EXPIRE_DAYS: int = Field(default=7)
    ELEVEN_API_KEY: str = Field(...)
    SARVAM_API_KEY: str = Field(...)
    MODEL : Optional[str] = Field(...)
    VOICE_ID: Optional[str] = Field(...)
    SPEAKER: Optional[str] = Field(...)

    TTS_PROVIDER: TTSProvider= Field(
        default=TTSProvider.DEEPGRAM,
        description="The TTS provider to use ('elevenlabs' or 'deepgram')"
    )

    LLM_TEMPERATURE : str = Field(...)

    @computed_field
    @property
    def DATABASE_URL(self) -> str:
        """Construct DATABASE_URL from components with asyncpg driver."""
        # URL encode the password to handle special characters
        encoded_password = quote_plus(self.DATABASE_PASSWORD)
        
        return (
            f"postgresql+asyncpg://"
            f"{self.DATABASE_USER}:{encoded_password}@"
            f"{self.DATABASE_HOST}:{self.DATABASE_PORT}/"
            f"{self.DATABASE_NAME}"
        )

    @computed_field  
    @property
    def MIGRATION_DATABASE_URL(self) -> str:
        """Construct MIGRATION_DATABASE_URL from components with psycopg2 driver."""
        # URL encode the password to handle special characters
        encoded_password = quote_plus(self.DATABASE_PASSWORD)
        
        return (
            f"postgresql+psycopg2://"
            f"{self.DATABASE_USER}:{encoded_password}@"
            f"{self.DATABASE_HOST}:{self.DATABASE_PORT}/"
            f"{self.DATABASE_NAME}"
        )


settings = Settings()
