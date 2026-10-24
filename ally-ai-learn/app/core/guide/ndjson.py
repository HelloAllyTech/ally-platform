"""Incremental NDJSON decoding of ally-be's voice turn stream.

``POST /v1/guide/voice/turns`` answers with one JSON object per line. Network
chunks don't respect lines — a frame can arrive split across two reads, and a
multi-byte character (Devanagari, Tamil, Kannada…) can be split between two
reads — so bytes are decoded incrementally and only whole lines are parsed.

Frames are validated against the generated contract (``GuideVoiceFrame``). A
line that fails is skipped rather than ending the turn, with one exception: an
``error`` frame this worker can't fully read (a failure code added in ally-be
after this build) is still an error, and comes through as ``internal_error`` so
the learner hears the generic line instead of silence.
"""

from __future__ import annotations

import codecs
import json
from typing import List, Optional

from pydantic import TypeAdapter, ValidationError

from app.core.guide.contract import GuideVoiceFrame, GuideVoiceFrameError
from app.core.logger import get_logger

logger = get_logger(__name__)

_FRAME = TypeAdapter(GuideVoiceFrame)


def parse_frame_line(line: str) -> Optional[GuideVoiceFrame]:
    """One NDJSON line → a frame, or None for a blank or unusable line."""
    text = line.strip()
    if not text:
        return None
    try:
        raw = json.loads(text)
    except ValueError:
        # Frame text is Ally's reply, which can echo the learner: log its size,
        # never its content.
        logger.warning(
            "[GUIDE] skipped a voice frame that is not JSON (%d chars)", len(text)
        )
        return None
    try:
        return _FRAME.validate_python(raw)
    except ValidationError:
        if isinstance(raw, dict) and raw.get("type") == "error":
            logger.warning(
                "[GUIDE] unreadable error frame (code=%r); treating as internal_error",
                raw.get("code"),
            )
            message = raw.get("message")
            return GuideVoiceFrameError.model_construct(
                type="error",
                code="internal_error",
                message=message if isinstance(message, str) else "",
            )
        logger.warning(
            "[GUIDE] skipped a voice frame outside the contract (type=%r)",
            raw.get("type") if isinstance(raw, dict) else type(raw).__name__,
        )
        return None


class NdjsonFrameDecoder:
    """Feed raw byte chunks in, get whole frames out."""

    def __init__(self) -> None:
        self._utf8 = codecs.getincrementaldecoder("utf-8")(errors="replace")
        self._pending = ""

    def feed(self, chunk: bytes) -> List[GuideVoiceFrame]:
        self._pending += self._utf8.decode(chunk)
        *lines, self._pending = self._pending.split("\n")
        return self._parse(lines)

    def flush(self) -> List[GuideVoiceFrame]:
        """End of stream: whatever is left is the last line, newline or not."""
        self._pending += self._utf8.decode(b"", final=True)
        rest, self._pending = self._pending, ""
        return self._parse([rest])

    @staticmethod
    def _parse(lines: List[str]) -> List[GuideVoiceFrame]:
        frames = []
        for line in lines:
            frame = parse_frame_line(line)
            if frame is not None:
                frames.append(frame)
        return frames
