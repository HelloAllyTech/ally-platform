"""
Pydantic schemas for feedback operations.
"""

from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field, ConfigDict


class FeedbackCreate(BaseModel):
    """Schema for creating feedback."""
    rating: Optional[int] = Field(None, ge=1, le=5, description="Rating from 1 to 5")
    comment: Optional[str] = Field(None, description="Optional feedback comment")


class FeedbackResponse(BaseModel):
    """Schema for feedback response."""
    model_config = ConfigDict(from_attributes=True)
    
    id: int
    user_id: int
    rating: Optional[int]
    comment: Optional[str]
    created_at: datetime
    
    # Optional user information for admin view
    user_name: Optional[str] = None
    user_email: Optional[str] = None


class FeedbackListResponse(BaseModel):
    """Schema for paginated feedback list response."""
    feedback: list[FeedbackResponse]
    total: int
    page: int
    per_page: int
    total_pages: int


class SimpleFeedbackListResponse(BaseModel):
    """Schema for simple feedback list response without pagination."""
    feedback: list[FeedbackResponse]
