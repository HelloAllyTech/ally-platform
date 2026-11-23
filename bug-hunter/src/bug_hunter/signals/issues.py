"""Issue signals (spec §12, user rules 2026-11-14/15). ally-platform is public, so an
issue counts only if it carries the ``bug`` label **and** a HelloAllyTech member either
opened it or applied that label (the label event's actor). Everything else is ignored
and logged. The text is scrubbed here and enters prompts as quoted data (builder,
``context.quote_signals``). Nothing is ever posted back on the public issue."""

from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any

from bug_hunter.safety.phi import scrub
from bug_hunter.signals.base import Candidate
from bug_hunter.signals.github import GitHubReader
from bug_hunter.signals.state import SignalState

CURSOR = "issues:since"
SUMMARY_MAX = 4000
log = logging.getLogger(__name__)
# app from an `app:<name>` label first, then from words in the title/body
_APP_WORDS = [
    ("ally-mobile", re.compile(r"(?i)\b(mobile app|android|ios|iphone|flutter)\b")),
    (
        "ally-web",
        re.compile(r"(?i)\b(helpline|admin dashboard|dashboard|web app|browser)\b"),
    ),
    ("ally-ai-learn", re.compile(r"(?i)\b(roleplay|simulation|voice|tts|stt)\b")),
    ("ally-ai", re.compile(r"(?i)\b(ally-ai|scribe|transcription|evaluation)\b")),
    ("ally-be", re.compile(r"(?i)\b(api|backend|server|500 error)\b")),
]


def app_of(issue: dict[str, Any], apps: list[str]) -> str | None:
    for label in issue.get("labels", []):
        name = label.get("name", "")
        if name.startswith("app:") and name[4:] in apps:
            return name[4:]
    text = f"{issue.get('title', '')}\n{issue.get('body') or ''}"
    for app, rx in _APP_WORDS:
        if app in apps and rx.search(text):
            return app
    return None


def collect(
    reader: GitHubReader,
    state: SignalState,
    apps: list[str],
    org: str = "HelloAllyTech",
    label: str = "bug",
    now: datetime | None = None,
) -> tuple[list[Candidate], dict[str, Any], list[str]]:
    """(candidates, cursor update, ignored-with-reason lines)."""
    now = now or datetime.now(timezone.utc)
    since = state.get(CURSOR) or (now - timedelta(days=1)).isoformat(timespec="seconds")
    members: dict[str, bool] = {}

    def member(login: str | None) -> bool:
        if not login:
            return False
        if login not in members:
            try:
                members[login] = bool(reader.is_org_member(org, login))
            except Exception as exc:  # noqa: BLE001 - unknown is not a member
                log.warning("membership check failed for %s: %s", login, exc)
                members[login] = False
        return members[login]

    out: list[Candidate] = []
    ignored: list[str] = []
    for issue in reader.issues(since, label):
        number = issue["number"]
        if issue.get("pull_request"):
            continue
        if label not in {lab.get("name") for lab in issue.get("labels", [])}:
            continue
        author = (issue.get("user") or {}).get("login")
        labelers = [
            (e.get("actor") or {}).get("login")
            for e in reader.label_events(number)
            if e.get("event") == "labeled"
            and (e.get("label") or {}).get("name") == label
        ]
        if not (member(author) or any(member(x) for x in labelers)):
            msg = (
                f"#{number}: ignored (not opened or labelled {label!r} by a "
                f"{org} member)"
            )
            ignored.append(msg)
            log.warning(msg)
            continue
        app = app_of(issue, apps)
        if app is None:
            msg = f"#{number}: ignored (app unknown: add an app:<name> label)"
            ignored.append(msg)
            log.warning(msg)
            continue
        title = scrub(issue.get("title", ""))[:200]
        body = scrub(issue.get("body") or "")
        out.append(
            Candidate(
                source="issue",
                app=app,
                key=f"issue:{number}",
                title=title,
                summary=f"{title}\n\n{body}"[:SUMMARY_MAX],
                ref=str(number),
                reported_by="staff" if member(author) else "user",
                extra={"issue": number},
            )
        )
    return out, {CURSOR: now.isoformat(timespec="seconds")}, ignored
