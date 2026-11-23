"""Small key/value state for the signal sources: cursors, the kill switch, seen keys.

``bughunter.signal_state`` in production (migration 0004), a dict in tests.
"""

from __future__ import annotations

import json
from typing import Any, Protocol

ENABLED = "enabled"  # the kill switch: bug-hunter pause | unpause


class SignalState(Protocol):
    def get(self, key: str, default: Any = None) -> Any: ...

    def set(self, key: str, value: Any) -> None: ...


class InMemoryState:
    def __init__(self, data: dict[str, Any] | None = None):
        self.data = dict(data or {})

    def get(self, key: str, default: Any = None) -> Any:
        return self.data.get(key, default)

    def set(self, key: str, value: Any) -> None:
        self.data[key] = value


class PostgresState:
    def __init__(self, url: str):
        from bug_hunter.graph.checkpointer import connect

        self.conn = connect(url, autocommit=True)

    def get(self, key: str, default: Any = None) -> Any:
        row = self.conn.execute(
            "SELECT value FROM bughunter.signal_state WHERE key = %s", (key,)
        ).fetchone()
        return default if row is None else row[0]

    def set(self, key: str, value: Any) -> None:
        self.conn.execute(
            """INSERT INTO bughunter.signal_state (key, value, updated_at)
               VALUES (%s, %s::jsonb, now())
               ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value,
               updated_at = now()""",
            (key, json.dumps(value)),
        )


def is_enabled(state: SignalState) -> bool:
    """Off only when someone paused it; a fresh database is enabled."""
    return bool(state.get(ENABLED, True))
