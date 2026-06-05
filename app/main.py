"""
Main application module.
"""

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.api import api_router
from app.core.logger import get_trace_id, logger
from app.middleware import get_middlewares

app = FastAPI(middleware=get_middlewares())


# Catch-all exception handler so dependency-resolution / middleware / handler
# errors don't escape as bare 500s with no trace_id and no traceback. The
# logger.exception() lands at ERROR, so (when Slack alerts are enabled) the
# failure is surfaced proactively instead of needing an AWS log dig.
@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    trace_id = get_trace_id()
    logger.exception(
        "Unhandled exception on %s %s (exception_type=%s): %s",
        request.method,
        request.url.path,
        type(exc).__name__,
        str(exc),
    )
    return JSONResponse(
        status_code=500,
        content={
            "detail": f"Internal Server Error: {type(exc).__name__}",
            "trace_id": trace_id,
        },
        headers={"X-Trace-ID": trace_id},
    )


# Register API routers
app.include_router(api_router)


@app.get("/api/health")
async def health():
    """
    Health check endpoint.
    """
    return {"status": "ok"}
