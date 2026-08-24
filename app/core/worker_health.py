"""LiveKit registration health, and the process exit that makes it actionable.

THE INCIDENT THIS EXISTS FOR
----------------------------
The agents SDK retries a lost LiveKit connection on a bounded budget
(``max_retry``). On exhaustion its ``_connection_task`` raises — into a task
nobody awaits. ``AgentServer.run()`` stays parked on its close future, so the
process does NOT exit: the container keeps running, ``start.sh``'s ``wait -n``
self-heal never fires, and the worker sits registered with nobody. On
2026-08-09 twelve tasks stayed dark for 19 hours while ECS, the container
health signal and the CloudWatch metrics all read green.

``WorkerOptions(max_retry=360)`` in app/worker.py already widened the budget to
about an hour, so a LiveKit restart or host migration is ridden out. That fixed
the trigger, not the failure mode: after those 360 attempts the process still
does not exit, and the only signal is the SDK's own health server on :8081 —
which the Dockerfile does not expose and nothing probes. Meanwhile FastAPI's
``/api/health`` on :8000, which IS what gets probed, returned a hardcoded
``{"status": "ok"}`` and proved only that uvicorn was alive.

A health check that cannot fail is worse than none: it converts an outage into
a silent one.

TWO PROCESSES, ONE CONTAINER
----------------------------
``start.sh`` runs uvicorn and ``python -m app.worker start`` as two separate
child processes. They share no memory, so the HTTP handler cannot read worker
state directly. The bridge is a small heartbeat FILE the worker writes and the
HTTP handler reads. It is a container-local file (default under the system temp
dir), rewritten atomically, and holds only registration state and a timestamp.

WHAT THIS MODULE DOES
---------------------
In the WORKER process (``start_health_monitor``):

* records ``worker_registered`` (the SDK's own event) so "have we ever
  registered, and when did we last?" is answerable;
* watches the SDK's ``_connection_failed`` flag — the definitive "I have given
  up" signal, set exactly where the retry budget is exhausted;
* writes the heartbeat file on an interval;
* on exhaustion, logs FATAL and exits the process. That is the actionable
  ending the incident lacked: ``start.sh``'s ``wait -n`` fires, the container
  stops, and the orchestrator replaces the task.

In the API process (``read_health_state`` / ``registration_health``): reads the
heartbeat and reports whether the worker is genuinely registered.

DELIBERATELY NARROW FAILURE CONDITIONS
--------------------------------------
The endpoint reports unhealthy for only two things:

1. ``connection_failed`` — the SDK has permanently given up.
2. a stale/absent heartbeat after the startup grace — the worker process is
   dead or wedged.

It does NOT fail merely because the worker is not registered *right now*. A
transient reconnect must not make a whole fleet fail its health check
simultaneously during a LiveKit blip and get culled mid-session; ``max_retry``
already grants an hour of patient retrying, and condition 1 is what fires when
that patience is genuinely exhausted.

The startup grace matters just as much: the worker needs to load models and
register, and reporting unhealthy before it has had the chance would crash-loop
the container on every deploy.
"""

from __future__ import annotations

import json
import os
import tempfile
import threading
import time
from typing import Any, Dict, Optional

from app.core.logger import get_logger

logger = get_logger(__name__)

#: Exit code used when the LiveKit connection is permanently lost. Distinct
#: from the stall watchdog's 75 so the two are separable in logs/metrics.
CONNECTION_LOST_EXIT_CODE = 76


def heartbeat_path() -> str:
    """Container-local path of the worker heartbeat file."""
    from app.core.config import settings

    configured = getattr(settings, "WORKER_HEALTH_FILE", None)
    if configured:
        return str(configured)
    return os.path.join(tempfile.gettempdir(), "ally-learn-worker-health.json")


def _heartbeat_interval_s() -> float:
    from app.core.config import settings

    return max(1.0, float(getattr(settings, "WORKER_HEALTH_HEARTBEAT_S", 5.0)))


def _stale_after_s() -> float:
    """How old a heartbeat may get before the worker is considered gone.

    Generously above the write interval so a slow/loaded host cannot produce a
    false unhealthy.
    """
    from app.core.config import settings

    return max(
        _heartbeat_interval_s() * 3,
        float(getattr(settings, "WORKER_HEALTH_STALE_AFTER_S", 45.0)),
    )


def _startup_grace_s() -> float:
    """Grace from API-process start before a missing heartbeat counts as a fault.

    Must comfortably exceed worker boot (model load + registration);
    ``initialize_process_timeout`` alone is 120s.
    """
    from app.core.config import settings

    return max(30.0, float(getattr(settings, "WORKER_HEALTH_STARTUP_GRACE_S", 180.0)))


