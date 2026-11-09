"""Onboarding builder (chunk 20a): the setup guide a new customer talks to.

Dark until BUILDER__ENABLED: every route answers 404 while it is off. The builder
keeps no state and never writes: ally-be sends the draft with each step, and applies
what comes back only after its own checks.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse

from app.api.v1.endpoints.knowledge_agent import knowledge_errors
from app.core.builder import tasks
from app.core.builder.change import ChangeRequest, ChangeResponse, propose_change
from app.core.builder.runner import execute, stream
from app.core.config import settings
from app.schemas.builder import (
    BuilderStepRequest,
    BuilderStepResponse,
    ExtractRequest,
    ExtractResponse,
)


def require_builder() -> None:
    """404, not 403: while the builder is off the route should not appear to exist."""
    if not settings.BUILDER.ENABLED:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")


router = APIRouter(dependencies=[Depends(require_builder)])


@router.post("/step", response_model=BuilderStepResponse, tags=["builder"])
async def step(payload: BuilderStepRequest):
    """
    One conversation step: the builder's message, quick replies and proposed
    changes for ally-be to check and apply. Past BUILDER__STEP_TIMEOUT_SECONDS the
    step is cancelled and answers 504.
    """
    timed_out = False
    with knowledge_errors("Unexpected error in a builder step"):
        try:
            return await execute(payload)
        except TimeoutError:
            timed_out = True
    if timed_out:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="The builder step timed out",
        )


@router.post("/step/stream", tags=["builder"])
async def step_stream(payload: BuilderStepRequest):
    """
    The same step as /step, as Server-Sent Events: `status` as each sub-task
    starts, the message as `token` events, then `final` (exactly /step's body) or
    `error {code}` (timeout, upstream, internal). A comment line every 10 s keeps
    the connection alive; disconnecting cancels the step.
    """
    return StreamingResponse(
        stream(payload),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/extract", response_model=ExtractResponse, tags=["builder"])
async def extract(payload: ExtractRequest):
    """
    Details for "What we learned" from a batch of crawled pages, each tied to the
    page it came from. A detail the model gives without a page from this batch is
    dropped and counted in `dropped`.
    """
    with knowledge_errors("Unexpected error extracting facts"):
        return await tasks.extract(payload)


@router.post("/change", response_model=ChangeResponse, tags=["builder"])
async def change(payload: ChangeRequest):
    """
    Change by chat on the assistant home (chunk 20a-2): the owner's request as a
    proposed before and after. ally-be applies it only when the owner confirms.
    A request that would weaken safety is refused.
    """
    with knowledge_errors("Unexpected error proposing a change"):
        return await propose_change(payload)
