"""Where agent runs are checkpointed: Postgres when configured, memory otherwise.

The Postgres tables live in their own database and schema
(`AGENT_RUNTIME__CHECKPOINT_DB_URL`, `AGENT_RUNTIME__CHECKPOINT_SCHEMA`). ally-ai
never writes to ally-be's database; these tables are the only Postgres state it owns.

If that database can't be reached at startup, the agent runtime stays off (the route
answers 503) and the rest of the service starts normally; ally-be falls back to v1.
"""

from __future__ import annotations

from typing import Any, Optional

from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.checkpoint.memory import InMemorySaver

from app.core.config import AgentRuntimeSettings, settings
from app.utils.logger import get_logger

logger = get_logger(__name__)

_saver: Optional[BaseCheckpointSaver] = None
_pool = None
_unavailable = False


async def open_checkpointer() -> Optional[BaseCheckpointSaver]:
    """Open the checkpointer once at startup and create its tables if needed.

    Returns None, and leaves the runtime unavailable, when Postgres can't be opened.
    """
    global _saver, _pool, _unavailable
    if _saver is not None:
        return _saver

    cfg = settings.AGENT_RUNTIME
    if not cfg.CHECKPOINT_DB_URL:
        logger.warning(
            "AGENT_RUNTIME__CHECKPOINT_DB_URL is not set: agent runs are checkpointed "
            "in memory only and are lost on restart"
        )
        _saver = InMemorySaver()
        return _saver

    try:
        _pool, _saver = await _open_postgres(cfg)
    except Exception as e:
        # The type only: a connection error's text can carry the host and user.
        logger.error(
            "Agent runtime checkpoint database could not be opened (%s): the agent "
            "runtime is off until the next restart",
            type(e).__name__,
        )
        _unavailable = True
        return None
    logger.info(
        "Agent runtime checkpoints in Postgres, schema %s", cfg.CHECKPOINT_SCHEMA
    )
    return _saver


async def _open_postgres(cfg: AgentRuntimeSettings) -> tuple[Any, BaseCheckpointSaver]:
    # Imported here so the service starts without the Postgres driver loaded when
    # the runtime is off.
    from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
    from psycopg import AsyncConnection
    from psycopg.rows import dict_row
    from psycopg_pool import AsyncConnectionPool

    # The schema name is validated by the settings pattern, so it is safe to quote.
    async with await AsyncConnection.connect(
        cfg.CHECKPOINT_DB_URL, autocommit=True
    ) as conn:
        await conn.execute(f'CREATE SCHEMA IF NOT EXISTS "{cfg.CHECKPOINT_SCHEMA}"')

    # autocommit, dict rows and no prepared statements are what AsyncPostgresSaver
    # requires of a pooled connection. `check` replaces a connection that died with a
    # database restart instead of failing the request that drew it.
    pool = AsyncConnectionPool(
        cfg.CHECKPOINT_DB_URL,
        min_size=1,
        max_size=cfg.CHECKPOINT_POOL_MAX_SIZE,
        open=False,
        check=AsyncConnectionPool.check_connection,
        kwargs={
            "autocommit": True,
            "row_factory": dict_row,
            "prepare_threshold": 0,
            "options": f"-c search_path={cfg.CHECKPOINT_SCHEMA}",
        },
    )
    await pool.open()
    try:
        saver = AsyncPostgresSaver(pool)
        await saver.setup()
    except BaseException:
        await pool.close()
        raise
    return pool, saver


def checkpointer_available() -> bool:
    """False when startup tried to open Postgres and failed."""
    return not _unavailable


def get_checkpointer() -> BaseCheckpointSaver:
    """The open checkpointer, or a fresh in-memory one when startup never opened one
    (tests, scripts). The fallback is not kept, so a later `open_checkpointer` still
    opens Postgres."""
    return _saver if _saver is not None else InMemorySaver()


async def close_checkpointer() -> None:
    global _saver, _pool, _unavailable
    if _pool is not None:
        await _pool.close()
    _saver, _pool, _unavailable = None, None, False
