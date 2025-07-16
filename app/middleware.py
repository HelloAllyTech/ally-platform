"""
Middleware for the FastAPI application.
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings


def setup_middleware(app: FastAPI) -> None:
    """
    Set up middleware for the FastAPI application.
    
    Args:
        app: The FastAPI application.
    """
    # Set up CORS middleware
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
