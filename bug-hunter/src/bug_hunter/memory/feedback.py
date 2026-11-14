"""Verdicts -> long-term memory (chunk 07, spec §8).

Mapping (user, 2026-11-14):

- diagnosis ``not_a_bug`` -> ``false_alarms`` (with fingerprints of the code lines the
  finding was about, taken at the run's commit);
- diagnosis ``wrong`` -> ``wrong_theories`` (investigate recalls them);
- fix ``wrong`` or ``needed_edits`` -> ``fragile_areas`` per changed file, and a
  **pending** ``conventions`` candidate from the reason (used in prompts only after
  ``bug-hunter memory approve``);
- every verdict -> the run's ``bugs`` record (diagnosis/fix verdict) and
  ``("global", "run_stats")`` per signal source and mode.

Sources: the ``bughunter.verdicts`` table (CLI now, dashboard in chunk 09) and a
GitHub label reader (``bh-diagnosis:*`` / ``bh-fix:*`` on bug-hunter PRs and issues),
built and tested with fakes, switched off by ``memory.github_feedback``.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Iterable, Protocol

from bug_hunter.memory.fingerprint import Reader, fingerprint, line_refs, repo_path
from bug_hunter.memory.records import (
    BugRecord,
    ConventionRecord,
    FalseAlarmRecord,
    FragileAreaRecord,
    RunStatsRecord,
    WrongTheoryRecord,
    new_id,
)
from bug_hunter.memory.store import Memory, overlap, words
from bug_hunter.memory.verdicts import DIAGNOSES, FIX_VERDICTS, Verdict, VerdictStore

CONVENTION_SIMILARITY = 0.5  # word overlap above which a candidate merges


@dataclass
class RunSnapshot:
    """What feedback needs from a finished run (its ``report.json`` state dump)."""

    run_id: str
    app: str
    app_path: str
    mode: str
    ref: str
    status: str
    signal_source: str
    signal_summary: str
    finding: dict[str, Any] | None
    root_cause: str
    patch_files: list[str] = field(default_factory=list)
    patch_rationale: str = ""

    @classmethod
    def from_state(cls, state: dict[str, Any], app_path: str) -> "RunSnapshot":
        patch = state.get("patch") or {}
        signal = state.get("signal") or {}
        return cls(
            run_id=state["run_id"],
            app=state.get("app") or "",
            app_path=app_path,
            mode=state.get("mode") or "issue",
            ref=state.get("ref") or "",
            status=state.get("status") or "",
            signal_source=signal.get("source", ""),
            signal_summary=signal.get("raw_summary", ""),
            finding=state.get("finding"),
            root_cause=state.get("root_cause") or "",
            patch_files=list(patch.get("files_changed") or []),
            patch_rationale=patch.get("rationale") or "",
        )


def load_run(run_id: str, artefacts_dir: Path, app_path_for: Callable[[str], str]):
    path = artefacts_dir / run_id / "report.json"
    if not path.is_file():
        raise FileNotFoundError(
            f"{path}: no report for run {run_id} (only finished runs can get a verdict)"
        )
    state = json.loads(path.read_text(encoding="utf-8"))
    return RunSnapshot.from_state(state, app_path_for(state.get("app") or ""))


def bug_id(run_id: str) -> str:
    """The ``bugs`` record of a run has a fixed id, so feedback can find it."""
    return "bug-" + hashlib.sha1(run_id.encode()).hexdigest()[:10]


def finding_signature(app: str, category: str, files: Iterable[str]) -> str:
    raw = f"{app}|{category}|{'|'.join(sorted(set(files)))}"
    return hashlib.sha1(raw.encode()).hexdigest()[:16]


def bug_record_for(run: RunSnapshot, read: Reader | None = None) -> BugRecord | None:
    f = run.finding
    if not f:
        return None
    files = [repo_path(p, run.app_path) for p in f.get("suspected_files") or []]
    prints = (
        fingerprint(line_refs(f.get("evidence") or [], files, run.app_path), read)
        if read
        else []
    )
    return BugRecord(
        id=bug_id(run.run_id),
        app=run.app,
        title=f.get("title", ""),
        text=f"{f.get('title', '')}: {f.get('hypothesis', '')[:400]}",
        files=files,
        signature=finding_signature(run.app, f.get("category", ""), files),
        source_run=run.run_id,
        root_cause=run.root_cause[:600],
        fix_summary=run.patch_rationale[:600],
        status=run.status,
        fingerprints=prints,
        finding=dict(f),
    )


def apply_verdict(
    memory: Memory, verdict: Verdict, run: RunSnapshot, read: Reader
) -> list[str]:
    """Write what one verdict teaches; returns the ids written or updated."""
    written: list[str] = []
    f = run.finding or {}
    files = [repo_path(p, run.app_path) for p in f.get("suspected_files") or []]
    title = f.get("title") or run.signal_summary[:120]
    app = run.app or verdict.app

    # the run's bug record carries the verdict
    found = memory.get(bug_id(run.run_id))
    bug = found[1] if found else bug_record_for(run, read)
    if bug is not None:
        bug.diagnosis, bug.fix_verdict = verdict.diagnosis, verdict.fix
        bug.verdict_reason = verdict.reason
        written.append(memory.put("bugs", bug).id)

    if verdict.diagnosis == "not_a_bug" and f:
        refs = line_refs(f.get("evidence") or [], files, run.app_path)
        record = FalseAlarmRecord(
            id=new_id("false_alarms"),
            app=app,
            title=title,
            reason=verdict.reason,
            text=f"{title}: {f.get('hypothesis', '')[:300]} | not a bug: "
            f"{verdict.reason}",
            files=files,
            signature=finding_signature(app, f.get("category", ""), files),
            source_run=run.run_id,
            fingerprints=fingerprint(refs, read),
        )
        written.append(memory.put("false_alarms", record).id)
    elif verdict.diagnosis == "wrong":
        theory = f"{title}: {f.get('hypothesis', '')[:300]}"
        if run.root_cause:
            theory += f" (root cause claimed: {run.root_cause[:200]})"
        record = WrongTheoryRecord(
            id=new_id("wrong_theories"),
            app=app,
            title=title,
            theory=theory,
            reason=verdict.reason,
            # embedded text leads with the report, so a similar report recalls it
            text=f"{run.signal_summary[:400]} | wrong theory: {title} | why: "
            f"{verdict.reason}",
            files=files,
            source_run=run.run_id,
        )
        written.append(memory.put("wrong_theories", record).id)

    if verdict.fix in ("wrong", "needed_edits"):
        changed = [repo_path(p, run.app_path) for p in run.patch_files] or files
        for path in changed:
            hits = [
                r
                for r in memory.search(app, "fragile_areas", files=[path], touch=False)
                if path in r.files
            ]
            if hits:
                area = hits[0]
                area.count += 1
                area.reasons = (area.reasons + [verdict.reason])[-10:]
            else:
                area = FragileAreaRecord(
                    id=new_id("fragile_areas"),
                    app=app,
                    text=f"{path}: fix {verdict.fix.replace('_', ' ')}",
                    files=[path],
                    source_run=run.run_id,
                    reasons=[verdict.reason],
                )
            written.append(memory.put("fragile_areas", area).id)
        written.append(add_convention_candidate(memory, app, verdict, run.run_id))

    written.append(update_run_stats(memory, verdict, run))
    return written


def add_convention_candidate(
    memory: Memory, app: str, verdict: Verdict, run_id: str
) -> str:
    """A pending convention from the reason; merges into a similar one."""
    text = verdict.reason.strip()
    for _kind, existing in memory.list("conventions", app=app):
        if overlap(words(text), words(existing.text)) >= CONVENTION_SIMILARITY:
            existing.count += 1
            existing.sources = (existing.sources + [run_id])[-20:]
            return memory.put("conventions", existing).id
    record = ConventionRecord(
        id=new_id("conventions"),
        app=app,
        text=text,
        source_run=run_id,
        sources=[run_id],
    )
    return memory.put("conventions", record).id


def approve_convention(memory: Memory, record_id: str, text: str | None = None):
    """Only approved conventions reach prompts (``bug-hunter memory approve``)."""
    found = memory.get(record_id)
    if found is None or found[0] != "conventions":
        raise ValueError(f"{record_id} is not a convention")
    record = found[1]
    record.status = "approved"
    if text:
        record.text = text.strip()
    return memory.put("conventions", record)


def update_run_stats(memory: Memory, verdict: Verdict, run: RunSnapshot) -> str:
    key = f"{run.signal_source or 'unknown'}/{run.mode}"
    hits = [
        r
        for r in memory.search("global", "run_stats", signature=key, touch=False)
        if isinstance(r, RunStatsRecord) and r.key == key
    ]
    stats = (
        hits[0]
        if hits
        else RunStatsRecord(
            id=new_id("run_stats"), app="global", key=key, signature=key, text=key
        )
    )
    stats.diagnoses += 1
    stats.diagnosis_correct += verdict.diagnosis == "correct"
    stats.not_a_bug += verdict.diagnosis == "not_a_bug"
    if verdict.fix != "none":
        stats.fixes += 1
        stats.fix_worked += verdict.fix == "worked"
        stats.fix_needed_edits += verdict.fix == "needed_edits"
    return memory.put("run_stats", stats).id


# --- GitHub label reader (switched off) --------------------------------------------


class LabelClient(Protocol):
    def labelled_items(self, label: str) -> list[dict[str, Any]]:
        """Bug-hunter PRs and issues, each ``{number, body, labels, comments}`` with
        ``labels: [{name, by}]`` (who applied it, from the label events) and
        ``comments: [{body, author}]``, oldest first."""
        ...

    def is_org_member(self, org: str, login: str) -> bool: ...


_RUN = re.compile(r"_Run `(run-[\w-]+)`")
log = logging.getLogger(__name__)


class GitHubLabelFeedback:
    """Verdicts from labels on bug-hunter PRs/issues: ``bh-diagnosis:<value>`` and
    ``bh-fix:<value>``, the reason from the latest comment. Off unless
    ``memory.github_feedback`` (there are no PRs in suggested_fix mode).

    ally-platform is public: only labels applied by, and comments written by, members
    of ``org`` (or logins in ``allow``) count. Everything else is ignored and logged,
    and ``ignored`` keeps the list for the caller."""

    def __init__(
        self,
        client: LabelClient,
        app_for_run: Callable[[str], str],
        org: str = "HelloAllyTech",
        allow: Iterable[str] = (),
    ):
        self.client = client
        self.app_for_run = app_for_run
        self.org = org
        self.allow = {a.lower() for a in allow}
        self.ignored: list[str] = []
        self._trusted: dict[str, bool] = {}

    def trusted(self, login: str | None) -> bool:
        if not login:
            return False
        key = login.lower()
        if key in self.allow:
            return True
        if key not in self._trusted:
            try:
                self._trusted[key] = bool(self.client.is_org_member(self.org, login))
            except Exception as exc:  # noqa: BLE001 - unknown is not a member
                log.warning("membership check failed for %s: %s", login, exc)
                self._trusted[key] = False
        return self._trusted[key]

    def _ignore(self, number: Any, what: str, login: str | None) -> None:
        who = login or "unknown"
        msg = f"#{number}: ignored {what} from {who} (not a {self.org} member)"
        self.ignored.append(msg)
        log.warning(msg)

    def verdicts(self, seen_runs: set[str]) -> list[Verdict]:
        out: list[Verdict] = []
        for item in self.client.labelled_items("bug-hunter"):
            number = item.get("number")
            m = _RUN.search(item.get("body") or "")
            if not m or m.group(1) in seen_runs:
                continue
            labels: dict[str, str] = {}
            for lab in item.get("labels", []):
                name, by = lab.get("name", ""), lab.get("by")
                if not name.startswith("bh-"):
                    continue
                if not self.trusted(by):
                    self._ignore(number, f"label {name}", by)
                    continue
                key, _, value = name.partition(":")
                labels[key] = value
            reason = ""
            for comment in item.get("comments", []):
                author = comment.get("author")
                if not self.trusted(author):
                    self._ignore(number, "comment", author)
                    continue
                reason = (comment.get("body") or "").strip() or reason
            diagnosis, fix = labels.get("bh-diagnosis"), labels.get("bh-fix", "none")
            if diagnosis not in DIAGNOSES or fix not in FIX_VERDICTS or not reason:
                continue  # incomplete labelling is skipped, never guessed
            out.append(
                Verdict(
                    run_id=m.group(1),
                    app=self.app_for_run(m.group(1)),
                    diagnosis=diagnosis,
                    fix=fix,
                    reason=reason,
                    decided_by=f"github#{number}",
                    source="github",
                )
            )
        return out


def run_feedback(
    memory: Memory,
    verdicts: VerdictStore,
    load: Callable[[str], RunSnapshot],
    reader_for: Callable[[RunSnapshot], Reader],
    github: GitHubLabelFeedback | None = None,
) -> list[tuple[Verdict, list[str]]]:
    """Apply every unapplied verdict (after importing GitHub ones, if enabled)."""
    if github is not None:
        seen = {v.run_id for v in verdicts.unapplied()}
        for v in github.verdicts(seen):
            verdicts.add(v)
    done: list[tuple[Verdict, list[str]]] = []
    for v in verdicts.unapplied():
        run = load(v.run_id)
        ids = apply_verdict(memory, v, run, reader_for(run))
        if v.id is not None:
            verdicts.mark_applied(v.id)
        done.append((v, ids))
    return done
