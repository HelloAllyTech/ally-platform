"""Metrics over per-case results (pure functions; no I/O).

Outcomes per case (set by the harness):
  bug cases   detected · escalated_correctly · escalated · missed · error
  clean cases clean · false_alarm · error
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import asdict, dataclass, field
from typing import Any, Iterable


@dataclass
class CaseResult:
    id: str
    app: str
    kind: str
    expected: str
    outcome: str
    found: bool = False
    escalated: bool = False
    patch_applied: bool | None = None
    repro_valid: bool | None = None  # agent's test fails on the buggy code
    oracle_pass: bool | None = None  # hidden oracle passes with the agent's patch
    tokens: int = 0
    cost_usd: float = 0.0
    seconds: float = 0.0
    sandbox_seconds: float = 0.0
    run_id: str = ""
    error: str | None = None
    trace_url: str | None = None
    status: str | None = None  # agent's final status (graph agents)
    confidence: str | None = None
    review_verdicts: list[str] = field(default_factory=list)
    fix_attempts: int = 0
    final_outcome: str | None = None
    stop_reason: str | None = None
    oracle_shape: bool = False  # the oracle asserts the real fix's shape
    human_fix_pass: bool | None = None  # human verdict on this run's patch, if given
    note: str = ""  # the case's report_note and any human note for this run

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class Metrics:
    cases: int = 0
    bugs: int = 0
    clean: int = 0
    detected: int = 0
    missed: int = 0
    false_alarms: int = 0
    repro_attempted: int = 0
    repro_valid: int = 0
    fix_attempted: int = 0
    fix_pass: int = 0
    fix_pass_adjusted: int = 0  # oracle, except human review for oracle_shape
    fix_adjusted_attempted: int = 0
    fix_pending_human: int = 0
    safe_over_escalations: int = 0  # expected fix, escalated by the topic rule
    wrong_escalations: int = 0  # expected fix, escalated for any other reason
    escalate_expected: int = 0
    escalate_correct: int = 0
    errors: int = 0
    tokens: int = 0
    cost_usd: float = 0.0
    seconds: float = 0.0
    sandbox_seconds: float = 0.0

    def rates(self) -> dict[str, float | None]:
        def rate(n: int, d: int) -> float | None:
            return round(n / d, 3) if d else None

        return {
            "detection": rate(self.detected, self.bugs),
            "false_alarm": rate(self.false_alarms, self.clean),
            "reproduction": rate(self.repro_valid, self.repro_attempted),
            "fix_pass": rate(self.fix_pass, self.fix_attempted),
            "fix_pass_adjusted": rate(
                self.fix_pass_adjusted, self.fix_adjusted_attempted
            ),
            "escalation_correct": rate(self.escalate_correct, self.escalate_expected),
            "error": rate(self.errors, self.cases),
        }

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["rates"] = self.rates()
        return d


def aggregate(results: Iterable[CaseResult]) -> dict[str, Metrics]:
    """``{"total": Metrics, "<app>": Metrics, …}``."""
    groups: dict[str, Metrics] = defaultdict(Metrics)
    for r in results:
        for key in ("total", r.app):
            m = groups[key]
            m.cases += 1
            m.tokens += r.tokens
            m.cost_usd += r.cost_usd
            m.seconds += r.seconds
            m.sandbox_seconds += r.sandbox_seconds
            if r.outcome == "error":
                m.errors += 1
            if r.kind == "bug":
                m.bugs += 1
                if r.outcome in (
                    "detected",
                    "escalated",
                    "escalated_correctly",
                    "escalated_acceptably",
                    "escalated_safe",
                ):
                    m.detected += 1
                if r.outcome == "escalated_safe":
                    m.safe_over_escalations += 1
                if r.outcome == "escalated":
                    m.wrong_escalations += 1
                if r.outcome == "escalated_acceptably":
                    # a bug unit tests cannot show, escalated with the right diagnosis:
                    # a correct escalation. Fix pass counts only cases that produced
                    # a fix (oracle_pass set); an escalation produced none.
                    m.escalate_expected += 1
                    m.escalate_correct += 1
                elif r.outcome == "missed":
                    m.missed += 1
                if r.expected == "escalate":
                    m.escalate_expected += 1
                    if r.outcome == "escalated_correctly":
                        m.escalate_correct += 1
                if r.repro_valid is not None:
                    m.repro_attempted += 1
                    m.repro_valid += int(r.repro_valid)
                if r.oracle_pass is not None:
                    m.fix_attempted += 1
                    m.fix_pass += int(r.oracle_pass)
                    if r.oracle_shape:
                        if r.human_fix_pass is None:
                            m.fix_pending_human += 1
                        else:
                            m.fix_adjusted_attempted += 1
                            m.fix_pass_adjusted += int(r.human_fix_pass)
                    else:
                        m.fix_adjusted_attempted += 1
                        m.fix_pass_adjusted += int(r.oracle_pass)
            else:
                m.clean += 1
                if r.outcome == "false_alarm":
                    m.false_alarms += 1
    groups.setdefault("total", Metrics())
    return dict(groups)


def _pct(value: float | None) -> str:
    return "–" if value is None else f"{value:.0%}"


def render_markdown(report: dict[str, Any]) -> str:
    meta = report["meta"]
    lines = [
        f"# Eval report: {meta['agent']} · {meta['mode']} mode",
        "",
        f"- repo: `{meta['git_sha'][:12]}` · prompts: {meta['prompt_versions']} "
        f"· models: {meta['models']}",
        f"- run at {meta['timestamp']} · cases: {meta['cases']} "
        f"· stopped: {meta.get('stopped_reason') or 'no (completed)'}",
        "",
        "| Scope | Cases | Bugs | Clean | Detection | False alarm | Repro | Fix pass "
        "| Escalation | Errors | Tokens | Cost | Agent s | Sandbox s |",
        "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    metrics = report["metrics"]
    for scope in ["total"] + sorted(k for k in metrics if k != "total"):
        m = metrics[scope]
        r = m["rates"]
        lines.append(
            f"| {scope} | {m['cases']} | {m['bugs']} | {m['clean']} "
            f"| {_pct(r['detection'])} | {_pct(r['false_alarm'])} "
            f"| {_pct(r['reproduction'])} | {_pct(r['fix_pass'])} "
            f"| {_pct(r['escalation_correct'])} | {m['errors']} "
            f"| {m['tokens']} | ${m['cost_usd']:.2f} | {m['seconds']:.0f} "
            f"| {m['sandbox_seconds']:.0f} |"
        )
    lines += [
        "",
        "## Cases",
        "",
        "| id | kind | expected | outcome | repro | oracle | review | fix tries "
        "| ended as | tokens | cost | s | trace | error / stop reason |",
        "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    verdict_totals: dict[str, int] = {}
    ending_totals: dict[str, int] = {}
    for c in report["cases"]:
        yes_no = lambda v: "–" if v is None else ("yes" if v else "no")  # noqa: E731
        trace = f"[trace]({c['trace_url']})" if c.get("trace_url") else "–"
        verdicts = c.get("review_verdicts") or []
        for v in verdicts:
            verdict_totals[v] = verdict_totals.get(v, 0) + 1
        ended = c.get("final_outcome") or "–"
        if c.get("final_outcome"):
            ending_totals[ended] = ending_totals.get(ended, 0) + 1
        note = c.get("error") or (c.get("stop_reason") if ended == "escalated" else "")
        lines.append(
            f"| `{c['id']}` | {c['kind']} | {c['expected']} | {c['outcome']} "
            f"| {yes_no(c['repro_valid'])} | {yes_no(c['oracle_pass'])} "
            f"| {', '.join(verdicts) or '–'} | {c.get('fix_attempts') or 0} | {ended} "
            f"| {c['tokens']} | ${c['cost_usd']:.3f} | {c['seconds']:.0f} | {trace} "
            f"| {(note or '')[:80]} |"
        )
    notes = [(c["id"], c.get("note")) for c in report["cases"] if c.get("note")]
    if notes:
        lines += ["", "Notes:"] + [f"- `{cid}`: {note}" for cid, note in notes]
    if verdict_totals or ending_totals:
        lines += [
            "",
            "Review verdicts: "
            + (
                ", ".join(f"{k} {v}" for k, v in sorted(verdict_totals.items()))
                or "none"
            )
            + " · Ended as: "
            + (
                ", ".join(f"{k} {v}" for k, v in sorted(ending_totals.items()))
                or "none"
            ),
        ]
    if meta.get("shards"):
        lines += [
            "",
            "| Shard | Cases | Cost | Minutes | Stopped |",
            "|---|---|---|---|---|",
        ]
        for sh in meta["shards"]:
            lines.append(
                f"| {sh['shard']} | {sh['cases']} | ${(sh['cost_usd'] or 0):.2f} "
                f"| {sh['minutes'] if sh['minutes'] is not None else '–'} "
                f"| {sh['stopped_reason'] or ('partial' if sh['partial'] else 'no')} |"
            )
    total = metrics["total"]
    if total.get("safe_over_escalations") or total.get("wrong_escalations"):
        lines += [
            "",
            f"Escalations of expected-fix cases: safe over-escalation (topic rule) "
            f"{total['safe_over_escalations']}, wrong {total['wrong_escalations']}",
        ]
    if total["fix_attempted"]:
        lines += [
            "",
            f"Fix pass: oracle {total['fix_pass']}/{total['fix_attempted']}; "
            f"adjusted (human review for oracle_shape cases) "
            f"{total['fix_pass_adjusted']}/{total['fix_adjusted_attempted']}"
            + (
                f", {total['fix_pending_human']} pending human review"
                if total["fix_pending_human"]
                else ""
            ),
        ]
    if meta.get("spend_today_usd") is not None:
        lines += [
            "",
            "Today's model spend on this machine: "
            f"${meta['spend_today_usd']:.2f} of the "
            f"${meta['spend_daily_cap_usd']:.0f} daily cap (runs/spend.json)",
        ]
    if meta.get("spend_note"):
        lines += ["", meta["spend_note"]]
    if meta.get("cost_cap_usd") is not None:
        lines += [
            "",
            f"Cost: ${meta.get('cost_usd_total', 0):.2f} of the "
            f"${meta['cost_cap_usd']:.2f} "
            f"cap · cases done {meta.get('cases_done', len(report['cases']))}"
            f" · remaining {meta.get('cases_remaining', 0)}",
        ]
    return "\n".join(lines)
