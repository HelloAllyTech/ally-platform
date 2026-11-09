"""Mine golden-case candidates from master's history.

Real bugs: non-merge ``fix`` commits touching one app, with a small source diff and
at least one test added or changed. Clean diffs: ``feat``/``chore`` commits that no
later fix touched within a window; "touched" is exact, from ``git blame`` of the
lines each fix removed, so a file-level overlap is not enough to disqualify.

Everything is written to ``evals/golden/candidates/`` for a person to review:
``CANDIDATES.md`` (one table per app), ``candidates.json`` (the records), and for
each bug candidate ``<id>.patch`` (the real fix, the hidden oracle). Nothing enters
``cases.yaml`` until ``bug-hunter eval accept <ids>``.
"""

from __future__ import annotations

import json
import re
import subprocess
from collections import defaultdict
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterable

from bug_hunter.config import BugHunterConfig
from bug_hunter.safety.paths import PathPolicy
from bug_hunter.safety.phi import scrub

# Old paths that belong to an app today (subtree history before the 2026-11 rename).
APP_PATH_ALIASES: dict[str, str] = {"ally-mobile-flutter": "ally-mobile"}
# Which subtree merges carry an app's pre-cutover history. ally-mobile's own old
# subtree is the React Native app (deleted); its Flutter history came in as
# ally-mobile-flutter.
SUBTREE_DIRS: dict[str, tuple[str, ...]] = {"ally-mobile": ("ally-mobile-flutter",)}
THIN_APPS = ("ally-ai", "ally-ai-learn", "ally-mobile")
SOURCE_EXT = (".ts", ".tsx", ".py", ".dart")
TEST_RE = re.compile(r"(\.spec\.|\.test\.|/tests?/|__tests__|_test\.dart$)")
CONVENTIONAL = re.compile(
    r"^(?P<type>[a-z]+)(\([^)]*\))?!?:\s*(?P<title>.+)$", re.IGNORECASE
)
PR_IN_SUBJECT = re.compile(r"\(#(\d+)\)\s*$")
HUNK_OLD = re.compile(r"^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@", re.MULTILINE)
REPO = "HelloAllyTech/ally-platform"


@dataclass
class Candidate:
    id: str
    kind: str  # bug | clean
    app: str
    layout: str  # monorepo (ally-be/src/…) | root (src/…, pre-cutover subtree history)
    sha: str
    parent: str
    date: str
    subject: str
    title: str
    body: str = ""
    pr_number: int | None = None
    pr_title: str = ""
    src_files: list[str] = field(default_factory=list)  # app-relative
    test_files: list[str] = field(default_factory=list)
    src_lines: int = 0
    risk: bool = False
    risk_hits: list[str] = field(default_factory=list)
    lockfile_blob: str | None = None
    lockfile_same_as_head: bool = False
    description: str = ""
    expected: str = "fix"


# --- git helpers ----


