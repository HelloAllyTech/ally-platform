import hmac
import uuid
from typing import List

from fastapi import Request
from fastapi.middleware import Middleware
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from app.core.config import settings
from app.core.constants import APISettings
from app.core.llm_usage.scope import parse_header, use_scope
from app.utils.logger import logger, trace_id_var


class AuthMiddleware(BaseHTTPMiddleware):
    """Middleware for checking X-API-Key in request headers."""

    async def dispatch(self, request: Request, call_next):

        # Only protect /api/v1 routes
        if request.url.path.startswith(APISettings.API_V1_STR):
            api_key = request.headers.get(APISettings.X_API_KEY_HEADER)
            if not api_key or not hmac.compare_digest(api_key, settings.API.X_API_KEY):
                return JSONResponse(
                    {"detail": "Unauthorized - invalid or missing API key"},
                    status_code=401,
                )

        return await call_next(request)


class LogRequestMiddleware(BaseHTTPMiddleware):
    """Custom middleware for logging requests and adding a Trace ID."""

    async def dispatch(self, request: Request, call_next):
        trace_id = str(uuid.uuid4())
        trace_id_var.set(trace_id)

        if request.url.path != "/api/health":
            logger.info(
                f"Incoming request {request.method} {request.url} (TraceID: {trace_id})"
            )

        response = await call_next(request)
        response.headers["X-Trace-ID"] = trace_id  # Include Trace ID in the response

        if request.url.path != "/api/health":
            logger.info(
                f"Completed request {request.method} {request.url} with status "
                f"{response.status_code} (TraceID: {trace_id})"
            )

        return response


class UsageScopeMiddleware:
    """Sets the usage scope from the ``X-Ally-Usage`` header for the request (CR1).

    Pure ASGI rather than ``BaseHTTPMiddleware``: the scope is a ContextVar set
    around the downstream app's whole call, so it is still set while a
    StreamingResponse's generator runs (an SSE reply's model calls happen there).
    An absent or invalid header leaves no scope, exactly as before.
    """

    HEADER = b"x-ally-usage"

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        raw = None
        for name, value in scope.get("headers") or []:
            if name.lower() == self.HEADER:
                raw = value
                break
        with use_scope(parse_header(raw)):
            await self.app(scope, receive, send)


def get_middlewares() -> List[Middleware]:
    """
    Create and configure middleware for the application.
    """
    middlewares = [
        Middleware(LogRequestMiddleware),
        # CORS middleware that should only be called from other services
        Middleware(
            CORSMiddleware,
            allow_origins=[],  # Empty list = reject all origins
            allow_credentials=False,  # Disable credentials
            allow_methods=[],  # Empty list = reject all methods
            allow_headers=[],  # Empty list = reject all headers
        ),
        Middleware(AuthMiddleware),
        Middleware(UsageScopeMiddleware),
    ]
    return middlewares
