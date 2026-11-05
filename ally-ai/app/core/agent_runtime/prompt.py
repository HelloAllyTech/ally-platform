"""Prompt assembly for the conversational agent.

Templates are `app/prompts/agent/*.txt`, resolved through the shared resolver, so the
Skills Store can override the text, model and temperature. What is rendered here is
the part that must not be overridable: passage numbering (the citation contract),
the tool list (it must match the step schema) and the persona fence.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence

from app.core.knowledge_agent.prompt import (
    format_history,
    format_passages,
    format_persona,
)
from app.prompts.resolver import load_and_format

AGENT_PROMPT_PATH = "agent/system"

NO_TOPICS = (
    "(no topics listed: say you answer questions from the organisation's reference "
    "material)"
)


def format_topics(topics: Optional[Sequence[str]]) -> str:
    """One title per line: what the bot can truthfully say it covers."""
    lines = [f"- {topic.strip()}" for topic in topics or [] if topic and topic.strip()]
    return "\n".join(lines) or NO_TOPICS


def format_feedback(feedback: Optional[str]) -> str:
    """Why check sent the previous draft back; empty on a first draft."""
    if not feedback:
        return ""
    return f"\n# Your previous draft was not sent\n{feedback}\n"


def format_searches(records: Sequence[Dict[str, Any]]) -> str:
    """Searches made for this message, so the model does not repeat one."""
    if not records:
        return "(none yet)"
    lines: List[str] = []
    for record in records:
        added = record.get("added") or []
        found = (
            f"added passages {', '.join(str(n) for n in added)}"
            if added
            else "nothing relevant or new"
        )
        lines.append(f'- {record.get("tool")}: "{record.get("query", "")}" → {found}')
    return "\n".join(lines)


def format_tools(tools: Sequence[Any]) -> str:
    """Each tool's name, what it does and its input fields: the step schema's fields."""
    if not tools:
        return "(no tools left: reply now with what you have)"
    blocks: List[str] = []
    for tool in tools:
        fields = ", ".join(
            f"`{name}`: {info.description or name}"
            for name, info in tool.input_model.model_fields.items()
        )
        blocks.append(f"- `{tool.name}`: {tool.description} Input: {fields}.")
    return "\n".join(blocks)


def build_agent_prompt(
    message: str,
    *,
    passages: List[Dict[str, Any]],
    history: Optional[List[Dict[str, str]]] = None,
    searches: Sequence[Dict[str, Any]] = (),
    feedback: Optional[str] = None,
    tools: Sequence[Any] = (),
    tool_budget: int = 0,
    knowledge_topics: Optional[Sequence[str]] = None,
    decline_text: Optional[str] = None,
    max_chars: int = 1400,
    persona: Optional[Dict[str, Any]] = None,
    prompts: Optional[Dict[str, Any]] = None,
) -> str:
    """The agent step's prompt. Empty when the template is missing (the caller
    refuses to run unguided)."""
    body = load_and_format(
        AGENT_PROMPT_PATH,
        prompts=prompts,
        message=message.strip(),
        passages=format_passages(passages),
        history=format_history(history),
        feedback=format_feedback(feedback),
        searches=format_searches(searches),
        tools=format_tools(tools),
        tool_budget=tool_budget,
        knowledge_topics=format_topics(knowledge_topics),
        decline_text=(decline_text or "").strip() or "I don't have that information.",
        max_chars=max_chars,
    )
    if not body:
        return body
    # The persona goes first, fenced and ranked below the rules that follow, as in
    # the parity path's answer prompt.
    return format_persona(persona) + body