class Repo:
    def __init__(self, root: Path, ref: str = "origin/master"):
        self.root = Path(root)
        self.ref = ref

    def git(self, *args: str) -> str:
        return subprocess.run(
            ["git", "-C", str(self.root), *args],
            capture_output=True,
            text=True,
            check=False,
        ).stdout

    def commits(
        self,
        since: str | None,
        grep: str,
        paths: Iterable[str],
        ref: str | None = None,
    ) -> list[str]:
        args = [
            "log",
            ref or self.ref,
            "--no-merges",
            "--format=%H",
            "-E",
            "-i",
            f"--grep={grep}",
        ]
        if since:
            args.append(f"--since={since}")
        paths = list(paths)
        if paths:
            args += ["--", *paths]
        return self.git(*args).split()

    def subtree_heads(self) -> dict[str, str]:
        """``{app dir: old head sha}`` from the monorepo's subtree merges
        ("Merge 'ally-be/' from commit '<sha>'"); newest merge wins, and its
        history contains the earlier ones. The old history keeps root-relative
        paths."""
        heads: dict[str, str] = {}
        out = self.git("log", self.ref, "--merges", "--format=%P%x00%s")
        for line in out.splitlines():
            parents, _, subject = line.partition("\x00")
            m = re.match(r"Merge '([\w-]+)/' from commit '([0-9a-f]+)'", subject)
            if m and len(parents.split()) >= 2:
                heads.setdefault(m.group(1), m.group(2))
        return heads

    def info(self, sha: str) -> tuple[str, str, str, str]:
        out = self.git(
            "log", "-1", "--format=%P%x00%ad%x00%s%x00%b", "--date=short", sha
        )
        parents, date, subject, body = (out.split("\x00") + ["", "", "", ""])[:4]
        return (
            parents.split()[0] if parents.split() else "",
            date,
            subject.strip(),
            body.strip(),
        )

    def files(self, sha: str) -> list[tuple[str, str]]:
        rows = []
        for line in self.git("show", "--name-status", "--format=", sha).splitlines():
            parts = line.split("\t")
            if len(parts) >= 2:
                rows.append((parts[0][0], parts[-1]))
        return rows

    def numstat_lines(self, sha: str, paths: list[str]) -> int:
        if not paths:
            return 0
        total = 0
        for line in self.git(
            "show", "--numstat", "--format=", sha, "--", *paths
        ).splitlines():
            a, b, *_ = line.split("\t") + ["", ""]
            if a.isdigit() and b.isdigit():
                total += int(a) + int(b)
        return total

    def blob(self, ref: str, path: str) -> str | None:
        out = self.git("ls-tree", ref, "--", path).split()
        return out[2] if len(out) >= 3 else None

    def diff(self, sha: str, paths: list[str]) -> str:
        return self.git("show", "--format=", sha, "--", *paths) if paths else ""

    def removed_ranges(self, sha: str, path: str) -> list[tuple[int, int]]:
        """Old-side line ranges a commit removed or replaced in ``path``."""
        out = self.git("show", "--format=", "--unified=0", sha, "--", path)
        ranges = []
        for m in HUNK_OLD.finditer(out):
            start = int(m.group(1))
            count = int(m.group(2)) if m.group(2) is not None else 1
            if count > 0:
                ranges.append((start, start + count - 1))
        return ranges

    def blame_shas(self, ref: str, path: str, start: int, end: int) -> set[str]:
        out = self.git("blame", "-l", "-L", f"{start},{end}", ref, "--", path)
        return {
            line.split()[0].lstrip("^") for line in out.splitlines() if line.strip()
        }

    def pr_for(self, sha: str) -> tuple[int | None, str, str]:
        """PR number, title, body via gh (network); empty on failure."""
        try:
            out = subprocess.run(
                [
                    "gh",
                    "api",
                    f"repos/{REPO}/commits/{sha}/pulls",
                    "--jq",
                    ".[0] | [.number, .title, .body] | @json",
                ],
                capture_output=True,
                text=True,
                timeout=30,
            ).stdout.strip()
            if out:
                number, title, body = json.loads(out)
                return number, title or "", body or ""
        except (OSError, ValueError, subprocess.TimeoutExpired):
            pass
        return None, "", ""


# --- classification ----


def app_of(path: str, apps: Iterable[str]) -> str | None:
    head = path.split("/", 1)[0]
    head = APP_PATH_ALIASES.get(head, head)
    return head if head in apps else None


def app_relative(path: str) -> str:
    return path.split("/", 1)[1] if "/" in path else path


def split_title(subject: str) -> tuple[str, str]:
    m = CONVENTIONAL.match(subject)
    if not m:
        return "", subject.strip()
    return m.group("type").lower(), m.group("title").strip()


def issue_description(title: str, body: str, pr_title: str, pr_body: str) -> str:
    """An issue-style description from what a reporter would have said. The fix
    commit's own words are the best record we have; scrubbed, trimmed, no diff."""
    lines = [pr_title.strip() or title.strip()]
    text = (body or pr_body or "").strip()
    text = re.sub(
        r"\n(Co-Authored-By|Signed-off-by|🤖 Generated).*", "", text, flags=re.S
    )
    text = re.sub(r"```.*?```", "", text, flags=re.S).strip()
    if text:
        lines += ["", text[:700].rstrip() + (" …" if len(text) > 700 else "")]
    return scrub("\n".join(lines))


