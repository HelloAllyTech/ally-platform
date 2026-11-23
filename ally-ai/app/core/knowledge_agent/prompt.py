"""Prompt assembly for the knowledge agent.

Templates live in app/prompts/knowledge/*.txt and are resolved through the shared
resolver, so ally-be's prompt management can override the text, model and temperature at
runtime. Everything here is the part that must NOT be overridable: how retrieved
passages are numbered and laid out, because the citation contract depends on those
numbers.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from app.prompts.resolver import load_and_format

ANSWER_PROMPT_PATH = "knowledge/whatsapp_answer"
# Bots allowed to answer beyond their documents (`documents_and_general`).
GENERAL_ANSWER_PROMPT_PATH = "knowledge/answer_general"
TRANSLATE_PROMPT_PATH = "knowledge/translate_query"
CRISIS_PROMPT_PATH = "knowledge/crisis_classify"

# Cap per passage when rendering. A single pathological chunk cannot be allowed to crowd
# the others out of the prompt; ally-be's chunker targets ~400 tokens, so this only ever
# bites on malformed input.
MAX_PASSAGE_CHARS = 4000

# Cap on rendered history. Two or three turns of context is enough to resolve "what
# about for children?"; more just costs tokens on every question.
MAX_HISTORY_TURNS = 6
MAX_HISTORY_CHARS = 1500

# The crisis check's view of the sender's earlier messages (ally-be sends the same
# limits; these hold if it doesn't). Enough to read "I mean it" after a disclosure.
MAX_CRISIS_HISTORY_MESSAGES = 5
MAX_CRISIS_HISTORY_CHARS = 1500
NO_CRISIS_HISTORY = "(no earlier messages)"


def format_passages(passages: List[Dict[str, Any]]) -> str:
    """
    Render retrieved passages as a numbered list.

    The numbers ARE the citation contract: the model returns integers, and those
    integers are mapped back to chunk ids here rather than trusted from the model. So
    numbering starts at 1, is contiguous, and matches the order of `passages` exactly —
    the caller resolves `citations` positionally against the same list it passed in.

    Source metadata is included per passage because the model needs to be able to tell
    two passages apart when deciding which it used, but it is told not to reproduce it:
    the source lines are rendered by ally-be from the resolved citations, not copied out
    of the answer text.
    """
    if not passages:
        return "(no passages were retrieved)"

    blocks: List[str] = []
    for index, passage in enumerate(passages, start=1):
        text = (passage.get("text") or "").strip()
        if len(text) > MAX_PASSAGE_CHARS:
            text = text[:MAX_PASSAGE_CHARS].rstrip() + "…"

        source_bits: List[str] = []
        title = (passage.get("document_title") or "").strip()
        if title:
            source_bits.append(title)
        page_from = int(passage.get("page_from") or 0)
        page_to = int(passage.get("page_to") or 0)
        if page_from:
            if page_to and page_to != page_from:
                source_bits.append(f"pp. {page_from}-{page_to}")
            else:
                source_bits.append(f"p. {page_from}")
        section = (passage.get("section_path") or "").strip()
        if section:
            source_bits.append(section)
        source = " · ".join(source_bits) if source_bits else "untitled source"

        blocks.append(f"[{index}] {source}\n{text}")

    return "\n\n".join(blocks)


def format_history(
    history: Optional[List[Dict[str, str]]],
    *,
    max_turns: int = MAX_HISTORY_TURNS,
    max_chars: int = MAX_HISTORY_CHARS,
) -> str:
    """
    Render recent turns as plain labelled lines.

    Trimmed to the most recent turns rather than the earliest: a follow-up depends on
    what was just said, and an old turn that no longer applies is worse than no context,
    because the model may answer the previous question again.
    """
    if not history:
        return "(no previous messages)"

    recent = history[-max_turns:]
    lines: List[str] = []
    for turn in recent:
        role = (turn.get("role") or "").strip().lower()
        content = " ".join((turn.get("content") or "").split())
        if not content:
            continue
        speaker = "Worker" if role in ("user", "worker", "human") else "Assistant"
        lines.append(f"{speaker}: {content}")

    rendered = "\n".join(lines)
    if len(rendered) > max_chars:
        # Keep the TAIL when trimming — the newest turn is the one the question refers
        # to.
        rendered = "…\n" + rendered[-max_chars:]
    return rendered or "(no previous messages)"


MAX_PERSONA_PROMPT_CHARS = 4000
_FENCE = '"""'


