"""Sandbox with a fake docker: builds the image when missing, installs once per
lockfile hash with network, runs everything else with --network none and the
configured limits, kills on timeout."""

from __future__ import annotations

from pathlib import Path

import pytest

from bug_hunter.config import BugHunterConfig
from bug_hunter.tools.sandbox import (
    SANDBOX_DIR,
    DockerResult,
    Sandbox,
    SandboxError,
    docker_available,
)


class FakeDocker:
    def __init__(self, *, image_exists=False, volume_exists=False, fail_install=False):
        self.calls: list[list[str]] = []
        self.image_exists = image_exists
        self.volume_exists = volume_exists
        self.fail_install = fail_install
        self.timeout_next = False

    def __call__(self, args, timeout=None):
        args = list(args)
        self.calls.append(args)
        sub = args[1:3]
        if sub == ["image", "inspect"]:
            return DockerResult(tuple(args), 0 if self.image_exists else 1, "", "")
        if sub == ["volume", "inspect"]:
            return DockerResult(tuple(args), 0 if self.volume_exists else 1, "", "")
        if args[1] == "build":
            self.image_exists = True
            return DockerResult(tuple(args), 0, "built", "")
        if args[1] == "run":
            if self.timeout_next:
                self.timeout_next = False
                return DockerResult(tuple(args), -1, "partial", "", timed_out=True)
            if (
                self.fail_install
                and "--network" in args
                and args[args.index("--network") + 1] == "bridge"
            ):
                return DockerResult(tuple(args), 1, "", "npm ERR! boom")
            self.volume_exists = True
            return DockerResult(tuple(args), 0, "ok", "")
        return DockerResult(tuple(args), 0, "", "")


@pytest.fixture
def worktree(tmp_path: Path) -> Path:
    root = tmp_path / "wt"
    (root / "ally-be").mkdir(parents=True)
    (root / "ally-be/package-lock.json").write_text('{"lockfileVersion": 3}')
    return root


def _sandbox(
    config: BugHunterConfig, worktree: Path, docker: FakeDocker, app="ally-be"
) -> Sandbox:
    return Sandbox(config, worktree, app, "run-x", docker=docker)


def test_image_is_built_once_from_the_app_dockerfile(config, worktree) -> None:
    docker = FakeDocker()
    sb = _sandbox(config, worktree, docker)
    tag = sb.ensure_image()
    assert tag.startswith("bug-hunter/node24:")
    build = next(c for c in docker.calls if c[1] == "build")
    assert build[3] == str(SANDBOX_DIR / "node24.Dockerfile")
    docker.calls.clear()
    assert sb.ensure_image() == tag
    assert [c[1] for c in docker.calls] == ["image"]


def test_install_runs_with_network_then_is_skipped(config, worktree) -> None:
    docker = FakeDocker(image_exists=True)
    sb = _sandbox(config, worktree, docker)
    result = sb.install()
    assert result is not None and result.ok and result.network
    run = next(c for c in docker.calls if c[1] == "run")
    assert run[run.index("--network") + 1] == "bridge"
    assert run[-1] == "npm ci"
    assert any(
        v.startswith("bughunter-deps-ally-be-")
        and v.endswith(":/work/ally-be/node_modules")
        for v in run
    )
    assert sb.install() is None  # volume now exists


def test_failed_install_removes_the_volume(config, worktree) -> None:
    docker = FakeDocker(image_exists=True, fail_install=True)
    sb = _sandbox(config, worktree, docker)
    with pytest.raises(SandboxError, match="install failed"):
        sb.install()
    assert any(c[1:3] == ["volume", "rm"] for c in docker.calls)


def test_exec_is_offline_and_limited(config, worktree) -> None:
    docker = FakeDocker(image_exists=True)
    sb = _sandbox(config, worktree, docker)
    result = sb.exec("npm test")
    assert result.ok and not result.network
    run = docker.calls[-1]
    assert run[run.index("--network") + 1] == "none"
    assert run[run.index("--cpus") + 1] == str(config.limits.sandbox.cpus)
    assert run[run.index("--memory") + 1] == f"{config.limits.sandbox.memory_mb}m"
    assert run[run.index("--pids-limit") + 1] == str(config.limits.sandbox.pids_limit)
    assert f"{worktree.resolve()}:/work" in run
    assert run[run.index("-w") + 1] == "/work/ally-be"
    assert "CI=true" in run and "JEST_MAX_WORKERS=4" in run
    assert run[-3:] == [sb.image_tag(), "sh", "-lc"] or run[-4:-1] == [
        sb.image_tag(),
        "sh",
        "-lc",
    ]
    assert run[-1] == "npm test"


