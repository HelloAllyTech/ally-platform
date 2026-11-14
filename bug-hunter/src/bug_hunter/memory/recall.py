"""What each node recalls from long-term memory (spec §7, chunk 07).

Recall lines go into the node's ``memory_recall`` context slot, inside the node's token
budget (the builder drops recall first). Closing decisions are checked in code:

- triage may close a signal as a known false alarm only by citing a recalled
  ``false_alarms`` record whose fingerprinted lines are unchanged at this commit; a
  record whose lines changed is shown as a hint and cannot close anything;
- a matching past bug record (user, 2026-11-14), by its human verdict:

  1. diagnosis correct, fix worked or not judged yet, lines unchanged: close as
     duplicate;
  2. diagnosis correct, lines changed: investigate, "possible regression of bug-…";
  3. diagnosis correct, fix wrong or needed_edits: skip investigate, reuse the
     confirmed diagnosis, go to reproduce/fix with the past fix, its verdict
     reason and the approved conventions;
  4. no verdict: a hint only, never closes;
  5. diagnosis wrong or not_a_bug: not shown as a bug (its wrong theory or false
     alarm record carries the lesson).

  Changed lines take precedence over the fix verdict (the confirmed diagnosis may be
  stale). Every row is enforced in code: triage can only cite, code decides.
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
    bugs: dict[str, Record] = field(default_factory=dict)  # every bug shown
    duplicate_bugs: dict[str, Record] = field(default_factory=dict)  # row 1
    regression_bugs: dict[str, Record] = field(default_factory=dict)  # row 2
    reuse_bugs: dict[str, Record] = field(default_factory=dict)  # row 3
    hint_bugs: dict[str, Record] = field(default_factory=dict)  # row 4


def bug_row(bug: Record, read: Reader) -> str:
    """Which row of the table a past bug record falls in."""
    diagnosis = getattr(bug, "diagnosis", None)
    if diagnosis in ("wrong", "not_a_bug"):
        return "hidden"
    if diagnosis is None:
        return "hint"
    if not unchanged(getattr(bug, "fingerprints", []), read):
        return "regression"
    if getattr(bug, "fix_verdict", None) in ("wrong", "needed_edits"):
        return "reuse"
    return "duplicate"


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
        row = bug_row(bug, read)
        if row == "hidden":
            continue
        out.bugs[bug.id] = bug
        head = f"{bug.title} — {(bug.root_cause or '')[:200]}"
        if row == "duplicate":
            out.duplicate_bugs[bug.id] = bug
            out.lines.append(
                f"CONFIRMED BUG {bug.id} (a human confirmed it; fix "
                f"{bug.fix_verdict or 'not judged yet'}; the code is unchanged): "
                f"{head}. If this signal is the same bug, answer kind duplicate with "
                f"memory_match {bug.id!r}."
            )
        elif row == "regression":
            out.regression_bugs[bug.id] = bug
            out.lines.append(
                f"CONFIRMED BUG {bug.id}, CODE CHANGED SINCE (a possible regression; "
                f"never a reason to close): {head}. If this signal is the same bug, "
                f"answer kind bug with memory_match {bug.id!r}."
            )
        elif row == "reuse":
            out.reuse_bugs[bug.id] = bug
            out.lines.append(
                f"CONFIRMED BUG {bug.id}, FIX NOT RIGHT YET (fix {bug.fix_verdict}: "
                f"{bug.verdict_reason[:200]}): {head}. If this signal is the same bug, "
                f"answer kind bug with memory_match {bug.id!r}."
            )
        else:
            out.hint_bugs[bug.id] = bug
            out.lines.append(
                f"UNCONFIRMED PAST BUG {bug.id} (no human verdict; a hint only, never "
                f"a reason to close): {head}"
            )
    return out


def investigate_recall(
    memory: Memory, app: str, query: str, regression_of: str | None = None
) -> list[str]:
    lines: list[str] = []
    if regression_of:
        found = memory.get(regression_of)
        if found is not None:
            bug = found[1]
            lines.append(
                f"POSSIBLE REGRESSION of {bug.id}: {bug.title} — confirmed before "
                f"(root cause: {(bug.root_cause or '')[:200]}; fix: "
                f"{(bug.fix_summary or 'none recorded')[:200]}). The code it was about "
                "has changed since; check whether the change brought it back."
            )
    return lines + [
        f"WRONG THEORY {wt.id} for a similar report: {wt.theory} — a human said: "
        f"{wt.reason}. Do not repeat it unless new evidence supports it."
        for wt in memory.search(app, "wrong_theories", query=query)
    ]


def fix_recall(
    memory: Memory,
    app: str,
    query: str,
    files: list[str],
    reused_from: str | None = None,
) -> list[str]:
    lines: list[str] = []
    if reused_from:
        found = memory.get(reused_from)
        if found is not None:
            bug = found[1]
            lines.append(
                f"SAME BUG {bug.id}: its diagnosis was confirmed. The previous fix "
                f"({bug.fix_verdict}): {(bug.fix_summary or 'none recorded')[:300]} — "
                f"a human said: {bug.verdict_reason[:300]}. Do not repeat what was "
                "wrong with it."
            )
    lines += [
        f"CONVENTION {cv.id}: {cv.text}"
        for cv in memory.search(
            app, "conventions", query=query, files=files, where={"status": "approved"}
        )
    ]
    past = [
        b
        for b in memory.search(app, "bugs", query=query, files=files)
        if b.id != reused_from
        and b.fix_summary
        and b.diagnosis not in ("wrong", "not_a_bug")
        and b.fix_verdict in (None, "worked", "needed_edits")
    ]
    lines += [
        f"PAST FIX {b.id} ({b.fix_verdict or 'no verdict yet'}): {b.title} — "
        f"{b.fix_summary[:250]} (files: {', '.join(b.files[:4])})"
        + (f" — a human said: {b.verdict_reason[:200]}" if b.verdict_reason else "")
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
