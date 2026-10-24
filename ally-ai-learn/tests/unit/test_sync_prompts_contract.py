"""scripts/sync_prompts.py sends each prompt's typed contract to the store."""

import importlib.util
from pathlib import Path

from app.prompts.contracts import contract_payload

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "sync_prompts.py"


def _load_script():
    spec = importlib.util.spec_from_file_location("sync_prompts", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_every_synced_prompt_carries_its_in_code_contract():
    items = _load_script().scan_prompts()
    assert items
    for item in items:
        assert item["contract"] == contract_payload(item["promptCode"])


def test_main_agent_contract_declares_required_variables_and_fragments():
    items = {i["promptCode"]: i for i in _load_script().scan_prompts()}
    contract = items["ally_ai_learn_system_main_agent_prompt"]["contract"]
    assert "role_instructions" in contract["required"]
    assert "language_glossary" in contract["fragments"]
