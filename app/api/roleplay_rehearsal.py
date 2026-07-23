"""Roleplay Studio v2 rehearsal API endpoints."""

import asyncio

from fastapi import APIRouter, Depends

from app.api.dependencies import verify_api_key
from app.core.logger import get_logger
from app.roleplay_v2.rehearsal.schemas import RehearsalRequest, RehearsalResponse
from app.roleplay_v2.rehearsal.service import (
    RehearsalService,
    request_cancel,
    run_rehearsal_with_concurrency_limit,
)

logger = get_logger(__name__)

router = APIRouter(
    prefix="/roleplay-rehearsal",
    tags=["roleplay-rehearsal"],
    dependencies=[Depends(verify_api_key)],
)


@router.post(
    "/run",
    response_model=RehearsalResponse,
    status_code=202,
    summary="Run a Roleplay Studio v2 rehearsal",
    description=(
        "Accepts a v2 ScenarioSpec and runs the full rehearsal harness "
        "(one simulated session per trainee profile, judged by the hybrid "
        "LLM+deterministic judge). Returns immediately with status "
        "'processing'; progress and results are PATCHed to the ally-be "
        "rehearsal webhook after each profile and at completion."
    ),
)
async def run_rehearsal(request: RehearsalRequest) -> RehearsalResponse:
    """Spawn the background rehearsal task and return 202 immediately."""
    logger.info(
        "Rehearsal requested: rehearsal_id=%s profiles=%s",
        request.rehearsal_id,
        request.config.trainee_profiles,
    )
    service = RehearsalService(request)
    asyncio.create_task(
        run_rehearsal_with_concurrency_limit(service),
        name=f"rehearsal-{request.rehearsal_id}",
    )
    return RehearsalResponse(rehearsal_id=request.rehearsal_id)


@router.post(
    "/cancel/{rehearsal_id}",
    status_code=202,
    summary="Signal an in-flight rehearsal to stop",
    description=(
        "Sets the cancellation flag on the active rehearsal; the run loop "
        "exits between turns and ships a CANCELLED webhook with any partial "
        "transcripts. No-op when the rehearsal already finished or is "
        "unknown to this worker."
    ),
)
async def cancel_rehearsal(rehearsal_id: str) -> dict:
    found = request_cancel(rehearsal_id)
    logger.info(
        "Cancel propagation for rehearsal_id=%s: active_service_found=%s",
        rehearsal_id,
        found,
    )
    return {"rehearsal_id": rehearsal_id, "cancel_signalled": found}
