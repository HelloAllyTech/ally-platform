"""Key facts (Q4 G3): the few facts an assistant must always know.

Up to about ten of the organisation's facts (its contact, hours, fees, what it
does and where), chosen by ally-be from what setup learned and the owner gave,
are in every run's passages from the start, so an answer never depends on a
search finding them ("zero-funds, we don't take money" missed for "₹10,000,
80G?"). They are citable like any passage, under the document they come from,
and, like the entries carried over from the last message, never count as what
this run's search found.
"""

from __future__ import annotations

import uuid
from typing import Any, Dict, List, Mapping

#: At most this many facts, and this many characters in all (about 500 tokens).
MAX_FACTS = 10
MAX_CHARS = 2000

_NAMESPACE = uuid.UUID("6f1c2e0a-6d55-4c7e-9a43-7b0f0c1d2e3f")


def key_fact_passages(bot: Mapping[str, Any]) -> List[Dict[str, Any]]:
    from app.core.config import settings

    if not settings.AGENT_RUNTIME.KEY_FACTS:
        return []
    block = bot.get("key_facts") or {}
    facts = [str(f).strip() for f in block.get("facts") or [] if str(f).strip()]
    document_id = str(block.get("document_id") or "")
    title = str(block.get("title") or "What we learned")
    passages: List[Dict[str, Any]] = []
    used = 0
    for index, text in enumerate(facts[:MAX_FACTS]):
        if used + len(text) > MAX_CHARS:
            break
        used += len(text)
        passages.append(
            {
                # Stable per fact, so the same fact cited twice is one source.
                "chunk_id": str(uuid.uuid5(_NAMESPACE, f"{document_id}:{text}")),
                "document_id": document_id,
                "document_title": title,
                "chunk_index": index,
                "text": text,
                "char_start": 0,
                "char_end": len(text),
                "page_from": 0,
                "page_to": 0,
                "section_path": "Key facts",
                "source_url": "",
                "language": "en",
                "token_count": max(1, len(text) // 4),
                "similarity": 1.0,
                "key_fact": True,
            }
        )
    return passages
