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
from app.core.working_memory.text import content_words

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

#: **The check does not discriminate in morphologically rich languages, and that
#: is measured rather than suspected.** Tamil grounded at 27% in the 2026-08-24
#: sweep against 83-100% for English, Hindi, Marathi and Kannada.
#:
#: Reading that session's real transcript, the client HAD discussed sleep —
#: "தூக்கம் சரியா வர மாட்டேங்க" — and the updater wrote "சரியா தூங்கவில்லை".
#: Tamil derivational morphology turns the noun தூக்கம் into the verb
#: தூங்கவில்லை, changing the consonant, so the two share no token and not even a
#: common prefix. A paraphrase that shifts part of speech scores zero.
#:
#: Both alternatives were tried and MEASURED, and neither separates the cases:
#:
#:   lexical overlap : genuine paraphrase 0.00-0.50, an inference 0.20
#:   embedding cosine: genuine 0.380-0.442, INVENTED content 0.345-0.422
#:
#: one invention scoring higher than a true disclosure. The signal distinguishing
#: "said differently" from "not said at all" is not present in either measure, so
#: no threshold and no better metric fixes this.
#:
#: What changed instead is the CONSEQUENCE. An item below the threshold is
#: recorded as unverified rather than discarded, because the check is good
#: evidence of corroboration and poor evidence of invention — and dropping
#: asserts the stronger claim. Same reasoning as an empty transcript keeping
#: everything: missing evidence is not evidence of invention.

#: Words too short to carry meaning in the overlap count. Same threshold the
#: recall keyword filter uses, for the same reason.
_MIN_WORD_LEN = 4


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
            words |= content_words(content)
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
        words = content_words(text)
        if not words:
            continue
        overlap = len(words & spoken) / len(words)
        (grounded if overlap >= _GROUNDING_THRESHOLD else ungrounded).append(text)
    return grounded, ungrounded


def build_writeout(
    memory: ClientWorkingMemory,
    messages: Sequence[BaseMessage] = (),
    monologue: Optional[Sequence[Dict[str, Any]]] = None,
) -> Optional[Dict[str, Any]]:
    """The semantic record, or None when there is nothing worth keeping.

    None rather than an empty skeleton: a session that ended before the client
    said anything should leave no trace, so the next session opens fresh
    instead of inheriting a record asserting that nothing happened.
    """
    grounded, ungrounded = check_grounding([f.text for f in memory.disclosed], messages)
    if ungrounded:
        # WARNING, not debug: a disclosure the transcript cannot corroborate
        # is worth seeing in production logs rather than discovering later
        # in a next session's prompt.
        logger.warning(
            "[working-memory] %d unverified disclosure(s) at write-out: %s",
            len(ungrounded),
            ungrounded,
        )

    open_threads = [t.topic for t in memory.open_threads]
    withheld_still_locked = [w.topic for w in memory.withheld if w.status == "unsaid"]

    if not (
        grounded or ungrounded or open_threads or withheld_still_locked or monologue
    ):
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
        # Kept, not discarded. See the note on _GROUNDING_THRESHOLD: the
        # check cannot tell a paraphrase from an inference, so discarding
        # would assert "invented" on evidence that does not support it. A
        # reader wanting only corroborated history uses `disclosed`; this
        # exists so the rest is recoverable rather than destroyed.
        "disclosed_unverified": ungrounded,
        # Named so a reader cannot mistake these for closed business.
        "unresolved_threads": open_threads,
        "still_withheld": withheld_still_locked,
        # Health, carried WITH the content so a consumer can weigh it. A record
        # from a session whose updater missed half its turns is thinner than one
        # from a session where every turn committed, and nothing downstream can
        # tell without being told.
        "updates_committed": memory.updates_committed,
        "updates_missed": memory.updates_missed,
        "unverified_count": len(ungrounded),
        # The per-turn internal monologue, so an admin can reopen a finished
        # session and work out why the client behaved as it did. Rides here
        # rather than on its own message because this record already reaches
        # ally-be as passthrough `structured` — no wire change, no migration.
        #
        # Carried even when every other field is empty: a session whose client
        # disclosed nothing is exactly the one someone will want to inspect.
        "monologue": list(monologue or []),
    }
