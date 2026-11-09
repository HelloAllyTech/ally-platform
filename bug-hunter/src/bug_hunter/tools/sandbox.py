"""Docker sandbox: one container per command, the run's worktree mounted at /work.

Repo code never runs on the host. Each app has an image built from
``bug-hunter/sandbox/<image>.Dockerfile`` (versions mirror the test-*.yml workflows).
Dependencies install once per lockfile hash into named Docker volumes, with network
on; every other command runs with ``--network none`` and the CPU, memory, pid and
time limits from ``limits.yaml``. Docker is driven through a ``DockerRunner`` the
unit tests fake.
"""

from __future__ import annotations

import hashlib
import shlex
import subprocess
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Mapping, Protocol, Sequence

from bug_hunter.config import PACKAGE_ROOT, BugHunterConfig

SANDBOX_DIR = PACKAGE_ROOT / "sandbox"
WORK_MOUNT = "/work"
IMAGE_PREFIX = "bug-hunter"
VOLUME_PREFIX = "bughunter-deps"


class SandboxError(RuntimeError):
    pass


@dataclass(frozen=True)
class DockerResult:
    args: tuple[str, ...]
    returncode: int
    stdout: str
    stderr: str
    timed_out: bool = False

    @property
    def ok(self) -> bool:
        return self.returncode == 0 and not self.timed_out


class DockerRunner(Protocol):
    def __call__(
        self, args: Sequence[str], timeout: int | None = None
    ) -> DockerResult: ...


def subprocess_docker(args: Sequence[str], timeout: int | None = None) -> DockerResult:
    try:
        proc = subprocess.run(
            list(args), capture_output=True, text=True, timeout=timeout
        )
    except subprocess.TimeoutExpired as exc:
        out = (
            exc.stdout.decode() if isinstance(exc.stdout, bytes) else (exc.stdout or "")
        )
        err = (
            exc.stderr.decode() if isinstance(exc.stderr, bytes) else (exc.stderr or "")
        )
        return DockerResult(tuple(args), -1, out, err, timed_out=True)
    except FileNotFoundError as exc:
        raise SandboxError("docker CLI not found") from exc
    return DockerResult(tuple(args), proc.returncode, proc.stdout, proc.stderr)


@dataclass(frozen=True)
class ExecResult:
    command: str
    exit_code: int
    stdout: str
    stderr: str
    duration_s: float
    timed_out: bool = False
    network: bool = False

    @property
    def ok(self) -> bool:
        return self.exit_code == 0 and not self.timed_out


