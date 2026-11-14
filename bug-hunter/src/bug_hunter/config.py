"""Loads and validates config/apps.yaml, models.yaml and limits.yaml.

Everything is strict: unknown keys, unknown apps or roles, and bad values raise
``ConfigError`` naming the file and field, so a broken config fails at start-up and
never half-way through a run. Env vars ``BUGHUNTER_MODEL_<ROLE>=provider:model``
override a role's model after the files are loaded.
"""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any, Literal, Mapping

import yaml
from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    ValidationError,
    field_validator,
    model_validator,
)

AppName = Literal["ally-be", "ally-web", "ally-ai", "ally-ai-learn", "ally-mobile"]
APP_NAMES: tuple[str, ...] = AppName.__args__  # type: ignore[attr-defined]

Role = Literal["triage", "investigate", "fix", "review", "embeddings"]
ROLES: tuple[str, ...] = Role.__args__  # type: ignore[attr-defined]
CHAT_ROLES: tuple[str, ...] = tuple(r for r in ROLES if r != "embeddings")

PROVIDERS: tuple[str, ...] = ("openai", "google_genai", "anthropic")

ENV_MODEL_PREFIX = "BUGHUNTER_MODEL_"
ENV_REPO_ROOT = "BUGHUNTER_REPO_ROOT"
ENV_CONFIG_DIR = "BUGHUNTER_CONFIG_DIR"

PACKAGE_ROOT = Path(__file__).resolve().parents[2]  # bug-hunter/
DEFAULT_CONFIG_DIR = PACKAGE_ROOT / "config"
DEFAULT_REPO_ROOT = PACKAGE_ROOT.parent  # ally-platform/
ENV_HOME = "BUGHUNTER_HOME"
# Live runs, kept artefacts, caches and the spend ledger live OUTSIDE the repository
# (default ~/.bug-hunter), so a branch switch or `git clean` can never delete them.
# Set BUGHUNTER_HOME in the shell or the CI job env (read at import, not from .env).
RUNS_DIR = Path(os.environ.get(ENV_HOME) or Path.home() / ".bug-hunter").expanduser()
ARTEFACTS_DIR = RUNS_DIR / "artefacts"
CACHE_DIR = RUNS_DIR / "cache"

CONFIG_FILES = ("apps.yaml", "models.yaml", "limits.yaml")


class ConfigError(Exception):
    """A config file is missing, unreadable or invalid. The message says where."""


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


# --- apps.yaml -----------------------------------------------------------------


class AppConfig(_Strict):
    path: str
    lang: Literal["typescript", "python", "dart"]
    test: str
    test_one: str | None = None
    test_project: str | None = None  # ally-web: one Nx project's suite ({project})
    format_files: str | None = (
        None  # formatter for changed files only ({files}); never for dart
    )
    # tests related to {files} (ally-be: jest --findRelatedTests); verify uses it
    # instead of the whole suite, which still runs in the PR's CI
    test_related: str | None = None
    lint: str | None = None
    typecheck: str | None = None
    test_dirs: list[str] = Field(default_factory=list)
    risk_paths: list[str] = Field(default_factory=list)
    notes: str | None = None

    @model_validator(mode="after")
    def _formatter_rules(self) -> "AppConfig":
        if self.format_files is not None:
            if self.lang == "dart":
                raise ValueError(
                    "format_files is not allowed for a dart app: never run dart format"
                )
            if "{files}" not in self.format_files:
                raise ValueError("format_files must contain {files}")
        if self.test_related is not None and "{files}" not in self.test_related:
            raise ValueError("test_related must contain {files}")
        return self

    # Sandbox (chunk 02)
    image: str = Field(min_length=1)
    install: str = Field(min_length=1)
    lockfile: str = Field(min_length=1)
    cache_dirs: list[str] = Field(default_factory=list)
    env: dict[str, str] = Field(default_factory=dict)

    @field_validator("path")
    @classmethod
    def _relative_path(cls, value: str) -> str:
        if not value or value.startswith("/") or ".." in Path(value).parts:
            raise ValueError("must be a relative path inside the repo")
        return value

    @field_validator("test", "test_one", "lint", "typecheck")
    @classmethod
    def _non_empty_command(cls, value: str | None) -> str | None:
        if value is not None and not value.strip():
            raise ValueError("command must not be empty")
        return value

    @field_validator("test_one")
    @classmethod
    def _test_one_placeholders(cls, value: str | None) -> str | None:
        if (
            value is not None
            and "{file}" not in value
            and "{project_file}" not in value
        ):
            raise ValueError("must contain the {file} (or {project_file}) placeholder")
        return value


