"""What each node recalls from long-term memory (spec §7, chunk 07).

Recall lines go into the node's ``memory_recall`` context slot, inside the node's token
budget (the builder drops recall first). Closing decisions are checked in code:

- triage may close a signal as a known false alarm only by citing a recalled
  ``false_alarms`` record whose fingerprinted lines are unchanged at this commit; a
  record whose lines changed is shown as a hint and cannot close anything;
- triage may close a duplicate only by citing a recalled ``bugs`` record;
- conventions reach prompts only once a human approved them.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from bug_hunter.memory.fingerprint import Reader, unchanged
from bug_hunter.memory.records import Record
from bug_hunter.memory.store import Memory

_DIFF_FILE = re.compile(r"^diff --git a/(\S+) b/", re.MULTILINE)
_ID = re.compile(r"\b(?:bug|fa|wt|cv|fr)-[0-9a-z]+\b")


def ids_in(lines: list[str]) -> list[str]:
    """The memory ids a node was shown (each recall line names its record first)."""
    out: list[str] = []
    for line in lines:
        m = _ID.search(line)
        if m and m.group(0) not in out:
            out.append(m.group(0))
    return out


RISK_ORDER = ["low", "medium", "high", "human_only"]


@dataclass
class TriageRecall:
    lines: list[str] = field(default_factory=list)
    blocking_false_alarms: dict[str, Record] = field(default_factory=dict)
    hint_false_alarms: dict[str, Record] = field(default_factory=dict)
    bugs: dict[str, Record] = field(default_factory=dict)


def diff_files(diff: str) -> list[str]:
    return list(dict.fromkeys(_DIFF_FILE.findall(diff or "")))


def triage_recall(
    memory: Memory, app: str, query: str, files: list[str], read: Reader
) -> TriageRecall:
    out = TriageRecall()
    for fa in memory.search(app, "false_alarms", query=query, files=files):
        if unchanged(fa.fingerprints, read):
            out.blocking_false_alarms[fa.id] = fa
            out.lines.append(
                f"KNOWN FALSE ALARM {fa.id} (the code it was about is unchanged): "
                f"{fa.title} — a human said it is not a bug: {fa.reason}. If this "
                f"signal is that same finding, answer kind not_a_bug with "
                f"memory_match {fa.id!r}."
            )
        else:
            out.hint_false_alarms[fa.id] = fa
            out.lines.append(
                f"PAST FALSE ALARM {fa.id} (the code has changed since; a hint only, "
                f"never a reason to close): {fa.title} — {fa.reason}"
            )
    for bug in memory.search(app, "bugs", query=query, files=files):
        out.bugs[bug.id] = bug
        verdict = f", verdict {bug.diagnosis}" if bug.diagnosis else ""
        out.lines.append(
            f"PAST BUG {bug.id} ({bug.status}{verdict}): {bug.title} — "
            f"{(bug.root_cause or '')[:200]}. If this signal is the same bug, answer "
            f"kind duplicate with memory_match {bug.id!r}."
        )
    return out


def investigate_recall(memory: Memory, app: str, query: str) -> list[str]:
    return [
        f"WRONG THEORY {wt.id} for a similar report: {wt.theory} — a human said: "
        f"{wt.reason}. Do not repeat it unless new evidence supports it."
        for wt in memory.search(app, "wrong_theories", query=query)
    ]


def fix_recall(memory: Memory, app: str, query: str, files: list[str]) -> list[str]:
    lines = [
        f"CONVENTION {cv.id}: {cv.text}"
        for cv in memory.search(
            app, "conventions", query=query, files=files, where={"status": "approved"}
        )
    ]
    past = [
        b
        for b in memory.search(app, "bugs", query=query, files=files, limit=10)
        if b.fix_summary and b.fix_verdict in (None, "worked", "needed_edits")
    ][: memory.recall_limit]
    lines += [
        f"PAST FIX {b.id} ({b.fix_verdict or 'no verdict yet'}): {b.title} — "
        f"{b.fix_summary[:250]} (files: {', '.join(b.files[:4])})"
        for b in past
    ]
    return lines


def fragile_hits(memory: Memory, app: str, files: list[str]) -> list[Record]:
    return [
        r
        for r in memory.search(app, "fragile_areas", files=files, touch=False)
        if set(r.files) & set(files)
    ]


def raised(level: str) -> str:
    i = RISK_ORDER.index(level) if level in RISK_ORDER else 0
    return RISK_ORDER[min(i + 1, len(RISK_ORDER) - 2)]  # never to human_only
