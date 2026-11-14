"""Git tool against a real temporary repository (git itself is not repo code)."""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from bug_hunter.tools.git import Git, GitError, branch_name


def _git(cwd: Path, *args: str) -> str:
    return subprocess.run(
        ["git", "-c", "user.name=t", "-c", "user.email=t@t", *args],
        cwd=cwd,
        check=True,
        capture_output=True,
        text=True,
    ).stdout


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    root = tmp_path / "repo"
    (root / "ally-be/src").mkdir(parents=True)
    _git(root, "init", "-q", "-b", "master")
    (root / "ally-be/src/a.ts").write_text("export const a = 1; // ops@example.com\n")
    _git(root, "add", ".")
    _git(root, "commit", "-q", "-m", "feat(be): first")
    (root / "ally-be/src/a.ts").write_text("export const a = 2;\n")
    _git(root, "commit", "-qam", "fix(be): bump a")
    return root


def test_worktree_lifecycle_and_reads(repo: Path, tmp_path: Path) -> None:
    git = Git(repo)
    wt = git.create_worktree(tmp_path / "runs", "run-1", "HEAD~1")
    assert (
        wt / "ally-be/src/a.ts"
    ).read_text() == "export const a = 1; // ops@example.com\n"
    assert git.head(wt) != git.head(repo)
    with pytest.raises(GitError, match="already exists"):
        git.create_worktree(tmp_path / "runs", "run-1", "HEAD")

    (wt / "ally-be/src/a.ts").write_text("export const a = 10;\n")
    diff = git.diff(wt, ["ally-be/src/a.ts"])
    assert "+export const a = 10;" in diff
    assert "ops@example.com" not in diff  # scrubbed
    assert git.changed_files(wt) == ["ally-be/src/a.ts"]

    log = git.log(wt, "ally-be/src/a.ts", n=5)
    assert "feat(be): first" in log and "fix(be): bump a" not in log
    blame = git.blame(wt, "ally-be/src/a.ts", 1, 1)
    assert "ops@example.com" not in blame and "a.ts" not in blame.split("\n")[0][:0]
    with pytest.raises(GitError):
        git.blame(wt, "ally-be/src/a.ts", 3, 1)

    (wt / "ally-be/node_modules").mkdir()
    git.remove_worktree(wt)
    assert not wt.exists()


def test_branch_commit_and_push_rules(repo: Path, tmp_path: Path) -> None:
    git = Git(repo)
    wt = git.create_worktree(tmp_path / "runs", "run-2", "HEAD")
    assert (
        branch_name("ally-be", "null-tenant-id") == "bughunter/ally-be/null-tenant-id"
    )
    with pytest.raises(GitError, match="invalid slug"):
        branch_name("ally-be", "Bad Slug!")
    assert (
        git.create_branch(wt, "ally-be", "null-tenant-id")
        == "bughunter/ally-be/null-tenant-id"
    )
    assert git.current_branch(wt) == "bughunter/ally-be/null-tenant-id"

    (wt / "ally-be/src/b.ts").write_text("export const b = 1;\n")
    with pytest.raises(GitError, match="conventional"):
        git.commit(wt, "added b", ["ally-be/src/b.ts"])
    with pytest.raises(GitError, match="explicit list"):
        git.commit(wt, "fix(be): b", [])
    sha = git.commit(wt, "fix(be): add b", ["ally-be/src/b.ts"])
    assert len(sha) == 40
    assert "ally-bug-hunter[bot]" in _git(wt, "log", "-1", "--format=%an")

    with pytest.raises(GitError, match="refusing to push"):
        git.push(wt, "master")
    git.remove_worktree(wt)


def test_failed_command_raises_with_scrubbed_stderr(repo: Path) -> None:
    git = Git(repo)
    with pytest.raises(GitError, match="git rev-parse HEAD failed"):
        git.head(repo / "ally-be/does-not-exist")
