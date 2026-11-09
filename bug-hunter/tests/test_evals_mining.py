"""Candidate mining on a fixture repo with both layouts: a fix with a test becomes
a bug candidate, a feat/chore that a later fix blamed within the window is not a
clean candidate, one outside the window is; subtree history is followed."""

from __future__ import annotations

import subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path

from bug_hunter.config import BugHunterConfig
from evals.mine_cases import (
    Repo,
    issue_description,
    later_fixed_shas,
    mine_bugs,
    mine_clean,
    render_candidates,
    shortlist,
    split_title,
    write_candidates,
)


def _git(cwd: Path, *args: str, date: str | None = None) -> str:
    env = None
    if date:
        import os

        env = {**os.environ, "GIT_AUTHOR_DATE": date, "GIT_COMMITTER_DATE": date}
    return subprocess.run(
        ["git", "-c", "user.name=t", "-c", "user.email=t@t", *args],
        cwd=cwd,
        check=True,
        capture_output=True,
        text=True,
        env=env,
    ).stdout.strip()


def _days_ago(n: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=n)).strftime(
        "%Y-%m-%dT12:00:00"
    )


def _build_repo(root: Path) -> Path:
    """Monorepo layout only (the subtree path is covered by sources_for on the real
    repo). History, oldest first:
      feat A (90 d ago)  src/a.ts            → later fixed within 30 d → not clean
      fix  A (80 d ago)  src/a.ts + spec     → bug candidate
      feat B (70 d ago)  src/b.ts            → never fixed → clean
      chore C (50 d ago) src/c.ts            → fixed 45 d later (outside window) → clean
      fix  C (5 d ago)   src/c.ts + spec     → bug candidate
      feat D (3 d ago)   src/d.ts            → too recent to judge → not clean
    """
    root.mkdir(parents=True)
    (root / "ally-be/src").mkdir(parents=True)
    (root / "ally-be/package-lock.json").write_text("{}")
    _git(root, "init", "-q", "-b", "master")

    def commit(msg: str, files: dict[str, str], days: int) -> str:
        for rel, content in files.items():
            path = root / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content)
        _git(root, "add", ".")
        _git(root, "commit", "-qm", msg, date=_days_ago(days))
        return _git(root, "rev-parse", "HEAD")

    commit("chore: init", {"ally-be/README.md": "x"}, 100)
    commit(
        "feat(a): add a",
        {"ally-be/src/a.ts": "export const a = 1;\nexport const a2 = 2;\n"},
        90,
    )
    commit(
        "fix(a): a returns 3",
        {
            "ally-be/src/a.ts": "export const a = 3;\nexport const a2 = 2;\n",
            "ally-be/src/a.spec.ts": "it('a', () => {});\n",
        },
        80,
    )
    commit("feat(b): add b", {"ally-be/src/b.ts": "export const b = 1;\n" * 6}, 70)
    commit("chore(c): add c", {"ally-be/src/c.ts": "export const c = 1;\n" * 6}, 50)
    commit(
        "fix(c): c returns 2 (#12)",
        {
            "ally-be/src/c.ts": "export const c = 2;\n" * 6,
            "ally-be/src/c.spec.ts": "it('c', () => {});\n",
        },
        5,
    )
    commit("feat(d): add d", {"ally-be/src/d.ts": "export const d = 1;\n" * 6}, 3)
    _git(root, "branch", "-f", "origin/master", "master")
    return root


def test_mining_bugs_and_clean(config: BugHunterConfig, tmp_path: Path) -> None:
    root = _build_repo(tmp_path / "repo")
    cfg = config.model_copy(update={"repo_root": root})
    repo = Repo(root, ref="master")
    bugs = mine_bugs(cfg, repo, None, 60, 120, ["ally-be"], use_gh=False)
    assert sorted(c.title for c in bugs) == ["a returns 3", "c returns 2 (#12)"]
    a = next(c for c in bugs if c.title.startswith("a "))
    assert a.src_files == ["src/a.ts"] and a.test_files == ["src/a.spec.ts"]
    assert a.src_lines == 2 and a.layout == "monorepo" and a.expected == "fix"
    assert a.lockfile_same_as_head and not a.risk
    c = next(c for c in bugs if c.title.startswith("c "))
    assert c.pr_number == 12
    clean = mine_clean(cfg, repo, None, 30, 5, 200, ["ally-be"])
    assert sorted(c.title for c in clean) == [
        "add b",
        "add c",
    ]  # a: fixed in window; d: too recent
    assert all(c.expected == "no_bug" and c.layout == "monorepo" for c in clean)
    folder = tmp_path / "cands"
    md = write_candidates(folder, repo, bugs + clean)
    patch = (folder / f"{a.id}.patch").read_text()
    assert "diff --git a/ally-be/src/a.ts" in patch
    assert "a/ally-be/src/a.spec.ts" in patch
    assert "| `ally-be-" in md.read_text() and (folder / "SHORTLIST.md").exists()
    assert len(shortlist(bugs + clean)) == 4


def test_later_fixed_uses_blame_on_removed_lines(
    config: BugHunterConfig, tmp_path: Path
) -> None:
    root = _build_repo(tmp_path / "repo")
    repo = Repo(root, ref="master")
    fixes = repo.commits(None, r"^fix(\(|:|!)", ["ally-be"])
    fixed = later_fixed_shas(repo, fixes, ["ally-be"])
    feat_a = _git(root, "log", "--format=%H", "--grep=^feat(a)")
    chore_c = _git(root, "log", "--format=%H", "--grep=^chore(c)")
    feat_b = _git(root, "log", "--format=%H", "--grep=^feat(b)")
    assert feat_a in fixed and chore_c in fixed and feat_b not in fixed


def test_helpers() -> None:
    assert split_title("fix(scope)!: Title here") == ("fix", "Title here")
    assert split_title("no prefix") == ("", "no prefix")
    text = issue_description(
        "Login fails",
        "Users with +91 98765 43210 cannot log in\n\nCo-Authored-By: x",
        "",
        "",
    )
    assert (
        text.startswith("Login fails")
        and "[phone]" in text
        and "Co-Authored-By" not in text
    )
    assert render_candidates([]).startswith("# Candidate golden cases")
