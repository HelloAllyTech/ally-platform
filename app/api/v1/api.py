"""
API router for v1 endpoints.
"""
from fastapi import APIRouter

from app.api.v1.endpoints import health, docs

api_router = APIRouter()

# Include routers from endpoints
api_router.include_router(health.router, tags=["health"])
api_router.include_router(docs.router, tags=["docs"])