class AppsConfig(_Strict):
    apps: dict[AppName, AppConfig]
    global_risk_paths: list[str] = Field(default_factory=list)

    @field_validator("apps")
    @classmethod
    def _all_apps_present(cls, value: dict[str, AppConfig]) -> dict[str, AppConfig]:
        missing = [name for name in APP_NAMES if name not in value]
        if missing:
            raise ValueError(f"missing apps: {', '.join(missing)}")
        return value


# --- models.yaml ---------------------------------------------------------------


class ModelDefaults(_Strict):
    temperature: float = Field(default=0, ge=0, le=2)
    timeout_s: int = Field(default=120, gt=0)
    max_retries: int = Field(default=2, ge=0)


class ModelSpec(_Strict):
    provider: Literal["openai", "google_genai", "anthropic"]
    model: str = Field(min_length=1)


class Price(_Strict):
    """USD per 1M tokens."""

    input: float = Field(ge=0)
    cached_input: float = Field(ge=0)
    output: float = Field(ge=0)


PROMPT_NODES: tuple[str, ...] = ("triage", "investigate", "reproduce", "fix", "review")


class ModelsConfig(_Strict):
    defaults: ModelDefaults = Field(default_factory=ModelDefaults)
    roles: dict[Role, ModelSpec]
    fallbacks: dict[Role, list[ModelSpec]] = Field(default_factory=dict)
    prompts: dict[str, str] = Field(default_factory=dict)  # node -> version (v1)
    prices: dict[str, Price] = Field(default_factory=dict)  # "provider:model" -> Price

    @field_validator("prompts")
    @classmethod
    def _prompt_versions(cls, value: dict[str, str]) -> dict[str, str]:
        for node, version in value.items():
            if node not in PROMPT_NODES:
                raise ValueError(
                    f"prompts.{node}: unknown node; expected {', '.join(PROMPT_NODES)}"
                )
            if not re.fullmatch(r"v\d+", version):
                raise ValueError(f"prompts.{node}: version must look like v1")
        return value

    @model_validator(mode="after")
    def _every_model_priced(self) -> "ModelsConfig":
        specs = list(self.roles.values()) + [
            s for fb in self.fallbacks.values() for s in fb
        ]
        missing = sorted({f"{s.provider}:{s.model}" for s in specs} - set(self.prices))
        if missing:
            raise ValueError(f"prices: no row for {', '.join(missing)}")
        return self

    def price_for(self, spec: ModelSpec) -> Price:
        return self.prices[f"{spec.provider}:{spec.model}"]

    @field_validator("roles")
    @classmethod
    def _all_roles_present(cls, value: dict[str, ModelSpec]) -> dict[str, ModelSpec]:
        missing = [role for role in ROLES if role not in value]
        if missing:
            raise ValueError(f"missing roles: {', '.join(missing)}")
        return value

    @field_validator("fallbacks")
    @classmethod
    def _no_embeddings_fallback(
        cls, value: dict[str, list[ModelSpec]]
    ) -> dict[str, list[ModelSpec]]:
        if "embeddings" in value:
            raise ValueError("fallbacks are only supported for chat roles")
        return value


# --- limits.yaml ---------------------------------------------------------------


class RunLimits(_Strict):
    max_fix_attempts: int = Field(default=3, ge=1)
    max_tokens: int = Field(gt=0)
    max_wall_clock_s: int = Field(gt=0)
    # per-app override of max_wall_clock_s (ally-web's Vitest suites are slow)
    max_wall_clock_s_by_app: dict[AppName, int] = Field(default_factory=dict)
    max_cost_usd: float = Field(default=1.5, gt=0)
    max_tool_turns: int = Field(default=30, ge=1)
    max_repro_attempts: int = Field(default=3, ge=1)
    max_fix_lines_changed: int = Field(default=80, ge=1)

    @field_validator("max_wall_clock_s_by_app")
    @classmethod
    def _positive_clock(cls, value: dict[str, int]) -> dict[str, int]:
        bad = [app for app, seconds in value.items() if seconds <= 0]
        if bad:
            raise ValueError(f"wall clock must be > 0 s for {', '.join(bad)}")
        return value

    def wall_clock_s(self, app: str | None) -> int:
        """The wall-clock cap for a run on ``app``."""
        by_app: dict[str | None, int] = dict(self.max_wall_clock_s_by_app)
        return by_app.get(app, self.max_wall_clock_s)


