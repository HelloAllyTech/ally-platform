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
    LIVEKIT_LOG_LEVEL: str = Field(...)
    LIVEKIT_LOG_DEV_MODE: bool = Field(default=False)
    LIVEKIT_LOG_CONSOLE: bool = Field(default=False)

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
    SQS_MESSAGE_EVENT_QUEUE_NAME: str = Field(..., description="SQS queue name for message and events")

    ELEVEN_API_KEY: str = Field(...)
    SARVAM_API_KEY: str = Field(...)


    LLM_TEMPERATURE : str = Field(...)

    DEFAULT_MALE_VOICE_MODEL: Optional[str] = Field(None)
    DEFAULT_FEMALE_VOICE_MODEL: Optional[str] = Field(None)
    DEFAULT_NON_BINARY_VOICE_MODEL: Optional[str] = Field(None)

settings = Settings()
