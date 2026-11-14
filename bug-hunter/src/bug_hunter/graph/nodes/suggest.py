"""suggest_fix: the end of a successful run in ``output_mode: suggested_fix``.

The verified, reviewed fix becomes a report (root cause, the failing test, the patch,
reviewer notes) in the run's artefacts. No branch, no commit, no PR, no approval row.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from bug_hunter.graph.budget import with_clock
from bug_hunter.graph.deps import GraphDeps
from bug_hunter.graph.output import suggested_fix_report
from bug_hunter.graph.state import BugState


def make_suggest_fix_node(deps: GraphDeps):
    def suggest_fix(state: BugState) -> dict[str, Any]:
        assert state.finding and state.patch and state.repro and state.verification
        budget = with_clock(state.budget_used, state.started_at)
        diff = Path(state.patch.diff_path).read_text(encoding="utf-8")
        test_file = Path(deps.app_root) / state.repro.test_path
        test_source = (
            test_file.read_text(encoding="utf-8", errors="replace")
            if test_file.is_file()
            else None
        )
        artefacts = dict(state.artefacts)
        artefacts["suggested_patch"] = str(
            deps.write_artefact("suggested-fix.patch", diff)
        )
        artefacts["suggested_fix"] = str(
            deps.write_artefact(
                "suggested-fix.md", suggested_fix_report(state, diff, test_source)
            )
        )
        deps.scratchpad.append_note(
            "suggest_fix: verified fix written to suggested-fix.md (no PR)"
        )
        return {
            "status": "suggested_fix",
            "artefacts": artefacts,
            "budget_used": budget,
        }

    return suggest_fix
