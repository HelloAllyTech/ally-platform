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

    This used to return a hardcoded ``{"status": "ok"}``, which proved only
    that uvicorn was running. The thing that actually matters — whether the
    LiveKit worker is registered and able to take jobs — lives in a SEPARATE
    process in the same container (see start.sh), and it can be permanently
    dead while this process is perfectly healthy. That is precisely the
    2026-08-09 failure: workers registered with nobody for 19 hours while every
    signal, this one included, read green. A health check that cannot fail is
    worse than none.

    So the response now reflects the worker's real registration state, read
    from the heartbeat the worker process writes (app/core/worker_health.py).
    It returns 503 for exactly two conditions — the SDK permanently gave up on
    LiveKit, or the worker heartbeat is missing/stale past the startup grace —
    and NOT for a transient reconnect, which must not cull a whole fleet during
    a LiveKit blip.

    ``status`` keeps its "ok" value on success so existing probes that match on
    it are unaffected; the ``livekit`` field carries the detail.
    """
    from app.core.worker_health import registration_health

    try:
        state = registration_health()
    except Exception:  # noqa: BLE001
        # A bug in the health check must not itself take the service down.
        # Report ok-with-unknown rather than a false 503.
        logger.exception("Health check failed to read worker state")
        return {"status": "ok", "livekit": "unknown"}

    body = {
        "status": "ok" if state["healthy"] else "unhealthy",
        "livekit": state["livekit"],
        "detail": state["detail"],
    }
    if not state["healthy"]:
        logger.error(
            "Health check UNHEALTHY: livekit=%s (%s)",
            state["livekit"],
            state["detail"],
        )
        return JSONResponse(status_code=503, content=body)
    return body
