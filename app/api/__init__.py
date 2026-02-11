"""API routers."""

from fastapi import APIRouter

from app.api.voice_preview import router as voice_preview_router

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(voice_preview_router)

__all__ = ["api_router"]
