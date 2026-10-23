"""Concurrency / freeze diagnostics for the agent worker process.

Opt-in via env var AGENT_DIAGNOSTICS_INTERVAL (seconds). 0 or unset = disabled.

On the interval, logs a snapshot of every asyncio Task in the running loop:
  - task name + done/cancelled flags
  - the coroutine it's currently awaiting (qualname + file:line)
  - the bottom of its stack (most recent frame inside our code)
  - process RSS

Also installs a SIGUSR1 handler so an operator can force an immediate dump:
  docker exec <container> kill -USR1 1
"""

from __future__ import annotations

import asyncio
import gc
import os
import signal
import sys
import time
import traceback
from typing import List, Optional

from app.core.logger import get_logger

logger = get_logger(__name__)

_started = False
_last_dump_ts: float = 0.0
# Strong reference to the heartbeat task to prevent it from being garbage
# collected. asyncio.create_task only holds a weak ref, and a fire-and-forget
# task can disappear at any point if nothing else holds it.
_heartbeat_task: Optional["asyncio.Task"] = None


def _rss_mb() -> Optional[float]:
    try:
        import resource

        rss_kb = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        # macOS reports bytes, Linux reports kilobytes
        return rss_kb / (1024 * 1024) if sys.platform == "darwin" else rss_kb / 1024
    except Exception:
        return None


def _format_task(task: asyncio.Task) -> str:
    name = task.get_name()
    coro = task.get_coro()
    coro_name = getattr(coro, "__qualname__", repr(coro))

    # Where the coroutine is currently suspended.
    frame_info = ""
    try:
        frames = task.get_stack(limit=6)
        if frames:
            # Prefer the deepest frame inside app/ — that's usually the
            # interesting one. Fall back to the deepest frame overall.
            chosen = next(
                (f for f in reversed(frames) if "/app/" in f.f_code.co_filename),
                frames[-1],
            )
            frame_info = (
                f"{chosen.f_code.co_filename}:"
                f"{chosen.f_lineno} in {chosen.f_code.co_name}"
            )
    except Exception as exc:
        frame_info = f"<stack unavailable: {exc}>"

    flags = []
    if task.done():
        flags.append("done")
    if task.cancelled():
        flags.append("cancelled")
    flag_str = f" [{','.join(flags)}]" if flags else ""

    return f"  - {name}{flag_str} coro={coro_name} at {frame_info}"


def _inspect_httpx_pool(client) -> Optional[str]:
    """Return a one-line summary of an httpx.AsyncClient connection pool."""
    try:
        transport = getattr(client, "_transport", None)
        pool = getattr(transport, "_pool", None) if transport else None
        if pool is None:
            return None
        conns = list(getattr(pool, "_connections", []) or [])
        active = sum(1 for c in conns if getattr(c, "is_idle", lambda: True)() is False)
        max_conns = getattr(pool, "_max_connections", "?")
        max_keepalive = getattr(pool, "_max_keepalive_connections", "?")
        requests_q = len(getattr(pool, "_requests", []) or [])
        return (
            f"httpx total={len(conns)} active={active} "
            f"waiting={requests_q} max={max_conns} keepalive={max_keepalive}"
        )
    except Exception as exc:
        return f"httpx <introspection failed: {exc}>"


def _inspect_aiohttp_session(session) -> Optional[str]:
    """Return a one-line summary of an aiohttp.ClientSession connector."""
    try:
        if getattr(session, "closed", True):
            return None
        connector = getattr(session, "_connector", None)
        if connector is None:
            return None
        # _conns: idle connections per host; _acquired: in-use Connection objects.
        idle = sum(len(v) for v in getattr(connector, "_conns", {}).values())
        acquired = len(getattr(connector, "_acquired", set()) or set())
        limit = getattr(connector, "_limit", "?")
        limit_per_host = getattr(connector, "_limit_per_host", "?")
        waiters = sum(len(v) for v in getattr(connector, "_waiters", {}).values())
        return (
            f"aiohttp idle={idle} acquired={acquired} "
            f"waiting={waiters} limit={limit} per_host={limit_per_host}"
        )
    except Exception as exc:
        return f"aiohttp <introspection failed: {exc}>"


def dump_http_pools() -> List[str]:
    """Discover live HTTP clients via GC and summarize each pool."""
    lines: List[str] = []
    seen_ids = set()
    for obj in gc.get_objects():
        cls = type(obj).__name__
        mod = type(obj).__module__ or ""
        line: Optional[str] = None
        if cls == "AsyncClient" and mod.startswith("httpx"):
            line = _inspect_httpx_pool(obj)
        elif cls == "ClientSession" and mod.startswith("aiohttp"):
            line = _inspect_aiohttp_session(obj)
        if line and id(obj) not in seen_ids:
            seen_ids.add(id(obj))
            lines.append(f"  - {cls} 0x{id(obj):x} {line}")
    return lines