@dataclass
class Sandbox:
    """Sandbox for one app inside one run's worktree."""

    config: BugHunterConfig
    worktree: Path
    app: str
    run_id: str
    docker: DockerRunner = subprocess_docker
    sandbox_dir: Path = SANDBOX_DIR
    app_root: Path | None = (
        None  # host dir that *is* the app; default worktree/<app path>
    )
    _counter: int = field(default=0, init=False)

    def __post_init__(self) -> None:
        self.worktree = Path(self.worktree).resolve()
        self.app_config = self.config.app(self.app)
        self.app_path = self.app_config.path
        self.limits = self.config.limits.sandbox
        # Pre-monorepo commits keep the app at the worktree root (no ally-be/ prefix):
        # the worktree is then mounted at /work/<app path> so commands see the same
        # layout as today.
        self.app_root = (
            Path(self.app_root).resolve()
            if self.app_root
            else self.worktree / self.app_path
        )

    @property
    def mounts_app_at_root(self) -> bool:
        return self.app_root != self.worktree / self.app_path

    # --- image ----

    @property
    def dockerfile(self) -> Path:
        path = self.sandbox_dir / f"{self.app_config.image}.Dockerfile"
        if not path.is_file():
            raise SandboxError(f"{path}: sandbox Dockerfile not found")
        return path

    def image_tag(self) -> str:
        digest = hashlib.sha256(self.dockerfile.read_bytes()).hexdigest()[:12]
        return f"{IMAGE_PREFIX}/{self.app_config.image}:{digest}"

    def image_exists(self, tag: str) -> bool:
        return self.docker(["docker", "image", "inspect", tag], timeout=60).ok

    def ensure_image(self) -> str:
        tag = self.image_tag()
        if self.image_exists(tag):
            return tag
        result = self.docker(
            [
                "docker",
                "build",
                "-f",
                str(self.dockerfile),
                "-t",
                tag,
                str(self.sandbox_dir),
            ],
            timeout=self.limits.install_timeout_s * 2,
        )
        if not result.ok:
            raise SandboxError(f"docker build {tag} failed: {result.stderr[-2000:]}")
        return tag

    # --- dependency volumes ----

    def lockfile_hash(self) -> str:
        lockfile = self.app_root / self.app_config.lockfile
        if not lockfile.is_file():
            raise SandboxError(f"{lockfile}: lockfile not found")
        return hashlib.sha256(lockfile.read_bytes()).hexdigest()[:12]

    def volume_names(self) -> list[str]:
        base = f"{VOLUME_PREFIX}-{self.app}-{self.lockfile_hash()}"
        return [f"{base}-{index}" for index in range(len(self.app_config.cache_dirs))]

    def _volume_mounts(self) -> list[str]:
        args: list[str] = []
        for name, cache_dir in zip(self.volume_names(), self.app_config.cache_dirs):
            target = (
                cache_dir
                if cache_dir.startswith("/")
                else f"{WORK_MOUNT}/{self.app_path}/{cache_dir}"
            )
            args += ["-v", f"{name}:{target}"]
        return args

    def volume_exists(self) -> bool:
        names = self.volume_names()
        if not names:
            return True
        return self.docker(["docker", "volume", "inspect", names[0]], timeout=60).ok

    def install(self, force: bool = False) -> ExecResult | None:
        """Install dependencies into the cache volumes (network on). Returns None
        when the volumes already exist for this lockfile hash."""
        if not force and self.volume_exists():
            return None
        result = self.exec(
            self.app_config.install,
            network=True,
            timeout=self.limits.install_timeout_s,
        )
        if not result.ok:
            for name in self.volume_names():
                self.docker(["docker", "volume", "rm", "-f", name], timeout=60)
            raise SandboxError(
                f"{self.app}: install failed ({result.exit_code}): "
                f"{(result.stderr or result.stdout)[-2000:]}"
            )
        return result

    # --- commands --------------------------------------------------------------------

    def container_name(self) -> str:
        self._counter += 1
        return f"bughunter-{self.run_id}-{self.app}-{self._counter}"

    def run_args(
        self,
        command: str,
        *,
        network: bool,
        name: str,
        extra_env: Mapping[str, str] | None = None,
    ) -> list[str]:
        args = [
            "docker",
            "run",
            "--rm",
            "--name",
            name,
            "--cpus",
            str(self.limits.cpus),
            "--memory",
            f"{self.limits.memory_mb}m",
            "--pids-limit",
            str(self.limits.pids_limit),
            "--network",
            "bridge" if network else "none",
            "-v",
            (
                f"{self.app_root}:{WORK_MOUNT}/{self.app_path}"
                if self.mounts_app_at_root
                else f"{self.worktree}:{WORK_MOUNT}"
            ),
            "-w",
            f"{WORK_MOUNT}/{self.app_path}",
        ]
        args += self._volume_mounts()
        env = {**self.app_config.env, **(extra_env or {})}
        for key, value in env.items():
            args += ["-e", f"{key}={value}"]
        args += [self.ensure_image(), "sh", "-lc", command]
        return args

    def exec(
        self,
        command: str,
        *,
        network: bool = False,
        timeout: int | None = None,
        extra_env: Mapping[str, str] | None = None,
    ) -> ExecResult:
        name = self.container_name()
        args = self.run_args(command, network=network, name=name, extra_env=extra_env)
        started = time.monotonic()
        result = self.docker(args, timeout=timeout or self.limits.timeout_s)
        duration = time.monotonic() - started
        if result.timed_out:
            self.docker(["docker", "kill", name], timeout=60)
        return ExecResult(
            command=command,
            exit_code=result.returncode,
            stdout=result.stdout,
            stderr=result.stderr,
            duration_s=round(duration, 1),
            timed_out=result.timed_out,
            network=network,
        )

    def cleanup(self) -> None:
        """Kill any container left over from this run (best effort)."""
        listing = self.docker(
            ["docker", "ps", "-aq", "--filter", f"name=bughunter-{self.run_id}-"],
            timeout=60,
        )
        ids = listing.stdout.split()
        if ids:
            self.docker(["docker", "rm", "-f", *ids], timeout=120)


def docker_available(docker: DockerRunner = subprocess_docker) -> bool:
    try:
        return docker(
            ["docker", "version", "--format", "{{.Server.Version}}"], timeout=15
        ).ok
    except SandboxError:
        return False


def quote(value: str) -> str:
    return shlex.quote(value)
