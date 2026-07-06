"""Hybrid judge for roleplay v2 rehearsals.

An LLM judge scores each rehearsal run (persona consistency, disclosure
discipline, difficulty calibration, rubric coverage) from the full spec —
INCLUDING locked secrets — plus the transcript interleaved with Director
decisions. Two deterministic checks then OVERRIDE the LLM where they can be
computed exactly:

- Leak detection: case-insensitive containment of a secret's content (whole
  text or any substantial sentence of it) in a CLIENT turn at or before the
  turn the Director unlocked it. Deterministic leaks are merged into the
  LLM's list and cap disclosure_discipline; an LLM claiming "no leaks"
  cannot outvote a verbatim leak, while the LLM may still ADD paraphrase
  leaks the containment check can't see.
- Rubric coverage (SKILLED run only): fraction of the rubric's HELPFUL
  behaviors the Director observed at least once. Helpful-only on purpose —
  a skilled trainee is not supposed to trigger the unhelpful behaviors, so
  counting them would cap a perfect run below 100.
"""

from __future__ import annotations

import json
import re
from typing import Any, Dict, List, Optional, Sequence

from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel, Field, field_validator

from app.core.logger import get_logger
from app.prompts.resolver import load_template
from app.roleplay_v2.rehearsal.schemas import TranscriptTurn
from app.roleplay_v2.spec.models import ScenarioSpec

logger = get_logger(__name__)

# A sentence of secret content this long is distinctive enough that verbatim
# containment in a client turn is a leak, not coincidence.
_MIN_LEAK_FRAGMENT_CHARS = 25


class SecretLeak(BaseModel):
    item_id: str
    leaked_while_locked: bool = True
    evidence: str = ""
    turn_index: int = -1


class RehearsalSessionJudgement(BaseModel):
    """Structured judge output for one profile run (json_mode target)."""

    persona_consistency: int = 0
    disclosure_discipline: int = 0
    difficulty_calibration: int = 0
    rubric_coverage: int = 0
    secret_leaks: List[SecretLeak] = Field(default_factory=list)
    state_path_plausible: bool = True
    critique_markdown: str = ""

    @field_validator(
        "persona_consistency",
        "disclosure_discipline",
        "difficulty_calibration",
        "rubric_coverage",
    )
    @classmethod
    def _clamp(cls, v: int) -> int:
        return max(0, min(100, int(v)))

    def dimension_scores(self) -> Dict[str, int]:
        return {
            "persona_consistency": self.persona_consistency,
            "disclosure_discipline": self.disclosure_discipline,
            "difficulty_calibration": self.difficulty_calibration,
            "rubric_coverage": self.rubric_coverage,
        }


# ---------------------------------------------------------------------------
# Deterministic checks
# ---------------------------------------------------------------------------


def _normalize(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "")).strip().lower()


def _leak_fragments(content: str) -> List[str]:
    """The whole secret plus each substantial sentence of it."""
    whole = _normalize(content)
    fragments = [whole] if whole else []
    for sentence in re.split(r"(?<=[.!?])\s+", content or ""):
        normalized = _normalize(sentence)
        if len(normalized) >= _MIN_LEAK_FRAGMENT_CHARS and normalized != whole:
            fragments.append(normalized)
    return fragments


def _unlock_turns(director_trace: Sequence[Dict[str, Any]]) -> Dict[str, int]:
    unlocks: Dict[str, int] = {}
    for entry in director_trace or []:
        if entry.get("type") == "director_disclosure_unlock":
            secret_id = entry.get("secret_id")
            if secret_id is not None and secret_id not in unlocks:
                unlocks[secret_id] = int(entry.get("turn_index", -1))
    return unlocks


def detect_secret_leaks(
    spec: ScenarioSpec,
    transcript: Sequence[TranscriptTurn],
    director_trace: Sequence[Dict[str, Any]],
) -> List[SecretLeak]:
    """Deterministic leak scan: secret content in CLIENT turns while locked.

    A secret counts as locked in turn N when it was never unlocked, or when
    N <= its unlock turn (the unlock verdict lands AFTER the actor spoke that
    turn, so same-turn content was generated under lock).
    """
    unlock_turns = _unlock_turns(director_trace)
    leaks: List[SecretLeak] = []
    for secret in spec.disclosure_ledger.secrets:
        fragments = _leak_fragments(secret.content)
        if not fragments:
            continue
        unlocked_at = unlock_turns.get(secret.id)
        for turn in transcript:
            if turn.role != "CLIENT":
                continue
            if unlocked_at is not None and turn.turn_index > unlocked_at:
                continue  # legally unlocked by then
            haystack = _normalize(turn.content)
            if any(fragment in haystack for fragment in fragments):
                leaks.append(
                    SecretLeak(
                        item_id=secret.id,
                        leaked_while_locked=True,
                        evidence=turn.content[:300],
                        turn_index=turn.turn_index,
                    )
                )
                break  # one deterministic finding per secret is enough
    return leaks


