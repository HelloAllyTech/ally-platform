"""PR body and escalation issue body, generated from state (spec §13); a model never
writes them."""

from __future__ import annotations

from bug_hunter.graph.state import BugState


def pr_title(state: BugState) -> str:
    title = state.finding.title if state.finding else "bug fix"
    return f"fix({state.app}): {title}"[:120]


def pr_body(state: BugState) -> str:
    f, r, p, v = state.finding, state.repro, state.patch, state.verification
    assert f and r and p and v
    box = lambda ok: "[x]" if ok else "[ ]"  # noqa: E731
    return "\n".join(
        [
            "## Bug",
            f"{f.title} · app: {state.app} · severity: {f.severity} · source: "
            f"{state.signal.source} {state.signal.ref}",
            "",
            "## Root cause",
            state.root_cause or "(not recorded)",
            "",
            "## Reproduction",
            f"Test: `{r.test_path}::{r.test_name}` — failed before this change, "
            "passes after.",
            "",
            "## Fix",
            f"{p.rationale} · {', '.join(p.files_changed)} · {p.lines_changed} lines",
            "",
            "## Verification",
            f"- {box(v.repro_passes)} repro test  "
            f"- {box(v.app_tests_pass)} app test suite"
            f"  - {box(v.lint_pass)} lint  - {box(v.typecheck_pass)} typecheck",
            (
                f"- pre-existing failures not blamed: {len(v.baseline_failures)}"
                if v.baseline_failures
                else "- no pre-existing failures"
            ),
            "",
            "## Risk",
            f"{state.risk_level} · reviewer verdict: "
            f"{state.review.verdict if state.review else 'n/a'} · "
            f"confidence: {state.confidence}",
            "",
            "## Approval",
            "Approve or reject in the Ally admin dashboard → Bug Hunter → Approvals "
            "(super duper admins only). Rejecting asks for a one-line reason; the bug "
            "hunter learns from it.",
            "",
            f"_Run `{state.run_id}` · bug-hunter v2_",
        ]
    )


def escalation_issue(state: BugState, scratchpad_tail: str) -> tuple[str, str]:
    f = state.finding
    title = (
        f"[bug-hunter] {f.title if f else state.signal.source + ' ' + state.signal.ref}"
    )
    lines = [
        "## Bug",
        f"{f.title if f else '(no finding)'} · app: {state.app} · severity: "
        f"{f.severity if f else 'unknown'} · source: {state.signal.source} "
        f"{state.signal.ref}",
        "",
        "## Root cause",
        state.root_cause or "(not established)",
        "",
        "## Why the agent stopped",
        state.stop_reason or "(no reason recorded)",
    ]
    if f:
        lines += ["", "## Evidence"] + [f"- {e}" for e in f.evidence]
    if state.repro:
        lines += [
            "",
            "## Reproduction attempt",
            f"`{state.repro.test_path}::{state.repro.test_name}` · "
            f"{state.repro.failure_kind}"
            f" · right reason: {state.repro.fails_for_the_right_reason}",
        ]
    if state.patch:
        lines += [
            "",
            "## Fix attempted",
            f"{state.patch.rationale} · {', '.join(state.patch.files_changed)} · "
            f"{state.patch.lines_changed} lines (attempts: {state.attempts})",
        ]
    if state.review:
        lines += [
            "",
            "## Review",
            f"{state.review.verdict}: " + "; ".join(state.review.issues),
        ]
    lines += ["", "## Ruled out / notes", "", scratchpad_tail.strip()[-3000:]]
    return title[:120], "\n".join(lines)
