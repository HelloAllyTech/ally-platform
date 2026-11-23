"""Shared fixtures. Tests are offline: dummy API keys only let provider clients
construct; nothing is ever invoked."""

from __future__ import annotations

import shutil
from pathlib import Path

import pytest
import yaml

from bug_hunter.config import DEFAULT_CONFIG_DIR, DEFAULT_REPO_ROOT, load_config


@pytest.fixture(autouse=True)
def _dummy_provider_keys(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-not-a-real-key")
    monkeypatch.setenv("GOOGLE_API_KEY", "test-not-a-real-key")
    # unit tests never trace: on CI the job env turns LangSmith on for the evals, and
    # the suite's fake tool calls showed up in the project
    monkeypatch.setenv("LANGSMITH_TRACING", "false")
    monkeypatch.delenv("LANGSMITH_API_KEY", raising=False)
    monkeypatch.delenv("BUGHUNTER_CONFIG_DIR", raising=False)
    monkeypatch.delenv("BUGHUNTER_REPO_ROOT", raising=False)


@pytest.fixture
def config():
    return load_config(env={})


@pytest.fixture
def repo_root() -> Path:
    return DEFAULT_REPO_ROOT


@pytest.fixture
def config_copy(tmp_path: Path) -> Path:
    """A writable copy of the shipped config directory."""
    target = tmp_path / "config"
    shutil.copytree(DEFAULT_CONFIG_DIR, target)
    return target


def rewrite_yaml(path: Path, mutate) -> None:
    """Load a YAML file, apply ``mutate(data)`` in place, write it back."""
    data = yaml.safe_load(path.read_text())
    mutate(data)
    path.write_text(yaml.safe_dump(data))


# Shared with the graph tests: the two-commit bug repo and its harness options.
from tests.test_evals_harness import repo_config  # noqa: E402,F401
