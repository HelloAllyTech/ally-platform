import hashlib
import json
from collections import OrderedDict
from typing import Dict, List, Optional

from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel, Field

from app.core.config import settings
from app.core.graph.utils import convert_messages_to_chat_messages
from app.core.logger import get_logger

logger = get_logger(__name__)

_RETRIEVAL_CACHE: "OrderedDict[str, str]" = OrderedDict()

# Cap injected RAG context to keep prompt budgets predictable. Without
# these the prompt could balloon to tens of KB when the LLM matches many
# titles or knowledge entries are large.
#  - PER_MATCH: each knowledge entry's content is truncated at this many
#    characters. Big enough to fit a paragraph or two of guidance per
#    title, small enough to bound the worst case at MAX_MATCHES * cap.
#  - TOTAL: hard ceiling across all matches. When the running total
#    would exceed this, remaining matches are dropped with a marker so
#    the prompt reader can see something was trimmed.
_MAX_PER_MATCH_CHARS = 1500
_MAX_TOTAL_CONTEXT_CHARS = 8000


class RelevantKeys(BaseModel):
    """Structured output schema for knowledge retrieval."""

    titles: List[str] = Field(
        description="List of relevant knowledge topic titles from the available topics"
    )


def build_knowledge_map(
    knowledge_sources: Optional[List[Dict[str, str]]],
) -> Dict[str, str]:
    """
    Convert a list of title-content dicts into a lookup map.

    Entries missing either ``title`` or ``content`` (or with empty values)
    are silently skipped so the caller never has to guard against bad data.
    """
    if not knowledge_sources:
        return {}

    knowledge_map: Dict[str, str] = {}
    for entry in knowledge_sources:
        if not isinstance(entry, dict):
            continue
        title = entry.get("title", "")
        content = entry.get("content", "")
        if title and content:
            knowledge_map[title] = content

    return knowledge_map


def _format_retrieved_context(
    relevant_titles: List[str],
    knowledge_map: Dict[str, str],
) -> str:
    """Format matched knowledge entries as a markdown block, with both
    per-match and total-context size caps so the prompt budget stays
    bounded regardless of how many titles match or how large the entries
    are."""
    sections: List[str] = []
    total_chars = 0
    truncated_any_total = False
    per_match_truncations = 0
    matched_count = 0
    for title in relevant_titles:
        if title not in knowledge_map:
            continue

        content = knowledge_map[title]
        if len(content) > _MAX_PER_MATCH_CHARS:
            per_match_truncations += 1
            content = content[:_MAX_PER_MATCH_CHARS].rstrip() + " …[truncated]"

        section = f"**{title}:**\n{content}"
        # +2 accounts for the "\n\n" separator that join() will insert
        # between this section and the next.
        prospective_total = total_chars + len(section) + (2 if sections else 0)
        if prospective_total > _MAX_TOTAL_CONTEXT_CHARS:
            truncated_any_total = True
            break

        sections.append(section)
        total_chars = prospective_total
        matched_count += 1

    if truncated_any_total:
        sections.append("…[additional matches omitted to fit context budget]")

    # Truncation observability — grep `[RAG_TRUNC]` to see when caps fired.
    if per_match_truncations or truncated_any_total:
        logger.info(
            "[RAG_TRUNC] per_match_truncations=%d total_truncated=%s "
            "matched=%d/%d total_chars=%d cap_per_match=%d cap_total=%d",
            per_match_truncations,
            truncated_any_total,
            matched_count,
            len(relevant_titles),
            total_chars,
            _MAX_PER_MATCH_CHARS,
            _MAX_TOTAL_CONTEXT_CHARS,
        )

    return "\n\n".join(sections)


def _build_cache_key(messages: list, knowledge_map: Dict[str, str]) -> str:
    """Build a stable cache key for recent conversation + knowledge content."""
    recent_messages = messages[-10:]
    chat_messages = convert_messages_to_chat_messages(recent_messages)

    conversation_payload = [
        {"role": msg.role, "content": msg.content}
        for msg in chat_messages
        if msg.content
    ]
    knowledge_payload = sorted(knowledge_map.items())
    payload = {
        "conversation": conversation_payload,
        "knowledge": knowledge_payload,
    }
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, ensure_ascii=True).encode("utf-8")
    ).hexdigest()


def _get_llm_identity(llm_client) -> str:
    """Best-effort identifier for the retrieval model/provider configuration."""
    llm_instance = getattr(llm_client, "llm_instance", None)
    if llm_instance is None:
        return "unknown"

    provider = llm_instance.__class__.__name__
    model = getattr(llm_instance, "model_name", None) or getattr(
        llm_instance, "model", None
    )
    if model:
        return f"{provider}:{model}"
    return provider


