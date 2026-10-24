"""The typed prompt contracts (app/prompts/contracts.py) against the defaults.

This is the CI check for the prompt files in Git: every default must satisfy
its contract, and every prompt must have one.
"""

import json
import re
import subprocess
import sys
from pathlib import Path

import pytest

from app.prompts.contracts import (
    PROMPT_CONTRACTS,
    PromptInputs,
    all_contract_payloads,
    contract_payload,
    is_closed,
    missing_required,
    required_variables,
)

SERVICE_ROOT = Path(__file__).resolve().parents[2]
PROMPTS_DIR = SERVICE_ROOT / "app" / "prompts"
PREFIX = "ally_ai_learn_"
PLACEHOLDER = re.compile(r"\{([a-zA-Z_][a-zA-Z0-9_]*)\}")


def _defaults() -> dict[str, str]:
    """Prompt code -> default text, derived exactly as scripts/sync_prompts.py does."""
    out = {}
    for txt in sorted(PROMPTS_DIR.rglob("*.txt")):
        rel = txt.relative_to(PROMPTS_DIR)
        code = PREFIX + str(rel.with_suffix("")).replace("/", "_")
        out[code] = txt.read_text(encoding="utf-8")
    return out


DEFAULTS = _defaults()


def test_every_prompt_has_a_contract_and_every_contract_a_prompt():
    assert sorted(PROMPT_CONTRACTS) == sorted(DEFAULTS)


@pytest.mark.parametrize("code", sorted(DEFAULTS))
def test_default_contains_every_required_variable(code):
    used = set(PLACEHOLDER.findall(DEFAULTS[code]))
    missing = [name for name in required_variables(code) if name not in used]
    assert not missing, (
        f"{code}: the default in Git is missing required {missing}. "
        "Defaults change only together with their contract."
    )


@pytest.mark.parametrize("code", sorted(DEFAULTS))
def test_closed_contract_default_uses_only_declared_variables(code):
    model = PROMPT_CONTRACTS[code]
    if not is_closed(model):
        pytest.skip("open contract: undeclared variables allowed")
    declared = set(contract_payload(code)["variables"])
    unknown = set(PLACEHOLDER.findall(DEFAULTS[code])) - declared
    assert not unknown, f"{code}: the default uses undeclared {sorted(unknown)}"


def test_contract_payload_shape():
    for code in PROMPT_CONTRACTS:
        payload = contract_payload(code)
        assert set(payload) <= {
            "variables",
            "required",
            "fragments",
            "contractVersion",
            "output",
        }
        assert payload["required"] == sorted(payload["required"])
        assert isinstance(payload["contractVersion"], int)
        assert payload["variables"] is None or isinstance(payload["variables"], list)
    assert contract_payload("not_a_prompt") is None


def test_open_and_closed_payloads():
    class Closed(PromptInputs):
        model_config = {"extra": "forbid"}
        a: str
        b: str | None = None

    PROMPT_CONTRACTS["__closed__"] = Closed
    try:
        assert contract_payload("__closed__") == {
            "variables": ["a", "b"],
            "required": ["a"],
            "contractVersion": 1,
        }
        assert missing_required("__closed__", {"b": "x"}) == ["a"]
        assert missing_required("__closed__", {"a": ""}) == []
    finally:
        del PROMPT_CONTRACTS["__closed__"]


def test_module_prints_every_contract_as_json():
    """`python -m app.prompts.contracts` feeds the release check."""
    out = subprocess.run(
        [sys.executable, "-m", "app.prompts.contracts"],
        cwd=SERVICE_ROOT,
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    assert json.loads(out) == json.loads(json.dumps(all_contract_payloads()))
