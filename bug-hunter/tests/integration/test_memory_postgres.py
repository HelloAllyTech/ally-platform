"""Real Postgres for chunk 07 (compose.yaml, `make db-up`): the PostgresStore in
signature mode (no embeddings call) and the verdicts table."""

from __future__ import annotations

import uuid

import pytest

from bug_hunter.memory.records import FalseAlarmRecord, new_id

pytestmark = pytest.mark.docker


def _db_or_skip():
    from psycopg import Connection

    from bug_hunter.graph.checkpointer import db_url

    try:
        Connection.connect(db_url(), connect_timeout=3).close()
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"bughunter database not running: {exc}")
    return db_url()


def test_postgres_store_round_trip_in_signature_mode(config) -> None:
    from bug_hunter.memory.store import open_memory

    _db_or_skip()
    mem_cfg = config.limits.memory.model_copy(update={"semantic": "off"})
    cfg = config.model_copy(
        update={"limits": config.limits.model_copy(update={"memory": mem_cfg})}
    )
    scope = f"it-{uuid.uuid4().hex[:8]}"
    with open_memory(cfg, scope=scope) as memory:
        assert memory.semantic is False
        rec = FalseAlarmRecord(
            id=new_id("false_alarms"),
            app="ally-be",
            title="x returns 0",
            reason="intended; mail jane.doe@example.com",
            text="x returns 0 | not a bug",
            files=["ally-be/src/x.ts"],
        )
        memory.put("false_alarms", rec)
        found = memory.search(
            "ally-be", "false_alarms", query="x returns 0", files=["ally-be/src/x.ts"]
        )
        assert [r.id for r in found] == [rec.id]
        assert "jane.doe@example.com" not in found[0].reason
        assert found[0].last_used_at is None or found[0].last_used_at
        assert memory.get(rec.id)[1].last_used_at  # touched by the search
        assert memory.delete(rec.id) and memory.get(rec.id) is None


def test_verdicts_table_round_trip() -> None:
    from bug_hunter.graph.approvals import PostgresApprovals
    from bug_hunter.memory.verdicts import PostgresVerdicts, Verdict

    url = _db_or_skip()
    assert "0002_verdicts.sql" in PostgresApprovals.migrate(url)
    store = PostgresVerdicts(url)
    run_id = f"run-it-{uuid.uuid4().hex[:8]}"
    saved = store.add(
        Verdict(
            run_id=run_id,
            app="ally-be",
            diagnosis="wrong",
            fix="none",
            reason="other cause",
            decided_by="it",
        )
    )
    assert saved.id and any(v.id == saved.id for v in store.unapplied())
    store.mark_applied(saved.id)
    assert store.for_run(run_id)[0].applied_at is not None
    assert all(v.id != saved.id for v in store.unapplied())


def test_spend_ledger_in_the_database() -> None:
    from bug_hunter import spend
    from bug_hunter.graph.approvals import PostgresApprovals

    url = _db_or_skip()
    assert "0003_spend.sql" in PostgresApprovals.migrate(url)
    led = spend.PostgresLedger(url)
    before = spend.total_for(path=led)
    spend.record(0.0123, "it", "integration test", path=led)
    assert spend.total_for(path=led) == pytest.approx(before + 0.0123)


def test_amended_verdicts_and_report_details_in_postgres() -> None:
    from bug_hunter.graph.approvals import PostgresApprovals
    from bug_hunter.memory.verdicts import PostgresVerdicts, Verdict
    from bug_hunter.reports.store import PostgresReports, Report

    url = _db_or_skip()
    applied = PostgresApprovals.migrate(url)
    assert "0006_verdict_amend_and_report_details.sql" in applied
    reports = PostgresReports(url)
    rep = reports.add(
        Report(
            day="2026-11-16",
            source="issue",
            app="ally-be",
            signal_key=f"it:{uuid.uuid4().hex[:6]}",
            status="suggested_fix",
            title="t",
            run_id="run-it",
            finding={"title": "t"},
            repro={"test_name": "n"},
            patch_diff="diff --git a b",
            review={"verdict": "approve", "notes": []},
        )
    )
    assert rep.finding == {"title": "t"} and rep.patch_diff.startswith("diff")
    store = PostgresVerdicts(url)

    def verdict(diagnosis, fix):
        return Verdict(
            run_id="run-it",
            app="ally-be",
            diagnosis=diagnosis,
            fix=fix,
            reason="r",
            decided_by="u-1",
            source="dashboard",
            report_id=rep.id,
        )

    a = store.add(verdict("not_a_bug", "none"))
    b = store.add(verdict("correct", "worked"))
    (old,) = store.superseded_by(b.id)
    assert old.id == a.id and old.superseded_at is not None
    assert [x.id for x in store.unapplied() if x.report_id == rep.id] == [b.id]
