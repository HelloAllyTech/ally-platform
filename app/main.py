"""
Main application module.
"""
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.openapi.utils import get_openapi

from app.api.v1.api import api_router
from app.core.config import settings
from app.middleware import get_middlewares



app = FastAPI(
    title=settings.PROJECT_NAME,
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
    docs_url=None,
    redoc_url=None,
    middleware=get_middlewares()
)

logging.getLogger("uvicorn.access").handlers = []
logging.getLogger("uvicorn.access").propagate = False


# Include API router
app.include_router(api_router, prefix=settings.API_V1_STR)


@app.get("/")
async def root():
    """
    Root endpoint.
    """
    return {"message": f"Welcome to {settings.PROJECT_NAME}"}