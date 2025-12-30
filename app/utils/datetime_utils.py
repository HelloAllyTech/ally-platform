"""
Datetime utility functions for consistent timestamp handling.
"""

from datetime import datetime, timezone
from typing import Union


def timestamp_to_iso_utc(timestamp: Union[int, float]) -> str:
    """
    Convert Unix timestamp to ISO 8601 UTC string with 'Z' suffix.

    Args:
        timestamp: Unix timestamp (seconds since epoch)

    Returns:
        ISO 8601 formatted UTC datetime string with 'Z' suffix

    Example:
        >>> timestamp_to_iso_utc(1641024000)
        '2022-01-01T12:00:00Z'
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

    Example:
        >>> get_current_iso_timestamp()
        '2022-01-01T12:00:00.123456Z'
    """
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