# --- mining ----


@dataclass(frozen=True)
class Source:
    app: str
    ref: str  # branch or old head
    prefix: str  # "ally-be" in the monorepo, "" in the old root layout
    layout: str  # monorepo | root

    def rel(self, path: str) -> str:
        return path.split("/", 1)[1] if self.prefix and "/" in path else path

    def belongs(self, path: str, apps: Iterable[str]) -> bool:
        if self.layout == "root":
            return True
        head = path.split("/", 1)[0]
        return APP_PATH_ALIASES.get(head, head) == self.app

    def repo_path(self, rel: str) -> str:
        return f"{self.prefix}/{rel}" if self.prefix else rel


def sources_for(config: BugHunterConfig, repo: Repo, app: str) -> list[Source]:
    """Where an app's history lives: the monorepo path (plus its alias path) and,
    before the 2026-10-23 cutover, the subtree parent with root-relative paths."""
    app_path = config.app(app).path
    sources = [Source(app, repo.ref, app_path, "monorepo")]
    heads = repo.subtree_heads()
    for subtree_dir in SUBTREE_DIRS.get(app, (app_path,)):
        if subtree_dir in heads:
            sources.append(Source(app, heads[subtree_dir], "", "root"))
    return sources


def _source_paths(source: Source) -> list[str]:
    if source.layout == "root":
        return []
    return [source.prefix] + [
        a for a, app in APP_PATH_ALIASES.items() if app == source.app
    ]


def mine_bugs(
    config: BugHunterConfig,
    repo: Repo,
    since: str | None,
    max_lines: int,
    max_lines_thin: int,
    apps: Iterable[str] | None = None,
    use_gh: bool = True,
    pr_cache: dict[str, list] | None = None,
) -> list[Candidate]:
    apps = tuple(apps or config.apps.apps)
    policy = PathPolicy(config.repo_root, config)
    out: list[Candidate] = []
    seen: set[str] = set()
    for app in apps:
        app_path = config.app(app).path
        head_lock = repo.blob(repo.ref, f"{app_path}/{config.app(app).lockfile}")
        for source in sources_for(config, repo, app):
            for sha in repo.commits(
                since, r"^fix(\(|:|!)", _source_paths(source), ref=source.ref
            ):
                if sha in seen:
                    continue
                parent, date, subject, body = repo.info(sha)
                kind, title = split_title(subject)
                if kind != "fix" or subject.lower().startswith("revert") or not parent:
                    continue
                files = repo.files(sha)
                if source.layout == "monorepo":
                    touched = {app_of(p, apps) for _s, p in files}
                    if touched != {app}:
                        continue
                src = [
                    p
                    for st, p in files
                    if st != "D" and p.endswith(SOURCE_EXT) and not TEST_RE.search(p)
                ]
                tests = [p for st, p in files if st != "D" and TEST_RE.search(p)]
                if not src or not tests:
                    continue
                lines = repo.numstat_lines(sha, src)
                cap = max_lines_thin if app in THIN_APPS else max_lines
                if lines == 0 or lines > cap:
                    continue
                seen.add(sha)
                today_paths = [f"{app_path}/{source.rel(p)}" for p in src + tests]
                hits = policy.touches_risk(today_paths, app)
                lock = repo.blob(parent, source.repo_path(config.app(app).lockfile))
                pr_number, pr_title, pr_body = _pr(
                    repo, sha, subject, use_gh and source.layout == "monorepo", pr_cache
                )
                out.append(
                    Candidate(
                        id=f"{app}-{sha[:8]}",
                        kind="bug",
                        app=app,
                        layout=source.layout,
                        sha=sha,
                        parent=parent,
                        date=date,
                        subject=subject,
                        title=title,
                        body=body,
                        pr_number=pr_number,
                        pr_title=pr_title,
                        src_files=[source.rel(p) for p in src],
                        test_files=[source.rel(p) for p in tests],
                        src_lines=lines,
                        risk=bool(hits),
                        risk_hits=hits,
                        lockfile_blob=lock,
                        lockfile_same_as_head=bool(lock) and lock == head_lock,
                        description=issue_description(title, body, pr_title, pr_body),
                        expected="escalate" if hits else "fix",
                    )
                )
    return out


