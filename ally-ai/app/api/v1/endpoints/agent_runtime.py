"""Agents v2 runtime endpoint — the conversational agent, run as a LangGraph loop.

Dark until AGENT_RUNTIME__ENABLED: every route here answers 404 while it is off, so
shipping this changes nothing in production, and 503 if it is on but its checkpoint
database could not be opened at startup. Every run adds a run id, a per-step trace
and a stored checkpoint to what /knowledge-agent/answer returns.
"""

from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from langgraph.graph.state import CompiledStateGraph

from app.api.v1.endpoints.knowledge_agent import knowledge_errors
from app.core.agent_runtime.checkpointer import checkpointer_available
from app.core.agent_runtime.graph import get_agent_graph, run_agent
from app.core.config import settings
from app.core.dependencies import get_knowledge_agent_service
from app.core.knowledge_agent.agent import KnowledgeAgentService
from app.schemas.agent_runtime import AgentRunRequest, AgentRunResponse
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
    caller can switch between the two without new error handling.
    """
    run_id = payload.run_id or str(uuid4())
    with knowledge_errors("Unexpected error in an agent run"):
        state = await run_agent(
            graph,
            run_id=run_id,
            conversation_id=payload.conversation_id,
            chatbot_id=payload.chatbot_id,
            question=payload.question,
            history=[turn.model_dump() for turn in payload.history],
            bot=payload.to_bot(),
        )
        result = state["result"]
        retrieval = {
            **result["retrieval"],
            "hit_chunk_ids": [
                str(hit.get("chunk_id")) for hit in state.get("hits") or []
            ],
        }
        return AgentRunResponse(
            **{**result, "retrieval": retrieval},
            run_id=run_id,
            trace=state.get("trace") or [],
        )
