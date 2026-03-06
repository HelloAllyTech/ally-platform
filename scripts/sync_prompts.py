#!/usr/bin/env python3
"""
Sync ally-ai-learn prompts to ally-be via POST /prompts/sync.

Scans app/prompts/**/*.txt, derives promptCode from path with ally_ai_learn_
prefix (subdir/filename.txt -> ally_ai_learn_subdir_filename). Uses
CORE_SERVICE_BASE_URL and CORE_SERVICE_API_KEY.

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

logger = get_logger(__name__)

PROMPTS_DIR = Path(__file__).resolve().parent.parent / "app" / "prompts"
SYNC_ENDPOINT = "/api/v1/prompts/sync"
PROMPT_CODE_PREFIX = "ally_ai_learn_"


def parse_variables_from_prompt(text: str) -> list[str]:
    """
    Extract placeholders from prompt template.
    Supports {var_name} format used by Python str.format().
    Returns sorted unique list of variable names.
    """
    pattern = r"\{([a-zA-Z_][a-zA-Z0-9_]*)\}"
    matches = re.findall(pattern, text)
    return sorted(set(matches))


def format_label(text: str) -> str:
    """
    Replace underscores with spaces and capitalize first letter of each word.
    E.g. 'default_system_prompt' -> 'Default System Prompt'
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

            subdir = rel.parent.name if rel.parent and rel.parent != Path(".") else ""
            filename = rel.stem
            formatted_filename = format_label(filename)
            formatted_subdir = format_label(subdir) if subdir else ""

            if formatted_subdir:
                name = f"{formatted_subdir}: {formatted_filename}"
                description = f"{formatted_subdir} prompt — {formatted_filename}"
            else:
                name = formatted_filename
                description = formatted_filename

            content = txt_file.read_text(encoding="utf-8")
            items.append(
                {
                    "promptCode": prompt_code,
                    "name": name,
                    "description": description,
                    "prompt": content,
                    "availableVariables": parse_variables_from_prompt(content),
                }
            )
        except Exception as e:
            logger.error("Failed to read %s: %s", txt_file, e)

    return items


def sync_prompts(dry_run: bool = False) -> dict:
    """
    Sync prompts to ally-be. Returns {added, updated} or empty on error.
    """
    base_url = settings.CORE_SERVICE_BASE_URL.rstrip("/")
    api_key = getattr(settings, "CORE_SERVICE_API_KEY", None) or getattr(
        settings, "X_API_KEY", None
    )
    if not api_key:
        logger.error("CORE_SERVICE_API_KEY or X_API_KEY not set")
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
