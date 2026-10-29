"""The debrief agent's steps — stateless transforms ally-be's recipe runner calls.

ally-be owns the run: it picks the recipe, gathers the inputs, sends the live
prompt text from the Skills Store, and stores every result in the run's
workspace. This service only performs the step.
"""

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from app.core.config import settings
from app.core.debrief import improver, steps
from app.core.debrief.improver import ImproverAnalysis
from app.core.debrief.safety_reader import (
    LearnerDistress,
    RiskCue,
    TranscriptTurn,
    read_safety,
)
from app.core.debrief.schemas import (
    DebriefCards,
    EvaluationOutput,
    EvidenceMap,
    ProgressReading,
)
from app.utils.logger import get_logger

logger = get_logger(__name__)

router = APIRouter()


class SafetyReaderRequest(BaseModel):
    # Every turn, both speakers, numbered from 1.
    transcript: List[TranscriptTurn] = Field(default_factory=list)
    language: str = "en"
    # The live `debrief_safety_reader_system` text; None uses the default.
    system_prompt: Optional[str] = None
    scenario_session_id: Optional[str] = None


class SafetyReaderResponse(BaseModel):
    model: str
    risk_cues: List[RiskCue]
    learner_distress: List[LearnerDistress]


@router.post("/safety-reader", response_model=SafetyReaderResponse)
async def safety_reader(req: SafetyReaderRequest) -> SafetyReaderResponse:
    """Read one session for client risk cues and the learner's own distress.

    A model that returns nothing usable is a 502, never an empty reading: the
    step is mandatory, and an empty answer would read as a safe session.
    """
    try:
        reading, model = await read_safety(
            req.transcript,
            req.language,
            system=req.system_prompt,
            scenario_session_id=req.scenario_session_id,
        )
    except Exception as exc:  # noqa: BLE001 - surface as 500, keep caller decoupled
        logger.exception("[debrief-safety] reader failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="safety reader failed",
        ) from exc
    if reading is None:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="safety reader returned no usable answer",
        )
    return SafetyReaderResponse(
        model=model,
        risk_cues=reading.risk_cues,
        learner_distress=reading.learner_distress,
    )


# --- The remaining steps --------------------------------------------------------
#
# Same contract as the Safety reader: ally-be sends the live prompt text and the
# model its recipe names; a model with no usable answer is a 502 so the runner
# can retry on the step's backup model or step down its fallback ladder.


def _unusable(step: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail=f"{step} returned no usable answer",
    )


def _failed(step: str, exc: Exception) -> HTTPException:
    logger.exception("[debrief-%s] failed", step)
    return HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail=f"{step} failed",
    )


class StepRequest(BaseModel):
    model: Optional[str] = None
    system_prompt: Optional[str] = None
    language: str = "en"
    scenario_session_id: Optional[str] = None


class AnalystRequest(StepRequest):
    transcript: List[TranscriptTurn] = Field(default_factory=list)
    scenario: Dict[str, Any] = Field(default_factory=dict)
    expected_behaviours: List[str] = Field(default_factory=list)
    learner_level: Optional[str] = None


class AnalystResponse(BaseModel):
    model: str
    evidence: EvidenceMap


@router.post("/analyst", response_model=AnalystResponse)
async def analyst(req: AnalystRequest) -> AnalystResponse:
    model = req.model or settings.DEBRIEF.ANALYST_MODEL
    try:
        out, ran = await steps.analyse(
            req.transcript,
            req.language,
            model,
            scenario=req.scenario,
            expected_behaviours=req.expected_behaviours,
            learner_level=req.learner_level,
            system=req.system_prompt,
            scenario_session_id=req.scenario_session_id,
        )
    except Exception as exc:  # noqa: BLE001
        raise _failed("analyst", exc) from exc
    if out is None:
        raise _unusable("analyst")
    return AnalystResponse(model=ran, evidence=out)


class ProgressRequest(StepRequest):
    evidence: Dict[str, Any]
    past_points: List[Dict[str, Any]] = Field(default_factory=list)


class ProgressResponse(BaseModel):
    model: str
    progress: ProgressReading


@router.post("/progress-reader", response_model=ProgressResponse)
async def progress_reader(req: ProgressRequest) -> ProgressResponse:
    model = req.model or settings.DEBRIEF.PROGRESS_READER_MODEL
    try:
        out, ran = await steps.read_progress(
            req.evidence,
            req.past_points,
            model,
            system=req.system_prompt,
            scenario_session_id=req.scenario_session_id,
        )
    except Exception as exc:  # noqa: BLE001
        raise _failed("progress-reader", exc) from exc
    if out is None:
        raise _unusable("progress-reader")
    return ProgressResponse(model=ran, progress=out)


