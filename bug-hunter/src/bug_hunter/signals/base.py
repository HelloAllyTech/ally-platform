"""What every signal source produces: a ``Candidate`` for one graph run."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Literal

Source = Literal["ci_failure", "issue", "error_log", "commit_sweep"]
# dispatch order (spec §12 / chunk 08): CI failures and staff/user reports first
PRIORITY: dict[str, int] = {
    "ci_failure": 0,
    "issue": 1,
    "error_log": 2,
    "commit_sweep": 3,
}


@dataclass
class Candidate:
    source: str  # Source
    app: str
    key: str  # dedupe key, stable across days ("ci:<run>", "issue:<n>", "log:<sig>")
    title: str
    summary: str  # scrubbed; becomes Signal.raw_summary (quoted when enabled)
    ref: str  # commit SHA, run id, issue number, signature
    reported_by: str  # agent | ci | monitoring | staff | user
    severity_hint: str = "medium"
    extra: dict[str, Any] = field(default_factory=dict)

    @property
    def priority(self) -> int:
        return PRIORITY.get(self.source, 9)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)
