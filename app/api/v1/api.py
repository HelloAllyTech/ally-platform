"""
API router for v1 endpoints.
"""
from fastapi import APIRouter

from app.api.v1.endpoints import health, docs, auth, room, webhook, scenario, users, feedback

api_router = APIRouter()

# Include routers from endpoints
api_router.include_router(health.router, tags=["health"])
api_router.include_router(docs.router, tags=["docs"])
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(room.router, prefix="/rooms", tags=["rooms"])
api_router.include_router(webhook.router, prefix="/webhook", tags=["webhook"])
api_router.include_router(scenario.router, prefix="/scenarios", tags=["scenarios"])
api_router.include_router(users.router, prefix="/users", tags=["users"])
api_router.include_router(feedback.router, prefix="/feedback", tags=["feedback"])