def compute_rubric_coverage(
    spec: ScenarioSpec, director_trace: Sequence[Dict[str, Any]]
) -> int:
    """% of HELPFUL rubric behaviors the Director observed at least once."""
    helpful = [b.id for b in spec.rubric.behaviors if b.polarity == "helpful"]
    if not helpful:
        return 0
    observed: set[str] = set()
    for entry in director_trace or []:
        if entry.get("type") == "director_rubric_score":
            for score in entry.get("scores", []):
                observed.add(score.get("behavior_id"))
    covered = sum(1 for b in helpful if b in observed)
    return round(100 * covered / len(helpful))


# ---------------------------------------------------------------------------
# LLM judge + hybrid merge
# ---------------------------------------------------------------------------


def _build_judge_user_message(
    profile: str,
    transcript: Sequence[TranscriptTurn],
    director_trace: Sequence[Dict[str, Any]],
) -> str:
    # Interleave Director decisions after each turn they belong to.
    by_turn: Dict[int, List[Dict[str, Any]]] = {}
    for entry in director_trace or []:
        by_turn.setdefault(int(entry.get("turn_index", -1)), []).append(entry)

    lines: List[str] = [f"Trainee profile for this run: {profile}", "", "TRANSCRIPT:"]
    seen_turns: set[int] = set()
    for turn in transcript:
        lines.append(f"[turn {turn.turn_index}] {turn.role}: {turn.content}")
        if turn.role == "CLIENT" and turn.turn_index not in seen_turns:
            seen_turns.add(turn.turn_index)
            for entry in by_turn.get(turn.turn_index, []):
                details = {k: v for k, v in entry.items() if k != "type"}
                lines.append(
                    f"    >> DIRECTOR {entry.get('type')}: "
                    f"{json.dumps(details, ensure_ascii=False)}"
                )
    summaries = [
        e for e in (director_trace or []) if e.get("type") == "roleplay_session_summary"
    ]
    if summaries:
        lines.append("")
        lines.append(
            f"SESSION SUMMARY: {json.dumps(summaries[-1], ensure_ascii=False)}"
        )
    lines.append("")
    lines.append("Score this run and return the JSON verdict.")
    return "\n".join(lines)


async def judge_session(
    spec: ScenarioSpec,
    profile: str,
    transcript: Sequence[TranscriptTurn],
    director_trace: Sequence[Dict[str, Any]],
    judge_llm: Any,
    *,
    prompt_data: Any = None,
) -> RehearsalSessionJudgement:
    """LLM-judge one run, then apply the deterministic overrides."""
    base = (load_template("judge/system", prompt_data) or "").strip()
    spec_json = json.dumps(
        spec.model_dump(by_alias=True, exclude={"ui"}),
        indent=2,
        ensure_ascii=False,
    )
    system_prompt = (
        f"{base}\n\n## Scenario specification (JSON, including locked secrets)\n"
        f"{spec_json}"
    )
    user_message = _build_judge_user_message(profile, transcript, director_trace)

    judgement: Optional[RehearsalSessionJudgement] = None
    try:
        structured = judge_llm.with_structured_output(
            RehearsalSessionJudgement, method="json_mode"
        )
        result = await structured.ainvoke(
            [
                SystemMessage(content=system_prompt),
                HumanMessage(content=user_message),
            ]
        )
        if isinstance(result, RehearsalSessionJudgement):
            judgement = result
        elif isinstance(result, dict):
            judgement = result.get(
                "parsed"
            ) or RehearsalSessionJudgement.model_validate(result)
    except Exception:
        logger.exception("[roleplay_v2] LLM judge failed; deterministic-only scores")
    if judgement is None:
        judgement = RehearsalSessionJudgement(
            critique_markdown=(
                "LLM judge unavailable — deterministic checks only for this run."
            )
        )

    # ---- Hybrid overrides (deterministic wins on conflict) ----

    det_leaks = detect_secret_leaks(spec, transcript, director_trace)
    if det_leaks:
        known = {(leak.item_id, leak.turn_index) for leak in judgement.secret_leaks}
        for leak in det_leaks:
            if (leak.item_id, leak.turn_index) not in known:
                judgement.secret_leaks.append(leak)
        total_secrets = max(1, len(spec.disclosure_ledger.secrets))
        leaked_ids = {leak.item_id for leak in det_leaks}
        deterministic_discipline = round(100 * (1 - len(leaked_ids) / total_secrets))
        if judgement.disclosure_discipline > deterministic_discipline:
            logger.info(
                "[roleplay_v2] judge override: disclosure_discipline %d → %d "
                "(deterministic leak check found %d leaked secret(s))",
                judgement.disclosure_discipline,
                deterministic_discipline,
                len(leaked_ids),
            )
            judgement.disclosure_discipline = deterministic_discipline

    if profile.upper() == "SKILLED":
        deterministic_coverage = compute_rubric_coverage(spec, director_trace)
        if judgement.rubric_coverage != deterministic_coverage:
            logger.info(
                "[roleplay_v2] judge override: rubric_coverage %d → %d "
                "(deterministic, SKILLED run)",
                judgement.rubric_coverage,
                deterministic_coverage,
            )
            judgement.rubric_coverage = deterministic_coverage

    return judgement
