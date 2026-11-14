"""The run's read-only inputs, handed to every node as LangGraph runtime context.

Nothing here is checkpointed: a resumed run is given its inputs again by the
resume request, with a fresh clock (a resumed run gets a fresh deadline, as in
ally-be's runner).
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional

from app.core.debrief_graph.gateway import Gateway
from app.core.debrief_graph.step_functions import StepRunner


def now_ms() -> float:
    return time.time() * 1000


def _camel(key: str) -> str:
    head, *rest = key.split("_")
    return head + "".join(p.title() for p in rest)


@dataclass
class DebriefRunContext:
    run_id: str
    session_id: str
    bundle: Dict[str, Any]
    prompts: Dict[str, str]
    ceiling_usd: float
    prices: Dict[str, Dict[str, Any]]
    session: Dict[str, Any]
    transcript: List[Dict[str, Any]]
    inputs: Dict[str, Any]  # the request's `context` block
    steps: StepRunner
    gateway: Gateway
    resumed: bool = False
    clock: Callable[[], float] = now_ms
    started_at: float = 0.0
    #: Per-invocation scratch for a step node's attempts (the model order chosen
    #: on the first attempt and the failed attempts' records). Lost with the
    #: process, which only means a resumed step starts its attempts afresh.
    attempts: Dict[str, Dict[str, Any]] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.started_at:
            self.started_at = self.clock()

    # --- the session, in ally-be's snake_case or camelCase -------------------

    def sess(self, key: str, default: Any = None) -> Any:
        if key in self.session:
            return self.session[key]
        return self.session.get(_camel(key), default)

    @property
    def language(self) -> str:
        return self.sess("language") or "en"

    @property
    def settings(self) -> Dict[str, Any]:
        return self.bundle.get("settings") or {}

    def setting(self, key: str, default: Any = None) -> Any:
        return self.settings.get(key, default)

    # --- the recipe -----------------------------------------------------------

    def recipe(self, key: str) -> Dict[str, Any]:
        return self.bundle["recipes"][key]

    def step_of(self, recipe_key: str, step: str) -> Optional[Dict[str, Any]]:
        return next(
            (s for s in self.recipe(recipe_key)["steps"] if s.get("step") == step),
            None,
        )

    def prompt(self, code: str) -> Optional[str]:
        return self.prompts.get(code)

    # --- the transcript and the clock ----------------------------------------

    @property
    def transcript_chars(self) -> int:
        return sum(len(t.get("text") or "") for t in self.transcript)

    @property
    def turns_line(self) -> str:
        from app.core.debrief_graph.narration import n

        return f"the transcript ({n(len(self.transcript), 'turn')})"

    def deadline_ms(self, has_risk_cue: bool) -> float:
        return float(
            self.setting("riskDeadlineMs" if has_risk_cue else "deadlineMs", 150_000)
        )

    def time_left_ms(self, has_risk_cue: bool) -> float:
        return self.deadline_ms(has_risk_cue) - (self.clock() - self.started_at)
