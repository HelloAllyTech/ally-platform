"""scripts/sync_prompts.py sends each prompt's typed contract to the store."""

import importlib.util
from pathlib import Path

from app.prompts.contracts import contract_payload

SERVICE_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = SERVICE_ROOT / "scripts" / "sync_prompts.py"


def test_every_synced_prompt_carries_its_in_code_contract(monkeypatch):
    monkeypatch.chdir(SERVICE_ROOT)  # the script scans app/prompts relative to cwd
    spec = importlib.util.spec_from_file_location("sync_prompts", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    items = module.scan_prompts()
    assert items
    for item in items:
        assert item["contract"] == contract_payload(item["promptCode"])
        # Retired: a sidecar no longer decides whether the store's text runs.
        assert "useDashboardOverride" not in item
