"""Simulated trainees for roleplay v2 rehearsals.

Each profile is a small system prompt (app/prompts/trainee/*.txt) layered on
a shared base. The trainee LLM sees the conversation from the TRAINEE's
perspective (client turns as HumanMessage, its own as AIMessage) — the mirror
of the actor's view, same role-flip the scenario-report counselor uses.

A lightweight Jaccard repetition check (adapted from
app/core/scenario_report/service.py) appends the stagnation-steering prompt
when the trainee starts looping.
"""

from __future__ import annotations

from typing import Any, List, Optional

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

from app.core.constants import get_language_name_from_code
from app.core.logger import get_logger
from app.prompts.resolver import load_and_format, load_template
from app.roleplay_v2.spec.models import ScenarioSpec

logger = get_logger(__name__)

PROFILE_TEMPLATES = {
    "SKILLED": "trainee/skilled",
    "POOR": "trainee/poor",
    "ADVERSARIAL": "trainee/adversarial",
    "CONDITION_DRIVEN": "trainee/condition_driven",
}

_REPETITION_JACCARD_THRESHOLD = 0.5
_REPETITION_LOOKBACK = 3
_MAX_CONTEXT_MESSAGES = 20


def _format_helpful_behaviors(spec: ScenarioSpec) -> str:
    lines: List[str] = []
    for behavior in spec.rubric.behaviors:
        if behavior.polarity != "helpful":
            continue
        line = f"- {behavior.name}: {behavior.description}"
        if behavior.examples:
            line += f' (e.g. "{behavior.examples[0]}")'
        lines.append(line)
    return "\n".join(lines) or "- (no helpful behaviors defined)"


class SimulatedTrainee:
    """Stateful scripted trainee: feed it client lines, get trainee lines."""

    def __init__(
        self,
        profile: str,
        llm: Any,
        spec: ScenarioSpec,
        *,
        prompt_data: Any = None,
        condition: Optional[str] = None,
    ) -> None:
        profile = profile.upper()
        if profile not in PROFILE_TEMPLATES:
            raise ValueError(
                f"Unknown trainee profile {profile!r}; "
                f"expected one of {sorted(PROFILE_TEMPLATES)}"
            )
        if profile == "CONDITION_DRIVEN" and not (condition or "").strip():
            raise ValueError("CONDITION_DRIVEN trainee requires a non-empty condition")
        self.profile = profile
        self._llm = llm

        language_code = spec.language_code
        base = load_and_format(
            "trainee/base",
            prompt_data=prompt_data,
            scenario_title=spec.title,
            competency=spec.competency_label or "general counseling skills",
            language_label=(
                f"{get_language_name_from_code(language_code)} ({language_code})"
            ),
        ).strip()
        profile_prompt = load_and_format(
            PROFILE_TEMPLATES[profile],
            prompt_data=prompt_data,
            helpful_behaviors=_format_helpful_behaviors(spec),
            condition=condition or "",
        ).strip()
        self._system_prompt = f"{base}\n\n{profile_prompt}"
        self._steering = (
            load_template("trainee/stagnation_steering", prompt_data) or ""
        ).strip()

        # Trainee-perspective history: Human = client, AI = this trainee.
        self._messages: List[Any] = []

    @property
    def system_prompt(self) -> str:
        return self._system_prompt

    def _is_stagnating(self) -> bool:
        """True when the last N trainee turns are pairwise similar (Jaccard)."""
        own = [m.content.lower() for m in self._messages if isinstance(m, AIMessage)]
        if len(own) < _REPETITION_LOOKBACK:
            return False
        recent = own[-_REPETITION_LOOKBACK:]
        for i in range(len(recent) - 1):
            a, b = set(recent[i].split()), set(recent[i + 1].split())
            if not a or not b:
                return False
            if len(a & b) / len(a | b) < _REPETITION_JACCARD_THRESHOLD:
                return False
        return True

    async def respond(self, client_text: str) -> str:
        """Consume the client's latest line and produce the trainee's reply."""
        self._messages.append(HumanMessage(content=client_text))

        system_content = self._system_prompt
        if self._is_stagnating() and self._steering:
            system_content += "\n\n" + self._steering
            logger.debug(
                "[roleplay_v2] trainee %s stagnating — steering injected",
                self.profile,
            )

        window = self._messages[-_MAX_CONTEXT_MESSAGES:]
        response = await self._llm.ainvoke(
            [SystemMessage(content=system_content), *window]
        )
        content = getattr(response, "content", response)
        text = content if isinstance(content, str) else str(content)
        text = text.strip()
        self._messages.append(AIMessage(content=text))
        return text
