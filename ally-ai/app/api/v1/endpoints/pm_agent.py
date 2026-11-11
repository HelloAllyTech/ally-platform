"""The Debrief PM agent (spec Part C): one run per call, synchronous.

ally-be packs the inputs, signs the agent token and stores the result; every tool
the agent calls goes back through ally-be's gateway. Auth: the service X-API-Key,
like every ally-be → ally-ai call. Contract: docs/debrief-harness/CONTRACT.md §7.
"""

from fastapi import APIRouter, HTTPException, status

from app.core.agent_runtime import checkpointer as runtime_checkpointer
from app.core.config import settings
from app.core.pm_agent.runner import run_pm_agent
from app.core.pm_agent.schemas import PmAgentRunRequest, PmAgentRunResponse
from app.core.pm_agent.store import get_pm_agent_store

router = APIRouter()


@router.post("/runs", response_model=PmAgentRunResponse)
async def pm_agent_run(req: PmAgentRunRequest) -> PmAgentRunResponse:
    """Run the PM agent once. A run an unexpected error stopped answers
    `failed` (200) with the steps recorded so far."""
    if not runtime_checkpointer.checkpointer_available():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="agent checkpoints are unavailable",
        )
    result = await run_pm_agent(
        req,
        store=get_pm_agent_store(),
        checkpointer=runtime_checkpointer.get_checkpointer(),
        default_model=settings.DEBRIEF.PM_AGENT_MODEL,
    )
    return PmAgentRunResponse(**result)
