"""Config loading: the shipped files are valid and point at real paths; broken
files fail fast with the file and field named; env overrides apply."""

from __future__ import annotations

import fnmatch
import subprocess
from pathlib import Path

import pytest

from bug_hunter.config import (
    APP_NAMES,
    ROLES,
    BugHunterConfig,
    ConfigError,
    load_config,
    model_overrides_from_env,
    parse_model_override,
)
from tests.conftest import rewrite_yaml


def _tracked_files(repo_root: Path, app_path: str) -> list[str]:
    out = subprocess.run(
        ["git", "-C", str(repo_root), "ls-files", "--", app_path],
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    prefix = "" if app_path == "." else app_path + "/"
    return [line[len(prefix) :] for line in out.splitlines() if line]


def _matches(pattern: str, files: list[str]) -> bool:
    """Same glob semantics as safety/paths.py will use: ``*`` crosses ``/`` and a
    trailing ``/`` means everything under that directory."""
    if pattern.endswith("/"):
        pattern += "*"
    if "*" in pattern:
        return any(fnmatch.fnmatch(f, pattern) for f in files)
    return pattern in files


# --- the shipped config --------------------------------------------------------


def test_shipped_config_loads(config: BugHunterConfig) -> None:
    assert set(config.apps.apps) == set(APP_NAMES)
    assert set(config.models.roles) == set(ROLES)
    assert config.models.defaults.temperature == 0
    assert config.models.defaults.timeout_s == 120
    assert config.models.defaults.max_retries == 2
    assert config.limits.run.max_fix_attempts == 3
    assert config.limits.sweep.max_prs_per_day == 3
    assert config.limits.sweep.max_runs_per_day == 5
    assert config.limits.approval.expiry_days == 7
    assert config.model_overrides == {}


def test_review_is_a_different_family_from_fix(config: BugHunterConfig) -> None:
    assert config.model_for("review").provider != config.model_for("fix").provider


@pytest.mark.parametrize("app", APP_NAMES)
def test_every_app_path_exists(config: BugHunterConfig, app: str) -> None:
    assert config.app_path(app).is_dir(), config.app_path(app)


def test_missing_app_paths_is_empty_for_the_real_repo(config: BugHunterConfig) -> None:
    assert config.missing_app_paths() == []


@pytest.mark.parametrize("app", APP_NAMES)
def test_every_risk_path_matches_tracked_files(
    config: BugHunterConfig, repo_root: Path, app: str
) -> None:
    files = _tracked_files(repo_root, config.app(app).path)
    assert files, f"{app}: no tracked files"
    unmatched = [p for p in config.app(app).risk_paths if not _matches(p, files)]
    assert unmatched == [], f"{app}: risk_paths matching nothing: {unmatched}"


@pytest.mark.parametrize("app", APP_NAMES)
def test_every_test_dir_matches_tracked_files(
    config: BugHunterConfig, repo_root: Path, app: str
) -> None:
    files = _tracked_files(repo_root, config.app(app).path)
    unmatched = [p for p in config.app(app).test_dirs if not _matches(p, files)]
    assert unmatched == [], f"{app}: test_dirs matching nothing: {unmatched}"


def test_global_risk_paths_match_something(
    config: BugHunterConfig, repo_root: Path
) -> None:
    files = _tracked_files(repo_root, ".")
    unmatched = [p for p in config.apps.global_risk_paths if not _matches(p, files)]
    assert unmatched == []


def test_web_risk_paths_do_not_catch_authoring_files(config: BugHunterConfig) -> None:
    patterns = config.app("ally-web").risk_paths
    for innocent in (
        "apps/ally-admin-dashboard/src/utils/agentAuthored.ts",
        "apps/ally-admin-dashboard/src/hooks/useContentAuthoring.ts",
    ):
        assert not any(fnmatch.fnmatch(innocent, p) for p in patterns), innocent
    assert any(
        fnmatch.fnmatch("apps/ally-helpline-dashboard/src/api/auth.ts", p)
        for p in patterns
    )


# --- invalid config fails fast, naming file and field --------------------------


def test_missing_config_dir(tmp_path: Path) -> None:
    with pytest.raises(ConfigError, match="config directory not found"):
        load_config(config_dir=tmp_path / "nope", env={})


def test_missing_file(config_copy: Path) -> None:
    (config_copy / "limits.yaml").unlink()
    with pytest.raises(ConfigError, match=r"limits\.yaml: file not found"):
        load_config(config_dir=config_copy, env={})


def test_empty_file(config_copy: Path) -> None:
    (config_copy / "models.yaml").write_text("")
    with pytest.raises(ConfigError, match=r"models\.yaml: file is empty"):
        load_config(config_dir=config_copy, env={})


def test_invalid_yaml(config_copy: Path) -> None:
    (config_copy / "apps.yaml").write_text("apps: [unclosed\n")
    with pytest.raises(ConfigError, match=r"apps\.yaml: invalid YAML"):
        load_config(config_dir=config_copy, env={})


def test_unknown_key_is_rejected(config_copy: Path) -> None:
    rewrite_yaml(
        config_copy / "apps.yaml",
        lambda d: d["apps"]["ally-be"].__setitem__("tset", "typo"),
    )
    with pytest.raises(ConfigError) as excinfo:
        load_config(config_dir=config_copy, env={})
    assert "apps.yaml" in str(excinfo.value)
    assert "apps.ally-be.tset" in str(excinfo.value)


def test_missing_app_is_rejected(config_copy: Path) -> None:
    rewrite_yaml(config_copy / "apps.yaml", lambda d: d["apps"].pop("ally-mobile"))
    with pytest.raises(ConfigError, match="missing apps: ally-mobile"):
        load_config(config_dir=config_copy, env={})


def test_unknown_app_is_rejected(config_copy: Path) -> None:
    rewrite_yaml(
        config_copy / "apps.yaml",
        lambda d: d["apps"].__setitem__("ally-infra", dict(d["apps"]["ally-ai"])),
    )
    with pytest.raises(ConfigError, match="ally-infra"):
        load_config(config_dir=config_copy, env={})


def test_absolute_app_path_is_rejected(config_copy: Path) -> None:
    rewrite_yaml(
        config_copy / "apps.yaml",
        lambda d: d["apps"]["ally-ai"].__setitem__("path", "/etc"),
    )
    with pytest.raises(ConfigError, match="apps.ally-ai.path"):
        load_config(config_dir=config_copy, env={})


def test_test_one_needs_file_placeholder(config_copy: Path) -> None:
    rewrite_yaml(
        config_copy / "apps.yaml",
        lambda d: d["apps"]["ally-ai"].__setitem__("test_one", "poetry run pytest"),
    )
    with pytest.raises(ConfigError, match=r"\{file\} placeholder"):
        load_config(config_dir=config_copy, env={})


def test_unknown_provider_is_rejected(config_copy: Path) -> None:
    rewrite_yaml(
        config_copy / "models.yaml",
        lambda d: d["roles"]["fix"].__setitem__("provider", "cohere"),
    )
    with pytest.raises(ConfigError) as excinfo:
        load_config(config_dir=config_copy, env={})
    assert "models.yaml" in str(excinfo.value)
    assert "roles.fix.provider" in str(excinfo.value)


def test_missing_role_is_rejected(config_copy: Path) -> None:
    rewrite_yaml(config_copy / "models.yaml", lambda d: d["roles"].pop("review"))
    with pytest.raises(ConfigError, match="missing roles: review"):
        load_config(config_dir=config_copy, env={})


def test_bad_temperature_is_rejected(config_copy: Path) -> None:
    rewrite_yaml(
        config_copy / "models.yaml",
        lambda d: d["defaults"].__setitem__("temperature", 7),
    )
    with pytest.raises(ConfigError, match="defaults.temperature"):
        load_config(config_dir=config_copy, env={})


def test_embeddings_fallback_is_rejected(config_copy: Path) -> None:
    rewrite_yaml(
        config_copy / "models.yaml",
        lambda d: d["fallbacks"].__setitem__(
            "embeddings", [{"provider": "openai", "model": "x"}]
        ),
    )
    with pytest.raises(ConfigError, match="only supported for chat roles"):
        load_config(config_dir=config_copy, env={})


def test_zero_fix_attempts_is_rejected(config_copy: Path) -> None:
    rewrite_yaml(
        config_copy / "limits.yaml",
        lambda d: d["run"].__setitem__("max_fix_attempts", 0),
    )
    with pytest.raises(ConfigError, match="run.max_fix_attempts"):
        load_config(config_dir=config_copy, env={})


def test_negative_node_budget_is_rejected(config_copy: Path) -> None:
    rewrite_yaml(
        config_copy / "limits.yaml", lambda d: d["nodes"].__setitem__("fix", -1)
    )
    with pytest.raises(ConfigError, match="token budget must be positive: fix"):
        load_config(config_dir=config_copy, env={})


# --- unknown names at lookup time ----------------------------------------------


def test_unknown_role_lookup(config: BugHunterConfig) -> None:
    with pytest.raises(ConfigError, match="unknown model role 'planner'"):
        config.model_for("planner")
    with pytest.raises(ConfigError, match="unknown model role 'planner'"):
        config.fallbacks_for("planner")


def test_unknown_app_lookup(config: BugHunterConfig) -> None:
    with pytest.raises(ConfigError, match="unknown app 'infra'"):
        config.app("infra")


# --- env overrides ---------------------------------------------------------------


def test_env_override_changes_one_role_only() -> None:
    cfg = load_config(env={"BUGHUNTER_MODEL_FIX": "google_genai:gemini-2.5-flash"})
    assert cfg.model_for("fix").provider == "google_genai"
    assert cfg.model_for("fix").model == "gemini-2.5-flash"
    assert cfg.models.roles["fix"].model == "gpt-5"  # file value untouched
    assert cfg.model_for("investigate").model == "gpt-5"
    assert set(cfg.model_overrides) == {"fix"}


def test_env_override_keeps_fallbacks() -> None:
    cfg = load_config(env={"BUGHUNTER_MODEL_FIX": "openai:gpt-5-mini"})
    assert [f.model for f in cfg.fallbacks_for("fix")] == ["gemini-2.5-pro"]


def test_env_override_from_process_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("BUGHUNTER_MODEL_TRIAGE", "openai:gpt-5")
    assert load_config().model_for("triage").model == "gpt-5"


def test_env_override_repo_root(tmp_path: Path) -> None:
    cfg = load_config(env={"BUGHUNTER_REPO_ROOT": str(tmp_path)})
    assert cfg.repo_root == tmp_path.resolve()
    assert len(cfg.missing_app_paths()) == len(APP_NAMES)


@pytest.mark.parametrize("value", ["gpt-5", "openai:", ":gpt-5", ""])
def test_malformed_override_is_rejected(value: str) -> None:
    with pytest.raises(ConfigError, match="expected 'provider:model'"):
        parse_model_override("BUGHUNTER_MODEL_FIX", value)


def test_override_with_unknown_provider_is_rejected() -> None:
    with pytest.raises(ConfigError, match="unknown provider 'cohere'"):
        parse_model_override("BUGHUNTER_MODEL_FIX", "cohere:command")


def test_override_for_unknown_role_is_rejected() -> None:
    with pytest.raises(ConfigError, match="BUGHUNTER_MODEL_PLANNER: unknown role"):
        model_overrides_from_env({"BUGHUNTER_MODEL_PLANNER": "openai:gpt-5"})


def test_unrelated_env_vars_are_ignored() -> None:
    assert model_overrides_from_env({"BUGHUNTER_REPO_ROOT": "/x", "HOME": "/h"}) == {}
