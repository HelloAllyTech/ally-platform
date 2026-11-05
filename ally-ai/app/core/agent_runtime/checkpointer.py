"""Where agent runs are checkpointed: Postgres when configured, memory otherwise.

The Postgres tables live in their own database and schema
(`AGENT_RUNTIME__CHECKPOINT_DB_URL`, `AGENT_RUNTIME__CHECKPOINT_SCHEMA`). ally-ai
never writes to ally-be's database; these tables are the only Postgres state it owns.
"""

from __future__ import annotations

from typing import Optional

from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.checkpoint.memory import InMemorySaver

from app.core.config import settings
from app.utils.logger import get_logger

logger = get_logger(__name__)

_saver: Optional[BaseCheckpointSaver] = None
_pool = None


async def open_checkpointer() -> BaseCheckpointSaver:
    """Open the checkpointer once at startup and create its tables if needed."""
    global _saver, _pool
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
    # requires of a pooled connection.
    pool = AsyncConnectionPool(
        cfg.CHECKPOINT_DB_URL,
        min_size=1,
        max_size=cfg.CHECKPOINT_POOL_MAX_SIZE,
        open=False,
        kwargs={
            "autocommit": True,
            "row_factory": dict_row,
            "prepare_threshold": 0,
            "options": f"-c search_path={cfg.CHECKPOINT_SCHEMA}",
        },
    )
    await pool.open()
    saver = AsyncPostgresSaver(pool)
    await saver.setup()
    _pool, _saver = pool, saver
    logger.info(
        "Agent runtime checkpoints in Postgres, schema %s", cfg.CHECKPOINT_SCHEMA
    )
    return saver


def get_checkpointer() -> BaseCheckpointSaver:
    """The open checkpointer, or memory when startup never opened one (tests)."""
    global _saver
    if _saver is None:
        _saver = InMemorySaver()
    return _saver


async def close_checkpointer() -> None:
    global _saver, _pool
    if _pool is not None:
        await _pool.close()
    _saver, _pool = None, None
