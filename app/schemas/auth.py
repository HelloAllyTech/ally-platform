"""
Authentication schemas.
"""
from pydantic import BaseModel


class Token(BaseModel):
    """Token schema."""
    
    access_token: str
    token_type: str


class TokenData(BaseModel):
    """Token data schema."""
    
    username: str | None = None


class LoginRequest(BaseModel):
    """Login request schema."""
    
    secret_key: str