#: Purposes with a section of their own (chunk 20a-2); "custom" uses the owner's note.
PURPOSES = ("answer", "enquiries", "training", "guide")


def channel_words(channel: Optional[str]) -> str:
    """Where the chat is, as the can-book section says it (chunk 8a)."""
    return (
        "WhatsApp" if (channel or "").strip().lower() == "whatsapp" else "the website"
    )


def format_purpose(
    persona: Dict[str, Any],
    prompts: Optional[Dict[str, Any]] = None,
    *,
    can_book: bool = False,
    channel: Optional[str] = None,
    takes_details: bool = False,
) -> str:
    """What the assistant is for: the purpose's seed section, or for "Something else"
    the owner's own description, fenced like their instructions. Empty when the bot
    has no purpose, so bots made before purposes run exactly as before.

    `can_book` (the run offers a create tool) picks Bring in customers' booking
    variant (chunk 8a), whose rules sit with the lists section's instead of against
    them. `takes_details` (a create tool on a list that takes the person's details:
    Leads, Callback requests) picks Answer questions' variant that offers to take
    their details when it can't answer (chunk 6b). Without either, the section is
    exactly as before."""
    purpose = (persona.get("purpose") or "").strip()
    # Q3-fast Part 2b: the purpose sets the goal and tone only. What a list's tools
    # add (booking, taking details) comes from its playbook, whatever the purpose,
    # so the `can_book` and `takes_details` variants are no longer used.
    if purpose in PURPOSES:
        return load_and_format(f"agent/purpose_{purpose}", prompts=prompts).strip()
    note = (persona.get("purpose_note") or "").strip()[:600]
    if purpose == "custom" and note:
        return "\n".join(
            [
                "# What you're for",
                "What the team that runs you wants you to do. The rules after this "
                "still win.",
                _FENCE,
                note.replace(_FENCE, "''"),
                _FENCE,
            ]
        )
    return ""


def format_persona(
    persona: Optional[Dict[str, Any]],
    prompts: Optional[Dict[str, Any]] = None,
    *,
    lists: str = "",
    memory: str = "",
    can_book: bool = False,
    channel: Optional[str] = None,
    takes_details: bool = False,
    mood: str = "",
    playbooks: str = "",
) -> str:
    """
    Render a chatbot's persona as a block that goes AHEAD of the answer template.

    Prepended in code rather than passed as a template variable, so it works with
    whatever answer text is live in the Skills Store — no publish has to wait for a
    deploy. The admin's instructions are fenced and explicitly ranked below the
    template's rules: a system prompt can change voice and focus, never the grounding,
    citation, format, language or safety rules that follow it.

    Empty (no persona) renders as nothing, so a bot without one runs the template
    exactly as before.

    `lists` is the agent's lists section (chunk 6), placed right after the purpose;
    empty unless the run has list tools. `memory` is what the assistant knows about
    the person (chunk 8a), right after the lists; empty with memory off.
    """
    if not persona and not lists and not memory and not mood and not playbooks:
        return ""
    persona = persona or {}
    name = (persona.get("display_name") or "").strip()
    tone = (persona.get("tone") or "").strip()
    instructions = (persona.get("system_prompt") or "").strip()[
        :MAX_PERSONA_PROMPT_CHARS
    ]
    rules = (persona.get("safety_rules") or "").strip()
    purpose = format_purpose(
        persona,
        prompts,
        can_book=can_book,
        channel=channel,
        takes_details=takes_details,
    )
    if not (
        name
        or tone
        or instructions
        or rules
        or purpose
        or lists
        or memory
        or mood
        or playbooks
    ):
        return ""

    lines = ["# Who you are"]
    if name:
        lines.append(f"You are {name}.")
    if tone:
        lines.append(f"Your tone: {tone}.")
    if instructions:
        lines.append(
            "Instructions from the team that runs you. They shape your voice and "
            "focus; where they conflict with the rules after them (sources, citations, "
            "format, language, safety), those rules win."
        )
        lines.append(_FENCE)
        # The admin's text cannot close the fence early.
        lines.append(instructions.replace(_FENCE, "''"))
        lines.append(_FENCE)
    if purpose:
        # After the owner's instructions and before the safety rules: a purpose
        # shapes how the assistant uses what it knows, and safety still wins.
        lines.append(purpose)
    if lists:
        # How to use the business's lists (chunk 6): after the purpose, whose
        # "never name a time" rule it replaces for an assistant that can book.
        lines.append(lists)
    if playbooks:
        # What each kind of list tool adds (Q3-fast Part 2b), right after the lists
        # section and before the safety rules.
        lines.append(playbooks)
    if memory:
        # What the assistant knows about the person (chunk 8a): before the safety
        # rules, which it never overrides.
        lines.append(memory)
    if mood:
        # How they feel (Q3-fast Part 1): only when upset, before the safety
        # rules, which it never overrides.
        lines.append(mood)
    if rules:
        # Built by ally-be from the bot's safety pack, never from an editor's text; it
        # comes after the instructions so nothing in them can talk it away.
        lines.append(rules)
    return "\n".join(lines) + "\n\n"