# ----------------------------------------------------------------------
# Worker side
# ----------------------------------------------------------------------


class WorkerHealthMonitor:
    """Tracks LiveKit registration and turns permanent loss into an exit."""

    def __init__(self, *, exit_on_connection_lost: bool = True) -> None:
        self._lock = threading.Lock()
        self._registered_ever = False
        self._last_registered_at: Optional[float] = None
        self._connection_failed = False
        self._started_at = time.time()
        self._server: Any = None
        self._subscribed = False
        self._exit_on_connection_lost = exit_on_connection_lost
        self._stopped = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._exited = False

    # ---- state ----

    def note_registered(self) -> None:
        with self._lock:
            self._registered_ever = True
            self._last_registered_at = time.time()

    def observe_server(self, server: Any) -> None:
        """Called with the AgentServer (from the ``load_fnc`` hook).

        ``load_fnc`` is the only hook that hands us the server object, and the
        SDK calls it on its own interval, so it doubles as the subscription
        point for ``worker_registered``. Everything here is private-attribute
        access guarded by getattr: a version bump that renames things degrades
        to "no exit signal", never to a broken worker.
        """
        self._server = server
        if not self._subscribed:
            try:
                server.on("worker_registered", lambda *a, **k: self.note_registered())
                self._subscribed = True
            except Exception:  # noqa: BLE001
                logger.warning(
                    "[worker-health] could not subscribe to worker_registered; "
                    "registration state will be inferred from the SDK flag only"
                )
                self._subscribed = True  # don't retry hot
        if getattr(server, "_connection_failed", False):
            with self._lock:
                self._connection_failed = True

    def snapshot(self) -> Dict[str, Any]:
        with self._lock:
            return {
                "pid": os.getpid(),
                "updated_at": time.time(),
                "started_at": self._started_at,
                "registered_ever": self._registered_ever,
                "last_registered_at": self._last_registered_at,
                "connection_failed": self._connection_failed,
                "active_jobs": (
                    len(getattr(self._server, "active_jobs", []) or [])
                    if self._server is not None
                    else 0
                ),
            }

    # ---- heartbeat + exit loop ----

    def _write_heartbeat(self) -> None:
        path = heartbeat_path()
        tmp = f"{path}.{os.getpid()}.tmp"
        try:
            with open(tmp, "w", encoding="utf-8") as fh:
                json.dump(self.snapshot(), fh)
            # Atomic replace, so a reader never sees a half-written file.
            os.replace(tmp, path)
        except Exception:  # noqa: BLE001 - health reporting must not break the worker
            logger.debug("[worker-health] heartbeat write failed", exc_info=True)
            try:
                os.unlink(tmp)
            except OSError:
                pass

    def _check_connection(self) -> bool:
        """True when the SDK has permanently given up on LiveKit."""
        server = self._server
        if server is None:
            return False
        if getattr(server, "_connection_failed", False):
            with self._lock:
                self._connection_failed = True
            return True
        return False

    def _run(self) -> None:
        interval = _heartbeat_interval_s()
        while not self._stopped.wait(interval):
            self._write_heartbeat()
            if not self._check_connection():
                continue
            # The retry budget is spent. The SDK will not try again and will
            # not exit, so this worker is registered with nobody — the exact
            # 19-hour silent failure this module exists to end.
            logger.critical(
                "[worker-health] LiveKit connection PERMANENTLY LOST — the SDK "
                "exhausted its retry budget and will not reconnect. This worker "
                "is registered with nobody and can accept no jobs."
            )
            self._write_heartbeat()  # so a probe racing the exit sees the truth
            if not self._exit_on_connection_lost:
                logger.critical(
                    "[worker-health] exit-on-connection-lost is DISABLED; the "
                    "process will stay up and deaf. /api/health will report "
                    "unhealthy so an orchestrator can still act."
                )
                return
            logger.critical(
                "[worker-health] exiting with code %d so the supervisor "
                "replaces this task",
                CONNECTION_LOST_EXIT_CODE,
            )
            self._exited = True
            os._exit(CONNECTION_LOST_EXIT_CODE)
        return

    def start(self) -> None:
        if self._thread is not None:
            return
        self._write_heartbeat()
        self._thread = threading.Thread(
            target=self._run, name="worker-health-monitor", daemon=True
        )
        self._thread.start()

    def stop(self) -> None:
        self._stopped.set()


#: Process-wide monitor for the worker process (None in the API process).
_monitor: Optional[WorkerHealthMonitor] = None


def get_monitor() -> Optional[WorkerHealthMonitor]:
    return _monitor


