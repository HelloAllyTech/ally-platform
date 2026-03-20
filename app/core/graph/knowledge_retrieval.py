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


class RelevantKeys(BaseModel):
    """Structured output schema for knowledge retrieval."""

    keys: List[str] = Field(
        description="List of relevant knowledge topic keys from the available topics"
    )


def build_knowledge_map(
    knowledge_sources: Optional[List[Dict[str, str]]],
) -> Dict[str, str]:
    """
    Convert a list of key-description dicts into a lookup map.

    Entries missing either ``key`` or ``description`` (or with empty values)
    are silently skipped so the caller never has to guard against bad data.
    """
    if not knowledge_sources:
        return {}

    knowledge_map: Dict[str, str] = {}
    for entry in knowledge_sources:
        if not isinstance(entry, dict):
            continue
        key = entry.get("key", "")
        description = entry.get("description", "")
        if key and description:
            knowledge_map[key] = description

    return knowledge_map


def _format_retrieved_context(
    relevant_keys: List[str],
    knowledge_map: Dict[str, str],
) -> str:
    """Format matched knowledge entries as a markdown block."""
    sections: List[str] = []
    for key in relevant_keys:
        if key in knowledge_map:
            sections.append(f"**{key}:**\n{knowledge_map[key]}")

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


async def retrieve_relevant_knowledge(
    llm_client,
    messages: list,
    knowledge_map: Dict[str, str],
) -> str:
    """
    Use the scenario LLM to identify which knowledge-base keys are
    relevant to the recent conversation, then return the formatted
    descriptions for those keys.

    Returns an empty string when nothing is relevant or on any error.
    """
    if not knowledge_map or not messages:
        return ""

    try:
        cache_key = (
            f"{_get_llm_identity(llm_client)}:"
            f"{_build_cache_key(messages, knowledge_map)}"
        )
        cached = _get_cached_retrieval(cache_key)
        if cached is not None:
            logger.debug("Knowledge retrieval cache hit")
            return cached

        recent_messages = messages[-10:]
        chat_messages = convert_messages_to_chat_messages(recent_messages)

        conversation_text = "\n".join(
            f"{msg.role}: {msg.content}" for msg in chat_messages if msg.content
        )

        available_keys = list(knowledge_map.keys())

        system_prompt = (
            "You are a knowledge retrieval assistant. Given a conversation between "
            "a counselor and a client, identify which knowledge topics are relevant "
            "to the current conversation.\n\n"
            f"Available topics: {available_keys}\n\n"
            "Return ONLY the keys that are directly relevant to what is being "
            "discussed. If none are relevant, return an empty list."
        )

        structured_llm = llm_client.llm_instance.with_structured_output(RelevantKeys)
        result = await structured_llm.ainvoke(
            [
                SystemMessage(content=system_prompt),
                HumanMessage(content=f"Recent conversation:\n{conversation_text}"),
            ]
        )

        if not result or not result.keys:
            _store_cached_retrieval(cache_key, "")
            return ""

        formatted_context = _format_retrieved_context(result.keys, knowledge_map)
        _store_cached_retrieval(cache_key, formatted_context)
        return formatted_context

    except Exception:
        logger.exception("Knowledge retrieval failed, continuing without context")
        return ""
