"""Prefetch: the up-front search for a question, as a fast first search.

The same retrieval, gate and selection as the parity path, and the same one
retrieval-log entry, but the gate never ends the run: below the threshold the agent
gets no passages and may search again.
"""

from __future__ import annotations

from typing import Any, Dict

from app.core.agent_runtime.state import AgentState, json_safe
from app.core.agent_runtime.trace import Node, traced
from app.core.knowledge_agent.agent import KnowledgeAgentService
from app.core.knowledge_agent.schemas import DeclineReason
from app.schemas.knowledge_chunk import AudienceSelector


def _summary(_: AgentState, update: Dict[str, Any]) -> str:
    hits = update["hits"]
    passages = len(update["passages"])
    if not hits:
        return f"0 hits, {passages} passages"
    best = update["retrieval"]["top_similarity"]
    return f"{len(hits)} hits, best {best:.2f}, {passages} passages"


def make_prefetch_node(service: KnowledgeAgentService) -> Node:
    @traced("prefetch", _summary)
    async def prefetch(state: AgentState) -> Dict[str, Any]:
        bot = state["bot"]
        limits = state["limits"]
        audience = AudienceSelector(**bot["audience"]).to_chunk_audience()
        hits, latency_ms = await service.retrieve(
            state["search_text"],
            audience,
            limits=limits,
            document_ids=bot.get("document_ids"),
        )
        hits = json_safe(hits)
        retrieval = service.retrieval_meta(
            limits,
            hits,
            language=state["language"],
            translated=state["translated_query"],
            translation_degraded=state["translation_degraded"],
        )
        reason = service.gate(
            hits,
            decline_similarity=limits["decline_similarity"],
            general=bot.get("answer_mode") == "documents_and_general",
            translation_degraded=state["translation_degraded"],
        )
        log = bot.get("log_retrieval", True)
        if reason is None:
            passages = service.select(
                hits,
                search_text=state["search_text"],
                limits=limits,
                latency_ms=latency_ms,
                language=state["language"],
                retrieval=retrieval,
                log_retrieval=log,
            )
        else:
            # Logged as the decline the parity path would have given, so the
            # threshold is still calibrated against what the search found.
            passages = []
            if log:
                service.report_gate_decline(
                    DeclineReason(reason),
                    search_text=state["search_text"],
                    hits=hits,
                    limits=limits,
                    latency_ms=latency_ms,
                    language=state["language"],
                )
        return {
            "hits": hits,
            "retrieval_latency_ms": latency_ms,
            "retrieval": retrieval,
            "prefetch_gate": reason.value if reason is not None else None,
            "passages": json_safe(passages),
        }

    return prefetch
