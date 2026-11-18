"""The canonical transcript (DESIGN §5): STT output, numbered, never rewritten.

Every STT provider here returns `segments_text`, one `start-end: text` line per
segment, in the language spoken. That is the transcript of record. The only
model call is for speaker roles, and it returns labels by segment id — it
never sees its own output turned back into text, so it can't drop, merge,
reorder or translate anything.

Dictation is one speaker, so it gets no roles call at all.
"""

import re
from typing import Any, Awaitable, Callable, Dict, List, Optional, Tuple

from pydantic import BaseModel

from app.core.note_harness.models import NoteTurn
from app.core.note_harness.transcript import format_ts

_LINE = re.compile(r"^\s*(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*:\s?(.*)$")

ROLES = ("COUNSELOR", "CLIENT")
UNKNOWN = "UNKNOWN"
# Words of transcript per roles call. Output is only ids and labels, so this is
# bounded by input, not output.
ROLES_CHUNK_WORDS = 3000
# Labelled segments from the previous chunk shown as context, so a speaker
# keeps the same role across chunks.
ROLES_CONTEXT_SEGMENTS = 8

ROLES_PATH = "scribe_note/speaker_roles"


class Segment(BaseModel):
    id: int
    start: float
    end: float
    text: str


class CanonicalTranscript(BaseModel):
    turns: List[NoteTurn]
    # Segment end times, by id, for storage alongside the turns.
    ends: Dict[int, float]
    roles_calls: int = 0
    unlabelled: int = 0


def parse_segments(segments_text: str) -> List[Segment]:
    """`start-end: text` lines → numbered segments, in the order given.

    A line without a time prefix continues the previous segment's text (a
    provider that wraps long text). Empty segments are dropped; ids are dense.
    """
    raw: List[List[Any]] = []
    for line in (segments_text or "").splitlines():
        m = _LINE.match(line)
        if m:
            raw.append([float(m.group(1)), float(m.group(2)), m.group(3).strip()])
        elif line.strip() and raw:
            raw[-1][2] = f"{raw[-1][2]} {line.strip()}".strip()
        elif line.strip():
            raw.append([0.0, 0.0, line.strip()])
    segments: List[Segment] = []
    for start, end, text in raw:
        if text:
            segments.append(
                Segment(id=len(segments) + 1, start=start, end=end, text=text)
            )
    return segments


def roles_schema() -> Dict[str, Any]:
    return {
        "title": "scribe_speaker_roles",
        "description": "The speaker of each transcript segment, by segment id.",
        "type": "object",
        "additionalProperties": False,
        "required": ["roles"],
        "properties": {
            "roles": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["id", "role"],
                    "properties": {
                        "id": {"type": "integer"},
                        "role": {"type": "string", "enum": list(ROLES)},
                    },
                },
            }
        },
    }


def render_segments(
    segments: List[Segment], roles: Optional[Dict[int, str]] = None
) -> str:
    lines = []
    for s in segments:
        who = f" | {roles[s.id]}" if roles and s.id in roles else ""
        lines.append(f"[{s.id} | {format_ts(s.start)}{who}] {s.text}")
    return "\n".join(lines)


def _chunks(segments: List[Segment], max_words: int) -> List[List[Segment]]:
    parts: List[List[Segment]] = []
    current: List[Segment] = []
    words = 0
    for s in segments:
        n = len(s.text.split())
        if current and words + n > max_words:
            parts.append(current)
            current, words = [], 0
        current.append(s)
        words += n
    if current:
        parts.append(current)
    return parts


# render(path, **variables) -> prompt; invoke(prompt, schema, path, max_tokens)
Render = Callable[..., str]
Invoke = Callable[[str, Dict[str, Any], str, int], Awaitable[Dict[str, Any]]]


async def label_roles(
    segments: List[Segment],
    render: Render,
    invoke: Invoke,
    chunk_words: int = ROLES_CHUNK_WORDS,
) -> Tuple[Dict[int, str], int]:
    """Role per segment id, and the number of calls made.

    Chunks run in order, each seeing the previous chunk's last labelled
    segments, so roles stay consistent across a long session.
    """
    roles: Dict[int, str] = {}
    calls = 0
    previous: List[Segment] = []
    for part in _chunks(segments, chunk_words):
        context = previous[-ROLES_CONTEXT_SEGMENTS:]
        prompt = render(
            ROLES_PATH,
            segments=render_segments(part),
            context=(
                render_segments(context, roles) if context else "(start of session)"
            ),
        )
        calls += 1
        answer = await invoke(prompt, roles_schema(), ROLES_PATH, 40 * len(part) + 200)
        wanted = {s.id for s in part}
        for item in (answer or {}).get("roles") or []:
            if not isinstance(item, dict):
                continue
            sid, role = item.get("id"), item.get("role")
            if sid in wanted and role in ROLES:
                roles[sid] = role
        previous = part
    return roles, calls


async def build_canonical(
    segments_text: str,
    mode: Optional[str],
    render: Render,
    invoke: Invoke,
    chunk_words: int = ROLES_CHUNK_WORDS,
) -> CanonicalTranscript:
    segments = parse_segments(segments_text)
    ends = {s.id: s.end for s in segments}
    if (mode or "").upper() == "DICTATION":
        turns = [
            NoteTurn(id=s.id, speaker="COUNSELOR", start=s.start, text=s.text)
            for s in segments
        ]
        return CanonicalTranscript(turns=turns, ends=ends)

    roles, calls = await label_roles(segments, render, invoke, chunk_words)
    turns: List[NoteTurn] = []
    unlabelled = 0
    last = UNKNOWN
    for s in segments:
        role = roles.get(s.id)
        if role is None:
            unlabelled += 1
            # A gap usually means the same speaker carried on.
            role = last
        last = role
        turns.append(NoteTurn(id=s.id, speaker=role, start=s.start, text=s.text))
    return CanonicalTranscript(
        turns=turns, ends=ends, roles_calls=calls, unlabelled=unlabelled
    )
