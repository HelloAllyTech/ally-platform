"""Debrief-quality judge — a stateless transform.

Same contract as the other judges: ally-be owns the data, selects the sessions,
renders the debrief and transcript from its own database, and persists the
result. This service only judges.

The response echoes the model and rubric version actually used, so the caller
stamps the stored rows with what ran rather than hard-coding our config.
"""

import time
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from app.core.config import settings
from app.core.debrief_quality.judge import judge_debrief
from app.core.debrief_quality.schemas import DimensionScore, HardFailFinding
from app.core.llm.capture import capture_calls
from app.utils.logger import get_logger

logger = get_logger(__name__)

router = APIRouter()


class DebriefQualityRequest(BaseModel):
    # Every turn, both speakers, numbered from 1.
    transcript: List[dict] = Field(default_factory=list)
    # The debrief exactly as the learner reads it, rendered by ally-be.
    debrief: str = ""
    language: str = "en"
    # LAY | EARLY_PROFESSIONAL | EXPERIENCED_PROFESSIONAL, when known.
    learner_level: Optional[str] = None
    # Practice guidance or tenant protocol the debrief was written against.
    guidance: Optional[str] = None
    # The trainee's past Work-on-this points the writer was given, so a
    # debrief that refers to them is not marked as an unsupported claim.
    history: Optional[str] = None
    rubric: Optional[str] = None
    # The judge's instructions from the Skills Store
    # (`debrief_quality_judge_system`); the code's text when absent.
    judge_instructions: Optional[str] = None
    # Attribution only: carried onto the call's llm_usage row.
    scenario_session_id: Optional[str] = None


class DebriefQualityResponse(BaseModel):
    judge_model: str
    judge_prompt_version: str
    # Empty when the judge produced no usable answer; the caller records a
    # failed attempt rather than a zero.
    dimensions: List[DimensionScore]
    hard_fails: List[HardFailFinding]
    # The call as the debrief's Agent logs keep it: the exact message (the
    # judge's instructions replaced by `{{system_prompt}}` when they were sent),
    # the full reply, tokens and time. None when no model was called.
    log: Optional[Dict[str, Any]] = None


def _log(calls: List[Dict[str, Any]], instructions: Optional[str], ms: int):
    if not calls:
        return None
    c = calls[-1]
    prompt = c.get("prompt") or ""
    inlined = bool(instructions) and instructions in prompt
    if inlined:
        prompt = prompt.replace(instructions, "{{system_prompt}}", 1)
    return {
        "input": prompt,
        "prompt_inlined": inlined,
        "output": c.get("reply"),
        "model": c.get("model"),
        "fell_back_from": c.get("fell_back_from"),
        "tokens_in": c.get("tokens_in") or None,
        "tokens_out": c.get("tokens_out") or None,
        "ms": ms,
        "error": c.get("error"),
    }


@router.post("/judge", response_model=DebriefQualityResponse)
async def judge(req: DebriefQualityRequest) -> DebriefQualityResponse:
    """Score one session's debrief against its transcript."""
    if not req.transcript:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="empty transcript"
        )
    if not req.debrief.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="empty debrief"
        )

    t0 = time.monotonic()
    calls: List[Dict[str, Any]] = []
    try:
        with capture_calls() as captured:
            calls = captured
            output, judge_model = await judge_debrief(
                req.transcript,  # type: ignore[arg-type]
                req.debrief,
                req.language,
                learner_level=req.learner_level,
                guidance=req.guidance,
                history=req.history,
                rubric=req.rubric,
                instructions=req.judge_instructions,
                scenario_session_id=req.scenario_session_id,
            )
    except Exception as exc:  # noqa: BLE001 - surface as 500, keep caller decoupled
        logger.exception("[debrief-quality] judge failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="debrief quality judge failed",
        ) from exc

    return DebriefQualityResponse(
        judge_model=judge_model,
        judge_prompt_version=settings.DEBRIEF_QUALITY_JUDGE.PROMPT_VERSION,
        dimensions=output.dimensions if output else [],
        hard_fails=output.hard_fails if output else [],
        log=_log(calls, req.judge_instructions, round((time.monotonic() - t0) * 1000)),
    )