def dump_tasks(reason: str = "heartbeat") -> None:
    """Log a snapshot of every Task on the running loop + HTTP pool counters.

    Log level depends on reason:
      - "heartbeat" → INFO (routine; emitted every interval; bypasses
        WARNING-level Slack/alert handlers).
      - anything else (e.g. "SIGUSR1") → WARNING (operator deliberately
        triggered a dump; worth surfacing).
    """
    global _last_dump_ts
    _last_dump_ts = time.time()

    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        logger.warning("[DIAG] dump_tasks called with no running loop (%s)", reason)
        return

    tasks = [t for t in asyncio.all_tasks(loop) if not t.done()]
    rss = _rss_mb()
    rss_str = f"{rss:.1f}MB" if rss is not None else "unknown"

    header = (
        f"[DIAG] pid={os.getpid()} reason={reason} " f"tasks={len(tasks)} rss={rss_str}"
    )
    task_body = "\n".join(_format_task(t) for t in tasks) or "  (no live tasks)"

    pool_lines = dump_http_pools()
    pool_body = (
        "\n".join(pool_lines) if pool_lines else "  (no httpx/aiohttp clients found)"
    )

    log = logger.info if reason == "heartbeat" else logger.warning
    log("%s\nTASKS:\n%s\nHTTP POOLS:\n%s", header, task_body, pool_body)


async def _heartbeat(interval: float) -> None:
    logger.info(
        "[DIAG] heartbeat started (interval=%.1fs, pid=%s)", interval, os.getpid()
    )
    while True:
        try:
            await asyncio.sleep(interval)
            dump_tasks(reason="heartbeat")
        except asyncio.CancelledError:
            logger.info("[DIAG] heartbeat cancelled")
            raise
        except Exception:
            # Diagnostics must never take the worker down.
            logger.exception("[DIAG] heartbeat iteration failed")


def _install_sigusr1_handler() -> None:
    """SIGUSR1 → immediate dump from the running loop."""
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return

    def handler() -> None:
        # Coalesce: ignore a burst of SIGUSR1 within 500ms.
        if time.time() - _last_dump_ts < 0.5:
            return
        try:
            dump_tasks(reason="SIGUSR1")
        except Exception:
            logger.exception("[DIAG] SIGUSR1 dump failed")

    try:
        loop.add_signal_handler(signal.SIGUSR1, handler)
        logger.info("[DIAG] SIGUSR1 handler installed (kill -USR1 %s)", os.getpid())
    except (NotImplementedError, RuntimeError) as exc:
        # Windows / restricted envs.
        logger.info("[DIAG] SIGUSR1 handler not installed: %s", exc)


def _read_interval_from_env() -> str:
    """Resolve AGENT_DIAGNOSTICS_INTERVAL from os.environ, falling back to
    parsing .env directly. pydantic-settings only pushes declared fields into
    its Settings object — it does NOT inject undeclared vars into os.environ,
    so a value sitting in .env never reaches os.getenv unless we look for it
    ourselves."""
    raw = os.environ.get("AGENT_DIAGNOSTICS_INTERVAL", "").strip()
    if raw:
        return raw
    # Walk up looking for the .env (Settings searches .env / ./.env / ../.env).
    here = os.path.dirname(os.path.abspath(__file__))
    for candidate in [
        os.path.join(here, "..", "..", ".env"),
        os.path.join(here, "..", "..", "..", ".env"),
        os.path.join(os.getcwd(), ".env"),
    ]:
        try:
            with open(candidate, "r") as f:
                for line in f:
                    line = line.strip()
                    if line.startswith("AGENT_DIAGNOSTICS_INTERVAL"):
                        _, _, val = line.partition("=")
                        return val.strip().strip('"').strip("'")
        except OSError:
            continue
    return ""


def start_diagnostics() -> Optional[asyncio.Task]:
    """Start the heartbeat task if AGENT_DIAGNOSTICS_INTERVAL is set and > 0.

    Idempotent: safe to call from every entrypoint; only the first call wires
    things up.
    """
    global _started
    if _started:
        return None

    raw = _read_interval_from_env()
    if not raw:
        return None
    try:
        interval = float(raw)
    except ValueError:
        logger.warning("[DIAG] AGENT_DIAGNOSTICS_INTERVAL=%r not a number", raw)
        return None
    if interval <= 0:
        return None

    _started = True
    _install_sigusr1_handler()
    global _heartbeat_task
    _heartbeat_task = asyncio.create_task(_heartbeat(interval), name="diag-heartbeat")
    return _heartbeat_task


def dump_stacks_sync() -> str:
    """Fallback for when the loop itself is wedged: returns Python stacks for
    every thread. Call from a signal handler that doesn't depend on the loop.
    """
    out = []
    for thread_id, frame in sys._current_frames().items():
        out.append(f"--- thread {thread_id} ---")
        out.extend(traceback.format_stack(frame))
    return "\n".join(out)
