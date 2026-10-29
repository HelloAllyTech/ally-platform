"""The debrief agent's steps — stateless transforms ally-be's recipe runner calls.

ally-be owns the run: it picks the recipe, gathers the inputs, sends the live
prompt text from the Skills Store, and stores every result in the run's
workspace. This service only performs the step.
"""

from typing import List, Optional

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from app.core.debrief.safety_reader import (
    LearnerDistress,
    RiskCue,
    TranscriptTurn,
    read_safety,
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
