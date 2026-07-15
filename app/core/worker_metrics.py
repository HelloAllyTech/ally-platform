"""Worker → CloudWatch active-session metric, for ECS demand-based autoscaling.

WHY THIS EXISTS
---------------
learn-core's ECS task count needs to track real demand, but the built-in ECS
metrics can't drive it: the worker is I/O-bound (~0.5% CPU) so CPU target-tracking
never moves, and container memory is baseline-dominated (the prewarmed VAD/BVC +
idle job processes) so memory is flat regardless of session load. The only usable
scaling signal is the number of *active sessions*, which LiveKit already tracks per
worker as ``AgentServer.active_jobs``.

Each task publishes its own ``active_jobs`` to CloudWatch under a shared dimension;
CloudWatch's SUM across tasks is total concurrent sessions, and an ECS
target-tracking policy on ``SUM(ActiveSessions) / RunningTaskCount`` (sessions per
task) scales the fleet. See DEPLOYMENT.md.

DESIGN / SAFETY
---------------
- Emission rides the ``load_fnc`` hook (``make_load_fnc``): LiveKit already calls
  it periodically **in a thread executor** (not the event loop) to compute worker
  load. We return the *exact* default load (so job dispatch/availability behaviour
  is byte-for-byte unchanged) and side-emit the metric. The emit is throttled and
  wrapped so it can NEVER affect the returned load or raise into the worker.
- PROD only. Dev/local never touch the prod scaling namespace.
- Best-effort: any failure (no creds, throttled, boto missing) is swallowed. A
  missing metric just means ECS holds the last desired count — it never breaks a
  session.
"""

from __future__ import annotations

import threading
import time
from typing import Callable, Optional

from app.core.config import settings
from app.core.constants import Environment
from app.core.logger import get_logger

logger = get_logger(__name__)

# CloudWatch client is created lazily and reused (thread-safe via the lock). None
# until first use; stays None if construction fails (best-effort → no metrics).
_cw_client = None
_client_lock = threading.Lock()
_client_broken = False  # set if client construction raised, so we don't retry hot

# Throttle state — load_fnc may be called every few seconds; we emit at most once
# per ECS_METRICS_EMIT_INTERVAL_S. monotonic clock so it's immune to wall-clock
# jumps. Guarded by its own lock (load_fnc can run on pooled executor threads).
_last_emit_monotonic: float = 0.0
_emit_lock = threading.Lock()


def _metrics_enabled() -> bool:
    """Only emit in PROD and only when the kill-switch is on."""
    return bool(settings.ECS_METRICS_ENABLED) and settings.ENV == Environment.PROD


def _get_cw_client():
    """Lazily build (and cache) a CloudWatch client, mirroring SQSQueue's cred
    handling. Returns None on any failure — callers must treat None as "skip"."""
    global _cw_client, _client_broken
    if _cw_client is not None or _client_broken:
        return _cw_client
    with _client_lock:
        if _cw_client is not None or _client_broken:
            return _cw_client
        try:
            import boto3

            if settings.AWS_ENDPOINT_URL:
                _cw_client = boto3.client(
                    "cloudwatch",
                    aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
                    aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
                    region_name=settings.AWS_REGION,
                    endpoint_url=settings.AWS_ENDPOINT_URL,
                )
            else:
                # Prod: default credential chain (the app's IAM user creds come
                # from the S3 env file); region from config.
                _cw_client = boto3.client("cloudwatch", region_name=settings.AWS_REGION)
        except Exception:  # noqa: BLE001 - metrics are best-effort
            _client_broken = True
            logger.warning("[ecs-metrics] CloudWatch client unavailable", exc_info=True)
        return _cw_client


def _should_emit_now() -> bool:
    """True at most once per throttle interval. Updates the timestamp when it
    returns True so concurrent callers don't double-emit."""
    global _last_emit_monotonic
    now = time.monotonic()
    interval = float(getattr(settings, "ECS_METRICS_EMIT_INTERVAL_S", 60.0) or 60.0)
    with _emit_lock:
        if now - _last_emit_monotonic < interval:
            return False
        _last_emit_monotonic = now
        return True


def emit_worker_metrics(active_jobs: int, worker_load: float) -> None:
    """Best-effort publish of this task's active-session count (+ worker load) to
    CloudWatch. Throttled and PROD-gated. Never raises."""
    try:
        if not _metrics_enabled() or not _should_emit_now():
            return
        client = _get_cw_client()
        if client is None:
            return
        dims = [{"Name": "Service", "Value": settings.ECS_METRICS_SERVICE}]
        client.put_metric_data(
            Namespace=settings.ECS_METRICS_NAMESPACE,
            MetricData=[
                {
                    "MetricName": "ActiveSessions",
                    "Dimensions": dims,
                    "Value": float(active_jobs),
                    "Unit": "Count",
                },
                {
                    "MetricName": "WorkerLoad",
                    "Dimensions": dims,
                    "Value": float(worker_load),
                    "Unit": "None",
                },
            ],
        )
        logger.debug(
            "[ecs-metrics] emitted active_jobs=%s load=%.3f", active_jobs, worker_load
        )
    except Exception:  # noqa: BLE001 - metrics must never break the worker
        logger.debug("[ecs-metrics] emit skipped (best-effort)", exc_info=True)


def make_load_fnc() -> Optional[Callable[[object], float]]:
    """Build the ``load_fnc`` for WorkerOptions: returns the LiveKit default load
    (unchanged dispatch behaviour) and side-emits the active-session metric.

    Returns None if the default load calculator can't be imported (unexpected
    livekit-agents version) — the caller then omits ``load_fnc`` so LiveKit uses
    its own default and the worker runs completely normally, just without the
    scaling metric.
    """
    try:
        # Private import, pinned to livekit-agents 1.3.12. Guarded so a version
        # bump that moves it degrades to "no metric", never to a broken worker.
        from livekit.agents.worker import _DefaultLoadCalc
    except Exception:  # noqa: BLE001
        logger.warning(
            "[ecs-metrics] _DefaultLoadCalc import failed; scaling metric disabled, "
            "worker load falls back to livekit default"
        )
        return None

    def _load_fnc(server: object) -> float:
        # Exact default load — this is what LiveKit would compute itself.
        load = _DefaultLoadCalc.get_load(server)
        try:
            active = len(getattr(server, "active_jobs", []) or [])
            emit_worker_metrics(active, load)
        except Exception:  # noqa: BLE001 - side-emit must not perturb the load value
            pass
        return load

    return _load_fnc
