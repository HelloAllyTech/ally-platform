"""search_knowledge: search the bot's documents again, with a better query.

The same retrieval and selection as the up-front search (the bot's documents,
audience and thresholds), so a passage found here could have been found there.
The retrieval log is not written: the up-front search already logged this message.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.core.agent_runtime.state import json_safe
from app.core.agent_runtime.tools.base import Tool, ToolContext, ToolResult
from app.schemas.knowledge_chunk import AudienceSelector

NAME = "search_knowledge"


class SearchKnowledgeInput(BaseModel):
    query: str = Field(
        "", description="A short, self-contained search query in English"
    )


async def search_knowledge(args: SearchKnowledgeInput, ctx: ToolContext) -> ToolResult:
    query = (args.query or "").strip()
    if not query:
        return ToolResult(
            summary=f"{NAME}: empty query",
            record={"tool": NAME, "query": "", "hits": 0, "added": []},
        )

    audience = AudienceSelector(**ctx.bot["audience"]).to_chunk_audience()
    hits, latency_ms = await ctx.service.retrieve(
        query,
        audience,
        limits=ctx.limits,
        document_ids=ctx.bot.get("document_ids"),
    )
    hits = json_safe(hits)
    selected = ctx.service.select(
        hits,
        search_text=query,
        limits=ctx.limits,
        latency_ms=latency_ms,
        language="en",
        retrieval={},  # throwaway: the run's retrieval block is the up-front search
        log_retrieval=False,
    )
    seen = {p.get("chunk_id") for p in ctx.passages}
    new = [p for p in selected if p.get("chunk_id") not in seen]
    first = len(ctx.passages) + 1
    numbers = list(range(first, first + len(new)))

    best = f", best {float(hits[0].get('similarity') or 0.0):.2f}" if hits else ""
    return ToolResult(
        passages=new,
        summary=f"{NAME}: {len(hits)} hits, {len(new)} new passages{best}",
        record={"tool": NAME, "query": query, "hits": len(hits), "added": numbers},
    )


TOOL = Tool(
    name=NAME,
    description=(
        "Search the organisation's reference library. Returns new numbered passages "
        "you can cite. Use it when the passages you have don't answer the latest "
        "message: rephrase, narrow or widen the query rather than repeating one."
    ),
    input_model=SearchKnowledgeInput,
    risk="low",
    handler=search_knowledge,
)
