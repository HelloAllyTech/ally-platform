"""Take quotes out of what goes to Builder and Bug Hunter (spec B4).

Builder and Bug Hunter never receive learner words or expert comment text: the PM
agent writes them a summary, and this removes anything quoted from it before it
leaves. ally-be does the same again in the gateway, against the comments the idea
cites, so a summary that slips past here is still caught there.
"""

from __future__ import annotations

import re
from typing import Iterable, Tuple

REMOVED = "[quote removed]"

#: Text inside quotation marks of any common kind, at least three characters long.
_QUOTED = re.compile(
    r"\"[^\"\n]{3,}\"|“[^”\n]{3,}”|‘[^’\n]{3,}’|«[^»\n]{3,}»|„[^“\n]{3,}“|`[^`\n]{3,}`"
)
#: Block quotes in markdown.
_BLOCK = re.compile(r"(?m)^\s*>.*$")

#: Known text shorter than this is not searched for (too likely to match by chance).
MIN_KNOWN = 12


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip().lower()


def strip_quotes(text: str, known: Iterable[str] = ()) -> Tuple[str, int]:
    """`text` with quoted passages and any of the `known` texts replaced; and how
    many were removed."""
    if not text:
        return "", 0
    out, n = _QUOTED.subn(REMOVED, text)
    out, m = _BLOCK.subn(REMOVED, out)
    n += m
    for k in known:
        k = (k or "").strip()
        if len(k) < MIN_KNOWN:
            continue
        pattern = re.compile(
            r"\s+".join(re.escape(w) for w in _norm(k).split(" ")), re.IGNORECASE
        )
        out, m = pattern.subn(REMOVED, out)
        n += m
    return out, n
