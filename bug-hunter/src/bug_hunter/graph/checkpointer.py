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
DEFAULT_DB_URL = "postgresql://bughunter:bughunter@localhost:5433/bughunter"
SCHEMA = "bughunter"


class CheckpointerError(RuntimeError):
    pass


def db_url(env: dict[str, str] | None = None) -> str:
    env = os.environ if env is None else env
    return env.get(ENV_DB_URL) or DEFAULT_DB_URL


def _redacted(url: str) -> str:
    return re.sub(r"//([^:/@]+)(:[^@/]*)?@", r"//\1:***@", url)


@contextmanager
def open_checkpointer(
    url: str | None = None, in_memory: bool = False
) -> Iterator[BaseCheckpointSaver]:
    """``with open_checkpointer() as saver:`` — Postgres (tables created on first use)
    or ``InMemorySaver`` when ``in_memory`` is set."""
    if in_memory:
        yield InMemorySaver()
        return
    url = url or db_url()
    try:
        from langgraph.checkpoint.postgres import PostgresSaver
        from psycopg import Connection
        from psycopg.rows import dict_row
    except ImportError as exc:  # pragma: no cover - dependency missing
        raise CheckpointerError(f"postgres checkpointer unavailable: {exc}") from exc
    try:
        with Connection.connect(url, autocommit=True) as admin:
            admin.execute(f'CREATE SCHEMA IF NOT EXISTS "{SCHEMA}"')
        # autocommit, dict rows and no prepared statements are what PostgresSaver needs
        with Connection.connect(
            url,
            autocommit=True,
            prepare_threshold=0,
            row_factory=dict_row,
            options=f"-c search_path={SCHEMA}",
        ) as conn:
            saver = PostgresSaver(conn)
            saver.setup()
            yield saver
    except CheckpointerError:
        raise
    except Exception as exc:  # noqa: BLE001 - the type only; the URL holds a password
        raise CheckpointerError(
            f"could not open the checkpoint database at {_redacted(url)} "
            f"({type(exc).__name__}); start it with `make db-up` or set {ENV_DB_URL}"
        ) from exc
