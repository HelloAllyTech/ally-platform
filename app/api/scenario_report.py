"""Scenario report generation API endpoints."""

import asyncio

from fastapi import APIRouter, Depends

from app.api.dependencies import verify_api_key
from app.core.logger import get_logger
from app.core.scenario_report.schemas import (
    ScenarioReportRequest,
    ScenarioReportResponse,
)
from app.core.scenario_report.service import (
    ScenarioReportService,
    request_cancel,
    run_report_with_concurrency_limit,
)

logger = get_logger(__name__)

router = APIRouter(
    prefix="/scenario-report",
    tags=["scenario-report"],
    dependencies=[Depends(verify_api_key)],
)


@router.post(
    "/generate",
    response_model=ScenarioReportResponse,
    summary="Generate a scenario report",
    description=(
        "Accepts a scenario report generation request and starts an "
        "asynchronous N-turn simulated conversation between a client agent "
        "and a counselor agent. Returns immediately with status 'processing'. "
        "Results are delivered via webhook upon completion."
    ),
    status_code=202,
)
async def generate_scenario_report(
    request: ScenarioReportRequest,
) -> ScenarioReportResponse:
    """Spawn a background report-generation task and return immediately."""
    logger.info(
        "Report generation requested: report_id=%s, scenario_id=%s, requested_turns=%d",
        request.report_id,
        request.scenario_id,
        request.turns,
    )

    service = ScenarioReportService(request)
    asyncio.create_task(
        run_report_with_concurrency_limit(service),
        name=f"report-{request.report_id}",
    )

    return ScenarioReportResponse(
        scenario_id=request.scenario_id,
        report_id=request.report_id,
    )


@router.post(
    "/cancel/{report_id}",
    summary="Signal an in-flight report to stop",
    description=(
        "Called by ally-be when the user clicks Cancel in the studio. "
        "Looks up the active ScenarioReportService for `report_id` and "
        "sets its cancellation flag — the run loop exits on the next "
        "iteration and ships a CANCELLED webhook with any partial "
        "transcripts collected so far. No-op when the report has "
        "already completed or doesn't exist in this worker's registry."
    ),
    status_code=202,
)
async def cancel_scenario_report(report_id: str) -> dict:
    """Signal cancellation; ally-be is the source of truth for DB status."""
    found = request_cancel(report_id)
    logger.info(
        "Cancel propagation for report_id=%s: active_service_found=%s",
        report_id,
        found,
    )
    return {"report_id": report_id, "cancel_signalled": found}
