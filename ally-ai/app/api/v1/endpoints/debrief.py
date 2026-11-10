"""The debrief agent's steps — stateless transforms ally-be's recipe runner calls.

ally-be owns the run: it picks the recipe, gathers the inputs, sends the live
prompt text from the Skills Store, and stores every result in the run's
workspace. This service only performs the step.
"""

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.core.agent_runtime.checkpointer import checkpointer_available
from app.core.config import settings
from app.core.debrief import pm_agent
from app.core.debrief.pm_agent import PmAgentAnalysis
from app.core.debrief.safety_reader import (
    LearnerDistress,
    RiskCue,
    TranscriptTurn,
    read_safety,
)
from app.core.debrief_graph.context import DebriefRunContext
from app.core.debrief_graph.gateway import HttpGateway
from app.core.debrief_graph.graph import get_debrief_graph
from app.core.debrief_graph.runner import run_debrief
from app.core.debrief_graph.schemas import DebriefRunRequest, DebriefRunResponse
from app.core.debrief_graph.step_functions import InProcessSteps
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
    # The release's model for this step; None uses DEBRIEF.SAFETY_READER_MODEL.
    model: Optional[str] = None


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
            model=req.model,
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


class PmAgentRequest(BaseModel):
    signals: Dict[str, Any]
    prompts: Dict[str, str] = Field(default_factory=dict)
    settings: Dict[str, Any] = Field(default_factory=dict)
    history: List[Dict[str, Any]] = Field(default_factory=list)
    model: Optional[str] = None
    system_prompt: Optional[str] = None
    # v9 FR-61: the redacted views it may query, the rows of the queries it
    # asked for last pass, how many more passes may ask, and which review.
    catalog: Optional[str] = None
    query_results: List[Dict[str, Any]] = Field(default_factory=list)
    rounds_left: int = 0
    review: str = "weekly"


class PmAgentResponse(BaseModel):
    model: str
    analysis: PmAgentAnalysis


# `/improver/analyse` is the PM agent's old name, kept while an ally-be
# release from before the rename may still call it.
@router.post("/pm-agent/analyse", response_model=PmAgentResponse)
@router.post(
    "/improver/analyse", response_model=PmAgentResponse, include_in_schema=False
)
async def pm_agent_analyse(req: PmAgentRequest) -> PmAgentResponse:
    model = req.model or settings.DEBRIEF.PM_AGENT_MODEL
    try:
        out, ran = await pm_agent.analyse_signals(
            req.signals,
            req.prompts,
            req.settings,
            req.history,
            model,
            system=req.system_prompt,
            catalog=req.catalog,
            query_results=req.query_results,
            rounds_left=req.rounds_left,
            review=req.review,
        )
    except Exception as exc:  # noqa: BLE001
        raise _failed("PM agent", exc) from exc
    if out is None:
        raise _unusable("PM agent")
    return PmAgentResponse(model=ran, analysis=out)


# --- The Debrief graph -------------------------------------------------------------
#
# The whole run in one call: ally-be prepares the inputs and applies the result;
# the graph runs the recipe (CONTRACT.md in docs/debrief-harness). The graph calls
# the step functions in-process; only the Safety reader keeps an endpoint (Ask Ally's
# distress check calls it).


def get_graph():
    return get_debrief_graph()


@router.post("/runs", response_model=DebriefRunResponse)
async def debrief_run(
    req: DebriefRunRequest, graph=Depends(get_graph)
) -> DebriefRunResponse:
    """Start, resume or read back one debrief run. Synchronous: returns the
    decision. A run an unexpected error stopped answers `failed` (200) and can
    be resumed with the same `run_id`."""
    if not checkpointer_available():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="debrief checkpoints are unavailable",
        )
    ctx = DebriefRunContext(
        run_id=req.run_id,
        session_id=req.scenario_session_id,
        bundle=req.bundle,
        prompts={k: v for k, v in req.prompts.items() if v},
        ceiling_usd=req.ceiling_usd,
        prices=req.prices,
        session=req.session,
        transcript=req.transcript,
        inputs=req.context,
        steps=InProcessSteps(),
        gateway=HttpGateway(req.gateway_url, req.run_token),
    )
    result = await run_debrief(graph, ctx, resume=req.resume)
    return DebriefRunResponse(**result)
