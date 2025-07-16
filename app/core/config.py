"""
Configuration settings for the application.
"""
import os
from typing import Any, Dict, Optional

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings."""

    model_config = SettingsConfigDict(env_file=[".env", "./.env", "../.env"])
    
    API_V1_STR: str = "/api/v1"
    PROJECT_NAME: str = "Ally Learn Core"
    SECRET_KEY: str = Field(...)
    TOKEN_EXPIRE_MINUTES: int = Field(...)
    SESSION_TIMEOUT_MINUTES: int = Field(...)

    LIVEKIT_API_KEY: str = Field(...)
    LIVEKIT_API_SECRET: str = Field(...)
    LIVEKIT_URL: str = Field(...)



settings = Settings()
