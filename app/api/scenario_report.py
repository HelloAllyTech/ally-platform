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
    accept_report,
    request_cancel,
    run_report_with_concurrency_limit,
)
from app.core.tasks import spawn_background_task

logger = get_logger(__name__)

# Strong references to in-flight report tasks (asyncio holds only weak ones).
_report_tasks: "set[asyncio.Task]" = set()

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
        "Results are delivered via webhook upon completion. A request for a "
        "report_id already queued or running in this worker starts nothing new "
        "and answers 202 with already_running=true."
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
    if not accept_report(service):
        # ally-be retries this call on failure, so a retry after a slow first
        # request can arrive while that report is still queued or running.
        # Running it again would repeat the whole simulation and judge.
        logger.warning(
            "Report %s is already queued or running; not starting another",
            request.report_id,
        )
        return ScenarioReportResponse(
            scenario_id=request.scenario_id,
            report_id=request.report_id,
            already_running=True,
        )

    spawn_background_task(
        run_report_with_concurrency_limit(service),
        name=f"report-{request.report_id}",
        background_tasks=_report_tasks,
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
        "Looks up the queued or running ScenarioReportService for "
        "`report_id` and sets its cancellation flag — a queued report stops "
        "as soon as it gets a slot, a running one on its next turn, and "
        "either ships a CANCELLED webhook with any partial transcripts "
        "collected so far. No-op when the report has already completed or "
        "doesn't exist in this worker's registry."
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