def _today_path(path: str) -> str:
    head, _, rest = path.partition("/")
    return f"{APP_PATH_ALIASES.get(head, head)}/{rest}"


def _pr(
    repo: Repo, sha: str, subject: str, use_gh: bool, cache: dict | None
) -> tuple[int | None, str, str]:
    m = PR_IN_SUBJECT.search(subject)
    if cache is not None and sha in cache:
        number, title, body = cache[sha]
        return number, title, body
    number, title, body = (int(m.group(1)), "", "") if m else (None, "", "")
    if use_gh:
        got = repo.pr_for(sha)
        if got[0] is not None:
            number, title, body = got
    if cache is not None:
        cache[sha] = [number, title, body]
    return number, title, body


def later_fixed_shas(
    repo: Repo, fix_shas: Iterable[str], apps: Iterable[str], root_layout: bool = False
) -> dict[str, str]:
    """``{commit sha: earliest date of a fix that removed or replaced its lines}``,
    from ``git blame`` on the fix's parent for the lines the fix removed."""
    fixed: dict[str, str] = {}
    apps = tuple(apps)
    for sha in fix_shas:
        parent, fix_date, _subject, _body = repo.info(sha)
        if not parent:
            continue
        for status, path in repo.files(sha):
            if (
                status == "A"
                or not path.endswith(SOURCE_EXT)
                or TEST_RE.search(path)
                or (not root_layout and app_of(path, apps) is None)
            ):
                continue
            for start, end in repo.removed_ranges(sha, path):
                for blamed in repo.blame_shas(parent, path, start, end):
                    if blamed not in fixed or fix_date < fixed[blamed]:
                        fixed[blamed] = fix_date
    return fixed


def fixed_within(commit_date: str, fix_date: str | None, window_days: int) -> bool:
    if not fix_date:
        return False
    delta = datetime.strptime(fix_date, "%Y-%m-%d") - datetime.strptime(
        commit_date, "%Y-%m-%d"
    )
    return 0 <= delta.days <= window_days


def mine_clean(
    config: BugHunterConfig,
    repo: Repo,
    since: str | None,
    window_days: int,
    min_lines: int,
    max_lines: int,
    apps: Iterable[str] | None = None,
) -> list[Candidate]:
    apps = tuple(apps or config.apps.apps)
    cutoff = datetime.now(timezone.utc) - timedelta(days=window_days)
    out: list[Candidate] = []
    seen: set[str] = set()
    for app in apps:
        for source in sources_for(config, repo, app):
            paths = _source_paths(source)
            fix_shas = repo.commits(since, r"^fix(\(|:|!)", paths, ref=source.ref)
            fixed = later_fixed_shas(
                repo, fix_shas, apps, root_layout=source.layout == "root"
            )
            reverted = _reverted_subjects(repo, since, paths, source.ref)
            for sha in repo.commits(
                since, r"^(feat|chore)(\(|:|!)", paths, ref=source.ref
            ):
                if sha in seen:
                    continue
                parent, date, subject, body = repo.info(sha)
                kind, title = split_title(subject)
                if kind not in ("feat", "chore") or title in reverted or not parent:
                    continue
                if fixed_within(date, fixed.get(sha), window_days):
                    continue
                if (
                    datetime.strptime(date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
                    > cutoff
                ):
                    continue  # too recent to know whether a fix will follow
                files = repo.files(sha)
                if source.layout == "monorepo" and {
                    app_of(p, apps) for _s, p in files
                } != {app}:
                    continue
                src = [
                    p
                    for st, p in files
                    if st != "D" and p.endswith(SOURCE_EXT) and not TEST_RE.search(p)
                ]
                if not src:
                    continue
                lines = repo.numstat_lines(sha, src)
                if lines < min_lines or lines > max_lines:
                    continue
                seen.add(sha)
                out.append(
                    Candidate(
                        id=f"{app}-{sha[:8]}",
                        kind="clean",
                        app=app,
                        layout=source.layout,
                        sha=sha,
                        parent=parent,
                        date=date,
                        subject=subject,
                        title=title,
                        body=body,
                        src_files=[source.rel(p) for p in src],
                        src_lines=lines,
                        description=scrub(title),
                        expected="no_bug",
                    )
                )
    return out


def _reverted_subjects(
    repo: Repo, since: str | None, paths: list[str], ref: str | None = None
) -> set[str]:
    out = set()
    for sha in repo.commits(since, r"^revert", paths, ref=ref):
        _p, _d, subject, _b = repo.info(sha)
        m = re.search(r'"([^"]+)"', subject)
        if m:
            _k, title = split_title(m.group(1))
            out.add(title)
    return out


# --- output ----


def write_candidates(folder: Path, repo: Repo, candidates: list[Candidate]) -> Path:
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "candidates.json").write_text(
        json.dumps([asdict(c) for c in candidates], indent=1), encoding="utf-8"
    )
    for c in candidates:
        if c.kind == "bug":
            prefix = "" if c.layout == "root" else _prefix_for(repo, c)
            paths = [
                f"{prefix}/{p}" if prefix else p for p in c.src_files + c.test_files
            ]
            (folder / f"{c.id}.patch").write_text(
                repo.diff(c.sha, paths), encoding="utf-8"
            )
    md = folder / "CANDIDATES.md"
    md.write_text(render_candidates(candidates), encoding="utf-8")
    write_shortlist(folder, candidates)
    return md


