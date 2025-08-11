"""
User schemas for API request/response validation.
"""

from datetime import datetime
from typing import Optional
from pydantic import BaseModel, EmailStr, Field


class UserBase(BaseModel):
    """Base user schema with common fields."""
    email: EmailStr = Field(..., description="User's email address")
    name: str = Field(..., min_length=1, max_length=255, description="User's full name")


class UserCreate(UserBase):
    """Schema for creating a new user."""
    pass  # Only email and name from UserBase


class UserUpdate(BaseModel):
    """Schema for updating user information."""
    email: Optional[EmailStr] = Field(None, description="User's email address")
    name: Optional[str] = Field(None, min_length=1, max_length=255, description="User's full name")


class UserResponse(UserBase):
    """Schema for user API responses."""
    id: int = Field(..., description="User's unique identifier")
    created_at: datetime = Field(..., description="User creation timestamp")
    updated_at: datetime = Field(..., description="User last update timestamp")
    deleted_at: Optional[datetime] = Field(None, description="User deletion timestamp (if soft deleted)")
    
    class Config:
        from_attributes = True  # For SQLAlchemy 2.0 compatibility
