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
