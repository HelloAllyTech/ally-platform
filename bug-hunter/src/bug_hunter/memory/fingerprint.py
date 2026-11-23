"""Fingerprints of the code lines a finding was about.

A false alarm may close a repeat finding only while these lines are unchanged. The
lines come from the finding's evidence (``path:line`` or ``path:start-end``, a window
of ``CONTEXT`` lines either side); files with no line reference are hashed whole.
Paths are stored repo-relative. Only hashes are kept.
"""

from __future__ import annotations

import hashlib
import re
from typing import Callable, Iterable

from bug_hunter.memory.records import LineFingerprint

CONTEXT = 2
_REF = re.compile(
    r"(?P<path>[\w./@+-]+\.[A-Za-z0-9]+)(?::(?P<start>\d+)(?:[-–](?P<end>\d+))?)?"
)

Reader = Callable[[str], "str | None"]  # repo-relative path -> text, None if absent


def repo_path(path: str, app_path: str) -> str:
    """App-relative or repo-relative -> repo-relative."""
    path = path.lstrip("./")
    if not app_path or app_path == "." or path.startswith(app_path.rstrip("/") + "/"):
        return path
    return f"{app_path.rstrip('/')}/{path}"


def _norm(lines: Iterable[str]) -> str:
    return "\n".join(" ".join(line.split()) for line in lines)


def _sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:24]


def line_refs(
    evidence: Iterable[str], files: Iterable[str], app_path: str
) -> list[tuple[str, int | None, int | None]]:
    """(repo path, start, end) per referenced range; whole files for the rest."""
    refs: list[tuple[str, int | None, int | None]] = []
    seen_files: set[str] = set()
    for item in evidence:
        for m in _REF.finditer(item):
            if not m.group("start"):
                continue
            path = repo_path(m.group("path"), app_path)
            start = int(m.group("start"))
            end = int(m.group("end") or start)
            ref = (path, max(1, start - CONTEXT), max(start, end) + CONTEXT)
            if ref not in refs:
                refs.append(ref)
            seen_files.add(path)
    for f in files:
        path = repo_path(f, app_path)
        if path not in seen_files:
            refs.append((path, None, None))
            seen_files.add(path)
    return refs


def fingerprint(
    refs: Iterable[tuple[str, int | None, int | None]], read: Reader
) -> list[LineFingerprint]:
    out: list[LineFingerprint] = []
    for path, start, end in refs:
        text = read(path)
        if text is None:
            sha = "missing"
        else:
            lines = text.splitlines()
            chosen = lines if start is None else lines[start - 1 : end]
            sha = _sha(_norm(chosen))
        out.append(LineFingerprint(path=path, start=start, end=end, sha=sha))
    return out


def unchanged(prints: Iterable[LineFingerprint], read: Reader) -> bool:
    """True only if every fingerprinted range hashes the same now. A record with no
    fingerprints never counts as unchanged (it can only be a hint)."""
    prints = list(prints)
    if not prints:
        return False
    current = fingerprint(((p.path, p.start, p.end) for p in prints), read)
    return all(
        old.sha == new.sha and old.sha != "missing" for old, new in zip(prints, current)
    )