def start_health_monitor() -> Optional[WorkerHealthMonitor]:
    """Start the worker-process health monitor. Idempotent, never raises."""
    global _monitor
    try:
        from app.core.config import settings

        if not getattr(settings, "WORKER_HEALTH_MONITOR_ENABLED", True):
            logger.info("[worker-health] monitor disabled by config")
            return None
        if _monitor is not None:
            return _monitor
        _monitor = WorkerHealthMonitor(
            exit_on_connection_lost=bool(
                getattr(settings, "WORKER_HEALTH_EXIT_ON_CONNECTION_LOST", True)
            )
        )
        _monitor.start()
        logger.info(
            "[worker-health] monitor armed (heartbeat=%s interval=%.0fs)",
            heartbeat_path(),
            _heartbeat_interval_s(),
        )
        return _monitor
    except Exception:  # noqa: BLE001 - never block worker startup
        logger.exception("[worker-health] failed to start monitor")
        return None


def wrap_load_fnc(load_fnc):
    """Wrap a ``load_fnc`` so the monitor sees the AgentServer.

    ``load_fnc`` is the only WorkerOptions hook that receives the server, and
    the SDK already calls it on an interval. Wrapping is strictly additive: the
    returned load value is whatever the wrapped function produced.

    Accepts None and returns None, so the caller can keep omitting the option
    when the underlying load calculator is unavailable — in that case the
    monitor still runs, it just has no server to read (registration state comes
    out as "never registered" and only the heartbeat is meaningful).
    """
    if load_fnc is None:
        return None

    def _wrapped(server):
        monitor = get_monitor()
        if monitor is not None:
            try:
                monitor.observe_server(server)
            except Exception:  # noqa: BLE001 - must not perturb the load value
                pass
        return load_fnc(server)

    return _wrapped


# ----------------------------------------------------------------------
# API side
# ----------------------------------------------------------------------

#: When the API process started, for the startup grace.
_api_started_at = time.time()


def read_health_state() -> Optional[Dict[str, Any]]:
    """Read the worker heartbeat, or None if it is missing/unreadable."""
    try:
        with open(heartbeat_path(), "r", encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, dict) else None
    except FileNotFoundError:
        return None
    except Exception:  # noqa: BLE001
        logger.debug("[worker-health] heartbeat unreadable", exc_info=True)
        return None


def registration_health(now: Optional[float] = None) -> Dict[str, Any]:
    """Report the worker's LiveKit registration health for ``/api/health``.

    Returns ``{"healthy": bool, "livekit": str, "detail": str, ...}``.
    ``livekit`` is one of:

    * ``registered``     — heartbeat fresh, has registered, connection fine
    * ``connecting``     — heartbeat fresh, not registered yet (still starting)
    * ``starting``       — no heartbeat yet, within the startup grace
    * ``connection_lost``— the SDK gave up permanently (UNHEALTHY)
    * ``worker_unreachable`` — heartbeat missing/stale past grace (UNHEALTHY)
    """
    now = time.time() if now is None else now
    state = read_health_state()

    if state is None:
        if now - _api_started_at < _startup_grace_s():
            return {
                "healthy": True,
                "livekit": "starting",
                "detail": "worker has not reported yet; within startup grace",
            }
        return {
            "healthy": False,
            "livekit": "worker_unreachable",
            "detail": "no worker heartbeat found",
        }

    if state.get("connection_failed"):
        return {
            "healthy": False,
            "livekit": "connection_lost",
            "detail": (
                "the agents SDK exhausted its LiveKit retry budget; this worker "
                "is registered with nobody"
            ),
            "worker_pid": state.get("pid"),
        }

    age = now - float(state.get("updated_at") or 0)
    if age > _stale_after_s():
        if now - _api_started_at < _startup_grace_s():
            return {
                "healthy": True,
                "livekit": "starting",
                "detail": f"worker heartbeat {age:.0f}s old; within startup grace",
            }
        return {
            "healthy": False,
            "livekit": "worker_unreachable",
            "detail": f"worker heartbeat is {age:.0f}s old",
            "worker_pid": state.get("pid"),
        }

    if not state.get("registered_ever"):
        # Fresh heartbeat but never registered: the worker process is alive and
        # still trying. Healthy on purpose — see the module docstring on why
        # transient non-registration must not fail the probe.
        return {
            "healthy": True,
            "livekit": "connecting",
            "detail": "worker is running but has not registered with LiveKit yet",
            "worker_pid": state.get("pid"),
        }

    return {
        "healthy": True,
        "livekit": "registered",
        "detail": "worker is registered with LiveKit",
        "worker_pid": state.get("pid"),
        "active_jobs": state.get("active_jobs"),
    }
