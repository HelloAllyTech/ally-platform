"""
Main application module.
"""

from fastapi import FastAPI

from app.api import api_router
from app.middleware import get_middlewares

app = FastAPI(middleware=get_middlewares())

# Register API routers
app.include_router(api_router)


@app.get("/api/health")
async def health():
    """
    Health check endpoint.
    """
    return {"status": "ok"}
