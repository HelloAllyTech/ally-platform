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
from typing import Any, Dict, List, Literal, Optional, Sequence, Tuple, Type

from pydantic import BaseModel, Field, create_model

#: What the agent decided the latest message is. Reported to ally-be, which shows it
#: in Preview and treats small talk and questions about the bot like a welcome.
TurnType = Literal["smalltalk", "about_bot", "question", "unclear"]

#: The `action` value that ends the loop with a reply.
REPLY_ACTION = "reply"


class AgentIntent(str, Enum):
    """The reply the agent chose. `check` decides what reaches ally-be."""

    ANSWER = "answer"
    SMALLTALK = "smalltalk"
    CLARIFY = "clarify"
    DECLINE = "decline"


_REPLY_FIELDS: Dict[str, Any] = {
    # Set on every step, so the last one says what the latest message was.
    "turn_type": (TurnType, "question"),
    "intent": (AgentIntent, AgentIntent.DECLINE),
    # The reply text, plain: any markdown is stripped by check.plain_text.
    "answer": (str, ""),
    # 1-based passage numbers, as presented in the prompt. Numbers, not ids: an
    # out-of-range integer can be detected and dropped, a made-up id cannot.
    "citations": (List[int], Field(default_factory=list)),
    "language": (str, "en"),
}


#: What `remember` may do on a run (chunk 8a): with memory on, the memory ops; with
#: a create tool, the person's name. None: the step has no `remember` field.
RememberMode = Literal["memory", "name", "memory_and_name"]
#: Memory ops a step may ask for; more are dropped.
MAX_REMEMBER_PER_STEP = 3

_SECTION_HELP = (
    "For add: preferences, context or open_items. Leave empty for the other ops."
)
_ID_HELP = "For replace, done and forget: the line's id, like m2."
_NAME_HELP = (
    "op name: when the person tells you their name, their name as they gave it. "
    "Only their own name, never someone else's."
)


@lru_cache(maxsize=4)
def remember_model(mode: RememberMode) -> Type[BaseModel]:
    """One `remember` op, flat and without Optional like the rest of the step."""
    ops = {
        "memory": ["add", "replace", "done", "forget"],
        "name": ["name"],
        "memory_and_name": ["add", "replace", "done", "forget", "name"],
    }[mode]
    op = Enum("RememberOpKind", {name: name for name in ops}, type=str)
    fields: Dict[str, Any] = {
        "op": (op, Field(op(ops[0]), description=", ".join(ops))),
        "text": (
            str,
            Field(
                "",
                description=(
                    "The line, short and plain (at most 200 characters), or the "
                    "name. " + (_NAME_HELP if "name" in ops else "")
                ).strip(),
            ),
        ),
    }
    if mode != "name":
        fields["section"] = (str, Field("", description=_SECTION_HELP))
        fields["id"] = (str, Field("", description=_ID_HELP))
    return create_model("RememberOp", **fields)


def _remember_help(mode: RememberMode) -> str:
    if mode == "name":
        return (
            "Usually empty. When the person tells you their name, one op name with "
            "it, so you won't need to ask again."
        )
    return (
        "Usually empty. What to remember about this person for next time, as the "
        "memory section says; at most 3."
    )


@lru_cache(maxsize=32)
def _step_schema(
    tools: Tuple[Tuple[str, Type[BaseModel]], ...],
    reply: bool = True,
    remember: Optional[RememberMode] = None,
) -> Type[BaseModel]:
    names = ((REPLY_ACTION,) if reply else ()) + tuple(name for name, _ in tools)
    # An Enum rather than a Literal: a one-value Literal renders as JSON Schema
    # `const`, which not every provider's structured output accepts; an enum
    # renders as `enum` whatever its size.
    action = Enum("AgentAction", {name: name for name in names}, type=str)
    fields: Dict[str, Any] = {"action": (action, action(names[0]))}
    # One input field per tool, named after it. Defaults rather than Optional, so
    # the model may leave the fields of tools it is not calling at their empty
    # defaults.
    for name, input_model in tools:
        fields[name] = (input_model, Field(default_factory=input_model))
    fields.update(_REPLY_FIELDS)
    if remember:
        # Any step may carry it, the reply included, so remembering never costs
        # a step or a model call (chunk 8a).
        fields["remember"] = (
            List[remember_model(remember)],  # type: ignore[valid-type]
            Field(default_factory=list, description=_remember_help(remember)),
        )
    return create_model("AgentStep", **fields)


def step_schema(
    tools: Sequence[Any],
    *,
    reply: bool = True,
    remember: Optional[RememberMode] = None,
) -> Type[BaseModel]:
    """The step schema for these tools (`Tool` objects); reply-only when empty, and
    tools-only when `reply` is false.

    The schema is passed to the provider, so a tool that is not offered cannot be
    named in `action` at all.
    """
    return _step_schema(
        tuple((tool.name, tool.input_model) for tool in tools),
        reply=reply or not tools,
        remember=remember,
    )
