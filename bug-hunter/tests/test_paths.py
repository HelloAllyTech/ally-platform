"""Path policy: deny paths cannot be read or written, including through ../ and
symlinks; lockfiles are read-only; writes stay inside the app; risk detection."""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from bug_hunter.config import BugHunterConfig
from bug_hunter.safety.paths import PathDenied, PathPolicy, matches


@pytest.fixture
def worktree(tmp_path: Path) -> Path:
    root = tmp_path / "wt"
    for rel in (
        "ally-be/src/user/user.service.ts",
        "ally-be/src/user/test/user.service.spec.ts",
        "ally-be/src/auth/auth.service.ts",
        "ally-be/package.json",
        "ally-be/package-lock.json",
        "ally-be/.env",
        "ally-be/.env.local",
        "ally-be/docker.env",
        "ally-be/certs/server.pem",
        "ally-ai/app/core/config.py",
        "ally-ai/tests/test_x.py",
        "ally-mobile/env/local.env",
        "infra/ansible/hosts.yml",
        ".github/workflows/test-ally-be.yml",
        ".git/config",
    ):
        path = root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("x")
    (tmp_path / "outside.txt").write_text("secret")
    os.symlink(tmp_path / "outside.txt", root / "ally-be" / "link-out.txt")
    os.symlink(root / "ally-be" / ".env", root / "ally-be" / "link-env.txt")
    return root


@pytest.fixture
def policy(worktree: Path, config: BugHunterConfig) -> PathPolicy:
    return PathPolicy(worktree, config)


@pytest.mark.parametrize(
    "rel",
    [
        "ally-be/.env",
        "ally-be/.env.local",
        "ally-be/docker.env",
        "ally-be/certs/server.pem",
        "ally-mobile/env/local.env",
        "infra/ansible/hosts.yml",
        ".github/workflows/test-ally-be.yml",
        ".git/config",
    ],
)
def test_deny_paths_cannot_be_read(policy: PathPolicy, rel: str) -> None:
    with pytest.raises(PathDenied):
        policy.check_read(rel)
    with pytest.raises(PathDenied):
        policy.check_write(rel, "ally-be")


def test_traversal_outside_worktree_is_denied(policy: PathPolicy) -> None:
    with pytest.raises(PathDenied, match="outside the worktree"):
        policy.check_read("ally-be/../../outside.txt")
    with pytest.raises(PathDenied):
        policy.check_read("/etc/passwd")


def test_symlink_out_of_worktree_is_denied(policy: PathPolicy) -> None:
    with pytest.raises(PathDenied, match="outside the worktree"):
        policy.check_read("ally-be/link-out.txt")


def test_symlink_to_env_inside_worktree_is_denied(policy: PathPolicy) -> None:
    with pytest.raises(PathDenied, match="reading denied"):
        policy.check_read("ally-be/link-env.txt")


def test_lockfile_is_read_only(policy: PathPolicy) -> None:
    assert policy.check_read("ally-be/package-lock.json").name == "package-lock.json"
    with pytest.raises(PathDenied, match="read-only"):
        policy.check_write("ally-be/package-lock.json", "ally-be")


def test_write_must_stay_inside_the_app(policy: PathPolicy) -> None:
    assert policy.check_write("ally-be/src/user/user.service.ts", "ally-be")
    with pytest.raises(PathDenied, match="not inside ally-be/"):
        policy.check_write("ally-ai/app/core/config.py", "ally-be")


def test_is_test_path(policy: PathPolicy) -> None:
    assert policy.is_test_path("ally-be/src/user/test/user.service.spec.ts", "ally-be")
    assert policy.is_test_path("ally-be/src/user/user.service.spec.ts", "ally-be")
    assert not policy.is_test_path("ally-be/src/user/user.service.ts", "ally-be")
    assert policy.is_test_path("ally-ai/tests/test_x.py", "ally-ai")
    assert not policy.is_test_path("ally-ai/app/core/config.py", "ally-ai")


def test_touches_risk_app_and_global(policy: PathPolicy) -> None:
    hits = policy.touches_risk(
        [
            "ally-be/src/auth/auth.service.ts",
            "ally-be/src/user/user.service.ts",
            "ally-be/package.json",
            "ally-ai/app/core/config.py",
        ],
        "ally-be",
    )
    assert any(
        h.startswith("ally-be/src/auth/auth.service.ts (src/auth/)") for h in hits
    )
    assert any(
        h.startswith("ally-be/src/user/user.service.ts (src/user/)") for h in hits
    )
    assert any(h.startswith("ally-be/package.json (**/package.json)") for h in hits)
    # another app's risk path is not this app's rule, and not a global one
    assert not any(h.startswith("ally-ai/app/core/config.py") for h in hits)
    assert policy.touches_risk(["ally-be/src/progress/x.ts"], "ally-be") == []


@pytest.mark.parametrize(
    "path,pattern,expected",
    [
        ("ally-be/.env", ".env*", True),
        ("ally-be/.env.local", ".env*", True),
        ("ally-be/src/env.ts", ".env*", False),
        ("ally-mobile/env/local.env", "**/env/**", True),
        ("env/x", "**/env/**", True),
        ("src/auth/x.ts", "src/auth/", True),
        (
            "ally-be/src/auth/x.ts",
            "src/auth/",
            False,
        ),  # app rules see app-relative paths
        ("ally-be/src/auth/x.ts", "ally-be/src/auth/", True),
        ("src/foo.spec.ts", "src/**/*.spec.ts", True),
        ("src/a/b/test/c.ts", "src/**/test/", True),
        ("apps/x/src/api/auth.ts", "**/api/auth.ts", True),
        ("apps/x/src/utils/agentAuthored.ts", "**/api/auth.ts", False),
    ],
)
def test_glob_semantics(path: str, pattern: str, expected: bool) -> None:
    assert matches(path, pattern) is expected
