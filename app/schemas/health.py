"""
Schemas for health check endpoint.
"""
from pydantic import BaseModel


class HealthResponse(BaseModel):
    """Schema for health check response."""
    
    status: str
