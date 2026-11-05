"""Structured outputs for the conversational agent's model calls.

The agent does not use provider tool calling. `generate_structured` has no
tool-calling path, and the bot's answer model can be any of three providers, so
each agent call returns one structured *step*: either "call this tool with this
input" or the final reply. The loop runs in code (graph.py).

The same rules as `knowledge_agent/schemas.py` apply: keep shapes flat and avoid
`Optional`. An absent value comes back as the empty default, which every provider's
structured output accepts.
"""

from __future__ import annotations

from enum import Enum
from functools import lru_cache
from typing import Any, Dict, List, Literal, Sequence, Tuple, Type

from pydantic import BaseModel, Field, create_model

#: What the contextualise call decided the latest message is.
TurnType = Literal["smalltalk", "about_bot", "question", "unclear"]

#: The `action` value that ends the loop with a reply.
REPLY_ACTION = "reply"


class TurnUnderstanding(BaseModel):
    """The contextualise call's output. It replaces the translate call."""

    turn_type: TurnType = "question"
    # The latest message as one self-contained English question, using the
    # conversation for what it refers to. Empty unless turn_type is "question".
    standalone_query: str = ""
    # BCP-47 tag of the latest message (romanised Hindi is `hi`).
    language: str = "en"


class AgentIntent(str, Enum):
    """The reply the agent chose. `check` decides what reaches ally-be."""

    ANSWER = "answer"
    SMALLTALK = "smalltalk"
    CLARIFY = "clarify"
    DECLINE = "decline"


_REPLY_FIELDS: Dict[str, Any] = {
    "intent": (AgentIntent, AgentIntent.DECLINE),
    # The reply text. Plain text: WhatsApp renders only *bold* and _italic_.
    "answer": (str, ""),
    # 1-based passage numbers, as presented in the prompt. Numbers, not ids: an
    # out-of-range integer can be detected and dropped, a made-up id cannot.
    "citations": (List[int], Field(default_factory=list)),
    "language": (str, "en"),
}


@lru_cache(maxsize=32)
def _step_schema(tools: Tuple[Tuple[str, Type[BaseModel]], ...]) -> Type[BaseModel]:
    names = (REPLY_ACTION, *(name for name, _ in tools))
    fields: Dict[str, Any] = {
        "action": (Literal[names], REPLY_ACTION),  # type: ignore[valid-type]
    }
    # One input field per tool, named after it. Defaults rather than Optional, so
    # the model may leave the fields of tools it is not calling at their empty
    # defaults.
    for name, input_model in tools:
        fields[name] = (input_model, Field(default_factory=input_model))
    fields.update(_REPLY_FIELDS)
    return create_model("AgentStep", **fields)


def step_schema(tools: Sequence[Any]) -> Type[BaseModel]:
    """The step schema for these tools (`Tool` objects); reply-only when empty.

    The schema is passed to the provider, so a tool that is not offered cannot be
    named in `action` at all.
    """
    return _step_schema(tuple((tool.name, tool.input_model) for tool in tools))