class SweepLimits(_Strict):
    max_runs_per_day: int = Field(default=5, ge=0)
    max_prs_per_day: int = Field(default=3, ge=0)


class ApprovalLimits(_Strict):
    expiry_days: int = Field(default=7, ge=1)


OutputMode = Literal["suggested_fix", "pr"]


class PrConfig(_Strict):
    auto_merge: bool = False
    # suggested_fix: a successful run ends with a report (root cause, failing test,
    # patch, reviewer notes), never a PR or an approval request. Switching to pr
    # needs a holdout milestone with >= 60% fix pass (docs/bug-hunter/CONTEXT.md).
    output_mode: OutputMode = "suggested_fix"


class SandboxLimits(_Strict):
    cpus: float = Field(gt=0)
    memory_mb: int = Field(gt=0)
    timeout_s: int = Field(gt=0)
    install_timeout_s: int = Field(default=1800, gt=0)
    pids_limit: int = Field(default=2048, gt=0)


class ContextLimits(_Strict):
    token_safety_margin: float = Field(default=0.15, ge=0, lt=0.9)
    chars_per_token_offline: int = Field(default=3, ge=1, le=4)
    repo_map_keep_commits: int = Field(default=2, ge=1)
    outline_first_min_lines: int = Field(default=800, ge=1)


class ArtefactLimits(_Strict):
    max_age_days: int = Field(default=30, ge=1)
    max_size_mb: int = Field(default=500, ge=1)


class EvalLimits(_Strict):
    min_free_gb: float = Field(default=5, ge=0)
    max_cost_usd: float = Field(default=10, gt=0)
    since_months: int = Field(default=12, ge=1)
    max_src_lines: int = Field(default=60, ge=1)
    max_src_lines_thin_apps: int = Field(default=120, ge=1)
    clean_window_days: int = Field(default=30, ge=1)
    clean_min_src_lines: int = Field(default=5, ge=1)
    clean_max_src_lines: int = Field(default=200, ge=1)


class MemoryConfig(_Strict):
    """Long-term memory (chunk 07)."""

    # auto: pgvector + the embeddings role when the server has the extension, else
    # lookup by error signature, app and file paths; on: require pgvector; off: never
    semantic: Literal["auto", "on", "off"] = "auto"
    recall_limit: int = Field(default=5, ge=1, le=5)  # records per recall query
    # a record is recalled only with a matching signature, a shared file or this
    # much word overlap (Jaccard); similarity only ranks
    min_word_overlap: float = Field(default=0.1, ge=0.0, le=1.0)
    scan_limit: int = Field(default=500, ge=10)  # candidates read per namespace
    github_feedback: bool = False  # PR/issue label reader: built, switched off
    # only labels/comments by members of this org, or these logins, count (public repo)
    github_org: str = "HelloAllyTech"
    github_allow: list[str] = Field(default_factory=list)


class LimitsConfig(_Strict):
    run: RunLimits
    sweep: SweepLimits = Field(default_factory=SweepLimits)
    approval: ApprovalLimits = Field(default_factory=ApprovalLimits)
    pr: PrConfig = Field(default_factory=PrConfig)
    sandbox: SandboxLimits
    nodes: dict[str, int] = Field(default_factory=dict)
    context: ContextLimits = Field(default_factory=ContextLimits)
    artefacts: ArtefactLimits = Field(default_factory=ArtefactLimits)
    evals: EvalLimits = Field(default_factory=EvalLimits)
    memory: MemoryConfig = Field(default_factory=MemoryConfig)

    @field_validator("nodes")
    @classmethod
    def _positive_budgets(cls, value: dict[str, int]) -> dict[str, int]:
        bad = [node for node, budget in value.items() if budget <= 0]
        if bad:
            raise ValueError(f"token budget must be positive: {', '.join(bad)}")
        return value


# --- the whole thing -----------------------------------------------------------


