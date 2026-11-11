"""One run's spend and trace, shared by the main agent and its subagents.

Built per run and closed over by the run's middleware, so a subagent's model calls
count against the same budget and land in the same step records as the main agent's.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, Dict, List

from app.core.debrief_graph.budget import budget_left
from app.core.debrief_graph.records import iso


def now_ms() -> float:
    return time.time() * 1000


@dataclass
class RunLedger:
    run_id: str
    budget_usd: float
    prices: Dict[str, Dict[str, float]]
    spent_usd: float = 0.0
    last_call_usd: float = 0.0
    steps: List[Dict[str, Any]] = field(default_factory=list)
    idea_ids: List[str] = field(default_factory=list)
    refusals: List[Dict[str, str]] = field(default_factory=list)
    models_used: List[str] = field(default_factory=list)
    stopped_for_budget: bool = False

    @property
    def exhausted(self) -> bool:
        return self.spent_usd >= self.budget_usd

    def cannot_afford_another(self) -> bool:
        """Spent, or another call like the last one would go over: stop before
        it, so a run ends within its budget rather than one call past it."""
        return self.exhausted or self.spent_usd + self.last_call_usd > self.budget_usd

    def left(self) -> float:
        return budget_left(self.budget_usd, self.spent_usd)

    def record(self, started_ms: float, **fields: Any) -> Dict[str, Any]:
        rec = {
            "startedAt": iso(started_ms),
            "ms": round(now_ms() - started_ms),
            **fields,
            "budgetLeftUsd": self.left(),
        }
        self.steps.append(rec)
        return rec
