"""Chunk 09: amended verdicts (user, 2026-11-16). The new verdict is active, the old
row is kept and points at it, and the feedback job retracts what the old one taught."""

from __future__ import annotations

from bug_hunter.memory import feedback as fb
from bug_hunter.memory.recall import triage_recall
from bug_hunter.memory.store import in_memory
from bug_hunter.memory.verdicts import InMemoryVerdicts, Verdict
from tests.test_graph_chunk06 import _isolated_caches, repo  # noqa: F401
from tests.test_memory import reader, snapshot


def v(diagnosis, fix="none", reason="r", report_id=7, run_id="run-1"):
    return Verdict(
        run_id=run_id,
        app="ally-be",
        diagnosis=diagnosis,
        fix=fix,
        reason=reason,
        decided_by="u-1",
        source="dashboard",
        report_id=report_id,
    )


def feed(memory, store, repo):
    return fb.run_feedback(
        memory, store, lambda rid: snapshot(run_id=rid), lambda run: reader(repo)
    )


def test_amending_not_a_bug_to_correct_removes_the_false_alarm(repo) -> None:
    memory, store = in_memory(), InMemoryVerdicts()
    first = store.add(v("not_a_bug", reason="intended"))
    feed(memory, store, repo)
    recall = triage_recall(memory, "ally-be", "x() returns 0 not 3", [], reader(repo))
    assert recall.blocking_false_alarms  # the false alarm closes repeats

    second = store.add(v("correct", fix="worked", reason="it was a real bug"))
    assert first.superseded_by == second.id and first.superseded_at  # kept, linked
    assert store.unapplied() == [second]
    feed(memory, store, repo)

    recall = triage_recall(memory, "ally-be", "x() returns 0 not 3", [], reader(repo))
    assert recall.blocking_false_alarms == {} and recall.hint_false_alarms == {}
    assert memory.list("false_alarms") == []
    assert first.retracted_at is not None
    # the bug record now carries the new verdict, and closes repeats as a duplicate
    _, bug = memory.get(fb.bug_id("run-1"))
    assert (bug.diagnosis, bug.fix_verdict) == ("correct", "worked")
    assert bug.source_verdicts == [second.id]
    assert fb.bug_id("run-1") in recall.duplicate_bugs
    ((_, stats),) = memory.list("run_stats", app="global")
    assert (stats.diagnoses, stats.not_a_bug, stats.diagnosis_correct) == (1, 0, 1)


def test_retraction_only_removes_the_old_verdicts_share(repo) -> None:
    memory, store = in_memory(), InMemoryVerdicts()
    reason = "use the shared PLAYGROUND_HISTORY_MAX constant, not a literal"
    # two different runs raise the same convention and fragile file
    store.add(v("correct", "needed_edits", reason, report_id=1, run_id="run-1"))
    store.add(
        v("correct", "needed_edits", reason + " please", report_id=2, run_id="run-2")
    )
    feed(memory, store, repo)
    ((_, cv),) = memory.list("conventions")
    ((_, area),) = memory.list("fragile_areas")
    assert cv.count == 2 and area.count == 2
    # report 2's verdict is amended to "fix worked": its share goes, report 1's stays
    store.add(v("correct", "worked", "fine after all", report_id=2, run_id="run-2"))
    feed(memory, store, repo)
    ((_, cv),) = memory.list("conventions")
    ((_, area),) = memory.list("fragile_areas")
    assert cv.count == 1 and area.count == 1 and len(area.reasons) == 1


def test_a_chain_of_amendments_retracts_the_applied_one(repo) -> None:
    memory, store = in_memory(), InMemoryVerdicts()
    store.add(v("not_a_bug", reason="a"))
    feed(memory, store, repo)
    store.add(v("wrong", reason="b"))  # superseded before the feedback job ran
    store.add(v("correct", fix="worked", reason="c"))
    feed(memory, store, repo)
    assert memory.list("false_alarms") == [] and memory.list("wrong_theories") == []


def test_human_only_reports_take_a_verdict_without_a_run(repo) -> None:
    memory, store = in_memory(), InMemoryVerdicts()
    store.add(v("correct", reason="real safety regression", run_id=""))
    done = feed(memory, store, repo)
    assert done[0][1] == [] and store.unapplied() == []