class BugHunterConfig(_Strict):
    apps: AppsConfig
    models: ModelsConfig
    limits: LimitsConfig
    config_dir: Path
    repo_root: Path
    model_overrides: dict[str, ModelSpec] = Field(default_factory=dict)

    def app(self, name: str) -> AppConfig:
        if name not in self.apps.apps:
            raise ConfigError(
                f"unknown app {name!r}; expected one of {', '.join(APP_NAMES)}"
            )
        return self.apps.apps[name]  # type: ignore[index]

    def app_path(self, name: str) -> Path:
        return self.repo_root / self.app(name).path

    def model_for(self, role: str) -> ModelSpec:
        """The role's model after env overrides."""
        if role not in self.models.roles:
            raise ConfigError(
                f"unknown model role {role!r}; expected one of {', '.join(ROLES)}"
            )
        override = self.model_overrides.get(role)
        return override or self.models.roles[role]  # type: ignore[index]

    def fallbacks_for(self, role: str) -> list[ModelSpec]:
        if role not in self.models.roles:
            raise ConfigError(
                f"unknown model role {role!r}; expected one of {', '.join(ROLES)}"
            )
        return list(self.models.fallbacks.get(role, []))  # type: ignore[call-overload]

    def missing_app_paths(self) -> list[str]:
        """``"<app>: <path>"`` for every app directory that does not exist."""
        return [
            f"{name}: {self.app_path(name)}"
            for name in self.apps.apps
            if not self.app_path(name).is_dir()
        ]


# --- loading -------------------------------------------------------------------


def _read_yaml(path: Path) -> dict[str, Any]:
    if not path.is_file():
        raise ConfigError(f"{path}: file not found")
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
    except yaml.YAMLError as exc:
        raise ConfigError(f"{path}: invalid YAML: {exc}") from exc
    if data is None:
        raise ConfigError(f"{path}: file is empty")
    if not isinstance(data, dict):
        raise ConfigError(f"{path}: top level must be a mapping")
    return data


def _format_validation_error(path: Path, exc: ValidationError) -> str:
    lines = [f"{path}: invalid config"]
    for error in exc.errors():
        location = ".".join(str(part) for part in error["loc"]) or "<root>"
        lines.append(f"  - {location}: {error['msg']}")
    return "\n".join(lines)


def _load_model(path: Path, model: type[BaseModel]) -> Any:
    try:
        return model.model_validate(_read_yaml(path))
    except ValidationError as exc:
        raise ConfigError(_format_validation_error(path, exc)) from exc


def parse_model_override(name: str, value: str) -> ModelSpec:
    """``provider:model`` → ModelSpec, with a clear error on anything else."""
    provider, sep, model = value.partition(":")
    if not sep or not provider.strip() or not model.strip():
        raise ConfigError(
            f"{name}: expected 'provider:model' (for example 'openai:gpt-5-mini'), "
            f"got {value!r}"
        )
    try:
        return ModelSpec(provider=provider.strip(), model=model.strip())
    except ValidationError:
        raise ConfigError(
            f"{name}: unknown provider {provider.strip()!r}; "
            f"expected one of {', '.join(PROVIDERS)}"
        ) from None


def model_overrides_from_env(env: Mapping[str, str]) -> dict[str, ModelSpec]:
    overrides: dict[str, ModelSpec] = {}
    for name, value in env.items():
        if not name.startswith(ENV_MODEL_PREFIX):
            continue
        role = name[len(ENV_MODEL_PREFIX) :].lower()
        if role not in ROLES:
            raise ConfigError(
                f"{name}: unknown role {role!r}; expected one of {', '.join(ROLES)}"
            )
        overrides[role] = parse_model_override(name, value)
    return overrides


def load_config(
    config_dir: Path | str | None = None,
    repo_root: Path | str | None = None,
    env: Mapping[str, str] | None = None,
) -> BugHunterConfig:
    """Load and validate all three config files.

    ``config_dir`` defaults to ``$BUGHUNTER_CONFIG_DIR`` or ``bug-hunter/config``;
    ``repo_root`` to ``$BUGHUNTER_REPO_ROOT`` or the parent of ``bug-hunter/``.
    """
    env = os.environ if env is None else env
    config_dir = Path(config_dir or env.get(ENV_CONFIG_DIR) or DEFAULT_CONFIG_DIR)
    repo_root = Path(repo_root or env.get(ENV_REPO_ROOT) or DEFAULT_REPO_ROOT)
    if not config_dir.is_dir():
        raise ConfigError(f"{config_dir}: config directory not found")

    apps = _load_model(config_dir / "apps.yaml", AppsConfig)
    models = _load_model(config_dir / "models.yaml", ModelsConfig)
    limits = _load_model(config_dir / "limits.yaml", LimitsConfig)

    return BugHunterConfig(
        apps=apps,
        models=models,
        limits=limits,
        config_dir=config_dir.resolve(),
        repo_root=repo_root.resolve(),
        model_overrides=model_overrides_from_env(env),
    )
