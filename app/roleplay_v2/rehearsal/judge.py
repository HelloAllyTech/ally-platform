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
from statistics import mean
from typing import Any, Dict, List, Optional, Sequence

from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel, Field, field_validator

from app.core.logger import get_logger
from app.prompts.resolver import load_template
from app.roleplay_v2.rehearsal.schemas import (
    RehearsalTestCase,
    RubricCriterionScore,
    TestVerdict,
    TranscriptTurn,
)
from app.roleplay_v2.spec import secret_matching
from app.roleplay_v2.spec.models import ScenarioSpec

logger = get_logger(__name__)


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


class TestCaseEvaluation(BaseModel):
    """Structured evaluator output for one agent test case (json_mode target)."""

    __test__ = False  # name matches pytest's Test* pattern; not a test class

    condition_recreated: bool = False
    verdict: TestVerdict = "INCONCLUSIVE"
    evidence: str = ""
    reasoning: str = ""
    # Set in code when the judge LLM call fell back; never trusted from the LLM.
    judge_failed: bool = False


class FullSessionEvaluation(BaseModel):
    """Structured evaluator output for one full_session case (json_mode target)."""

    rubric_scores: List[RubricCriterionScore] = Field(default_factory=list)
    overall_score: int = 0
    summary_markdown: str = ""
    # Set in code when the judge LLM call fell back; never trusted from the LLM.
    judge_failed: bool = False


# ---------------------------------------------------------------------------
# Deterministic checks
# ---------------------------------------------------------------------------


# Shared with the live Director leak guard so the two never drift (see
# app/roleplay_v2/spec/secret_matching.py).
_normalize = secret_matching.normalize_text
_leak_fragments = secret_matching.leak_fragments


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
    *,
    include_closing: bool = True,
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
    if include_closing:
        lines.append("")
        lines.append("Score this run and return the JSON verdict.")
    return "\n".join(lines)


async def _invoke_judge_once(
    judge_llm: Any, system_prompt: str, user_message: str
) -> Optional[RehearsalSessionJudgement]:
    """One judge LLM call → parsed judgement, or None on failure."""
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
            return result
        if isinstance(result, dict):
            return result.get("parsed") or RehearsalSessionJudgement.model_validate(
                result
            )
    except Exception:
        logger.exception("[roleplay_v2] LLM judge call failed")
    return None


def _mean_int(values: Sequence[int]) -> int:
    return round(sum(values) / len(values)) if values else 0


