"""Who the bot speaks for: the organisation's names and topics, from its config."""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass
from typing import List, Tuple

from app.core.agent_runtime.state import BotConfig

#: Words in a bot's or a document's name that don't identify an organisation.
_GENERIC_NAME_WORDS = {
    "faq",
    "faqs",
    "bot",
    "chatbot",
    "assistant",
    "helper",
    "help",
    "support",
    "desk",
    "chat",
    "team",
    "info",
    "the",
    "and",
    "for",
    "guide",
    "docs",
}


@dataclass(frozen=True)
class Organisation:
    """How the check recognises a message or reply about the organisation."""

    #: The bot's own name: masked first, so "I'm Ally FAQ" is not about the
    #: organisation.
    self_names: Tuple[str, ...] = ()
    #: Names that mean the organisation or its product.
    terms: Tuple[str, ...] = ()
    #: What the bot covers, by document title ("About Ally", "Privacy and Data").
    topics: Tuple[str, ...] = ()

    def topics_named_in(self, text: str) -> int:
        """How many topics `text` mentions, by any of a topic's distinctive words
        ("Getting Access and Signing In" by "access" or "signing"): a topic list
        when three or more."""
        lowered = (text or "").lower()
        return sum(
            1
            for topic in self.topics
            if any(
                re.search(rf"\b{re.escape(word)}", lowered)
                for word in _topic_words(topic)
            )
        )

    def named_in(self, text: str) -> bool:
        if not self.terms or not text:
            return False
        for name in self.self_names:
            text = re.sub(re.escape(name), " ", text, flags=re.IGNORECASE)
        return any(
            re.search(rf"(?<!\w){re.escape(term)}(?!\w)", text, re.IGNORECASE)
            for term in self.terms
        )


_TOPIC_STOPWORDS = {"about", "getting", "using", "where", "what", "with", "their"}


def _topic_words(topic: str) -> List[str]:
    """A topic's distinctive words: five letters or more, not filler."""
    return [
        word
        for word in re.findall(r"[a-z]+", topic.lower())
        if len(word) >= 5 and word not in _TOPIC_STOPWORDS
    ]


def organisation_of(bot: BotConfig) -> Organisation:
    """The organisation's names, from the bot: its display name and the name its
    documents share ("Ally FAQ – About Ally" → "Ally FAQ"), plus their distinctive
    words ("Ally"). A bot with neither has no names, and only citations apply."""
    persona = bot.get("persona") or {}
    display = (persona.get("display_name") or "").strip()
    names: List[str] = [display] if display else []
    topics: List[str] = []
    split = [
        [part.strip() for part in re.split(r"\s[–—-]\s", topic, maxsplit=1)]
        for topic in bot.get("knowledge_topics") or []
    ]
    # The name is the side the titles share: "Ally FAQ – About Ally" puts it first,
    # a crawled page's "Batch timings — Bright Minds Academy" last (chunk 20a-2).
    lefts = Counter(parts[0] for parts in split if len(parts) == 2)
    rights = Counter(parts[1] for parts in split if len(parts) == 2)
    for parts in split:
        if len(parts) != 2 or not parts[0]:
            topics.append(parts[-1])
            continue
        left, right = parts
        right_is_name = right and (
            right == display or (rights[right] >= 2 and lefts[left] < 2)
        )
        if right_is_name and left != display:
            names.append(right)
            topics.append(left)
        else:
            names.append(left)
            topics.append(right)
    terms: List[str] = []
    for name in names:
        terms.append(name)
        terms += [
            word
            for word in re.findall(r"[\w']+", name)
            if len(word) >= 3
            and word[0].isupper()
            and word.lower() not in _GENERIC_NAME_WORDS
        ]
    unique = tuple(dict.fromkeys(t for t in terms if t))
    return Organisation(
        self_names=(display,) if display else (),
        terms=unique,
        topics=tuple(t for t in topics if t),
    )
