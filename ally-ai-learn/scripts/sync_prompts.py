#!/usr/bin/env python3
"""
Sync ally-ai-learn prompts to ally-be via POST /prompts/sync.

Scans app/prompts/**/*.txt, derives promptCode from path with ally_ai_learn_
prefix (subdir/filename.txt -> ally_ai_learn_subdir_filename). Name/description
are derived from path; optional overrides from subdir/_meta/<stem>.meta.json
(with "name" and/or "description" keys) are applied when present.

Uses CORE_SERVICE_BASE_URL and CORE_SERVICE_API_KEY.

Run during deployment or manually:
    poetry run python scripts/sync_prompts.py
    poetry run python scripts/sync_prompts.py --dry-run
"""

import argparse
import json
import re
import sys
from pathlib import Path

# Add project root to path (before app imports)
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx  # noqa: E402

from app.core.config import settings  # noqa: E402
from app.core.logger import get_logger  # noqa: E402

logger = get_logger(__name__)

PROMPTS_DIR = Path(__file__).resolve().parent.parent / "app" / "prompts"
SYNC_ENDPOINT = "/api/v1/prompts/sync"
PROMPT_CODE_PREFIX = "ally_ai_learn_"


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

    Auto-parsed placeholders from prompt text arrive as strings; richer meta
    JSON entries arrive as objects. The merge is by ``name`` — when both a
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
                    # meta JSON's labels / required flags.
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


def load_meta(txt_file: Path) -> dict | None:
    """
    Load name, description, category, kind, promptType, hasStates,
    uses_blocks, availableVariables from _meta/<stem>.meta.json.
    """
    meta_path = txt_file.parent / "_meta" / f"{txt_file.stem}.meta.json"
    if not meta_path.exists():
        return None
    try:
        data = json.loads(meta_path.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            return None
        out = {}
        if isinstance(data.get("name"), str) and data["name"].strip():
            out["name"] = data["name"].strip()
        if isinstance(data.get("description"), str) and data["description"].strip():
            out["description"] = data["description"].strip()
        if isinstance(data.get("category"), str) and data["category"].strip():
            out["category"] = data["category"].strip()
        if isinstance(data.get("kind"), str) and data["kind"].strip():
            out["kind"] = data["kind"].strip()
        if isinstance(data.get("promptType"), str) and data["promptType"].strip():
            out["promptType"] = data["promptType"].strip()
        if isinstance(data.get("hasStates"), bool):
            out["hasStates"] = data["hasStates"]
        if isinstance(data.get("uses_blocks"), list):
            out["uses_blocks"] = data["uses_blocks"]
        if isinstance(data.get("availableVariables"), list):
            out["availableVariables"] = data["availableVariables"]
        return out if out else None
    except (json.JSONDecodeError, OSError):
        return None


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

            meta = load_meta(txt_file)
            if meta:
                if meta.get("name") is not None:
                    name = meta["name"]
                if meta.get("description") is not None:
                    description = meta["description"]
            category = (
                meta.get("category")
                if meta and meta.get("category") is not None
                else formatted_category
            )

            content = txt_file.read_text(encoding="utf-8")
            # Resolve usesBlocks to fully-qualified prompt codes. ALWAYS
            # include the field (defaulting to []) so the BE upsert can
            # explicitly clear stale entries when a meta JSON drops a
            # block reference — TypeORM's .update() treats `undefined`
            # as "don't change", so omitting the field would leave old
            # uses_blocks values pinned in the DB forever even after
            # they were removed from the meta JSON.
            uses_blocks_codes: list[str] = []
            if meta and meta.get("uses_blocks"):
                # block name -> ally_ai_learn_subdir_blockname.
                # Note: only handles blocks in same dir as the prompt for now.
                # e.g. system/competency_block.txt ->
                # ally_ai_learn_system_competency_block.
                # prompt: system/full_prompt -> item rel.parent: system.
                subdir_prefix = (
                    str(rel.parent).replace("/", "_") if str(rel.parent) != "." else ""
                )
                for b in meta["uses_blocks"]:
                    if subdir_prefix:
                        uses_blocks_codes.append(
                            f"{PROMPT_CODE_PREFIX}{subdir_prefix}_{b}"
                        )
                    else:
                        uses_blocks_codes.append(f"{PROMPT_CODE_PREFIX}{b}")

            item = {
                "promptCode": prompt_code,
                "name": name,
                "description": description,
                "category": category,
                "prompt": content,
                "availableVariables": merge_available_variables(
                    parse_variables_from_prompt(content),
                    meta.get("availableVariables", []) if meta else [],
                ),
                "usesBlocks": uses_blocks_codes,
            }

            if meta:
                if meta.get("kind"):
                    item["kind"] = meta["kind"]
                if meta.get("promptType"):
                    item["promptType"] = meta["promptType"]
                if "hasStates" in meta:
                    item["hasStates"] = meta["hasStates"]

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
