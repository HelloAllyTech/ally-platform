"""
Middleware for the FastAPI application.
"""

import uuid
from typing import List

from fastapi import Request
from fastapi.middleware import Middleware
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.config import settings
from app.core.logger import logger, trace_id_var


class LogRequestMiddleware(BaseHTTPMiddleware):
    """Custom middleware for logging requests and adding a Trace ID."""

    async def dispatch(self, request: Request, call_next):
        trace_id = str(uuid.uuid4())
        trace_id_var.set(trace_id)

        if request.url.path not in ["/api/health", "/api/v1/health"]:
            logger.info(
                f"Incoming request {request.method} {request.url} (TraceID: {trace_id})"
            )

        response = await call_next(request)
        response.headers["X-Trace-ID"] = trace_id  # Include Trace ID in the response

        if request.url.path not in ["/api/health", "/api/v1/health"]:
            logger.info(
                f"Completed request {request.method} {request.url} "
                f"with status {response.status_code} (TraceID: {trace_id})"
            )

        return response


def get_middlewares() -> List[Middleware]:
    """
    Create and configure middleware for the application.
    """
    origins = [
        origin.strip()
        for origin in settings.ALLOWED_ORIGINS.split(",")
        if origin.strip()
    ]

    middlewares = [
        Middleware(LogRequestMiddleware),
        Middleware(
            CORSMiddleware,
            allow_origins=origins,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        ),
    ]
    return middlewares