async def judge_session(
    spec: ScenarioSpec,
    profile: str,
    transcript: Sequence[TranscriptTurn],
    director_trace: Sequence[Dict[str, Any]],
    judge_llm: Any,
    *,
    prompt_data: Any = None,
    samples: Optional[int] = None,
) -> RehearsalSessionJudgement:
    """LLM-judge one run, then apply the deterministic overrides.

    The two soft dimensions (persona_consistency, difficulty_calibration) have
    no deterministic backstop, so they are the noisiest single-shot scores.
    When ``samples`` (or settings.REHEARSAL_JUDGE_SAMPLES) > 1, the judge is
    called that many times and those two dimensions are averaged; every other
    field comes from the first successful sample.
    """
    from app.core.config import settings

    n_samples = max(
        1,
        int(
            samples
            if samples is not None
            else getattr(settings, "REHEARSAL_JUDGE_SAMPLES", 1)
        ),
    )

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

    samples_out: List[RehearsalSessionJudgement] = []
    for _ in range(n_samples):
        one = await _invoke_judge_once(judge_llm, system_prompt, user_message)
        if one is not None:
            samples_out.append(one)

    judgement: Optional[RehearsalSessionJudgement] = (
        samples_out[0] if samples_out else None
    )
    if judgement is None:
        logger.warning(
            "[roleplay_v2] LLM judge produced no usable sample; deterministic-only"
        )
        judgement = RehearsalSessionJudgement(
            critique_markdown=(
                "LLM judge unavailable — deterministic checks only for this run."
            )
        )
    elif len(samples_out) > 1:
        # Average the two backstop-less soft dimensions across samples.
        judgement.persona_consistency = _mean_int(
            [s.persona_consistency for s in samples_out]
        )
        judgement.difficulty_calibration = _mean_int(
            [s.difficulty_calibration for s in samples_out]
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


async def evaluate_test_case(
    spec: ScenarioSpec,
    test_case: RehearsalTestCase,
    transcript: Sequence[TranscriptTurn],
    director_trace: Sequence[Dict[str, Any]],
    judge_llm: Any,
    *,
    prompt_data: Any = None,
) -> TestCaseEvaluation:
    """LLM-evaluate one agent test case, then apply deterministic coercions.

    Judges the RUNTIME (actor + director), not the trainee — the trainee was
    a scripted CONDITION_DRIVEN profile tasked with provoking the condition.
    A condition that never materialised deterministically forces INCONCLUSIVE
    regardless of the LLM's claimed verdict.
    """
    base = (load_template("judge/test_case", prompt_data) or "").strip()
    spec_json = json.dumps(
        spec.model_dump(by_alias=True, exclude={"ui"}),
        indent=2,
        ensure_ascii=False,
    )
    system_prompt = (
        f"{base}\n\n## Scenario specification (JSON, including locked secrets)\n"
        f"{spec_json}"
    )
    transcript_block = _build_judge_user_message(
        "CONDITION_DRIVEN", transcript, director_trace, include_closing=False
    )
    user_message = "\n".join(
        [
            f"TEST CASE: {test_case.title}",
            "",
            "CONDITION (the situation the scripted trainee was tasked to " "recreate):",
            test_case.condition,
            "",
            "TEST (the assertion to check once the condition occurred):",
            test_case.test,
            "",
            transcript_block,
            "",
            "Apply the two-step protocol and return the JSON verdict for "
            "this test case.",
        ]
    )

    evaluation: Optional[TestCaseEvaluation] = None
    try:
        structured = judge_llm.with_structured_output(
            TestCaseEvaluation, method="json_mode"
        )
        result = await structured.ainvoke(
            [
                SystemMessage(content=system_prompt),
                HumanMessage(content=user_message),
            ]
        )
        if isinstance(result, TestCaseEvaluation):
            evaluation = result
        elif isinstance(result, dict):
            evaluation = result.get("parsed") or TestCaseEvaluation.model_validate(
                result
            )
    except Exception:
        logger.exception(
            "[roleplay_v2] test-case evaluator failed for test case %s",
            test_case.id,
        )
    if evaluation is None:
        evaluation = TestCaseEvaluation(
            reasoning="evaluator unavailable", judge_failed=True
        )
    else:
        # judge_failed is decided here, never by the LLM's JSON.
        evaluation.judge_failed = False

    # ---- Deterministic coercion: no condition → no verdict ----
    if not evaluation.condition_recreated and evaluation.verdict != "INCONCLUSIVE":
        logger.info(
            "[roleplay_v2] judge override: test case %s verdict %s → INCONCLUSIVE "
            "(condition_recreated=false)",
            test_case.id,
            evaluation.verdict,
        )
        evaluation.verdict = "INCONCLUSIVE"

    return evaluation


async def evaluate_full_session(
    spec: ScenarioSpec,
    test_case: RehearsalTestCase,
    transcript: Sequence[TranscriptTurn],
    director_trace: Sequence[Dict[str, Any]],
    judge_llm: Any,
    *,
    prompt_data: Any = None,
) -> FullSessionEvaluation:
    """LLM-score one full_session test case's rubrics, then coerce in code.

    Judges the RUNTIME (actor + director), not the trainee — the trainee was
    a scripted FULL_SESSION profile holding an ordinary complete session.
    Deterministic coercions after the LLM call: scores clamped to 0-100,
    rubric_scores realigned to the request's rubric order/text by index, and
    overall_score recomputed as the mean of the aligned scores (the LLM's
    claimed overall is ignored).
    """
    base = (load_template("judge/full_session", prompt_data) or "").strip()
    spec_json = json.dumps(
        spec.model_dump(by_alias=True, exclude={"ui"}),
        indent=2,
        ensure_ascii=False,
    )
    system_prompt = (
        f"{base}\n\n## Scenario specification (JSON, including locked secrets)\n"
        f"{spec_json}"
    )
    rubric_lines: List[str] = []
    for index, rubric in enumerate(test_case.rubrics, start=1):
        rubric_lines.append(f"{index}. CRITERIA: {rubric.criteria}")
        rubric_lines.append(
            f"   SCORING INSTRUCTIONS: {rubric.scoring_instructions or '(none)'}"
        )
    transcript_block = _build_judge_user_message(
        "FULL_SESSION", transcript, director_trace, include_closing=False
    )
    user_message = "\n".join(
        [
            f"TEST CASE: {test_case.title}",
            "",
            "RUBRICS (score every one, in this order):",
            *rubric_lines,
            "",
            transcript_block,
            "",
            "Score every rubric and return the JSON verdict for this test case.",
        ]
    )

    evaluation: Optional[FullSessionEvaluation] = None
    try:
        structured = judge_llm.with_structured_output(
            FullSessionEvaluation, method="json_mode"
        )
        result = await structured.ainvoke(
            [
                SystemMessage(content=system_prompt),
                HumanMessage(content=user_message),
            ]
        )
        if isinstance(result, FullSessionEvaluation):
            evaluation = result
        elif isinstance(result, dict):
            evaluation = result.get("parsed") or FullSessionEvaluation.model_validate(
                result
            )
    except Exception:
        logger.exception(
            "[roleplay_v2] full-session evaluator failed for test case %s",
            test_case.id,
        )
    if evaluation is None:
        evaluation = FullSessionEvaluation(
            summary_markdown="evaluator unavailable", judge_failed=True
        )
    else:
        # judge_failed is decided here, never by the LLM's JSON.
        evaluation.judge_failed = False

    # ---- Deterministic coercions: clamp, realign to request order, re-mean ----
    aligned: List[RubricCriterionScore] = []
    for index, rubric in enumerate(test_case.rubrics):
        raw = (
            evaluation.rubric_scores[index]
            if index < len(evaluation.rubric_scores)
            else None
        )
        aligned.append(
            RubricCriterionScore(
                criteria=rubric.criteria,
                score=max(0, min(100, int(raw.score))) if raw else 0,
                evidence=raw.evidence if raw else "",
                reasoning=raw.reasoning if raw else "(no score returned)",
            )
        )
    evaluation.rubric_scores = aligned
    evaluation.overall_score = (
        round(mean(score.score for score in aligned)) if aligned else 0
    )
    return evaluation
