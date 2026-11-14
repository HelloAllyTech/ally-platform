"""Memory, light (chunk 8a): what a run sees of the person, and what it asks to
remember.

Nothing here stores anything. A run's `remember` ops are collected into
`memory_writes` and returned; ally-be checks them and applies them after the reply
has been sent, never for a crisis, Safety, hand-over or failed run, never in Try it.
"""

from __future__ import annotations

from typing import Any, Dict, List, Mapping, Optional, Sequence

from app.core.agent_runtime.schemas import MAX_REMEMBER_PER_STEP, RememberMode
from app.core.agent_runtime.tools.lists import offers_create
from app.prompts.resolver import load_and_format

MEMORY_PROMPT_PATH = "agent/memory"
#: Shown when memory is on and the person has no lines yet, so `remember` still has
#: its rules.
NO_LINES = "(nothing yet)"
NO_NEVER_STORE = "(nothing else listed)"
SECTIONS = ("preferences", "context", "open_items")
MAX_TEXT = 200
MAX_NAME = 80
#: Memory writes one run may return in all (a rewrite repeats the reply step).
MAX_WRITES_PER_RUN = 6


def remember_mode(bot: Mapping[str, Any]) -> Optional[RememberMode]:
    """What `remember` may do on this run: memory ops when the bot's memory is on,
    the person's name when a create tool is offered (so a booking doesn't ask for it
    twice), both, or nothing (the step schema is then today's)."""
    memory = "memory" in bot
    name = offers_create(bot.get("gateway_definitions"))
    if memory and name:
        return "memory_and_name"
    if memory:
        return "memory"
    if name:
        return "name"
    return None


def memory_section(
    bot: Mapping[str, Any], prompts: Optional[Dict[str, Any]] = None
) -> str:
    """The "What you know about this person" section, or "" with memory off."""
    memory = bot.get("memory")
    if memory is None:
        return ""
    lines = (memory.get("lines") or "").strip() or NO_LINES
    never = [n.strip() for n in memory.get("never_store") or [] if n and n.strip()]
    return load_and_format(
        MEMORY_PROMPT_PATH,
        prompts=prompts,
        lines=lines,
        never_store="\n".join(f"- {n}" for n in never) or NO_NEVER_STORE,
    ).strip()


def history_lead(bot: Mapping[str, Any]) -> str:
    """What goes ahead of the last messages: the person's name and this chat's
    rolling summary, each only when there is one. "" keeps the history as today."""
    lines: List[str] = []
    name = (bot.get("person_name") or "").strip()
    if name:
        lines.append(f"The person's name: {name}")
    summary = (bot.get("summary") or "").strip()
    if summary:
        lines.append(f"Earlier in this chat (a summary): {summary}")
    return "\n".join(lines)


def personal_context(bot: Mapping[str, Any]) -> str:
    """What the run was given about the person, for the check (chunk 8a): their
    memory lines, this chat's summary and their name. "" when none."""
    memory = bot.get("memory") or {}
    parts = [
        (memory.get("lines") or "").strip(),
        (bot.get("summary") or "").strip(),
        (bot.get("person_name") or "").strip(),
    ]
    return "\n".join(p for p in parts if p)


def _clean(op: Mapping[str, Any], mode: RememberMode) -> Optional[Dict[str, Any]]:
    kind = str(op.get("op") or "")
    text = " ".join(str(op.get("text") or "").split())
    ref = str(op.get("id") or "").strip()
    section = str(op.get("section") or "").strip()
    if kind == "name":
        if mode == "memory" or not text or len(text) > MAX_NAME:
            return None
        return {"op": "name", "text": text}
    if mode == "name":
        return None
    if kind == "add":
        if section not in SECTIONS or not text:
            return None
        return {"op": "add", "section": section, "text": text[:MAX_TEXT]}
    if kind == "replace":
        if not ref or not text:
            return None
        write = {"op": "replace", "id": ref, "text": text[:MAX_TEXT]}
        if section in SECTIONS:
            write["section"] = section
        return write
    if kind in ("done", "forget"):
        return {"op": kind, "id": ref} if ref else None
    return None


def collect(
    so_far: Sequence[Dict[str, Any]],
    step: Mapping[str, Any],
    mode: Optional[RememberMode],
) -> List[Dict[str, Any]]:
    """The run's writes with this step's added: well-formed ones only, at most three
    a step and six a run, and no repeats (a rewritten reply asks again)."""
    out = list(so_far)
    if not mode:
        return out
    for op in (step.get("remember") or [])[:MAX_REMEMBER_PER_STEP]:
        write = _clean(op or {}, mode)
        if write and write not in out and len(out) < MAX_WRITES_PER_RUN:
            out.append(write)
    return out


def trace_summary(writes: Sequence[Mapping[str, Any]]) -> str:
    """Counts only, never the text: the trace is shown to owners and logged."""
    counts: Dict[str, int] = {}
    for write in writes:
        counts[write["op"]] = counts.get(write["op"], 0) + 1
    return "would remember: " + ", ".join(f"{n} {op}" for op, n in counts.items())
