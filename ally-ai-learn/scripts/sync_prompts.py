#!/usr/bin/env python3
"""
Sync ally-ai-learn prompts to ally-be via POST /prompts/sync.

Scans app/prompts/**/*.txt, derives promptCode from path with ally_ai_learn_
prefix (subdir/filename.txt -> ally_ai_learn_subdir_filename). Each prompt's
name, description, category, labelled variables and contract come from its
model in app/prompts/contracts.py; the path fills whatever it leaves out.

Uses CORE_SERVICE_BASE_URL and CORE_SERVICE_API_KEY.

Run during deployment or manually:
    poetry run python scripts/sync_prompts.py
    poetry run python scripts/sync_prompts.py --dry-run
"""

import argparse
import re
import sys
from pathlib import Path

# Add project root to path (before app imports)
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx  # noqa: E402

from app.core.config import settings  # noqa: E402
from app.core.logger import get_logger  # noqa: E402
from app.prompts.contracts import (  # noqa: E402
    PROMPT_CONTRACTS,
    available_variables,
    contract_payload,
)

logger = get_logger(__name__)

PROMPTS_DIR = Path(__file__).resolve().parent.parent / "app" / "prompts"
SYNC_ENDPOINT = "/api/v1/prompts/sync"
PROMPT_CODE_PREFIX = "ally_ai_learn_"
# Every prompt this service syncs is a whole prompt (not a reusable block).
PROMPT_KIND = "prompt"


# Placeholders that the runtime substitutes from non-author-facing
# sources and that we therefore don't want surfaced in the studio's
# "Available Variables" chip list. They're still valid to reference
# inside a custom prompt variant — they just don't fit the
# "one placeholder = one scenario-author input" mental model the chip
# list is built around, and showing them clutters the legitimate
# author-facing fields.
#
# - `custom_fields_text`: rendered concatenation of the scenario's
#   customFields[] array. Authors fill in the individual name/value
#   pairs in the simulator creator, never the rendered string itself.
# - `language_characteristics`: raw per-scenario language-style
#   override. Whenever it's set, it's also what `{language_label}`
#   resolves to (the resolver merges it in). The only behavior it
#   uniquely exposes is "render empty when no override exists" — a
#   niche pattern that doesn't justify a chip alongside `{name}` /
#   `{age}` / etc. Variants that want the empty-when-absent rendering
#   can still reference `{language_characteristics}` directly.
HIDDEN_PLACEHOLDERS = frozenset(
    {
        "custom_fields_text",
        "language_characteristics",
    }
)


def parse_variables_from_prompt(text: str) -> list[str]:
    """
    Extract placeholders from prompt template.
    Supports {var_name} format used by Python str.format().
    Returns sorted unique list of variable names, with placeholders in
    HIDDEN_PLACEHOLDERS filtered out so they don't surface in the
    studio's available-variables chip list.
    """
    pattern = r"\{([a-zA-Z_][a-zA-Z0-9_]*)\}"
    matches = re.findall(pattern, text)
    return sorted(set(matches) - HIDDEN_PLACEHOLDERS)


def merge_available_variables(*variable_lists) -> list:
    """Merge variable lists, accepting either string names or
    ``{name, label?, required?}`` objects.

    Auto-parsed placeholders from prompt text arrive as strings; the contract's
    variables arrive as objects. The merge is by ``name`` — when both a
    string and an object reference the same name, the object's metadata
    (label / required / etc.) is preserved.

    Output is always a list of objects sorted by name so the studio can
    consume a stable schema.
    """
    by_name: dict[str, dict] = {}
    for values in variable_lists:
        if not values:
            continue
        for value in values:
            if isinstance(value, str) and value.strip():
                name = value.strip()
                if name not in by_name:
                    by_name[name] = {"name": name}
            elif isinstance(value, dict):
                raw_name = value.get("name")
                if not isinstance(raw_name, str) or not raw_name.strip():
                    continue
                name = raw_name.strip()
                existing = by_name.get(name, {"name": name})
                for key, val in value.items():
                    if key == "name":
                        continue
                    # First write wins for any metadata key; auto-parsed
                    # strings (which have no metadata) never overwrite the
                    # contract's labels / required flags.
                    existing.setdefault(key, val)
                by_name[name] = existing
    return [by_name[name] for name in sorted(by_name)]


def format_label(text: str) -> str:
    """
    Replace underscores with spaces and capitalize first letter of each word.
    E.g. 'base_role_instruction' -> 'Base Role Instruction'
    """
    if not text:
        return ""
    return " ".join(word.capitalize() for word in text.replace("_", " ").split())


