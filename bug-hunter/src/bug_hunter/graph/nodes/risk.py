"""risk_precheck (before fix) and risk_gate (after review): rules, no model.

risk_precheck looks at the finding's files and the repro; risk_gate re-checks the
*actual* files and lines in the final diff, so a fix that drifted into a risk path or
touched safety code escalates even after the reviewer approved it.
"""

from __future__ import annotations

from typing import Any

from bug_hunter.graph.budget import with_clock
from bug_hunter.graph.deps import GraphDeps
from bug_hunter.graph.risk import risk_hits, risk_level, risky_dependents, topic_hits
from bug_hunter.graph.state import BugState


def _app_abs(deps: GraphDeps, rel: str) -> str:
    app_path = deps.config.app(deps.app).path
    if rel.startswith(app_path + "/"):
        return rel
    return f"{app_path}/{rel}" if (deps.worktree / app_path).exists() else rel


def make_risk_precheck_node(deps: GraphDeps):
    def risk_precheck(state: BugState) -> dict[str, Any]:
        assert state.finding is not None
        files = [
            deps.worktree / _app_abs(deps, f) for f in state.finding.suspected_files
        ]
        # paths and category only: the safety-keyword check runs on *changed code* in
        # risk_gate. Scanning the finding's prose matched a quoted code comment
        # ("… ＳＵＩＣＩＤＥ → suicide …") and escalated a plain regex fix.
        reasons = list(deps.workspace.policy.touches_risk(files, deps.app))
        # (a) tenancy, data exposure, auth or permissions: human-only whatever the paths
        reasons += topic_hits(
            state.finding.title, state.finding.hypothesis, state.root_cause or ""
        )
        if state.finding.category == "security":
            reasons.append("finding category: security")
        if reasons:
            deps.scratchpad.append_note(
                f"risk_precheck: human-only: {'; '.join(reasons)[:300]}"
            )
            return {
                "risk_level": "human_only",
                "status": "escalated",
                "stop_reason": "risky area, human-only: " + "; ".join(reasons)[:350],
                "budget_used": with_clock(state.budget_used, state.started_at),
            }
        deps.scratchpad.append_note(
            "risk_precheck: no risk path in the suspected files"
        )
        return {
            "status": "fixing",
            "budget_used": with_clock(state.budget_used, state.started_at),
        }

    return risk_precheck


def make_risk_gate_node(deps: GraphDeps):
    def risk_gate(state: BugState) -> dict[str, Any]:
        assert state.patch is not None and state.finding is not None
        diff_path = state.patch.diff_path
        diff = ""
        try:
            diff = open(diff_path, encoding="utf-8").read() if diff_path else ""
        except OSError:
            diff = ""
        files = [deps.worktree / f for f in state.patch.files_changed]
        reasons = risk_hits(deps.workspace.policy, deps.app, files, diff)
        # (b) a risk-path file uses what the fix changed (repo map callers/importers)
        app_prefix = (
            "" if deps.app_root == deps.worktree else deps.config.app(deps.app).path
        )
        reasons += risky_dependents(
            deps.repo_map,
            deps.workspace.policy,
            deps.app,
            deps.app_root,
            diff,
            app_prefix,
        )
        # (a) again on the finding, in case it was reached by another path
        reasons += topic_hits(
            state.finding.title, state.finding.hypothesis, state.root_cause or ""
        )
        level = risk_level(
            human_only_reasons=reasons,
            lines_changed=state.patch.lines_changed,
            files_changed=len(state.patch.files_changed),
            severity=state.finding.severity,
            review_verdict=state.review.verdict if state.review else None,
        )
        if deps.memory is not None and level != "human_only":
            from bug_hunter.memory.fingerprint import repo_path
            from bug_hunter.memory.recall import fragile_hits, raised

            changed = [repo_path(f, deps.app_prefix) for f in state.patch.files_changed]
            fragile = fragile_hits(deps.memory, deps.app, changed)
            if fragile:
                before, level = level, raised(level)
                deps.scratchpad.append_note(
                    f"risk_gate: fragile area ({', '.join(r.id for r in fragile)}): "
                    f"risk {before} -> {level}"
                )
        update: dict[str, Any] = {
            "risk_level": level,
            "budget_used": with_clock(state.budget_used, state.started_at),
        }
        if level == "human_only":
            deps.scratchpad.append_note(
                f"risk_gate: human-only after review: {'; '.join(reasons)[:300]}"
            )
            update.update(
                status="escalated",
                stop_reason="final diff touches a human-only area: "
                + "; ".join(reasons)[:330],
            )
        else:
            deps.scratchpad.append_note(f"risk_gate: {level}")
        return update

    return risk_gate
