"""
Time utility functions for consistent timestamp handling and performance analysis.
"""

import time
from contextlib import contextmanager
from datetime import datetime, timezone
from functools import wraps
from typing import Callable, Optional, Union

from app.core.logger import get_logger

logger = get_logger(__name__)


# ====================================================================
# Datetime Utilities
# ====================================================================


def timestamp_to_iso_utc(timestamp: Union[int, float]) -> str:
    """
    Convert Unix timestamp to ISO 8601 UTC string with 'Z' suffix.

    Args:
        timestamp: Unix timestamp (seconds since epoch)

    Returns:
        ISO 8601 formatted UTC datetime string with 'Z' suffix
    """
    return (
        datetime.fromtimestamp(timestamp, tz=timezone.utc)
        .isoformat()
        .replace("+00:00", "Z")
    )


def get_current_iso_timestamp() -> str:
    """
    Get current timestamp in ISO 8601 UTC format with 'Z' suffix.

    Returns:
        ISO 8601 formatted UTC datetime string with 'Z' suffix
    """
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


# ====================================================================
# Timing Utilities
# ====================================================================


@contextmanager
def time_operation(operation_name: str, log_level: str = "info"):
    """
    Context manager for timing operations.

    Args:
        operation_name: Name of the operation being timed
        log_level: Log level ("info", "debug", "warning")
    """
    start_time = time.time()
    try:
        yield
    finally:
        duration_ms = (time.time() - start_time) * 1000
        log_func = getattr(logger, log_level.lower(), logger.info)
        log_func(f"{operation_name} completed in {duration_ms:.2f}ms")


def timed_async(
    func: Optional[Callable] = None, *, operation_name: Optional[str] = None
):
    """
    Decorator for timing async functions.

    Args:
        func: Function to decorate (if used as decorator)
        operation_name: Name of operation (defaults to function name)
    """

    def decorator(f: Callable) -> Callable:
        op_name = operation_name or f"{f.__name__}"

        @wraps(f)
        async def wrapper(*args, **kwargs):
            with time_operation(op_name):
                return await f(*args, **kwargs)

        return wrapper

    if func is None:
        return decorator
    return decorator(func)


class TimingContext:
    """
    Context manager for tracking multiple timing operations.
    """

    def __init__(self, context_name: str, auto_log: bool = True):
        self.context_name = context_name
        self.start_time: Optional[float] = None
        self.operations: list[tuple[str, float]] = []
        self.auto_log = auto_log

    def __enter__(self):
        """Enter context manager."""
        self.start_time = time.time()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        """Exit context manager and log summary if auto_log is True."""
        if self.auto_log and self.start_time is not None:
            self.log_summary()
        return False  # Don't suppress exceptions

    @contextmanager
    def operation(self, operation_name: str):
        """Time a nested operation within this context."""
        op_start = time.time()
        try:
            yield
        finally:
            duration_ms = (time.time() - op_start) * 1000
            self.operations.append((operation_name, duration_ms))
            logger.debug(
                f"  [{self.context_name}] {operation_name}: {duration_ms:.2f}ms"
            )

    def log_summary(self):
        """Log summary of all operations and total time."""
        if self.start_time is None:
            return

        total_duration_ms = (time.time() - self.start_time) * 1000

        logger.info(f"[{self.context_name}] Timing Summary:")
        for op_name, duration_ms in self.operations:
            percentage = (
                (duration_ms / total_duration_ms * 100) if total_duration_ms > 0 else 0
            )
            logger.info(f"  {op_name}: {duration_ms:.2f}ms ({percentage:.1f}%)")
        logger.info(f"  Total: {total_duration_ms:.2f}ms")

    def get_total_duration_ms(self) -> float:
        """Get total duration in milliseconds."""
        if self.start_time is None:
            return 0.0
        return (time.time() - self.start_time) * 1000


def format_duration_ms(duration_seconds: float) -> str:
    """
    Format duration in a human-readable way.

    Args:
        duration_seconds: Duration in seconds

    Returns:
        Formatted string (e.g., "45.23ms", "1.23s", "2m 15s")
    """
    duration_ms = duration_seconds * 1000

    if duration_ms < 1000:
        return f"{duration_ms:.2f}ms"
    elif duration_ms < 60000:
        return f"{duration_seconds:.2f}s"
    else:
        minutes = int(duration_seconds // 60)
        seconds = duration_seconds % 60
        return f"{minutes}m {seconds:.1f}s"
