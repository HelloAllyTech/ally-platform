"""Debrief language judge: a stateless transform.

ally-be owns the data: it renders the debrief's visible sections and the cited
transcript turns from its own database and persists the result. This endpoint
only judges, and echoes the model and prompt version that actually ran.
"""

import time
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from app.core.config import settings
from app.core.debrief_language.judge import judge_debrief_language
from app.core.debrief_language.prompt import LanguageEvalParams
from app.core.debrief_language.schemas import LanguageFinding
from app.core.llm.capture import capture_calls
from app.utils.logger import get_logger

logger = get_logger(__name__)

router = APIRouter()


class DebriefLanguageRequest(BaseModel):
    # The debrief's visible text, one entry per section: {section, text}.
    sections: List[dict] = Field(default_factory=list)
    # The session language code (e.g. "hi-IN").
    language: str = "en"
    # languages.evalConfig of that language (label, variety, diglossia,
    # code-switch partners); every key optional.
    language_config: Optional[Dict[str, Any]] = None
    # Only the transcript turns the debrief cites: {role, text, turn_index}.
    quoted_turns: List[dict] = Field(default_factory=list)
    # The pinned rubric from the Skills Store; the code's text when absent.
    rubric: Optional[str] = None
    scenario_session_id: Optional[str] = None
    # The providers the learner's organisation allows (ally-be sends its allowlist).
    # When the judge's own provider is not in the list nothing is sent to it: the
    # answer is `skipped`.
    allowed_providers: Optional[List[str]] = None


class DebriefLanguageResponse(BaseModel):
    judge_model: str
    judge_prompt_version: str
    # False when the judge produced no usable answer: the caller records a
    # failed attempt, never an empty (clean) result.
    answered: bool
    # Set instead of calling the model when the organisation does not allow the
    # judge's provider.
    skipped: Optional[str] = None
    findings: List[LanguageFinding]
    dropped: Dict[str, int] = Field(default_factory=dict)
    log: Optional[Dict[str, Any]] = None


def _log(calls: List[Dict[str, Any]], ms: int) -> Optional[Dict[str, Any]]:
    if not calls:
        return None
    c = calls[-1]
    return {
        "input": c.get("prompt"),
        "output": c.get("reply"),
        "model": c.get("model"),
        "fell_back_from": c.get("fell_back_from"),
        "tokens_in": c.get("tokens_in") or None,
        "tokens_out": c.get("tokens_out") or None,
        "ms": ms,
        "error": c.get("error"),
    }


@router.post("/judge", response_model=DebriefLanguageResponse)
async def judge(req: DebriefLanguageRequest) -> DebriefLanguageResponse:
    """Check one debrief's language."""
    if not any(str(s.get("text", "")).strip() for s in req.sections):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="empty debrief"
        )
    cfg = settings.DEBRIEF_LANGUAGE_JUDGE
    if req.allowed_providers is not None and cfg.PROVIDER not in req.allowed_providers:
        # A learner's text never goes to a provider the organisation does not allow
        # (FR-57).
        return DebriefLanguageResponse(
            judge_model=cfg.MODEL,
            judge_prompt_version=cfg.PROMPT_VERSION,
            answered=False,
            skipped="provider_not_allowed",
            findings=[],
        )
    t0 = time.monotonic()
    calls: List[Dict[str, Any]] = []
    try:
        with capture_calls() as captured:
            calls = captured
            result, judge_model = await judge_debrief_language(
                req.sections,  # type: ignore[arg-type]
                req.language,
                params=LanguageEvalParams(**(req.language_config or {})),
                quoted_turns=req.quoted_turns,  # type: ignore[arg-type]
                rubric=req.rubric,
                scenario_session_id=req.scenario_session_id,
            )
    except Exception as exc:  # noqa: BLE001
        logger.exception("[debrief-language] judge failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="debrief language judge failed",
        ) from exc

    return DebriefLanguageResponse(
        judge_model=judge_model,
        judge_prompt_version=settings.DEBRIEF_LANGUAGE_JUDGE.PROMPT_VERSION,
        answered=result is not None,
        findings=result.findings if result else [],
        dropped=result.dropped if result else {},
        log=_log(calls, round((time.monotonic() - t0) * 1000)),
    )
