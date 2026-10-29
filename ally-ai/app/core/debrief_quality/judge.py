"""Debrief-quality judge — one Gemini call per session's debrief.

Mirrors the feedback-groundedness judge: the LLM returns per-dimension scores
and hard-fail labels only, the weighted overall is computed by the caller, and
token usage is emitted so the backfill's cost is visible.
"""

from __future__ import annotations

from typing import List, Optional, Tuple

from app.core.config import settings
from app.core.debrief_quality.prompt import TranscriptTurn, build_judge_prompt
from app.core.debrief_quality.schemas import DebriefQualityOutput
from app.utils.logger import get_logger

logger = get_logger(__name__)


async def judge_debrief(
    transcript: List[TranscriptTurn],
    debrief: str,
    language: str,
    learner_level: Optional[str] = None,
    guidance: Optional[str] = None,
    rubric: Optional[str] = None,
    scenario_session_id: Optional[str] = None,
) -> Tuple[Optional[DebriefQualityOutput], str]:
    """Score one debrief against its transcript.

    Returns None when there is nothing to judge — no debrief text or no
    transcript. A missing judgment is different from a low score, and the
    caller stores neither as a zero.

    The second return value is THE MODEL THAT ACTUALLY RAN, which the caller
    stores rather than its own setting, so a pinned series is never polluted.

    A result is also None when the model's answer does not cover every
    dimension exactly once: a partial score would read as a low overall.
    """
    if not debrief.strip() or not transcript:
        return None, settings.DEBRIEF_QUALITY_JUDGE.MODEL

    prompt = build_judge_prompt(
        transcript,
        debrief,
        language,
        learner_level=learner_level,
        guidance=guidance,
        rubric=rubric,
    )

    from app.core.llm.dispatch import PROVIDER_GEMINI, generate_structured
    from app.core.llm_usage.tasks import LLMTask

    output, meta = await generate_structured(
        schema=DebriefQualityOutput,
        prompt=prompt,
        task=LLMTask.DEBRIEF_QUALITY_JUDGE.value,
        provider=PROVIDER_GEMINI,
        # Pinned: ally-be selects work by the pinned judge model, so a
        # substitute's judgment would be paid for and then judged again.
        never_fallback=True,
        model=settings.DEBRIEF_QUALITY_JUDGE.MODEL,
        temperature=0,
        max_tokens=None,
        scenario_session_id=scenario_session_id,
    )
    if meta.get("fell_back_from"):
        logger.warning(
            "debrief quality judge fell back from %s to %s/%s",
            meta["fell_back_from"],
            meta["provider"],
            meta["model"],
        )
    if output is None:
        logger.warning("[debrief-quality] judge returned no output")
        return None, meta["model"]

    seen = [d.dimension for d in output.dimensions]
    if len(seen) != 8 or len(set(seen)) != 8:
        logger.warning(
            "[debrief-quality] judge returned %d dimension scores (%d distinct)",
            len(seen),
            len(set(seen)),
        )
        return None, meta["model"]

    return output, meta["model"]
