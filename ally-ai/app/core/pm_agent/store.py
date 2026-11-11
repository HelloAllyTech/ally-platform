"""The PM agent's memory store: LangGraph's Postgres store, in its own namespace.

It lives in the same database and schema as the run checkpoints
(`AGENT_RUNTIME__CHECKPOINT_DB_URL` / `_SCHEMA`), on the checkpointer's own
connection pool, so ally-ai still owns exactly one Postgres database. Without that
database (tests, a laptop without it) the store is in memory and lost on restart,
as the checkpoints are.

The agent's files under `/memories/` are rows in namespace `MEMORY_NAMESPACE`;
nothing else in ally-ai reads or writes that namespace.
"""

from __future__ import annotations

from typing import Optional

from langgraph.store.base import BaseStore
from langgraph.store.memory import InMemoryStore

from app.core.agent_runtime import checkpointer as runtime_checkpointer
from app.utils.logger import get_logger

logger = get_logger(__name__)

#: The agent's own namespace in the store (spec C1: "memory, own namespace").
MEMORY_NAMESPACE = ("debrief_pm_agent", "memories")

_store: Optional[BaseStore] = None


async def open_pm_agent_store() -> BaseStore:
    """Startup, after the checkpointer: open the Postgres store on its pool."""
    global _store
    if _store is not None:
        return _store
    pool = runtime_checkpointer._pool
    if pool is None:
        _store = InMemoryStore()
        return _store
    try:
        from langgraph.store.postgres.aio import AsyncPostgresStore

        store = AsyncPostgresStore(pool)
        await store.setup()
        _store = store
        logger.info("PM agent memory in Postgres")
    except Exception as e:  # noqa: BLE001 - memory degrades, the service starts
        logger.error(
            "PM agent memory store could not be opened (%s): in memory until restart",
            type(e).__name__,
        )
        _store = InMemoryStore()
    return _store


def get_pm_agent_store() -> BaseStore:
    """The open store, or a process-wide in-memory one when startup never opened one."""
    global _store
    if _store is None:
        _store = InMemoryStore()
    return _store


async def close_pm_agent_store() -> None:
    """Shutdown: the pool belongs to the checkpointer, which closes it."""
    global _store
    _store = None