def _prefix_for(repo: Repo, c: Candidate) -> str:
    """The app directory name as it was at the commit (alias-aware)."""
    for status_path in repo.files(c.sha):
        head = status_path[1].split("/", 1)[0]
        if APP_PATH_ALIASES.get(head, head) == c.app:
            return head
    return c.app


def render_candidates(candidates: list[Candidate]) -> str:
    by_app: dict[str, list[Candidate]] = defaultdict(list)
    for c in candidates:
        by_app[c.app].append(c)
    lines = [
        "# Candidate golden cases",
        "",
        "Review, then accept by id: `poetry run bug-hunter eval accept <id> [<id> …]`.",
        "Bug rows: `lines` = source lines changed by the real fix (tests excluded);",
        "`tests` = oracle test files; `risk` = touches a risk path (expected outcome:",
        "escalate); `lock=HEAD` = same lockfile as master, so the sandbox reuses one",
        "dependency volume. `layout` old = pre-cutover subtree history (app at the",
        "worktree root; PR numbers refer to the archived repo). Clean rows: feat/chore",
        "commits no later fix",
        "touched within the window.",
        "",
    ]
    for app in sorted(by_app):
        rows = sorted(by_app[app], key=lambda c: (c.kind, c.src_lines))
        bugs = sum(1 for c in rows if c.kind == "bug")
        lines += [f"## {app}  ({bugs} bug, {len(rows) - bugs} clean)", ""]
        lines.append(
            "| id | kind | date | layout | lines | tests | risk | lock=HEAD "
            "| PR | title |"
        )
        lines.append("|---|---|---|---|---|---|---|---|---|---|")
        for c in rows:
            pr = f"#{c.pr_number}" if c.pr_number else ""
            lines.append(
                f"| `{c.id}` | {c.kind} | {c.date} "
                f"| {'old' if c.layout == 'root' else 'mono'} | {c.src_lines} "
                f"| {len(c.test_files) if c.kind == 'bug' else ''} "
                f"| {'**yes**' if c.risk else ''} "
                f"| {_lock_cell(c)} "
                f"| {pr} | {_cell(c.title)} |"
            )
        lines.append("")
    return "\n".join(lines)


def _lock_cell(c: Candidate) -> str:
    if c.kind != "bug":
        return ""
    return "yes" if c.lockfile_same_as_head else "no"


def _cell(text: str, limit: int = 90) -> str:
    text = text.replace("|", "\\|").replace("\n", " ").strip()
    return text if len(text) <= limit else text[: limit - 1] + "…"


