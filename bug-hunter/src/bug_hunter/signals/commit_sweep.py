"""Commit sweep (spec §12): commits on master since the last processed SHA, per app,
through five narrow lenses and a falsifier.

The lens and falsifier prompts are drafts until the user approves them, so this module
only depends on two interfaces (``LensRunner``, ``Falsifier``). With no runner, the
sweep reports what it *would* review (dry run) and calls no model.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from typing import Any, Callable, Protocol

from bug_hunter.signals.base import Candidate
from bug_hunter.signals.state import SignalState

LENSES = (
    "logic",
    "error_handling_and_null",
    "security_and_data_exposure",
    "async_and_race",
    "api_contract",
)
CURSOR = "commit_sweep:last_sha"
SEVERITY = {"critical": 4, "high": 3, "medium": 2, "low": 1}
MAX_FALSIFY = 5  # falsifier loops per batch (cost cap); safety findings always go
CONFIDENCE = {"high": 3, "medium": 2, "low": 1}


@dataclass
class LensFinding:
    lens: str
    title: str
    category: str
    severity: str
    files: list[str]
    evidence: list[str]
    hypothesis: str
    confidence: str
    safety: bool = False  # weakens crisis detection / guardrails / escalation


@dataclass
class SweepBatch:
    app: str
    commits: list[str]  # oldest first
    files: list[str]
    findings: list[LensFinding] = field(default_factory=list)
    survived: list[LensFinding] = field(default_factory=list)
    dropped: list[LensFinding] = field(default_factory=list)  # past the falsify cap


class LensRunner(Protocol):
    def run(self, lens: str, app: str, commits: list[str]) -> list[LensFinding]: ...


class Falsifier(Protocol):
    def check(self, app: str, finding: LensFinding) -> tuple[str, str, str]:
        """(verdict survives|refuted, confidence medium|low, reason)."""
        ...


# git access as plain callables, so tests pass recorded fixtures
ListCommits = Callable[[str | None], list[str]]  # since sha -> shas oldest first
ChangedFiles = Callable[[str], list[str]]  # sha -> repo-relative paths


def app_of_path(path: str, app_paths: dict[str, str]) -> str | None:
    for app, prefix in app_paths.items():
        if path.startswith(prefix.rstrip("/") + "/"):
            return app
    return None


def batches(
    list_commits: ListCommits,
    changed_files: ChangedFiles,
    state: SignalState,
    app_paths: dict[str, str],
    apps: list[str],
) -> tuple[list[SweepBatch], dict[str, Any]]:
    since = state.get(CURSOR)
    shas = list_commits(since)
    by_app: dict[str, SweepBatch] = {}
    for sha in shas:
        for path in changed_files(sha):
            app = app_of_path(path, app_paths)
            if app is None or app not in apps:
                continue
            b = by_app.setdefault(app, SweepBatch(app=app, commits=[], files=[]))
            if sha not in b.commits:
                b.commits.append(sha)
            if path not in b.files:
                b.files.append(path)
    cursor = {CURSOR: shas[-1]} if shas else {}
    return list(by_app.values()), cursor


def rank(f: LensFinding) -> int:
    return SEVERITY.get(f.severity, 1) * CONFIDENCE.get(f.confidence, 1)


def collect_with(
    sweep: list[SweepBatch],
    runner_for: Callable[[SweepBatch], Any] | None,
) -> tuple[list[Candidate], float]:
    """Like ``collect``, with a model runner per batch: ``runner_for(batch)`` is a
    context manager yielding an object that is both the ``LensRunner`` and the
    ``Falsifier`` and has a ``budget`` (cost). Returns (candidates, cost in USD)."""
    if runner_for is None:
        return [], 0.0
    out: list[Candidate] = []
    cost = 0.0
    for b in sweep:
        with runner_for(b) as runner:
            try:
                out += collect([b], runner, runner)
            finally:
                cost += runner.budget.cost_usd
    out.sort(key=lambda c: c.extra.get("rank", 0), reverse=True)
    out.sort(key=lambda c: not c.extra.get("human_only", False))
    return out, round(cost, 4)


def collect(
    sweep: list[SweepBatch],
    lenses: LensRunner | None,
    falsifier: Falsifier | None,
    max_falsify: int = MAX_FALSIFY,
) -> list[Candidate]:
    """Lens findings that survive the falsifier with at least medium confidence,
    ranked by severity x confidence. No runner (prompts not approved, dry run): no
    model calls and no candidates; the batches still say what would be reviewed."""
    if lenses is None or falsifier is None:
        return []
    out: list[tuple[int, Candidate]] = []
    for b in sweep:
        for lens in LENSES:
            b.findings.extend(lenses.run(lens, b.app, b.commits))
        ordered = sorted(b.findings, key=lambda f: (not f.safety, -rank(f)))
        checked = [f for f in ordered if f.safety]
        checked += [f for f in ordered if not f.safety][
            : max(0, max_falsify - len(checked))
        ]
        b.dropped = [f for f in ordered if f not in checked]
        for f in checked:
            verdict, confidence, reason = falsifier.check(b.app, f)
            # a change that weakens safety always reaches a human, whatever the
            # falsifier said (user, 2026-11-15); everything else must survive
            if not f.safety and (verdict != "survives" or confidence != "medium"):
                continue
            b.survived.append(f)
            digest = hashlib.sha1(f"{f.title}|{'|'.join(f.files)}".encode()).hexdigest()
            out.append(
                (
                    rank(f),
                    Candidate(
                        source="commit_sweep",
                        app=b.app,
                        key=f"sweep:{b.app}:{b.commits[-1][:12]}:{digest[:10]}",
                        title=("[safety] " if f.safety else "") + f.title[:200],
                        summary=(
                            f"Commit sweep ({f.lens} lens) over {len(b.commits)} "
                            f"commit(s) up to {b.commits[-1][:12]}.\n{f.hypothesis}\n"
                            "Evidence:\n- " + "\n- ".join(f.evidence) + f"\n\n"
                            f"Falsifier: {verdict} ({confidence}): {reason}"
                            + (
                                "\n\nSafety-related (crisis detection, guardrails or "
                                "escalation): routed to a human, never fixed "
                                "automatically."
                                if f.safety
                                else ""
                            )
                        ),
                        ref=b.commits[-1],
                        reported_by="agent",
                        severity_hint=f.severity,
                        extra={
                            "lens": f.lens,
                            "commits": b.commits,
                            "rank": rank(f),
                            "human_only": f.safety,
                            "falsifier": verdict,
                        },
                    ),
                )
            )
    out.sort(key=lambda rc: rc[0], reverse=True)
    return [c for _, c in out]
