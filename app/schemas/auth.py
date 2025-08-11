"""
Authentication schemas.
"""
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, EmailStr, Field


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


# Email-OTP Authentication Schemas

class SendOTPRequest(BaseModel):
    """Request schema for sending OTP to email."""
    
    email: EmailStr = Field(..., description="Email address to send OTP to")


class SendOTPResponse(BaseModel):
    """Response schema for OTP send request."""
    
    message: str = Field(..., description="Success message")
    email: str = Field(..., description="Email address OTP was sent to")
    expires_in_minutes: int = Field(..., description="OTP expiry time in minutes")


class VerifyOTPRequest(BaseModel):
    """Request schema for verifying OTP and logging in."""
    
    email: EmailStr = Field(..., description="Email address")
    code: str = Field(..., min_length=4, max_length=4, description="4-digit OTP code")


class TokenPair(BaseModel):
    """Token pair response schema."""
    
    access_token: str = Field(..., description="JWT access token")
    refresh_token: str = Field(..., description="JWT refresh token")
    token_type: str = Field(default="bearer", description="Token type")
    expires_in: int = Field(..., description="Access token expiry time in seconds")


class VerifyOTPResponse(BaseModel):
    """Response schema for successful OTP verification."""
    
    message: str = Field(..., description="Success message")
    user_id: int = Field(..., description="User ID")
    email: str = Field(..., description="User email")
    name: str = Field(..., description="User name")
    tokens: TokenPair = Field(..., description="Authentication tokens")


class RefreshTokenRequest(BaseModel):
    """Request schema for refreshing access token."""
    
    refresh_token: str = Field(..., description="Valid refresh token")


class RefreshTokenResponse(BaseModel):
    """Response schema for token refresh."""
    
    access_token: str = Field(..., description="New JWT access token")
    token_type: str = Field(default="bearer", description="Token type")
    expires_in: int = Field(..., description="Access token expiry time in seconds")


class LogoutRequest(BaseModel):
    """Request schema for logout."""
    
    refresh_token: Optional[str] = Field(None, description="Refresh token to invalidate")


class LogoutResponse(BaseModel):
    """Response schema for logout."""
    
    message: str = Field(..., description="Logout confirmation message")
