"""Room I/O for a text-chat roleplay: typed both ways, no audio in either direction.

A text-chat roleplay is the same session as a voice one — same persona graph,
events, guardrails, ScoreKeeper, transcript and end-of-session score — with the
audio pipeline taken out. LiveKit's RoomIO already carries text both ways:

- the learner's client sends each message as a text stream on ``lk.chat``,
  which RoomIO hands to ``text_input_cb``;
- the persona's reply is published as a text stream on ``lk.transcription``,
  one stream per reply, closed when the reply is complete.

So the only text-chat-specific pieces are the room options below and the input
callback. Everything downstream of ``generate_reply`` is shared with voice.
"""

from __future__ import annotations

from typing import Any

from livekit.agents import RoomInputOptions, RoomOutputOptions

from app.core.logger import get_logger

logger = get_logger(__name__)

# Matches the learner client's composer limit. Enforced here too so a modified
# client cannot hand the persona graph (and every detector that reads the
# learner's turn) an unbounded message.
TEXT_CHAT_MAX_MESSAGE_CHARS = 2000


def text_chat_input_cb(session: Any, ev: Any) -> None:
    """Turn one typed learner message into one persona turn.

    LiveKit's default callback calls ``session.interrupt()`` first, which is
    right for a call — the learner talking over the agent should stop it. In a
    chat it would cut a reply off half-written, leaving the learner a truncated
    message on screen and the transcript an ``interrupted`` line nobody spoke.
    So a message that arrives while a reply is still being written queues
    behind it instead: each message is answered in order, and every reply the
    learner sees is whole.
    """
    text = (getattr(ev, "text", "") or "").strip()
    if not text:
        return
    if len(text) > TEXT_CHAT_MAX_MESSAGE_CHARS:
        logger.warning(
            "[TEXT_CHAT] learner message truncated from %d to %d chars",
            len(text),
            TEXT_CHAT_MAX_MESSAGE_CHARS,
        )
        text = text[:TEXT_CHAT_MAX_MESSAGE_CHARS]
    session.generate_reply(user_input=text)


def text_chat_room_options() -> tuple[RoomInputOptions, RoomOutputOptions]:
    """Room options for a text-chat session: text in, text out, no audio.

    ``sync_transcription=False`` because there is no audio to pace the text
    against — the reply is published as fast as it is generated.
    """
    return (
        RoomInputOptions(
            audio_enabled=False,
            text_enabled=True,
            text_input_cb=text_chat_input_cb,
        ),
        RoomOutputOptions(
            audio_enabled=False,
            transcription_enabled=True,
            sync_transcription=False,
        ),
    )
