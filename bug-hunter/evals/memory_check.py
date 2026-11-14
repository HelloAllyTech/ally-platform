"""Chunk 07 mechanics check: two passes over a few cases with simulated verdicts.

Pass 1 runs each case with an empty, eval-scoped memory (``learn`` writes the bug
records). Each entry's verdict (``golden/memory-check.yaml``, source ``simulated``) is
applied through the same ``apply_verdict`` as ``bug-hunter verdict``; entries marked
``approve_convention`` approve the conventions their verdict raised, standing in for
``bug-hunter memory approve``. Pass 2 runs the same cases against that memory. The
report says, per case, what pass 2 was shown (``recalled``) and what changed.

Holdout cases are refused: they never enter memory.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, replace
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml

from bug_hunter import spend
from bug_hunter.config import BugHunterConfig
from bug_hunter.memory.feedback import apply_verdict, approve_convention, load_run
from bug_hunter.memory.store import Memory
from bug_hunter.memory.verdicts import Verdict
from evals.metrics import CaseResult
from evals.run_evals import (
    RESULTS_DIR,
    DiskGuard,
    HarnessOptions,
    Repo,
    StopHarness,
    run_case,
)
from evals.schema import Case

SPEC = Path(__file__).parent / "golden" / "memory-check.yaml"


@dataclass
class Entry:
    case: str
    mode: str
    diagnosis: str
    fix: str
    reason: str
    approve_convention: bool = False


def load_entries(path: Path = SPEC) -> list[Entry]:
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    return [Entry(**e) for e in data.get("entries", [])]


def _git_reader(repo: Repo, ref: str):
    def read(repo_rel: str):
        out = repo.git("show", f"{ref}:{repo_rel}")
        return out or None  # Repo.git returns "" for a path absent at that commit

    return read


def _summary(row: CaseResult) -> dict[str, Any]:
    return {
        "run_id": row.run_id,
        "outcome": row.outcome,
        "ended_as": row.final_outcome or row.status,
        "finding": row.finding_title,
        "oracle": row.oracle_pass,
        "recalled": list(row.recalled),
        "cost_usd": round(row.cost_usd, 4),
        "error": row.error,
    }


def changes(first: dict[str, Any], second: dict[str, Any]) -> list[str]:
    out = []
    for key in ("finding", "ended_as", "outcome", "oracle"):
        if first.get(key) != second.get(key):
            out.append(f"{key}: {first.get(key)!r} -> {second.get(key)!r}")
    return out or ["nothing changed"]


def run_memory_check(
    config: BugHunterConfig,
    entries: list[Entry],
    cases: dict[str, Case],
    agent: Any,  # a GraphAgent whose .memory is the eval memory
    memory: Memory,
    options: HarnessOptions,
    repo: Repo | None = None,
    guard: DiskGuard | None = None,
    results_dir: Path = RESULTS_DIR,
) -> tuple[dict[str, Any], Path]:
    for e in entries:
        case = cases.get(e.case)
        if case is None:
            raise ValueError(f"unknown case {e.case}")
        if case.split == "holdout":
            raise ValueError(f"{e.case} is a holdout case: never in memory")
        if e.mode not in case.modes:
            raise ValueError(f"{e.case} has no {e.mode} mode")
    if memory.scope == "live":
        raise ValueError("the memory check needs an eval-scoped memory, not live")
    repo = repo or Repo(config.repo_root)
    guard = guard or DiskGuard(options.min_free_gb or config.limits.evals.min_free_gb)
    agent.memory = memory
    cap = options.max_cost_usd or config.limits.evals.max_cost_usd
    if options.spend_file is not None:
        spend.check_cap(
            expected_usd=0.0,
            override=options.override_spend_cap,
            path=options.spend_file,
        )
    artefacts_dir = options.runs_dir / "artefacts"
    spent = 0.0
    rows: dict[str, dict[str, Any]] = {e.case: {"mode": e.mode} for e in entries}
    stopped = None
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    base = results_dir / f"{stamp}-memory-check"
    results_dir.mkdir(parents=True, exist_ok=True)

    def run_pass(label: str) -> None:
        nonlocal spent
        for e in entries:
            if spent >= cap:
                raise StopHarness(f"cost cap ${cap:.2f} reached in {label}")
            row = run_case(
                config, cases[e.case], agent, replace(options, mode=e.mode), guard, repo
            )
            spent += row.cost_usd
            rows[e.case][label] = _summary(row)
            write(partial=True)

    def apply_verdicts() -> None:
        for e in entries:
            first = rows[e.case].get("pass1") or {}
            info: dict[str, Any] = {"diagnosis": e.diagnosis, "fix": e.fix}
            try:
                case = cases[e.case]
                run = load_run(
                    first.get("run_id", ""),
                    artefacts_dir,
                    # pre-cutover cases ran with the app at the repo root
                    lambda app: (
                        "" if case.layout == "root" or not app else config.app(app).path
                    ),
                )
            except FileNotFoundError as exc:
                info["skipped"] = str(exc)[:200]
                rows[e.case]["verdict"] = info
                continue
            verdict = Verdict(
                run_id=run.run_id,
                app=run.app or cases[e.case].app,
                diagnosis=e.diagnosis,
                fix=e.fix if run.patch_files or e.fix == "none" else "none",
                reason=e.reason,
                decided_by="memory-check",
                source="simulated",
            )
            ids = apply_verdict(memory, verdict, run, _git_reader(repo, run.ref))
            if e.approve_convention:
                for cid in [i for i in ids if i.startswith("cv-")]:
                    approve_convention(memory, cid)
                    info.setdefault("approved", []).append(cid)
            info["written"] = ids
            info["applied_fix"] = verdict.fix
            if not run.finding:
                info["note"] = "pass 1 had no finding: only the run record and stats"
            rows[e.case]["verdict"] = info

    def write(partial: bool) -> None:
        for r in rows.values():
            if "pass1" in r and "pass2" in r:
                written = set((r.get("verdict") or {}).get("written") or [])
                r["recalled_memory"] = bool(written & set(r["pass2"]["recalled"]))
                r["changes"] = changes(r["pass1"], r["pass2"])
        report = {
            "meta": {
                "kind": "memory-check",
                "scope": memory.scope,
                "semantic": memory.semantic,
                "cost_usd_total": round(spent, 4),
                "cost_cap_usd": cap,
                "partial": partial,
                "stopped_reason": stopped,
                "timestamp": stamp,
            },
            "cases": rows,
            "memory": [
                {"kind": k, **r.model_dump(exclude={"fingerprints"})}
                for k, r in memory.list()
            ],
        }
        base.with_suffix(".json").write_text(json.dumps(report, indent=1))
        base.with_suffix(".md").write_text(render(report))

    try:
        run_pass("pass1")
        apply_verdicts()
        run_pass("pass2")
    except StopHarness as exc:
        stopped = str(exc)
    if options.spend_file is not None and spent > 0:
        spend.record(spent, "local-eval", "memory-check", path=options.spend_file)
    write(partial=False)
    return json.loads(base.with_suffix(".json").read_text()), base.with_suffix(".md")


def render(report: dict[str, Any]) -> str:
    meta = report["meta"]
    lines = [
        "# Memory check (chunk 07 mechanics)",
        "",
        f"- scope `{meta['scope']}` · semantic search: {meta['semantic']} · cost "
        f"${meta['cost_usd_total']:.2f} of ${meta['cost_cap_usd']:.2f}"
        + (f" · stopped: {meta['stopped_reason']}" if meta["stopped_reason"] else ""),
        "",
        "| case | mode | pass 1 | verdict | written | pass 2 recalled | pass 2 | "
        "recalled the verdict? | what changed |",
        "|---|---|---|---|---|---|---|---|---|",
    ]

    def cell(p: dict[str, Any] | None) -> str:
        if not p:
            return "–"
        oracle = {True: "oracle pass", False: "oracle fail"}.get(p.get("oracle"), "")
        return f"{p['ended_as']} · {p['finding'] or '(no finding)'} {oracle}".strip()

    for cid, r in report["cases"].items():
        v = r.get("verdict") or {}
        lines.append(
            f"| `{cid}` | {r['mode']} | {cell(r.get('pass1'))} | "
            f"{v.get('diagnosis', '–')}/{v.get('applied_fix', v.get('fix', '–'))} | "
            f"{', '.join(v.get('written') or []) or v.get('skipped', '–')} | "
            f"{', '.join((r.get('pass2') or {}).get('recalled') or []) or '–'} | "
            f"{cell(r.get('pass2'))} | "
            f"{'yes' if r.get('recalled_memory') else 'no'} | "
            f"{'; '.join(r.get('changes') or [])} |"
        )
    lines += ["", f"Memory after the check: {len(report['memory'])} records"]
    for m in report["memory"]:
        extra = f" [{m['status']}]" if m["kind"] == "conventions" else ""
        lines.append(f"- {m['id']} ({m['kind']}{extra}): {m['text'][:120]}")
    return "\n".join(lines) + "\n"