def build_answer_prompt(
    question: str,
    *,
    passages: List[Dict[str, Any]],
    history: Optional[List[Dict[str, str]]] = None,
    max_chars: int = 1400,
    prompts: Optional[Dict[str, Any]] = None,
    persona: Optional[Dict[str, Any]] = None,
    general: bool = False,
) -> str:
    """
    Assemble the answer prompt, honouring any ally-be override of the template.

    `general` picks the template for bots allowed to answer beyond their documents.
    """
    body = load_and_format(
        GENERAL_ANSWER_PROMPT_PATH if general else ANSWER_PROMPT_PATH,
        prompts=prompts,
        question=question.strip(),
        passages=format_passages(passages),
        history=format_history(history),
        max_chars=max_chars,
    )
    if not body:
        return body
    return format_persona(persona, prompts) + body


def build_translate_prompt(
    question: str, *, prompts: Optional[Dict[str, Any]] = None
) -> str:
    """Assemble the query-preparation prompt."""
    return load_and_format(
        TRANSLATE_PROMPT_PATH,
        prompts=prompts,
        question=question.strip(),
    )


def format_crisis_history(history: Optional[List[str]]) -> str:
    """
    Render the sender's earlier messages for the crisis check, oldest first.

    The newest messages are kept: a follow-up is read against what was just said. A
    message that crosses the character budget keeps its end, and older ones are dropped.
    """
    messages = [" ".join((m or "").split()) for m in history or []]
    messages = [m for m in messages if m][-MAX_CRISIS_HISTORY_MESSAGES:]
    kept: List[str] = []
    budget = MAX_CRISIS_HISTORY_CHARS
    for message in reversed(messages):
        if budget <= 0:
            break
        if len(message) > budget:
            message = "…" + message[-(budget - 1) :] if budget > 1 else "…"
        kept.insert(0, message)
        budget -= len(message)
    return "\n".join(f"- {m}" for m in kept) or NO_CRISIS_HISTORY


def build_crisis_prompt(
    message: str,
    *,
    history: Optional[List[str]] = None,
    prompts: Optional[Dict[str, Any]] = None,
) -> str:
    """Assemble the crisis-classification prompt.

    A text without `{history}` ignores it, so the same code renders an older version of
    the prompt exactly as before.
    """
    return load_and_format(
        CRISIS_PROMPT_PATH,
        prompts=prompts,
        message=message.strip(),
        history=format_crisis_history(history),
    )
