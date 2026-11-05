"""Agents v2 runtime endpoint — the knowledge pipeline run as a LangGraph graph.

Dark until AGENT_RUNTIME__ENABLED: every route here answers 404 while it is off, so
shipping this changes nothing in production. In chunk 1 the graph is parity only:
it answers exactly as /knowledge-agent/answer does, and adds a run id, a per-step
trace and a stored checkpoint per run.
"""

from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from langgraph.graph.state import CompiledStateGraph

from app.core.agent_runtime.graph import get_agent_graph, run_agent
from app.core.config import settings
from app.exceptions.custom_exceptions import (
    EmbeddingFailedException,
    LLMInvocationFailedException,
    VectorDBSearchFailedException,
)
from app.schemas.agent_runtime import AgentRunRequest, AgentRunResponse
from app.utils.logger import get_logger

logger = get_logger(__name__)


def require_agent_runtime() -> None:
    """404, not 403: while the runtime is off the route should not appear to exist."""
    if not settings.AGENT_RUNTIME.ENABLED:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")


async def get_graph() -> CompiledStateGraph:
    return get_agent_graph()


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
    bot = {
        "prompts": payload.prompts,
        "limits": {
            "top_k": payload.top_k,
            "min_similarity": payload.min_similarity,
            "decline_similarity": payload.decline_similarity,
            "max_passages": payload.max_passages,
            "max_context_tokens": payload.max_context_tokens,
            "similarity_band": payload.similarity_band,
        },
        "max_answer_chars": payload.max_answer_chars,
        "translate_query": payload.translate_query,
        # `is not None`, not truthiness, as in the old route: an EMPTY list is "this
        # bot has no documents" and must search nothing, never everything.
        "document_ids": (
            [str(d) for d in payload.document_ids]
            if payload.document_ids is not None
            else None
        ),
        "persona": payload.persona.model_dump() if payload.persona else None,
        "answer_mode": payload.answer_mode,
        "channel": payload.channel,
        "audience": payload.audience.model_dump(mode="json"),
    }
    try:
        state = await run_agent(
            graph,
            run_id=run_id,
            conversation_id=payload.conversation_id,
            chatbot_id=payload.chatbot_id,
            question=payload.question,
            history=[turn.model_dump() for turn in payload.history],
            bot=bot,
        )
    except EmbeddingFailedException:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to embed the question",
        )
    except VectorDBSearchFailedException:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The knowledge index is unavailable",
        )
    except LLMInvocationFailedException as e:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(e))
    except Exception:
        logger.exception("Unexpected error in an agent run")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to answer the question",
        )

    result = state["result"]
    retrieval = {
        **result["retrieval"],
        "hit_chunk_ids": [str(hit.get("chunk_id")) for hit in state.get("hits") or []],
    }
    return AgentRunResponse(
        **{**result, "retrieval": retrieval},
        run_id=run_id,
        trace=state.get("trace") or [],
    )
