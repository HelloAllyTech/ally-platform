"""Short-term memory: LangGraph checkpoints in Postgres (spec §8), so a run survives a
restart and can pause for human approval (chunk 06). Local dev uses the pgvector
container from ``compose.yaml``; ``BUGHUNTER_CHECKPOINT_DB_URL`` points elsewhere.

In memory only when asked (``--no-checkpoint``): never silently.
"""

from __future__ import annotations

import os
import re
from contextlib import contextmanager
from typing import Iterator

from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.checkpoint.memory import InMemorySaver

ENV_DB_URL = "BUGHUNTER_CHECKPOINT_DB_URL"
DEFAULT_DB_URL = "postgresql://bughunter:bughunter@localhost:5477/ally_local"
SCHEMA = "bughunter"


class CheckpointerError(RuntimeError):
    pass


def db_url(env: dict[str, str] | None = None) -> str:
    env = os.environ if env is None else env
    return env.get(ENV_DB_URL) or DEFAULT_DB_URL


def connect(url: str, **kwargs):
    """Every bug-hunter Postgres connection, pinned to the ``bughunter`` schema.

    The bug hunter's tables live in ally-be's database, in their own schema, under a
    role that has no grants on ally-be's tables (``db/ally-db-setup.sql``). Pinning
    ``search_path`` here means a table created by LangGraph's ``setup()`` (checkpoints,
    the store) can never land in ally-be's ``public`` schema, whatever the role's
    default search path is.
    """
    from psycopg import Connection

    options = kwargs.pop("options", "")
    pin = f"-c search_path={SCHEMA}"
    return Connection.connect(url, options=f"{pin} {options}".strip(), **kwargs)


def _ensure_schema(conn) -> None:
    """Create the schema only when it is missing. In ally-be's database the schema is
    created by ``db/ally-db-setup.sql`` and owned by the agent's role, which has no
    CREATE right on the database itself; ``CREATE SCHEMA IF NOT EXISTS`` checks that
    right before it checks existence, so it would fail there."""
    row = conn.execute(
        "SELECT 1 FROM pg_namespace WHERE nspname = %s", (SCHEMA,)
    ).fetchone()
    if row is None:
        conn.execute(f'CREATE SCHEMA "{SCHEMA}"')


def _redacted(url: str) -> str:
    return re.sub(r"//([^:/@]+)(:[^@/]*)?@", r"//\1:***@", url)


@contextmanager
def _connect(url: str) -> Iterator[BaseCheckpointSaver]:
    """Postgres saver with its tables created; only connection problems are wrapped."""
    try:
        from langgraph.checkpoint.postgres import PostgresSaver
        from psycopg.rows import dict_row
    except ImportError as exc:  # pragma: no cover - dependency missing
        raise CheckpointerError(f"postgres checkpointer unavailable: {exc}") from exc
    try:
        with connect(url, autocommit=True) as admin:
            _ensure_schema(admin)
        # autocommit, dict rows and no prepared statements are what PostgresSaver needs
        conn = connect(url, autocommit=True, prepare_threshold=0, row_factory=dict_row)
    except Exception as exc:  # noqa: BLE001 - the type only; the URL holds a password
        raise CheckpointerError(
            f"could not open the checkpoint database at {_redacted(url)} "
            f"({type(exc).__name__}); start it with `make db-up` or set {ENV_DB_URL}"
        ) from exc
    try:
        saver = PostgresSaver(conn)
        saver.setup()
    except Exception as exc:  # noqa: BLE001
        conn.close()
        raise CheckpointerError(
            f"could not set up the checkpoint tables ({type(exc).__name__})"
        ) from exc
    try:
        yield saver  # whatever the caller raises in here propagates unchanged
    finally:
        conn.close()


@contextmanager
def open_checkpointer(
    url: str | None = None, in_memory: bool = False
) -> Iterator[BaseCheckpointSaver]:
    """``with open_checkpointer() as saver:`` — Postgres (tables created on first use)
    or ``InMemorySaver`` when ``in_memory`` is set."""
    if in_memory:
        yield InMemorySaver()
        return
    with _connect(url or db_url()) as saver:
        yield saver
