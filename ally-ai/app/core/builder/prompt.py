"""What the builder's prompts are given, as text.

Every section is capped: the builder reads summaries of pages, never whole pages
(extraction aside), so a 50-page site costs the same as a 5-page one per step.
"""

from __future__ import annotations

import json
from typing import Dict, Iterable, List, Optional, Sequence

from app.schemas.builder import (
    BotDraft,
    HistoryTurn,
    Learned,
    PageSummary,
    PageText,
    SafetyPackInfo,
)

SECTION_LABELS = {
    "about": "About",
    "services": "Services and prices",
    "hours": "Hours",
    "team": "Team",
    "location": "Location and contact",
    "policies": "Policies",
    "faqs": "Common questions",
    "brand": "Brand",
}

#: Characters of builder conversation the step reads.
HISTORY_CHARS = 4000
HISTORY_TURNS = 12
#: Facts the prompts read, most recent kept when over.
LEARNED_FACTS = 120


def format_learned(learned: Learned) -> str:
    facts = learned.facts[-LEARNED_FACTS:]
    if not facts:
        return "(nothing yet)"
    lines: List[str] = []
    for section, label in SECTION_LABELS.items():
        found = [fact for fact in facts if fact.section.value == section]
        if not found:
            continue
        lines.append(f"## {label}")
        for fact in found:
            source = "from the owner" if fact.byOwner else fact.sourceUrl
            lines.append(f"- {fact.text} (source: {source})")
    return "\n".join(lines)


def format_pages(pages: Sequence[PageSummary], *, snippets: bool = True) -> str:
    if not pages:
        return "(no pages read)"
    lines: List[str] = []
    for n, page in enumerate(pages, 1):
        lines.append(f"{n}. {page.title or '(untitled)'} — {page.url}")
        if page.headings:
            lines.append(f"   Headings: {'; '.join(page.headings[:12])}")
        if snippets and page.snippet:
            lines.append(f"   {page.snippet}")
    return "\n".join(lines)


def format_page_texts(pages: Sequence[PageText]) -> str:
    """Numbered pages for extraction: the number is what a fact cites."""
    return "\n\n".join(
        f"[Page {n}] {page.title or '(untitled)'} — {page.url}\n{page.text.strip()}"
        for n, page in enumerate(pages, 1)
    )


def format_answers(answers: Dict[str, str], labels: Dict[str, str]) -> str:
    shown = {k: v for k, v in answers.items() if v and k != "pending"}
    if not shown:
        return "(none yet)"
    return "\n".join(f"- {labels.get(k, k)}: {v}" for k, v in shown.items())


def format_draft(draft: BotDraft) -> str:
    """The fields the builder works on; never the documents or the access list."""
    view = {
        "name": draft.name,
        "assistantName": draft.assistantName,
        "introduction": draft.introduction,
        "tone": draft.tone,
        "languages": draft.languages,
        "topics": draft.topics,
        "suggestedQuestions": draft.suggestedQuestions,
        "declineText": draft.declineText,
        "design": draft.design.value if draft.design else None,
    }
    return json.dumps(view, ensure_ascii=False, indent=1)


def format_pack(pack: SafetyPackInfo) -> str:
    lines = [f"{pack.name} (always on)"]
    if pack.always:
        lines.append("Always: " + " ".join(pack.always))
    if pack.never:
        lines.append("Never: " + " ".join(pack.never))
    if pack.at_risk:
        lines.append("If someone may be at risk: " + " ".join(pack.at_risk))
    return "\n".join(lines)


def format_history(history: Iterable[HistoryTurn]) -> str:
    turns = list(history)[-HISTORY_TURNS:]
    if not turns:
        return "(this is the start)"
    lines: List[str] = []
    used = 0
    for turn in reversed(turns):
        who = {"builder": "You", "owner": "Owner", "note": "Note"}[turn.role]
        line = f"{who}: {turn.text.strip()}"
        used += len(line)
        if used > HISTORY_CHARS:
            break
        lines.append(line)
    return "\n".join(reversed(lines))


def format_list(items: Optional[Sequence[str]], empty: str = "(none)") -> str:
    return "\n".join(f"- {item}" for item in items or []) or empty