def _get_cached_retrieval(cache_key: str) -> Optional[str]:
    cached = _RETRIEVAL_CACHE.get(cache_key)
    if cached is None:
        return None
    _RETRIEVAL_CACHE.move_to_end(cache_key)
    return cached


def _store_cached_retrieval(cache_key: str, value: str) -> None:
    _RETRIEVAL_CACHE[cache_key] = value
    _RETRIEVAL_CACHE.move_to_end(cache_key)
    while len(_RETRIEVAL_CACHE) > settings.KNOWLEDGE_RETRIEVAL_CACHE_SIZE:
        _RETRIEVAL_CACHE.popitem(last=False)


def _build_selector_prompt(
    available_titles: List[str], glossary_hints: Optional[Dict[str, str]]
) -> str:
    """Build the title-selection system prompt.

    Without glossary sections this is the original single-criterion prompt
    (behavior-preserving). With them, the prompt carries a dual-framing
    instruction (LANGUAGE_GLOSSARY_DESIGN.md §5.2): scenario topics are
    selected for what is being DISCUSSED (content-side, backward-looking),
    glossary sections for what the agent's NEXT reply needs (production-side,
    forward-looking) — with a deliberate bias toward inclusion, since a
    missed glossary section sends the agent into a vocabulary domain unarmed
    while a false positive only spends cap budget. Each glossary section's
    `retrievalHint` is rendered under its title as its trigger description.
    """
    if not glossary_hints:
        return (
            "You are a knowledge retrieval assistant. Given a conversation between "
            "a counselor and a client, identify which knowledge topics are relevant "
            "to the current conversation.\n\n"
            f"Available topics: {available_titles}\n\n"
            "Return ONLY the titles that are directly relevant to what is being "
            "discussed. If none are relevant, return an empty list."
        )

    lines: List[str] = []
    for title in available_titles:
        lines.append(f"- {title}")
        hint = glossary_hints.get(title)
        if hint:
            lines.append(f"  when to retrieve: {hint}")
    topics_block = "\n".join(lines)

    return (
        "You are a knowledge retrieval assistant for a role-played conversation "
        "between a counselor and a client (the client is an AI agent).\n\n"
        f"Available topics:\n{topics_block}\n\n"
        "Two kinds of topics are listed:\n"
        "- Scenario knowledge topics: return them only when they are directly "
        "relevant to what is being discussed.\n"
        "- Language glossary sections (titles in [brackets]): these help the "
        "client character SPEAK its next reply in its language. Return a "
        "glossary section when the next reply is likely to enter that "
        "vocabulary domain, even if it has not been explicitly mentioned yet. "
        "When the conversation seems to be entering a new topic area, prefer "
        "including the matching glossary section.\n\n"
        "Return ONLY relevant titles. If none are relevant, return an empty list."
    )


async def retrieve_relevant_knowledge(
    llm_client,
    messages: list,
    knowledge_map: Dict[str, str],
    glossary_hints: Optional[Dict[str, str]] = None,
) -> str:
    """
    Use the scenario LLM to identify which knowledge-base titles are
    relevant to the recent conversation, then return the formatted
    content for those titles.

    `knowledge_map` may include Tier 1 language-glossary sections (prefixed
    titles); `glossary_hints` maps those titles to their retrieval-trigger
    descriptions and switches the selector to the dual-framing prompt.

    Returns an empty string when nothing is relevant or on any error.
    """
    if not knowledge_map or not messages:
        return ""

    try:
        cache_key = (
            f"{_get_llm_identity(llm_client)}:"
            f"{_build_cache_key(messages, knowledge_map)}"
        )
        if glossary_hints:
            hints_digest = hashlib.md5(
                json.dumps(sorted(glossary_hints.items())).encode("utf-8")
            ).hexdigest()
            cache_key = f"{cache_key}:{hints_digest}"
        cached = _get_cached_retrieval(cache_key)
        if cached is not None:
            logger.debug("Knowledge retrieval cache hit")
            return cached

        recent_messages = messages[-10:]
        chat_messages = convert_messages_to_chat_messages(recent_messages)

        conversation_text = "\n".join(
            f"{msg.role}: {msg.content}" for msg in chat_messages if msg.content
        )

        available_titles = list(knowledge_map.keys())

        system_prompt = _build_selector_prompt(available_titles, glossary_hints)

        structured_llm = llm_client.llm_instance.with_structured_output(RelevantKeys)
        result = await structured_llm.ainvoke(
            [
                SystemMessage(content=system_prompt),
                HumanMessage(content=f"Recent conversation:\n{conversation_text}"),
            ]
        )

        if not result or not result.titles:
            _store_cached_retrieval(cache_key, "")
            return ""

        formatted_context = _format_retrieved_context(result.titles, knowledge_map)
        _store_cached_retrieval(cache_key, formatted_context)
        return formatted_context

    except Exception:
        logger.exception("Knowledge retrieval failed, continuing without context")
        return ""
