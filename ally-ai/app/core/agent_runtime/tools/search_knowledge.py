"""search_knowledge: the agent's way into the bot's documents.

The agent decides when to search and writes the query itself, using the
conversation for what a follow-up refers to. It is the same retrieval, gate and
selection as v1 (the bot's documents, audience and thresholds), so a
passage found here is one v1 could have found. The run's first search
is logged to the retrieval log exactly as v1 logs its one search.
"""

from __future__ import annotations

import asyncio
from typing import Any, Dict, List

from pydantic import BaseModel, Field

from app.core.agent_runtime.state import json_safe
from app.core.agent_runtime.tools.base import Tool, ToolContext, ToolResult
from app.core.knowledge_agent.schemas import DeclineReason, is_general
from app.schemas.knowledge_chunk import AudienceSelector

NAME = "search_knowledge"


class SearchKnowledgeInput(BaseModel):
    query: str = Field(
        "",
        description=(
            "A short, self-contained question in English, with what the message "
            "refers to filled in from the conversation"
        ),
    )


async def search_knowledge(args: SearchKnowledgeInput, ctx: ToolContext) -> ToolResult:
    query = (args.query or "").strip()
    if not query:
        return ToolResult(
            summary=f"{NAME}: empty query",
            record={"tool": NAME, "query": "", "hits": 0, "added": []},
        )

    service = ctx.service
    audience = AudienceSelector(**ctx.bot["audience"]).to_chunk_audience()
    # Q4 C14: the English query, and the person's message as they wrote it when it
    # is different, searched together; the same facts in every language.
    written = as_written(ctx.latest, query, ctx.language)
    searches = [query, *([written] if written else [])]
    found = await asyncio.gather(
        *(
            service.retrieve(
                text,
                audience,
                limits=ctx.limits,
                document_ids=ctx.bot.get("document_ids"),
            )
            for text in searches
        )
    )
    hits = json_safe(merge_hits([h for h, _ in found], ctx.limits.get("top_k")))
    latency_ms = max(ms for _, ms in found)
    retrieval = service.retrieval_meta(
        ctx.limits,
        hits,
        language=ctx.language,
        translated=query,
        translation_degraded=False,
    )
    reason = service.gate(
        hits,
        decline_similarity=ctx.limits["decline_similarity"],
        general=is_general(ctx.bot.get("answer_mode")),
        translation_degraded=False,
    )
    if reason is None:
        selected = service.select(
            hits,
            search_text=query,
            limits=ctx.limits,
            latency_ms=latency_ms,
            language=ctx.language,
            retrieval=retrieval,
            log_retrieval=ctx.log_retrieval,
            agent_selection=True,
        )
    else:
        # Nothing relevant. Logged as the decline v1 would have
        # given, so the threshold is still calibrated against what was found; the
        # agent decides what to say.
        selected = []
        if ctx.log_retrieval:
            service.report_gate_decline(
                DeclineReason(reason),
                search_text=query,
                hits=hits,
                limits=ctx.limits,
                latency_ms=latency_ms,
                language=ctx.language,
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
        retrieval=retrieval,
        hits=hits,
        gate=reason.value if reason is not None else None,
    )


#: The person's message is searched as written only when it is at least this long.
MIN_WRITTEN_CHARS = 8


def as_written(latest: str, query: str, language: str = "en") -> str:
    """The person's message, when it is worth a second search: not in English (the
    query already is), not empty, not a plain yes, and not the query itself."""
    from app.core.agent_runtime.nodes.presearch import looks_hinglish, mostly_non_latin
    from app.core.agent_runtime.tools.confirmed import is_plain_yes

    text = (latest or "").strip()[:300]
    if len(text) < MIN_WRITTEN_CHARS or is_plain_yes(text):
        return ""
    english = (language or "en").lower().startswith("en")
    if english and not (mostly_non_latin(text) or looks_hinglish(text)):
        return ""
    if " ".join(text.lower().split()) == " ".join(query.lower().split()):
        return ""
    return text


def merge_hits(results: List[List[Dict[str, Any]]], top_k: Any) -> List[Dict[str, Any]]:
    """One list from several searches: each chunk once, at its best similarity,
    best first, at most `top_k` (all when unset)."""
    best: Dict[str, Dict[str, Any]] = {}
    for hits in results:
        for hit in hits:
            key = str(hit.get("chunk_id") or id(hit))
            old = best.get(key)
            if old is None or float(hit.get("similarity") or 0) > float(
                old.get("similarity") or 0
            ):
                best[key] = hit
    merged = sorted(
        best.values(), key=lambda h: float(h.get("similarity") or 0), reverse=True
    )
    return merged[: int(top_k)] if top_k else merged


TOOL = Tool(
    name=NAME,
    description=(
        "Search the organisation's reference library for facts about it: its "
        "product, how things work, policies, contacts. Returns numbered passages "
        "you can cite, or nothing when nothing relevant exists. If a search misses, "
        "try different words rather than repeating it."
    ),
    input_model=SearchKnowledgeInput,
    risk="low",
    handler=search_knowledge,
)
