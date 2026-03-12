from typing import Dict, List, Optional

from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel, Field

from app.core.graph.utils import convert_messages_to_chat_messages
from app.core.logger import get_logger

logger = get_logger(__name__)


class RelevantKeys(BaseModel):
    """Structured output schema for knowledge retrieval."""

    keys: List[str] = Field(
        description="List of relevant knowledge topic keys from the available topics"
    )


def build_knowledge_map(
    knowledge_base: Optional[List[Dict[str, str]]],
) -> Dict[str, str]:
    """
    Convert a list of key-description dicts into a lookup map.

    Entries missing either ``key`` or ``description`` (or with empty values)
    are silently skipped so the caller never has to guard against bad data.
    """
    if not knowledge_base:
        return {}

    knowledge_map: Dict[str, str] = {}
    for entry in knowledge_base:
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
            return ""

        return _format_retrieved_context(result.keys, knowledge_map)

    except Exception:
        logger.exception("Knowledge retrieval failed, continuing without context")
        return ""
