"""Goal-based actor-evaluation API for real sessions."""

import asyncio

from fastapi import APIRouter, Depends

from app.api.dependencies import verify_api_key
from app.core.logger import get_logger
from app.core.scenario_session_evaluation.schemas import (
    ActorEvaluationRequest,
    ActorEvaluationResponse,
)
from app.core.scenario_session_evaluation.service import run_actor_evaluation

logger = get_logger(__name__)

router = APIRouter(
    prefix="/scenario-session",
    tags=["scenario-session-evaluation"],
    dependencies=[Depends(verify_api_key)],
)


@router.post(
    "/actor-evaluation",
    response_model=ActorEvaluationResponse,
    summary="Evaluate a real session's roleplay actor against agent test cases",
    description=(
        "Accepts a real session's transcript plus the configured agent test "
        "cases and starts an asynchronous LLM-judge evaluation of the ACTOR "
        "agent. Returns immediately; per-goal scores + feedback are delivered "
        "to ally-be via the session-evaluation webhook."
    ),
    status_code=202,
)
async def evaluate_actor(
    request: ActorEvaluationRequest,
) -> ActorEvaluationResponse:
    """Spawn a background evaluation task and return immediately."""
    logger.info(
        "Actor evaluation requested: session_id=%s, turns=%d, goals=%d",
        request.scenario_session_id,
        len(request.transcript),
        len(request.goals),
    )
    asyncio.create_task(
        run_actor_evaluation(request),
        name=f"actor-eval-{request.scenario_session_id}",
    )
    return ActorEvaluationResponse(
        scenario_session_id=request.scenario_session_id,
    )