def mine_all(
    config: BugHunterConfig,
    repo: Repo | None = None,
    apps: Iterable[str] | None = None,
    use_gh: bool = True,
    pr_cache_path: Path | None = None,
) -> list[Candidate]:
    repo = repo or Repo(config.repo_root)
    limits = config.limits.evals
    since = (
        datetime.now(timezone.utc) - timedelta(days=30 * limits.since_months)
    ).strftime("%Y-%m-%d")
    cache: dict[str, list] = {}
    if pr_cache_path and pr_cache_path.exists():
        cache = json.loads(pr_cache_path.read_text())
    apps = tuple(apps or config.apps.apps)
    bugs: list[Candidate] = []
    for app in apps:
        # thin apps: whole history, bigger cap
        app_since = None if app in THIN_APPS else since
        bugs += mine_bugs(
            config,
            repo,
            app_since,
            limits.max_src_lines,
            limits.max_src_lines_thin_apps,
            [app],
            use_gh,
            cache,
        )
    clean = mine_clean(
        config,
        repo,
        since,
        limits.clean_window_days,
        limits.clean_min_src_lines,
        limits.clean_max_src_lines,
        apps,
    )
    if pr_cache_path:
        pr_cache_path.parent.mkdir(parents=True, exist_ok=True)
        pr_cache_path.write_text(json.dumps(cache, indent=0))
    return bugs + clean


# --- shortlist ----

SHORTLIST_BUGS = {
    "ally-be": 14,
    "ally-web": 10,
    "ally-ai": 10,
    "ally-ai-learn": 10,
    "ally-mobile": 10,
}
SHORTLIST_CLEAN = {
    "ally-be": 8,
    "ally-web": 8,
    "ally-ai": 6,
    "ally-ai-learn": 6,
    "ally-mobile": 6,
}


def shortlist(
    candidates: list[Candidate],
    bugs_per_app: dict[str, int] | None = None,
    clean_per_app: dict[str, int] | None = None,
) -> list[Candidate]:
    """A reviewable subset: per app, bug candidates preferring the monorepo layout
    (runnable as-is, same lockfile), smaller diffs and a few risk-path cases; clean
    candidates preferring the newest and mid-sized diffs."""
    bugs_per_app = bugs_per_app or SHORTLIST_BUGS
    clean_per_app = clean_per_app or SHORTLIST_CLEAN
    chosen: list[Candidate] = []
    by_app: dict[str, list[Candidate]] = defaultdict(list)
    for c in candidates:
        by_app[c.app].append(c)
    for app, items in sorted(by_app.items()):
        bugs = [c for c in items if c.kind == "bug"]
        bugs.sort(
            key=lambda c: (
                c.layout != "monorepo",
                not c.lockfile_same_as_head,
                c.src_lines,
            )
        )
        quota = bugs_per_app.get(app, 10)
        risky = [c for c in bugs if c.risk][: max(1, quota // 4)]
        plain = [c for c in bugs if not c.risk][: quota - len(risky)]
        chosen += sorted(plain + risky, key=lambda c: c.src_lines)
        clean = [c for c in items if c.kind == "clean"]
        clean.sort(
            key=lambda c: (c.layout != "monorepo", -c.date.count("-"), c.date),
            reverse=False,
        )
        clean.sort(key=lambda c: (c.layout != "monorepo", abs(c.src_lines - 40)))
        clean = sorted(
            clean[: clean_per_app.get(app, 6) * 2], key=lambda c: c.date, reverse=True
        )
        chosen += clean[: clean_per_app.get(app, 6)]
    return chosen


def write_shortlist(folder: Path, candidates: list[Candidate]) -> Path:
    short = shortlist(candidates)
    path = folder / "SHORTLIST.md"
    text = render_candidates(short).replace(
        "# Candidate golden cases",
        f"# Shortlist ({sum(c.kind == 'bug' for c in short)} bug, "
        f"{sum(c.kind == 'clean' for c in short)} clean "
        f"of {len(candidates)} candidates)",
    )
    path.write_text(text, encoding="utf-8")
    (folder / "shortlist-ids.txt").write_text(
        "\n".join(c.id for c in short) + "\n", encoding="utf-8"
    )
    return path
