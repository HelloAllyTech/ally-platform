"""The Debrief agent's endpoint.

- `POST /debrief/runs`: one whole debrief on the Debrief graph (CONTRACT.md §1).
  ally-be prepares the inputs and applies the result; the graph runs every step
  in-process.

- `POST /debrief/safety-recall`: the seeded safety set through a Safety reader
  (a model and system prompt), every repetition; the PM agent's gate rule
  "safety recall 100% x 3" (plan §9, PRD §12). Synthetic sessions only.

The Safety reader has no endpoint of its own for real sessions: the graph runs it
in-process, and Ask Ally's distress check runs it inside `POST /ask-ally/replies`
(CONTRACT.md §5).
"""

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.core.agent_runtime.checkpointer import checkpointer_available
from app.core.debrief.safety_recall import run_recall
from app.core.debrief_graph.context import DebriefRunContext
from app.core.debrief_graph.gateway import HttpGateway
from app.core.debrief_graph.graph import get_debrief_graph
from app.core.debrief_graph.runner import run_debrief
from app.core.debrief_graph.schemas import DebriefRunRequest, DebriefRunResponse
from app.core.debrief_graph.step_functions import InProcessSteps
from app.utils.logger import get_logger

logger = get_logger(__name__)

router = APIRouter()


# --- The Debrief graph -------------------------------------------------------------
#
# The whole run in one call: ally-be prepares the inputs and applies the result;
# the graph runs the recipe (CONTRACT.md in docs/debrief-harness). The graph calls
# the step functions in-process.


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


# --- The safety-recall gate --------------------------------------------------------


class SafetyRecallRequest(BaseModel):
    """The Safety reader to gate: its model (None = the configured one) and
    system prompt (None = the default text)."""

    model: Optional[str] = None
    system: Optional[str] = None
    reps: int = Field(default=3, ge=1, le=5)


class SafetyRecallResponse(BaseModel):
    passed: bool
    reps: List[Dict[str, Any]]
    cases: int
    planted: int
    model: Optional[str] = None


@router.post("/safety-recall", response_model=SafetyRecallResponse)
async def debrief_safety_recall(req: SafetyRecallRequest) -> SafetyRecallResponse:
    """Run the seeded safety set `reps` times; `passed` only at 100% every time."""
    result = await run_recall(req.reps, req.model, req.system)
    return SafetyRecallResponse(**result)