class WriterRequest(StepRequest):
    evidence: Dict[str, Any]
    safety: Dict[str, Any] = Field(default_factory=dict)
    transcript: List[TranscriptTurn] = Field(default_factory=list)
    passages: List[Dict[str, Any]] = Field(default_factory=list)
    progress: Optional[Dict[str, Any]] = None
    learner_level: Optional[str] = None
    tone: Optional[str] = None
    short: bool = False


class CardsResponse(BaseModel):
    model: str
    cards: DebriefCards


@router.post("/writer", response_model=CardsResponse)
async def writer(req: WriterRequest) -> CardsResponse:
    model = req.model or settings.DEBRIEF.WRITER_MODEL
    try:
        out, ran = await steps.write(
            req.evidence,
            req.safety,
            req.language,
            model,
            req.transcript,
            passages=req.passages,
            progress=req.progress,
            learner_level=req.learner_level,
            tone=req.tone,
            short=req.short,
            system=req.system_prompt,
            scenario_session_id=req.scenario_session_id,
        )
    except Exception as exc:  # noqa: BLE001
        raise _failed("writer", exc) from exc
    if out is None:
        raise _unusable("writer")
    return CardsResponse(model=ran, cards=out)


class EvaluatorRequest(StepRequest):
    transcript: List[TranscriptTurn] = Field(default_factory=list)
    debrief: str
    # The pinned rubric from the Skills Store; None uses the judge's default.
    rubric: Optional[str] = None
    learner_level: Optional[str] = None
    guidance: Optional[str] = None
    history: Optional[str] = None


class EvaluatorResponse(BaseModel):
    model: str
    evaluation: EvaluationOutput


@router.post("/evaluator", response_model=EvaluatorResponse)
async def evaluator(req: EvaluatorRequest) -> EvaluatorResponse:
    model = req.model or settings.DEBRIEF.EVALUATOR_MODEL
    try:
        out, ran = await steps.evaluate(
            req.transcript,
            req.debrief,
            req.language,
            model,
            rubric=req.rubric,
            learner_level=req.learner_level,
            guidance=req.guidance,
            scenario_session_id=req.scenario_session_id,
            history=req.history,
        )
    except Exception as exc:  # noqa: BLE001
        raise _failed("evaluator", exc) from exc
    if out is None:
        raise _unusable("evaluator")
    return EvaluatorResponse(model=ran, evaluation=out)


class ReviserRequest(StepRequest):
    draft: Dict[str, Any]
    critique: List[Dict[str, Any]] = Field(default_factory=list)
    evidence: Dict[str, Any] = Field(default_factory=dict)
    excerpts: List[TranscriptTurn] = Field(default_factory=list)


@router.post("/reviser", response_model=CardsResponse)
async def reviser(req: ReviserRequest) -> CardsResponse:
    model = req.model or settings.DEBRIEF.REVISER_MODEL
    try:
        out, ran = await steps.revise(
            req.draft,
            req.critique,
            req.evidence,
            req.excerpts,
            req.language,
            model,
            system=req.system_prompt,
            scenario_session_id=req.scenario_session_id,
        )
    except Exception as exc:  # noqa: BLE001
        raise _failed("reviser", exc) from exc
    if out is None:
        raise _unusable("reviser")
    return CardsResponse(model=ran, cards=out)


class ImproverRequest(BaseModel):
    signals: Dict[str, Any]
    prompts: Dict[str, str] = Field(default_factory=dict)
    settings: Dict[str, Any] = Field(default_factory=dict)
    history: List[Dict[str, Any]] = Field(default_factory=list)
    model: Optional[str] = None
    system_prompt: Optional[str] = None


class ImproverResponse(BaseModel):
    model: str
    analysis: ImproverAnalysis


@router.post("/improver/analyse", response_model=ImproverResponse)
async def improver_analyse(req: ImproverRequest) -> ImproverResponse:
    model = req.model or settings.DEBRIEF.IMPROVER_MODEL
    try:
        out, ran = await improver.analyse_signals(
            req.signals,
            req.prompts,
            req.settings,
            req.history,
            model,
            system=req.system_prompt,
        )
    except Exception as exc:  # noqa: BLE001
        raise _failed("improver", exc) from exc
    if out is None:
        raise _unusable("improver")
    return ImproverResponse(model=ran, analysis=out)
