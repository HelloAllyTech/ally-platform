#!/usr/bin/env python3
"""concepts-lint — keep wiki/platform/concepts.md in step with the code it maps.

Why this exists: the Core Concepts page is the vocabulary an agent session reads before it
touches an unfamiliar area. A map that silently misses a subsystem is worse than no map —
the reader trusts it and concludes the thing does not exist. Prose cannot notice that a new
module appeared, so this script does, on every PR (the `concepts` job in docs.yml).

It fails when:

  1. unclaimed   — a module/feature directory exists that no concept card's `**Code:**`
                   line and no `## Plumbing` bullet names (a new subsystem nobody mapped).
  2. missing     — a path a card or plumbing bullet names no longer exists (a rename or a
                   removal the page did not follow).
  3. toggles     — a `FeatureToggleKey` member is not mentioned on any card as
                   `FeatureToggleKey.NAME` (a gate nobody can trace to a concept).
  4. malformed   — a card lacks its `<!-- concept: slug -->` marker or a required field, a
                   slug repeats, or `**Status:**` does not start with a known status.

A directory counts as claimed only when a card (or a plumbing bullet) names the directory
itself; citing a file inside it does not. Only tracked files count, so build output and
caches never create work.

    python3 scripts/concepts_lint.py              # exit 1 on any finding
    python3 scripts/concepts_lint.py --unclaimed  # just print unclaimed dirs, one per line

No dependencies beyond the standard library and `git`.
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
PAGE = "helloallytech.github.io/wiki/platform/concepts.md"

# Directories whose immediate children are each a module, package, page or feature.
# Adding a root here widens what the page must cover; keep it to places where one child
# directory ≈ one subsystem.
ROOTS = (
    "ally-be/src",
    "ally-ai/app/core",
    "ally-ai-learn/app/core",
    "ally-web/apps/ally-admin-dashboard/src/pages",
    "ally-web/apps/ally-helpline-dashboard/src/pages",
    "ally-mobile/lib/features",
)
SKIP_CHILD = re.compile(r"^(__.*|\..*|node_modules)$")

TOGGLES_FILE = "ally-be/src/authorization/constants/admin-feature-toggle.constants.ts"
STATUSES = ("Live", "Dark", "Partial", "Deprecated", "Removed")
REQUIRED_FIELDS = ("**Is:**", "**Composed of:**", "**Status:**", "**Code:**")

BACKTICK = re.compile(r"`([^`\s]+)`")
CARD_HEAD = re.compile(r"^### (.+)$")
SLUG = re.compile(r"<!--\s*concept:\s*([a-z0-9-]+)\s*-->")
SECTION = re.compile(r"^## (.+)$")


def tracked_files() -> list[str]:
    out = subprocess.run(
        ["git", "ls-files", "-z", "--", *ROOTS, TOGGLES_FILE],
        cwd=REPO, check=True, capture_output=True, text=True,
    ).stdout
    return [p for p in out.split("\0") if p]


def inventory(files: list[str]) -> set[str]:
    dirs: set[str] = set()
    for f in files:
        for root in ROOTS:
            prefix = root + "/"
            if f.startswith(prefix):
                rest = f[len(prefix):]
                if "/" in rest:  # a file inside a child directory, not a loose file
                    child = rest.split("/", 1)[0]
                    if not SKIP_CHILD.match(child):
                        dirs.add(prefix + child)
    return dirs


def toggle_keys() -> list[str]:
    text = (REPO / TOGGLES_FILE).read_text()
    m = re.search(r"export enum FeatureToggleKey \{(.*?)^\}", text, re.S | re.M)
    if not m:
        sys.exit(f"concepts-lint: could not find `enum FeatureToggleKey` in {TOGGLES_FILE}")
    return re.findall(r"^\s*([A-Z][A-Z0-9_]*)\s*=", m.group(1), re.M)


def parse_page(text: str):
    """Return (cards, plumbing_paths). A card = dict(name, line, slug, fields, paths)."""
    cards: list[dict] = []
    plumbing: list[tuple[str, int]] = []
    section = ""
    card = None
    in_fence = False
    for n, line in enumerate(text.splitlines(), 1):
        if line.startswith("```"):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        if m := SECTION.match(line):
            section = m.group(1).strip().lower()
            card = None
            continue
        if m := CARD_HEAD.match(line):
            card = {"name": m.group(1).strip(), "line": n, "slug": None,
                    "fields": set(), "paths": [], "status": None}
            cards.append(card)
            continue
        if section.startswith("plumbing") and line.lstrip().startswith("- "):
            plumbing += [(p, n) for p in BACKTICK.findall(line.split("—")[0])]
            continue
        if card is None:
            continue
        if m := SLUG.search(line):
            card["slug"] = m.group(1)
        for field in REQUIRED_FIELDS:
            if line.startswith(field):
                card["fields"].add(field)
        if line.startswith("**Status:**"):
            card["status"] = line[len("**Status:**"):].strip()
        if line.startswith("**Code:**"):
            card["paths"] += [(p, n) for p in BACKTICK.findall(line)]
    return cards, plumbing


def norm(p: str) -> str:
    return p.rstrip("/")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--unclaimed", action="store_true", help="print unclaimed dirs only")
    args = ap.parse_args()

    page_path = REPO / PAGE
    if not page_path.exists():
        print(f"concepts-lint: {PAGE} is missing")
        return 1
    page = page_path.read_text()
    cards, plumbing = parse_page(page)

    files = tracked_files()
    dirs = inventory(files)
    claims = [(norm(p), n) for c in cards for p, n in c["paths"]] + [
        (norm(p), n) for p, n in plumbing
    ]
    claimed = {p for p, _ in claims}

    # Only naming the directory itself claims it. A card citing one file inside a module
    # (a controller another concept borrows) says nothing about what the module is.
    def is_claimed(d: str) -> bool:
        return d in claimed

    unclaimed = sorted(d for d in dirs if not is_claimed(d))
    if args.unclaimed:
        print("\n".join(unclaimed))
        return 0

    problems: list[str] = []
    for d in unclaimed:
        problems.append(
            f"unclaimed: `{d}/` — add it to the **Code:** line of the concept it belongs to, "
            f"give it a new card, or list it under `## Plumbing` with a reason"
        )

    for p, n in claims:
        if not (REPO / p).exists():
            problems.append(f"missing: `{p}` (line {n}) no longer exists — follow the rename, "
                            f"or drop it if the code was removed")

    mentioned = set(re.findall(r"FeatureToggleKey\.([A-Z][A-Z0-9_]*)", page))
    for key in toggle_keys():
        if key not in mentioned:
            problems.append(f"toggles: `FeatureToggleKey.{key}` is on no card — name it on "
                            f"the **Status:** line of the concept it gates")
    for key in sorted(mentioned - set(toggle_keys())):
        problems.append(f"toggles: `FeatureToggleKey.{key}` is on the page but not in "
                        f"{TOGGLES_FILE} — it was renamed or removed")

    seen: dict[str, int] = {}
    for c in cards:
        where = f"### {c['name']} (line {c['line']})"
        if not c["slug"]:
            problems.append(f"malformed: {where} has no `<!-- concept: slug -->` marker")
        elif c["slug"] in seen:
            problems.append(f"malformed: {where} repeats slug `{c['slug']}` "
                            f"(first at line {seen[c['slug']]})")
        else:
            seen[c["slug"]] = c["line"]
        for f in REQUIRED_FIELDS:
            if f not in c["fields"]:
                problems.append(f"malformed: {where} is missing {f}")
        if c["status"] is not None and not c["status"].startswith(STATUSES):
            problems.append(f"malformed: {where} status must start with one of "
                            f"{', '.join(STATUSES)}")

    if problems:
        print(f"concepts-lint: {len(problems)} problem(s) in {PAGE}\n")
        print("\n".join(f"  - {p}" for p in problems))
        print("\nThe page is the agent-facing map of Ally's concepts; see its "
              "'Keeping this page current' section.")
        return 1
    print(f"concepts-lint: ok — {len(cards)} cards, {len(dirs)} directories, "
          f"{len(toggle_keys())} toggles covered")
    return 0


if __name__ == "__main__":
    sys.exit(main())