def scan_prompts() -> list[dict]:
    """Scan app/prompts/**/*.txt and build sync payload items."""
    items = []
    if not PROMPTS_DIR.exists():
        logger.warning("Prompts directory not found: %s", PROMPTS_DIR)
        return items

    for txt_file in sorted(PROMPTS_DIR.rglob("*.txt")):
        try:
            rel = txt_file.relative_to(PROMPTS_DIR)
            # subdir/filename.txt -> ally_ai_learn_subdir_filename
            path_part = str(rel.with_suffix("")).replace("/", "_")
            prompt_code = f"{PROMPT_CODE_PREFIX}{path_part}"

            top_level_dir = rel.parts[0] if len(rel.parts) > 1 else ""
            subdir = rel.parent.name if rel.parent and rel.parent != Path(".") else ""
            filename = rel.stem
            formatted_filename = format_label(filename)
            formatted_subdir = format_label(subdir) if subdir else ""
            formatted_category = (
                format_label(top_level_dir) if top_level_dir else "General"
            )

            if formatted_subdir:
                name = f"{formatted_subdir}: {formatted_filename}"
                description = f"{formatted_subdir} prompt — {formatted_filename}"
            else:
                name = formatted_filename
                description = formatted_filename

            model = PROMPT_CONTRACTS.get(prompt_code)
            info = model.prompt if model else None
            if info and info.name:
                name = info.name
            if info and info.description:
                description = info.description
            category = info.category if info and info.category else formatted_category

            content = txt_file.read_text(encoding="utf-8")
            item = {
                "promptCode": prompt_code,
                "name": name,
                "description": description,
                "category": category,
                "prompt": content,
                # Placeholders in the text, plus the contract's variables with
                # their labels and required flags (the contract wins on a name).
                "availableVariables": merge_available_variables(
                    available_variables(prompt_code),
                    parse_variables_from_prompt(content),
                ),
                # Always sent, so the store clears a stale value: TypeORM's
                # update() treats `undefined` as "don't change".
                "usesBlocks": [],
                "kind": PROMPT_KIND,
                # The typed contract: the Skills Store refuses a version that
                # drops a required variable.
                "contract": contract_payload(prompt_code),
            }
            if info and info.prompt_type:
                item["promptType"] = info.prompt_type
            if info and info.has_states is not None:
                item["hasStates"] = info.has_states

            items.append(item)
        except Exception as e:
            logger.error("Failed to read %s: %s", txt_file, e)

    return items


def sync_prompts(dry_run: bool = False) -> dict:
    """
    Sync prompts to ally-be. Returns {added, updated} or empty on error.
    """
    base_url = settings.CORE_SERVICE_BASE_URL.rstrip("/")
    api_key = (
        getattr(settings, "PROMPT_SERVICE_API_KEY", None)
        or getattr(settings, "CORE_SERVICE_API_KEY", None)
        or getattr(settings, "X_API_KEY", None)
    )
    if not api_key:
        logger.error(
            "PROMPT_SERVICE_API_KEY, CORE_SERVICE_API_KEY, or X_API_KEY not set"
        )
        return {}

    items = scan_prompts()
    if not items:
        logger.warning("No prompts found to sync")
        return {"added": 0, "updated": 0}

    logger.info("Syncing %d prompts to %s%s", len(items), base_url, SYNC_ENDPOINT)

    if dry_run:
        for it in items:
            logger.info("  [dry-run] %s -> %s", it["promptCode"], it["name"])
        return {"added": len(items), "updated": 0}

    url = f"{base_url}{SYNC_ENDPOINT}"
    try:
        resp = httpx.post(
            url,
            json={"prompts": items},
            headers={"x-api-key": api_key, "Content-Type": "application/json"},
            timeout=60.0,
        )
        resp.raise_for_status()
        data = resp.json()
        logger.info(
            "Sync result: %d added, %d updated",
            data.get("added", 0),
            data.get("updated", 0),
        )
        return data
    except httpx.HTTPStatusError as e:
        logger.error("Sync failed: %s %s", e.response.status_code, e.response.text)
        return {}
    except Exception as e:
        logger.exception("Sync failed: %s", e)
        return {}


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Sync ally-ai-learn prompts to ally-be"
    )
    parser.add_argument("--dry-run", action="store_true", help="Log only, do not POST")
    args = parser.parse_args()
    result = sync_prompts(dry_run=args.dry_run)
    return 0 if result else 1


if __name__ == "__main__":
    sys.exit(main())
