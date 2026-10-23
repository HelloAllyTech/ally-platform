#!/usr/bin/env python3
"""Count the things prose keeps getting wrong, and write wiki/platform/stats.md.

"43 modules", "211+ migrations", "105 tables" — every one of those was true once. Numbers
typed into prose are stale the week after they're written, and they're the single most
common wrong fact an agent reads. So: prose states invariants, this file states counts.

Run with the code repos checked out somewhere reachable:

    python3 scripts/gen-stats.py --repos /path/to/checkouts

Repos that aren't present are reported as unavailable rather than silently omitted — a
missing row must not read as a zero.
"""

from __future__ import annotations

import argparse
import re
from datetime import date
from pathlib import Path

# (label, repo, how to count it). Each counter takes the repo root and returns an int.
COUNTERS: list[tuple[str, str, str]] = [
    ("PostgreSQL entities", "ally-be", "entities"),
    ("TypeORM migrations", "ally-be", "migrations"),
    ("Feature modules", "ally-be", "modules"),
    ("WebSocket gateways", "ally-be", "gateways"),
    ("Weaviate collections", "ally-ai", "collections"),
    ("Weaviate migrations", "ally-ai", "ai_migrations"),
    ("API endpoint modules", "ally-ai", "endpoints"),
    ("Event types", "ally-ai-learn", "event_types"),
    ("TTS / STT / LLM providers", "ally-ai-learn", "providers"),
    ("Numbered developer guides", "ally-ai-learn", "guides"),
    ("Applications", "ally-web", "apps"),
    ("Shared libraries", "ally-web", "libs"),
]


def count(root: Path, kind: str) -> int:
    if kind == "entities":
        return len(list(root.glob("src/**/entity/*.entity.ts")))
    if kind == "migrations":
        return len(list((root / "src/database/migrations").glob("*.ts")))
    if kind == "modules":
        return len(list(root.glob("src/*/*.module.ts")))
    if kind == "gateways":
        return len(list(root.glob("src/**/*.gateway.ts")))
    if kind == "collections":
        target = root / "app/core/vector_db/constants.py"
        if not target.exists():
            return 0
        text = target.read_text(encoding="utf-8")
        return len(set(re.findall(r"^\s*([A-Z][A-Z0-9_]{2,})\s*=\s*[\"']", text, re.MULTILINE)))
    if kind == "ai_migrations":
        return len([p for p in (root / "app/migrations").glob("*.py") if p.stem[:3].isdigit()])
    if kind == "endpoints":
        return len(list((root / "app/api/v1/endpoints").glob("*.py"))) - len(
            list((root / "app/api/v1/endpoints").glob("__init__.py"))
        )
    if kind == "event_types":
        # Each event type is a package directory, not a module file.
        d = root / "app/core/events/event_types"
        return len([p for p in d.iterdir() if p.is_dir() and not p.name.startswith("_")]) if d.exists() else 0
    if kind == "providers":
        total = 0
        for family in ("tts", "stt", "llms"):
            d = root / "app" / family
            if d.exists():
                total += len(
                    [p for p in d.glob("*.py") if p.name not in ("__init__.py", "factory.py", "base.py")]
                )
        return total
    if kind == "guides":
        return len(list((root / "docs").glob("[0-9][0-9]-*.md")))
    if kind == "apps":
        d = root / "apps"
        return len([p for p in d.iterdir() if p.is_dir()]) if d.exists() else 0
    if kind == "libs":
        d = root / "libs"
        return len([p for p in d.iterdir() if p.is_dir()]) if d.exists() else 0
    raise ValueError(f"unknown counter: {kind}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--repos", default="..", help="directory containing the repo checkouts")
    ap.add_argument("--out", default="wiki/platform/stats.md")
    args = ap.parse_args()

    base = Path(args.repos).resolve()
    repo_root = Path(__file__).resolve().parent.parent

    rows: list[str] = []
    unavailable: set[str] = set()
    for label, repo, kind in COUNTERS:
        root = base / repo
        if not root.is_dir():
            unavailable.add(repo)
            rows.append(f"| {label} | `{repo}` | _not checked out_ |")
            continue
        try:
            rows.append(f"| {label} | `{repo}` | {count(root, kind):,} |")
        except Exception as exc:  # a broken counter must not silently read as zero
            rows.append(f"| {label} | `{repo}` | _counter failed: {exc}_ |")

    body = f"""---
title: Platform Stats
tags: [platform, reference, generated]
summary: Generated counts of the things prose keeps getting wrong — entities, migrations, modules, providers. Regenerated weekly; never hand-edited.
last_reconciled: {date.today().isoformat()}
---

# Platform Stats

**Generated — do not edit.** Produced by `scripts/gen-stats.py` and refreshed by the
weekly health sweep.

Numbers typed into prose go stale the week after they're written, and a wrong count is
the most common wrong fact an agent reads. Prose states invariants; this page states
counts. If you catch yourself typing a number a script could count, link here instead.

| What | Repo | Count |
|---|---|---|
{chr(10).join(rows)}

_Counted on {date.today().isoformat()}._
"""

    if unavailable:
        body += (
            "\n> Some repos were not checked out when this ran, so their rows read "
            "_not checked out_ rather than zero: "
            + ", ".join(f"`{r}`" for r in sorted(unavailable))
            + ".\n"
        )

    out = repo_root / args.out
    out.write_text(body, encoding="utf-8")
    print(f"wrote {args.out}")
    for row in rows:
        print("  " + row)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
