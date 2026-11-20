"""The bug hunter's role inside ally-be's database (db/ally-db-setup.sql): it owns
the ``bughunter`` schema, cannot read ally-be's tables (PHI), and never creates
anything in ``public``. Needs the local ally-be Postgres (`make ally-db-setup`)."""

from __future__ import annotations

import pytest

pytestmark = pytest.mark.docker


def _conn_or_skip():
    from bug_hunter.graph.checkpointer import connect, db_url

    try:
        conn = connect(db_url(), autocommit=True, connect_timeout=3)
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"ally-be database not running: {exc}")
    superuser = conn.execute(
        "SELECT rolsuper FROM pg_roles WHERE rolname = current_user"
    ).fetchone()[0]
    if superuser:
        conn.close()
        pytest.skip("connected as a superuser: isolation cannot be shown")
    return conn


def test_search_path_is_pinned_to_the_bughunter_schema() -> None:
    with _conn_or_skip() as conn:
        assert conn.execute("SHOW search_path").fetchone()[0] == "bughunter"


def test_the_agent_role_cannot_read_any_ally_be_table() -> None:
    from psycopg import errors

    with _conn_or_skip() as conn:
        tables = [
            r[0]
            for r in conn.execute(
                "SELECT tablename FROM pg_tables WHERE schemaname = 'public'"
            ).fetchall()
        ]
        if not tables:
            pytest.skip("ally-be's tables are not migrated in this database")
        for name in ("users", tables[0]):
            if name not in tables:
                continue
            with pytest.raises(errors.InsufficientPrivilege):
                conn.execute(f'SELECT 1 FROM public."{name}" LIMIT 1')


def test_nothing_of_the_bug_hunters_lives_in_public() -> None:
    with _conn_or_skip() as conn:
        owned = conn.execute("""SELECT c.relname FROM pg_class c
               JOIN pg_namespace n ON n.oid = c.relnamespace
               WHERE n.nspname = 'public' AND c.relowner = (
                 SELECT oid FROM pg_roles WHERE rolname = current_user)""").fetchall()
        assert owned == []


def test_checkpointer_and_store_tables_are_created_in_bughunter(config) -> None:
    from bug_hunter.graph.checkpointer import open_checkpointer
    from bug_hunter.memory.store import open_memory

    _conn_or_skip().close()
    with open_checkpointer():
        pass
    with open_memory(config, scope="it-isolation"):
        pass
    with _conn_or_skip() as conn:
        schemas = {r[0] for r in conn.execute("""SELECT n.nspname FROM pg_class c
                   JOIN pg_namespace n ON n.oid = c.relnamespace
                   WHERE c.relname IN ('checkpoints', 'store')""").fetchall()}
        assert schemas == {"bughunter"}
