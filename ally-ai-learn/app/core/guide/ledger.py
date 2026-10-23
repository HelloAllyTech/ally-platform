"""Barge-in bookkeeping: which reply the learner spoke over, and how much of it
they actually heard.

ally-be stores each reply in full (history must replay byte for byte), so when
the learner talks over Ally the next turn carries ``interruptedTurnId`` and
``spokenChars`` and ally-be tells the model what was really heard.

How each reply ends decides what is sent:

* **Played to the end** — nothing to report.
* **Spoken over after ally-be finished it** (its ``done`` frame, and so its
  ``turnId``, had arrived) — report the turn and the characters of *its* text
  the learner heard. Card hints are spoken too but are not part of the stored
  reply, so they are counted out.
* **Spoken over before audio started** — the same, with ``spokenChars`` 0.
* **Spoken over while still streaming** — the worker closed the stream, which
  cancels the turn in ally-be; no reply was stored and no ``turnId`` was ever
  received, so there is nothing to mark.

LiveKit reports what was heard as the interrupted assistant message it adds to
the chat context: the transcript synchronised with audio playout, i.e. the
words actually played. No message at all means nothing was played.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import List, Optional, Tuple

_WHITESPACE = re.compile(r"\s+")


@dataclass(frozen=True)
class Interruption:
    turn_id: str
    spoken_chars: int


@dataclass
class _Reply:
    # (text as spoken, counts toward ally-be's stored reply)
    segments: List[Tuple[str, bool]] = field(default_factory=list)
    turn_id: Optional[str] = None
    settled: bool = False

    @property
    def spoken_text(self) -> str:
        return "".join(text for text, _ in self.segments)

    @property
    def reply_chars(self) -> int:
        return sum(len(text) for text, is_reply in self.segments if is_reply)

    def reply_chars_heard(self, heard_chars: int) -> int:
        """Characters of the stored reply within the first ``heard_chars``
        characters spoken."""
        remaining = max(0, heard_chars)
        counted = 0
        for text, is_reply in self.segments:
            if remaining <= 0:
                break
            taken = min(len(text), remaining)
            if is_reply:
                counted += taken
            remaining -= taken
        return counted


def _squash(text: str) -> str:
    return _WHITESPACE.sub(" ", text).strip()


class SpokenReplyLedger:
    """One per voice session; replies are spoken one at a time."""

    def __init__(self) -> None:
        self._current: Optional[_Reply] = None
        self._pending: Optional[Interruption] = None

    # -- a reply's life ---------------------------------------------------

    def begin_reply(self) -> None:
        """A new reply starts; settle the previous one if LiveKit never did."""
        previous = self._current
        if previous is not None and not previous.settled:
            # No assistant message was added for it, so none of it played. If
            # ally-be had finished it, it is stored in full and must be marked.
            if previous.turn_id and previous.reply_chars > 0:
                self._pending = Interruption(previous.turn_id, 0)
            previous.settled = True
        self._current = _Reply()

    def note_reply_text(self, text: str, *, supersedes_earlier: bool = False) -> None:
        """Text from ally-be's reply (a ``delta``).

        ``supersedes_earlier`` is for the fixed crisis message cutting a reply
        short: ally-be stores the crisis text as the turn's reply and what came
        before it separately, so earlier text stops counting toward it.
        """
        if self._current is None or not text:
            return
        if supersedes_earlier:
            self._current.segments = [
                (spoken, False) for spoken, _ in self._current.segments
            ]
        self._current.segments.append((text, True))

    def note_other_text(self, text: str) -> None:
        """Spoken, but not part of ally-be's stored reply (card hints, fixed
        worker lines)."""
        if self._current is not None and text:
            self._current.segments.append((text, False))

    def note_done(self, turn_id: str) -> None:
        if self._current is not None and turn_id:
            self._current.turn_id = turn_id

    def on_assistant_message(self, heard: str, *, interrupted: bool) -> None:
        """LiveKit added Ally's message: ``heard`` is what played."""
        reply = self._current
        if reply is None or reply.settled or not reply.segments:
            return
        if not _squash(reply.spoken_text).startswith(_squash(heard)[:24]):
            # Not this reply (a fixed line spoken with session.say).
            return
        reply.settled = True
        if interrupted and reply.turn_id:
            self._pending = Interruption(
                reply.turn_id, reply.reply_chars_heard(len(heard))
            )

    # -- what the next turn carries ---------------------------------------

    @property
    def pending(self) -> Optional[Interruption]:
        return self._pending

    def take_pending(self) -> Optional[Interruption]:
        pending, self._pending = self._pending, None
        return pending

    def restore_pending(self, interruption: Optional[Interruption]) -> None:
        """Put back an interruption ally-be never acted on, unless a newer one
        has taken its place."""
        if interruption is not None and self._pending is None:
            self._pending = interruption
