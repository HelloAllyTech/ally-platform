"""What the working memory leaves behind at session end (phase 7).

Two kinds of thing survive a session, and they are not the same kind:

- **Episodic** — what happened. The rolling summary already carries this, and
  this module adds nothing to it.
- **Semantic** — what is now *true about this client*: what they disclosed, what
  they are still carrying, and how far they actually travelled. That is what a
  next session needs in order to open as a continuation rather than as a
  restart, and it is the half no existing mechanism records.

It rides inside `session_memory.structured` under one namespaced key rather than
as a new message type. `structured` is already a passthrough dict on the ally-be
side (`Record<string, any>`, read for the keys it knows and stored whole), so
this needs no wire change, no migration and no new consumer — the record is
persisted the moment the worker emits it, and a reader can be written later
against data that already exists.

**The groundedness cross-check is the point of this module, not a footnote.**
Everything in the ledger was proposed by an LLM. A disclosure the client never
actually made is worse than a forgotten one: it comes back next session as
established fact, in the client's own mouth, with nothing left to contradict it
— the model would be lying to itself with a citation. So before anything is
written out, every disclosure is checked against the transcript, and one that
cannot be found there does not survive the session.
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Sequence

from langchain_core.messages import BaseMessage

from app.core.logger import get_logger
from app.core.working_memory.state import ClientWorkingMemory

logger = get_logger(__name__)

_WORD_RE = re.compile(r"[\w']+", re.UNICODE)

#: Share of a disclosure's content words that must appear in the transcript for
#: it to count as grounded.
#:
#: 0.6 rather than 1.0 because the check has to survive legitimate paraphrase:
#: the updater writes "she lost her job in March" for a client who said "work
#: ended just after Pongal", and demanding every word would discard true
#: disclosures wholesale. It is set to catch INVENTION — a fact with no lexical
#: footprint in the conversation at all — not to enforce quotation.
_GROUNDING_THRESHOLD = 0.6

#: Words too short to carry meaning in the overlap count. Same threshold the
#: recall keyword filter uses, for the same reason.
_MIN_WORD_LEN = 4


def _content_words(text: str) -> set[str]:
    return {w.lower() for w in _WORD_RE.findall(text or "") if len(w) >= _MIN_WORD_LEN}


def _transcript_words(messages: Sequence[BaseMessage]) -> set[str]:
    """Every content word spoken by anyone, both sides.

    Both sides deliberately: the client discloses in its own words, and a
    disclosure the counsellor named first ("so you lost the job?") and the
    client confirmed is genuinely grounded even though the client never said
    the noun.
    """
    words: set[str] = set()
    for message in messages:
        content = getattr(message, "content", None)
        if isinstance(content, str):
            words |= _content_words(content)
    return words


def check_grounding(
    texts: Sequence[str],
    messages: Sequence[BaseMessage],
) -> tuple[List[str], List[str]]:
    """Split `texts` into (grounded, ungrounded) against the transcript.

    With no transcript to check against, everything is returned as grounded —
    an empty transcript is missing evidence, not evidence of invention, and
    silently discarding a whole ledger because the messages were unreadable
    would be the worse failure.
    """
    if not messages:
        return list(texts), []

    spoken = _transcript_words(messages)
    grounded: List[str] = []
    ungrounded: List[str] = []
    for text in texts:
        words = _content_words(text)
        if not words:
            continue
        overlap = len(words & spoken) / len(words)
        (grounded if overlap >= _GROUNDING_THRESHOLD else ungrounded).append(text)
    return grounded, ungrounded


def build_writeout(
    memory: ClientWorkingMemory,
    messages: Sequence[BaseMessage] = (),
) -> Optional[Dict[str, Any]]:
    """The semantic record, or None when there is nothing worth keeping.

    None rather than an empty skeleton: a session that ended before the client
    said anything should leave no trace, so the next session opens fresh
    instead of inheriting a record asserting that nothing happened.
    """
    grounded, ungrounded = check_grounding([f.text for f in memory.disclosed], messages)
    if ungrounded:
        # WARNING, not debug: an ungrounded disclosure means the updater
        # invented something, and that is worth seeing in production logs
        # rather than discovering later in a next session's prompt.
        logger.warning(
            "[working-memory] dropping %d ungrounded disclosure(s) at " "write-out: %s",
            len(ungrounded),
            ungrounded,
        )

    open_threads = [t.topic for t in memory.open_threads]
    withheld_still_locked = [w.topic for w in memory.withheld if w.status == "locked"]

    if not (grounded or open_threads or withheld_still_locked):
        return None

    return {
        # How far the client actually travelled, and by what route. The path
        # rather than the endpoint: "guarded -> testing -> guarded" and
        # "guarded -> testing -> engaged" end up in different places from the
        # same start, and a trainee who caused the first should not read as
        # having caused the second.
        "final_stance": memory.stance,
        "stance_path": list(memory.stance_path),
        "disclosed": grounded,
        # Named so a reader cannot mistake these for closed business.
        "unresolved_threads": open_threads,
        "still_withheld": withheld_still_locked,
        # Health, carried WITH the content so a consumer can weigh it. A record
        # from a session whose updater missed half its turns is thinner than one
        # from a session where every turn committed, and nothing downstream can
        # tell without being told.
        "updates_committed": memory.updates_committed,
        "updates_missed": memory.updates_missed,
        "ungrounded_dropped": len(ungrounded),
    }
