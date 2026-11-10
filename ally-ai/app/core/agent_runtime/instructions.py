"""The instructions an assistant follows, as the owner's "How it works" shows them
(chunk 20d-2).

Single source: the text comes from the run's own prompt builder (`build_agent_prompt`,
with the same inputs the first step of a run uses), so nothing is copied that can
drift. It is then split into labelled parts in the order they appear, which join back
into exactly the same text (a test holds that). The owner's own parts are marked.

Nothing here calls a model. The knowledge agent's prompt code is used, not changed.
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

from app.core.agent_runtime.prompt import build_agent_prompt
from app.core.agent_runtime.tools import allowed_tools
from app.core.builder.change import weakens_safety
from app.core.config import settings
from app.core.knowledge_agent.prompt import (
    MAX_PERSONA_PROMPT_CHARS,
    format_persona,
    format_purpose,
)

#: Where the passages found for each question go, as the owner reads it.
PASSAGES_PLACEHOLDER = "(the parts of your pages it finds for each question)"
QUESTION_PLACEHOLDER = "(the visitor's message)"

#: The parts of the text the owner writes (and can edit in place).
OWNER_LAYERS = {"business", "tone", "instructions", "avoid"}


def first_step_prompt(bot: Dict[str, Any]) -> str:
    """The prompt the first step of a run for this bot is given, with the visitor's
    message and the passages left as placeholders (they change with every question)."""
    return build_agent_prompt(
        QUESTION_PLACEHOLDER,
        passages=[],
        history=None,
        searches=(),
        feedback=None,
        answer_mode=bot.get("answer_mode"),
        tools=allowed_tools(bot),
        # A run's first step has every search left.
        tool_budget=settings.AGENT_RUNTIME.MAX_TOOL_CALLS,
        knowledge_topics=bot.get("knowledge_topics"),
        decline_text=bot.get("decline_text"),
        max_chars=bot.get("max_answer_chars") or 1400,
        persona=bot.get("persona"),
        prompts=bot.get("prompts"),
    )


def _find(text: str, part: str, start: int) -> int:
    return text.find(part, start) if part else -1


def split_parts(bot: Dict[str, Any], full: str) -> List[Dict[str, Any]]:
    """The full text cut into labelled parts, in order. Joined, they are `full`.

    The persona block is located by the same pieces `format_persona` writes; anything
    not recognised stays in the part around it, so the parts always add up.
    """
    persona = bot.get("persona") or {}
    prompts = bot.get("prompts")
    block = format_persona(persona, prompts) if persona else ""
    marks: List[tuple[int, str]] = []
    if block and full.startswith(block):
        name = (persona.get("display_name") or "").strip()
        tone = (persona.get("tone") or "").strip()
        instructions = (persona.get("system_prompt") or "").strip()[
            :MAX_PERSONA_PROMPT_CHARS
        ]
        rules = (persona.get("safety_rules") or "").strip()
        purpose = format_purpose(persona, prompts)
        at = 0
        for layer, piece in (
            ("business", f"You are {name}." if name else ""),
            ("tone", f"Your tone: {tone}." if tone else ""),
            ("instructions", instructions.replace('"""', "''") if instructions else ""),
            ("purpose", purpose),
            ("safety", rules),
        ):
            found = _find(block, piece, at)
            if found >= 0:
                marks.append((found, layer))
                # The part runs to the next mark; topics to avoid sit inside the rules.
                at = found + len(piece)
                if layer == "safety":
                    for topic in persona.get("avoid_topics") or []:
                        line = f"Talk about {topic}"
                        hit = full.find(line, found, found + len(piece))
                        if hit >= 0:
                            # From the start of its line.
                            line_start = full.rfind("\n", found, hit) + 1
                            marks.append((line_start, "avoid"))
                            marks.append((hit + len(line), "safety"))
        marks.append((len(block), "base"))
    else:
        marks.append((0, "base"))
    marks.sort(key=lambda m: m[0])
    if marks[0][0] != 0:
        marks.insert(0, (0, "business"))
    parts: List[Dict[str, Any]] = []
    for index, (start, layer) in enumerate(marks):
        end = marks[index + 1][0] if index + 1 < len(marks) else len(full)
        text = full[start:end]
        if not text:
            continue
        if parts and parts[-1]["layer"] == layer:
            parts[-1]["text"] += text
        else:
            parts.append({"layer": layer, "text": text, "owner": layer in OWNER_LAYERS})
    return parts


def search_settings(bot: Dict[str, Any]) -> Dict[str, Any]:
    """How it finds answers: the search limits a run starts with, and the documents."""
    limits = bot.get("limits") or {}
    defaults = settings.KNOWLEDGE_AGENT
    return {
        "top_k": limits.get("top_k") or defaults.TOP_K,
        "max_passages": limits.get("max_passages") or defaults.MAX_PASSAGES,
        "min_similarity": limits.get("min_similarity") or defaults.MIN_SIMILARITY,
        "searches": settings.AGENT_RUNTIME.MAX_TOOL_CALLS,
        "documents": len(bot.get("document_ids") or []),
    }


def describe(bot: Dict[str, Any]) -> Dict[str, Any]:
    full = first_step_prompt(bot)
    parts = split_parts(bot, full) if full else []
    if "".join(p["text"] for p in parts) != full:
        # Never shown wrong: the whole text, without labels.
        parts = [{"layer": "base", "text": full, "owner": False}]
    return {
        "full": full,
        "parts": parts,
        "placeholders": {
            "question": QUESTION_PLACEHOLDER,
            "passages": PASSAGES_PLACEHOLDER,
        },
        "search": search_settings(bot),
    }


# ── Checking the owner's own instructions before they're saved ──────────────

_INJECTION = re.compile(
    r"\b(ignore|disregard|forget|override)\b[^.\n]{0,40}"
    r"\b(previous|prior|above|earlier|all|your|the)\b[^.\n]{0,20}"
    r"\b(instructions?|rules?|prompts?|guidelines?)\b"
    r"|\byou are now\b|\bpretend (to be|you are)\b|\bjailbreak\b"
    r"|\bpichl[ie] (baat|instructions?)\b.{0,20}\b(bhool|ignore)"
    r"|पिछले\s+निर्देश",
    re.IGNORECASE,
)


def check_owner_text(text: str) -> Dict[str, Optional[str]]:
    """The builder's safety check, applied to text the owner typed: `refused` when it
    would weaken a safety rule, `warning` when it reads like an attempt to override the
    assistant's rules (saved, but the owner is told it won't outrank them)."""
    if weakens_safety(text):
        return {"refused": "weakens_safety", "warning": None}
    if _INJECTION.search(text or ""):
        return {"refused": None, "warning": "override_attempt"}
    return {"refused": None, "warning": None}
