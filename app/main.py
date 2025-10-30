"""
Main application module.
"""
from fastapi import FastAPI
from app.middleware import get_middlewares

app = FastAPI(middleware=get_middlewares())


@app.get("/api/health")
async def health():
    """
    Health check endpoint.
    """
    return {"status": "ok"}