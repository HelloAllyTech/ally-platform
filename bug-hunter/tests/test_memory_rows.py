"""The past-bug table (user, 2026-11-14): one test per row, and recall evidence."""

from __future__ import annotations

from bug_hunter.graph import routing
from bug_hunter.graph.build import initial_state
from bug_hunter.graph.nodes.investigate import make_investigate_node
from bug_hunter.graph.nodes.triage import make_triage_node
from bug_hunter.memory import feedback as fb
from bug_hunter.memory.records import BugRecord, ConventionRecord
from bug_hunter.memory.store import in_memory
from tests.fakes import ScriptedChatModel, ai
from tests.test_graph_chunk06 import (  # noqa: F401 - fixtures
    EDIT_FIX,
    RUN_REPRO,
    SIGNAL,
    SUBMIT_FIX,
    _deps,
    _isolated_caches,
    _run,
    repo,
)
from tests.test_memory import decide, reader, snapshot, triage_deps

CHANGED = "export const x = () => {\n  return compute(); // changed\n};\n"


def past_bug(repo, diagnosis=None, fix=None, reason="", run_id="run-1"):
    memory = in_memory()
    bug = fb.bug_record_for(snapshot(run_id=run_id), reader(repo))
    bug.diagnosis, bug.fix_verdict, bug.verdict_reason = diagnosis, fix, reason
    memory.put("bugs", bug)
    return memory, bug.id


def triage(config, repo, tmp_path, memory, kind, match):
    deps = triage_deps(config, repo, tmp_path, decide(kind, match=match), memory)
    out = make_triage_node(deps)(initial_state(deps, SIGNAL))
    prompt = str(deps.models["triage"].calls[0][0].content)
    return deps, out, prompt


# row 1 -----------------------------------------------------------------------------


def test_row1_confirmed_fix_worked_code_unchanged_closes_as_duplicate(
    config, repo, tmp_path
) -> None:
    for fix in ("worked", None):
        memory, bid = past_bug(repo, "correct", fix)
        _, out, prompt = triage(config, repo, tmp_path, memory, "duplicate", bid)
        assert out["status"] == "closed_duplicate" and out["duplicate_of"] == bid
        assert f"CONFIRMED BUG {bid} (a human confirmed it" in prompt


# row 2 -----------------------------------------------------------------------------


def test_row2_confirmed_but_code_changed_investigates_as_possible_regression(
    config, repo, tmp_path
) -> None:
    memory, bid = past_bug(repo, "correct", "worked")
    (repo / "ally-be/src/x.ts").write_text(CHANGED)
    deps, out, prompt = triage(config, repo, tmp_path, memory, "duplicate", bid)
    assert out["status"] == "triaged" and out["regression_of"] == bid
    assert "CODE CHANGED SINCE" in prompt and "never a reason to close" in prompt
    # investigate is told
    deps.models["investigate"] = ScriptedChatModel(
        script=[
            ai(
                tool_calls=[
                    {
                        "name": "report_no_bug",
                        "args": {"reason": "n", "confidence": "low"},
                    }
                ]
            )
        ]
    )
    state = initial_state(deps, SIGNAL).model_copy(update={"app": "ally-be", **out})
    make_investigate_node(deps)(state)
    inv = str(deps.models["investigate"].calls[0][0].content)
    assert f"POSSIBLE REGRESSION of {bid}" in inv


def test_changed_lines_win_over_a_bad_fix_verdict(config, repo, tmp_path) -> None:
    memory, bid = past_bug(repo, "correct", "needed_edits", "use 10")
    (repo / "ally-be/src/x.ts").write_text(CHANGED)
    _, out, _ = triage(config, repo, tmp_path, memory, "bug", bid)
    assert out.get("regression_of") == bid and not out.get("reused_from")


# row 3 -----------------------------------------------------------------------------


def test_row3_confirmed_with_a_bad_fix_reuses_the_diagnosis_and_skips_investigate(
    config, repo, tmp_path
) -> None:
    from bug_hunter.graph.state import Review
    from tests.fakes import structured

    memory, bid = past_bug(
        repo, "correct", "needed_edits", "return 3 via the shared constant X_VALUE"
    )
    memory.put(
        "conventions",
        ConventionRecord(
            id="cv-1",
            app="ally-be",
            text="x returns 0: use the shared constant X_VALUE",
            status="approved",
        ),
    )
    memory.put(
        "conventions",
        ConventionRecord(id="cv-2", app="ally-be", text="x returns 0: pending rule"),
    )
    # triage node alone: the reuse
    _, out, prompt = triage(config, repo, tmp_path, memory, "bug", bid)
    assert out["reused_from"] == bid and out["finding"].title == "x returns 0"
    assert "FIX NOT RIGHT YET" in prompt
    state = initial_state(_deps(config, repo, tmp_path, []), SIGNAL).model_copy(
        update=out
    )
    assert routing.after_triage(state) == "reproduce"
    # the whole graph: investigate is never called; fix sees the past fix, the
    # verdict reason and the approved convention (not the pending one)
    deps = _deps(
        config,
        repo,
        tmp_path,
        [EDIT_FIX, RUN_REPRO, SUBMIT_FIX],
        output_mode="suggested_fix",
    )
    deps.memory = memory
    from bug_hunter.graph.nodes.triage import TriageDecision

    deps.models["triage"] = ScriptedChatModel(
        script=[
            structured(
                TriageDecision(
                    is_bug_candidate=True,
                    app="ally-be",
                    severity="medium",
                    confidence="medium",
                    reason="same as before",
                    kind="bug",
                    memory_match=bid,
                ),
                model="gpt-5-mini",
            )
        ]
    )
    deps.models["investigate"] = ScriptedChatModel(script=[])  # any call fails
    deps.models["review"] = ScriptedChatModel(
        script=[structured(Review(verdict="approve"), model="gemini-2.5-pro")]
    )
    _, final = _run(deps)
    assert final.status == "suggested_fix", final.stop_reason
    assert deps.models["investigate"].calls == []
    assert final.reused_from == bid and bid in final.recalled
    fix_prompts = [
        str(c[0].content)
        for c in deps.models["fix"].calls
        if "SAME BUG" in str(c[0].content)
    ]
    assert fix_prompts, "fix never saw the past fix"
    fix_prompt = fix_prompts[0]
    assert "a human said: return 3 via the shared constant X_VALUE" in fix_prompt
    assert "CONVENTION cv-1" in fix_prompt and "cv-2" not in fix_prompt


