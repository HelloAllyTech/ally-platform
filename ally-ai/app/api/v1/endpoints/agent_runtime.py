"""Agents v2 runtime endpoint — the conversational agent, run as a LangGraph loop.

Dark until AGENT_RUNTIME__ENABLED: every run route here answers 404 while it is off, so
shipping this changes nothing in production, and 503 if it is on but its checkpoint
database could not be opened at startup. The builder's /instructions routes are on
`builder_router` instead and always answer: they make no model call and open nothing.
Every run adds a run id, a per-step trace and a stored checkpoint to what
/knowledge-agent/answer returns. /run and
/run/stream share one runner (agent_runtime/runner.py).
"""

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from langgraph.graph.state import CompiledStateGraph

from app.api.v1.endpoints.knowledge_agent import knowledge_errors
from app.core.agent_runtime.checkpointer import checkpointer_available
from app.core.agent_runtime.graph import get_agent_graph
from app.core.agent_runtime.instructions import check_owner_text
from app.core.agent_runtime.instructions import describe as describe_instructions
from app.core.agent_runtime.runner import execute, stream
from app.core.config import settings
from app.core.dependencies import get_knowledge_agent_service
from app.core.knowledge_agent.agent import KnowledgeAgentService
from app.schemas.agent_runtime import (
    AgentRunRequest,
    AgentRunResponse,
    InstructionsResponse,
    OwnerTextCheckRequest,
    OwnerTextCheckResponse,
)
from app.utils.logger import get_logger

logger = get_logger(__name__)


def require_agent_runtime() -> None:
    """404, not 403: while the runtime is off the route should not appear to exist."""
    if not settings.AGENT_RUNTIME.ENABLED:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")
    if not checkpointer_available():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The agent runtime is unavailable",
        )


async def get_graph(
    service: KnowledgeAgentService = Depends(get_knowledge_agent_service),
) -> CompiledStateGraph:
    return get_agent_graph(service)


router = APIRouter(dependencies=[Depends(require_agent_runtime)])
# The owner's "How it works" and the instructions safety check: plain functions of the
# request, so they don't wait for the runtime to be switched on.
builder_router = APIRouter()


@router.post(
    "/run",
    response_model=AgentRunResponse,
    status_code=status.HTTP_200_OK,
    tags=["agent_runtime"],
)
async def run(
    payload: AgentRunRequest,
    graph: CompiledStateGraph = Depends(get_graph),
):
    """
    Answer one message through the agent graph.

    Same outcomes and status codes as /knowledge-agent/answer — `answer`, `decline`
    and `clarify` are all 200, and a failure maps to the same 502/503/500 — so a
    caller can switch between the two without new error handling. A run past
    AGENT_RUNTIME__RUN_TIMEOUT_SECONDS is cancelled and answers 504.
    """
    timed_out = False
    with knowledge_errors("Unexpected error in an agent run"):
        try:
            return await execute(graph, payload)
        except TimeoutError:
            # Outside knowledge_errors, which would make it a 500.
            timed_out = True
    if timed_out:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="The agent run timed out",
        )


@builder_router.post(
    "/instructions",
    response_model=InstructionsResponse,
    status_code=status.HTTP_200_OK,
    tags=["agent_runtime"],
)
async def instructions(payload: AgentRunRequest):
    """
    The instructions a run for this bot starts from, without running it (chunk 20d-2,
    the owner's "How it works"). Built by the same code `/agent/run` uses, from the
    same request, so what the owner reads is what the assistant follows. No model call.
    """
    return describe_instructions(payload.to_bot())


@builder_router.post(
    "/instructions/check",
    response_model=OwnerTextCheckResponse,
    status_code=status.HTTP_200_OK,
    tags=["agent_runtime"],
)
async def check_instructions(payload: OwnerTextCheckRequest):
    """The builder's safety check on text an owner typed into their instructions."""
    return check_owner_text(payload.text)


@router.post("/run/stream", tags=["agent_runtime"])
async def run_stream(
    payload: AgentRunRequest,
    graph: CompiledStateGraph = Depends(get_graph),
):
    """
    The same run as /run, as Server-Sent Events: `run_started`, then `status` and
    `step` as they happen, the checked reply as `token` events, and `final` —
    exactly /run's response — or `error {code}` (timeout, upstream, internal).
    A comment line every 10 s keeps the connection alive; disconnecting cancels
    the run.
    """
    return StreamingResponse(
        stream(graph, payload),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
