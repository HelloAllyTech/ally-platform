"""Retrieve: search the bot's documents in Weaviate."""

from __future__ import annotations

from typing import Any, Dict

from app.core.agent_runtime.state import AgentState, json_safe
from app.core.agent_runtime.trace import Node, traced
from app.core.knowledge_agent.agent import KnowledgeAgentService
from app.schemas.knowledge_chunk import AudienceSelector


def _summary(_: AgentState, update: Dict[str, Any]) -> str:
    hits = update["hits"]
    if not hits:
        return "0 hits"
    return f"{len(hits)} hits, best {update['retrieval']['top_similarity']:.2f}"


def make_retrieve_node(service: KnowledgeAgentService) -> Node:
    @traced("retrieve", _summary)
    async def retrieve(state: AgentState) -> Dict[str, Any]:
        bot = state["bot"]
        # The selector travels as JSON in the state; the ChunkAudience it builds is
        # what retrieval filters on, exactly as the old endpoint builds it.
        audience = AudienceSelector(**bot["audience"]).to_chunk_audience()
        hits, latency_ms = await service.retrieve(
            state["search_text"],
            audience,
            limits=state["limits"],
            document_ids=bot.get("document_ids"),
        )
        hits = json_safe(hits)
        return {
            "hits": hits,
            "retrieval_latency_ms": latency_ms,
            "retrieval": service.retrieval_meta(
                state["limits"],
                hits,
                language=state["language"],
                translated=state["translated_query"],
                translation_degraded=state["translation_degraded"],
            ),
        }

    return retrieve