def test_timeout_kills_the_container(config, worktree) -> None:
    docker = FakeDocker(image_exists=True)
    sb = _sandbox(config, worktree, docker)
    docker.timeout_next = True
    result = sb.exec("sleep 999")
    assert result.timed_out and not result.ok
    kill = docker.calls[-1]
    assert kill[:2] == ["docker", "kill"] and kill[2].startswith(
        "bughunter-run-x-ally-be-"
    )


def test_mobile_mounts_absolute_cache_dir(config, tmp_path) -> None:
    root = tmp_path / "wt"
    (root / "ally-mobile").mkdir(parents=True)
    (root / "ally-mobile/pubspec.lock").write_text("packages: {}")
    docker = FakeDocker(image_exists=True)
    sb = _sandbox(config, root, docker, app="ally-mobile")
    sb.exec("flutter test")
    run = docker.calls[-1]
    mounts = [run[i + 1] for i, a in enumerate(run) if a == "-v"]
    assert any(m.endswith(":/work/ally-mobile/.dart_tool") for m in mounts)
    assert any(m.endswith(":/root/.pub-cache") for m in mounts)


def test_missing_lockfile_is_an_error(config, tmp_path) -> None:
    (tmp_path / "wt/ally-be").mkdir(parents=True)
    sb = _sandbox(config, tmp_path / "wt", FakeDocker(image_exists=True))
    with pytest.raises(SandboxError, match="lockfile not found"):
        sb.install()


def test_docker_available_with_fake() -> None:
    assert docker_available(FakeDocker()) is True


def test_old_layout_mounts_the_worktree_as_the_app(config, tmp_path) -> None:
    root = tmp_path / "old-layout"
    root.mkdir()
    (root / "package-lock.json").write_text("{}")
    docker = FakeDocker(image_exists=True)
    sb = Sandbox(config, root, "ally-be", "run-old", docker=docker, app_root=root)
    assert sb.mounts_app_at_root
    sb.exec("npm test")
    run = docker.calls[-1]
    assert f"{root.resolve()}:/work/ally-be" in run
    assert run[run.index("-w") + 1] == "/work/ally-be"
    assert any(v.endswith(":/work/ally-be/node_modules") for v in run)


class FlakyDocker(FakeDocker):
    """The install fails with the given outputs first, then succeeds."""

    def __init__(self, failures):
        super().__init__(image_exists=True)
        self.failures = list(failures)

    def __call__(self, args, timeout=None):
        args = list(args)
        if (
            args[1] == "run"
            and "--network" in args
            and args[args.index("--network") + 1] == "bridge"
        ):
            self.calls.append(args)
            if self.failures:
                return DockerResult(tuple(args), 1, "", self.failures.pop(0))
            self.volume_exists = True
            return DockerResult(tuple(args), 0, "ok", "")
        return super().__call__(args, timeout)


def test_install_retries_registry_and_dns_errors_with_backoff(config, worktree) -> None:
    dns = (
        "npm error code ENOTFOUND\nnpm error network request to "
        "https://registry.npmjs.org/zod failed, reason: getaddrinfo ENOTFOUND"
    )
    docker = FlakyDocker([dns, "Connection reset by peer"])
    slept: list[float] = []
    sb = Sandbox(
        config, worktree, "ally-be", "run-x", docker=docker, sleep=slept.append
    )
    assert sb.install().ok
    installs = [c for c in docker.calls if c[1] == "run"]
    assert len(installs) == 3 and slept == [5, 20]


def test_install_does_not_retry_a_real_error(config, worktree) -> None:
    docker = FlakyDocker(["npm error code ERESOLVE could not resolve dependency"])
    slept: list[float] = []
    sb = Sandbox(
        config, worktree, "ally-be", "run-x", docker=docker, sleep=slept.append
    )
    with pytest.raises(SandboxError):
        sb.install()
    assert slept == [] and len([c for c in docker.calls if c[1] == "run"]) == 1


def test_install_gives_up_after_the_last_retry(config, worktree) -> None:
    docker = FlakyDocker(["getaddrinfo ENOTFOUND"] * 5)
    slept: list[float] = []
    sb = Sandbox(
        config, worktree, "ally-be", "run-x", docker=docker, sleep=slept.append
    )
    with pytest.raises(SandboxError, match="ENOTFOUND"):
        sb.install()
    assert slept == [5, 20, 60]
