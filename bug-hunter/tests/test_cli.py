"""``bug-hunter config check`` passes on the real tree, fails on a bad one, and
prints no env values."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from typer.testing import CliRunner

from bug_hunter.cli import app
from tests.conftest import rewrite_yaml

runner = CliRunner()


def test_check_passes_on_the_real_repo() -> None:
    result = runner.invoke(app, ["config", "check"])
    assert result.exit_code == 0, result.output
    assert "config ok" in result.output
    for app_name in ("ally-be", "ally-web", "ally-ai", "ally-ai-learn", "ally-mobile"):
        assert app_name in result.output
    assert "review       google_genai:gemini-2.5-pro" in result.output
    assert "fallbacks: google_genai:gemini-2.5-pro" in result.output


def test_check_json_output() -> None:
    result = runner.invoke(app, ["config", "check", "--json"])
    assert result.exit_code == 0, result.output
    payload = json.loads(result.output.rsplit("\nconfig ok", 1)[0])
    assert payload["models"]["roles"]["fix"]["fallbacks"][0]["model"] == (
        "gemini-2.5-pro"
    )
    assert all(details["exists"] for details in payload["apps"].values())


def test_check_fails_when_an_app_path_is_missing(tmp_path: Path) -> None:
    result = runner.invoke(app, ["config", "check", "--repo-root", str(tmp_path)])
    assert result.exit_code == 1
    assert "MISSING" in result.output
    assert "missing app paths:" in result.output


def test_check_fails_on_invalid_config(config_copy: Path) -> None:
    rewrite_yaml(config_copy / "models.yaml", lambda d: d["roles"].pop("fix"))
    result = runner.invoke(app, ["config", "check", "--config-dir", str(config_copy)])
    assert result.exit_code == 1
    assert "config error" in result.output
    assert "missing roles: fix" in result.output


def test_check_shows_override_without_env_values(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("BUGHUNTER_MODEL_FIX", "openai:gpt-5-mini")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-should-never-be-printed")
    result = runner.invoke(app, ["config", "check"])
    assert result.exit_code == 0, result.output
    assert "fix          openai:gpt-5-mini  (env override)" in result.output
    assert "sk-should-never-be-printed" not in result.output
