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


def reviewer_notes(state: BugState) -> list[str]:
    """What the reviewer raised without blocking the fix."""
    if not state.review:
        return []
    return (
        list(state.review.issues)
        + [f"regression risk: {r}" for r in state.review.regression_risks]
        + list(state.review.notes)
    )


def counterexample_counts(state: BugState) -> dict[str, int]:
    """proposed / kept / failed / disputed over the whole run (review.v4)."""
    ces = state.counterexamples
    return {
        "proposed": len(ces),
        "kept": sum(
            1 for c in ces if c.status in ("kept", "passed", "failed", "disputed")
        ),
        # failed at least once against a fix (then fixed, disputed or still failing)
        "failed": sum(1 for c in ces if c.failed_on_fix),
        "disputed": sum(1 for c in ces if c.status == "disputed"),
    }


def suggested_fix_report(state: BugState, diff: str, test_source: str | None) -> str:
    """The deliverable of a successful run in ``output_mode: suggested_fix``."""
    f, r, p, v = state.finding, state.repro, state.patch, state.verification
    assert f and r and p and v
    box = lambda ok: "[x]" if ok else "[ ]"  # noqa: E731
    notes = reviewer_notes(state)
    lines = [
        f"# Suggested fix: {f.title}",
        "",
        f"app: {state.app} · severity: {f.severity} · confidence: "
        f"{state.confidence or '–'} · risk: {state.risk_level or '–'} · source: "
        f"{state.signal.source} {state.signal.ref} · ref: `{state.ref[:12]}`",
        "",
        "No branch, PR or approval request was created (output_mode: suggested_fix).",
        "",
    ]
    disputed = [c for c in state.counterexamples if c.status == "disputed"]
    if disputed:
        lines += [
            "> **Reviewer counterexample disputed.** The fixer says the test(s) below",
            "> contradict the report or the finding; they did not send the fix back,",
            "> and the confidence was lowered one level. Decide who is right.",
            "",
        ]
        for c in disputed:
            lines += [
                f"### {c.name}: `{c.test_path}::{c.test_name}`",
                f"- reviewer's claim: {c.claim}",
                f"- fixer's reason: {c.dispute_reason}",
                "",
                "```",
                c.code.rstrip(),
                "```",
                "",
                "Output with the suggested patch:",
                "",
                "```",
                c.failure_excerpt.strip(),
                "```",
                "",
            ]
    lines += [
        "## Root cause",
        state.root_cause or "(not recorded)",
        "",
        "## Verified failing test",
        f"`{r.test_path}::{r.test_name}` failed on the unchanged code "
        f"({r.failure_kind}) and passes with the patch below.",
    ]
    if r.failing_output_excerpt:
        lines += [
            "",
            "Failure before the fix (scrubbed):",
            "",
            "```",
            r.failing_output_excerpt.strip(),
            "```",
        ]
    if test_source is not None:
        lines += ["", f"`{r.test_path}`:", "", "```", test_source.rstrip(), "```"]
    lines += [
        "",
        "## Suggested patch",
        f"{p.rationale} · {', '.join(p.files_changed)} · {p.lines_changed} lines "
        f"· attempts: {state.attempts}",
        "",
        "```diff",
        diff.rstrip(),
        "```",
        "",
    ]
    passing = [c for c in state.counterexamples if c.status == "passed"]
    if passing:
        lines += [
            "",
            "## Extra regression tests (reviewer counterexamples the patch passes)",
        ]
        for c in passing:
            lines += [
                "",
                f"`{c.test_path}::{c.test_name}` — {c.claim}",
                "",
                "```",
                c.code.rstrip(),
                "```",
            ]
    lines += [
        "",
        "## Verification",
        f"- {box(v.repro_passes)} repro test  - {box(v.app_tests_pass)} app tests"
        f"  - {box(v.lint_pass)} lint  - {box(v.typecheck_pass)} typecheck",
        "",
        "## Reviewer notes",
        f"verdict: {state.review.verdict if state.review else 'n/a'}",
    ]
    lines += [f"- {n}" for n in notes] if notes else ["- none"]
    lines += ["", f"_Run `{state.run_id}` · bug-hunter v2_"]
    return "\n".join(lines) + "\n"


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
    if state.counterexamples:
        lines += ["", "## Reviewer counterexamples"] + [
            f"- {c.name} ({c.status}): `{c.test_path}::{c.test_name}` — {c.claim}"
            + (f" · disputed: {c.dispute_reason}" if c.dispute_reason else "")
            for c in state.counterexamples
        ]
    lines += ["", "## Ruled out / notes", "", scratchpad_tail.strip()[-3000:]]
    return title[:120], "\n".join(lines)
