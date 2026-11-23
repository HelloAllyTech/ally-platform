"""Production error signals (spec §12): one CloudWatch Logs Insights query per log
group per day, grouped by error signature in code. A signature becomes a signal when
it is **new** (not in the 7-day baseline) or **spiking** (today >= factor x its daily
mean), and has a stack frame in the app's own code.

Production logs can carry personal and health data: every message is scrubbed before
it is kept, and only the normalised signature, counts and one scrubbed example are
stored. Nothing is printed to any log.
"""

from __future__ import annotations

import hashlib
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Protocol

from bug_hunter.safety.phi import scrub
from bug_hunter.signals.base import Candidate
from bug_hunter.signals.state import SignalState

QUERY = (
    "fields @message | filter @message like /ERROR|Error|Exception|Traceback/ "
    "| stats count(*) as count by @message | sort count desc | limit 500"
)
BASELINE_DAYS = 7
# frames in the app's own code (not node_modules / site-packages)
APP_FRAME = {
    "ally-be": re.compile(r"\(?/?(?:app/)?(?:dist/)?src/[\w/.-]+\.(?:ts|js):\d+"),
    "ally-ai": re.compile(r"\[app\.[\w.]+\]|\bapp/[\w/]+\.py"),
    "ally-ai-learn": re.compile(r"\[app\.[\w.]+\]|\bapp/[\w/]+\.py"),
}
_NOISE = [
    (re.compile(r"\[?\d{4}-\d\d-\d\d[T ][\d:.]+(?:\+\d{4}|Z)?\]?"), "<ts>"),
    (
        re.compile(r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b"),
        "<id>",
    ),
    (re.compile(r"(?i)TraceID:[^\]\s]+"), "TraceID:<id>"),
    (re.compile(r"\b0x[0-9a-f]+\b"), "<hex>"),
    (re.compile(r"\d+"), "<n>"),
    (re.compile(r"'[^']{0,200}'|\"[^\"]{0,200}\""), "<str>"),
]


class LogsClient(Protocol):
    def query(
        self, log_group: str, query: str, start: datetime, end: datetime
    ) -> list[dict[str, Any]]:
        """Logs Insights rows as ``{"@message": str, "count": str|int}``."""
        ...


def signature(message: str) -> str:
    """The message's first line with ids, numbers, strings and times normalised."""
    first = scrub(message).splitlines()[0] if message else ""
    for rx, repl in _NOISE:
        first = rx.sub(repl, first)
    return " ".join(first.split())[:240]


def sig_key(app: str, sig: str) -> str:
    return f"log:{app}:" + hashlib.sha1(sig.encode()).hexdigest()[:12]


def collect(
    client: LogsClient,
    state: SignalState,
    log_groups: dict[str, list[str]],
    apps: list[str],
    spike_factor: float = 3.0,
    min_count: int = 5,
    now: datetime | None = None,
) -> tuple[list[Candidate], dict[str, Any]]:
    """Candidates for the last day, and the baseline updates to save after dispatch."""
    now = now or datetime.now(timezone.utc)
    start = now - timedelta(days=1)
    day = now.date().isoformat()
    out: list[Candidate] = []
    updates: dict[str, Any] = {}
    for app in apps:
        groups = log_groups.get(app) or []
        frame = APP_FRAME.get(app)
        if not groups or frame is None:
            continue
        counts: dict[str, int] = {}
        example: dict[str, str] = {}
        for group in groups:
            for row in client.query(group, QUERY, start, now):
                msg = str(row.get("@message", ""))
                if not frame.search(msg):
                    continue  # no frame in the app's code: library or infra noise
                sig = signature(msg)
                counts[sig] = counts.get(sig, 0) + int(row.get("count", 1) or 1)
                example.setdefault(sig, scrub(msg)[:1500])
        key = f"error_logs:baseline:{app}"
        baseline: dict[str, dict[str, int]] = state.get(key) or {}
        for sig, today in counts.items():
            history = {
                d: n
                for d, n in (baseline.get(sig) or {}).items()
                if d != day
                and d >= (now - timedelta(days=BASELINE_DAYS)).date().isoformat()
            }
            mean = sum(history.values()) / BASELINE_DAYS if history else 0.0
            new = not history
            spiking = today >= min_count and today >= spike_factor * max(mean, 1e-9)
            if new or spiking:
                why = "new" if new else f"spiking ({today} vs {mean:.1f}/day)"
                out.append(
                    Candidate(
                        source="error_log",
                        app=app,
                        key=sig_key(app, sig),
                        title=f"{why} production error in {app}: {sig[:120]}",
                        summary=(
                            f"A {why} error signature in {app}'s production logs: "
                            f"{today} occurrence(s) in the last day.\n\nSignature: "
                            f"{sig}\n\nOne example (scrubbed):\n{example[sig]}"
                        ),
                        ref=sig_key(app, sig),
                        reported_by="monitoring",
                        severity_hint="high" if spiking and not new else "medium",
                        extra={"count": today, "mean_7d": round(mean, 2), "new": new},
                    )
                )
        merged = {
            sig: {**(baseline.get(sig) or {}), day: n} for sig, n in counts.items()
        }
        # keep every known signature's recent days; drop days older than the window
        cutoff = (now - timedelta(days=BASELINE_DAYS + 1)).date().isoformat()
        for sig, days in baseline.items():
            merged.setdefault(sig, days)
        updates[key] = {
            sig: {d: n for d, n in days.items() if d >= cutoff}
            for sig, days in merged.items()
            if any(d >= cutoff for d in days)
        }
    return out, updates
