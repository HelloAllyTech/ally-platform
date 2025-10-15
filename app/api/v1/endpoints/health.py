"""
Health check endpoint.
"""
from fastapi import APIRouter

from app.schemas.health import HealthResponse

router = APIRouter()

@router.get("/health", response_model=HealthResponse)
async def health_check() -> HealthResponse:
    """
    Health check endpoint.
    
    Returns:
        HealthResponse: The health status of the service.
    """
    return HealthResponse(status="ok")