# row 4 -----------------------------------------------------------------------------


def test_row4_no_verdict_is_a_hint_that_never_closes(config, repo, tmp_path) -> None:
    memory, bid = past_bug(repo)
    for kind in ("duplicate", "not_a_bug"):
        _, out, prompt = triage(config, repo, tmp_path, memory, kind, bid)
        assert out["status"] == "triaged"
        assert f"UNCONFIRMED PAST BUG {bid}" in prompt and "never" in prompt


# row 5 -----------------------------------------------------------------------------


def test_row5_wrong_or_not_a_bug_records_are_not_shown_as_bugs(
    config, repo, tmp_path
) -> None:
    for diagnosis in ("wrong", "not_a_bug"):
        memory, bid = past_bug(repo, diagnosis, "none", "other cause")
        _, out, prompt = triage(config, repo, tmp_path, memory, "duplicate", bid)
        assert bid not in prompt and out["status"] == "triaged"


def test_row5_lesson_comes_from_the_wrong_theory(config, repo, tmp_path) -> None:
    """End to end through feedback: the wrong verdict hides the bug and the wrong
    theory reaches investigate."""
    from bug_hunter.memory.recall import investigate_recall, triage_recall

    memory = in_memory()
    memory.put("bugs", fb.bug_record_for(snapshot(), reader(repo)))
    fb.apply_verdict(
        memory,
        fb_verdict("wrong", "the cause is zero-width spaces"),
        snapshot(),
        reader(repo),
    )
    tr = triage_recall(memory, "ally-be", "x() returns 0 not 3", [], reader(repo))
    assert tr.bugs == {}
    lines = investigate_recall(memory, "ally-be", "x() returns 0 not 3")
    assert any("WRONG THEORY" in x and "zero-width" in x for x in lines)


def fb_verdict(diagnosis, reason):
    from bug_hunter.memory.verdicts import Verdict

    return Verdict(
        run_id="run-1",
        app="ally-be",
        diagnosis=diagnosis,
        fix="none",
        reason=reason,
        decided_by="t",
    )


# recall evidence ------------------------------------------------------------------


def test_similarity_only_ranks_recall_needs_evidence() -> None:
    from langgraph.store.memory import InMemoryStore

    from bug_hunter.memory.store import Memory

    memory = Memory(
        InMemoryStore(
            index={"dims": 2, "embed": lambda ts: [[1.0, 1.0] for _ in ts]}
        ),  # every record is maximally "similar"
        semantic=True,
    )
    memory.put(
        "bugs",
        BugRecord(
            id="bug-web",
            app="ally-web",
            title="t",
            text="WhatsApp preview sends full history, rejected after 20 turns",
            files=["ally-web/apps/a/ChatbotTestTab.tsx"],
        ),
    )
    query = "helpline crashes on load: useLocation outside a Router"
    assert memory.search("ally-web", "bugs", query=query) == []  # no evidence
    # a shared file is evidence, whatever the words
    assert memory.search(
        "ally-web", "bugs", query=query, files=["ally-web/apps/a/ChatbotTestTab.tsx"]
    )
    # enough word overlap is evidence
    assert memory.search(
        "ally-web", "bugs", query="preview history rejected after 20 turns"
    )
    # a matching signature is evidence
    memory.put(
        "bugs",
        BugRecord(id="bug-sig", app="ally-web", title="t", text="zzz", signature="s1"),
    )
    assert [r.id for r in memory.search("ally-web", "bugs", signature="s1")] == [
        "bug-sig"
    ]


def test_recall_is_capped_at_five() -> None:
    memory = in_memory()
    for i in range(9):
        memory.put(
            "bugs",
            BugRecord(
                id=f"bug-{i}", app="ally-be", title="t", text="x returns 0", files=[]
            ),
        )
    assert len(memory.search("ally-be", "bugs", query="x returns 0", limit=50)) == 5
