#!/usr/bin/env python3
"""Generate wiki/manifest.json and wiki/ROUTING.md from page frontmatter.

ROUTING.md is the token-budgeted index shipped into every code repo, so an agent can
pick the right page *before* spending a fetch. manifest.json is the structured form for
tooling (the reconciler, the freshness check).

Both are generated. Never hand-edit them; edit the page frontmatter instead.

Usage:
    python3 scripts/gen-routing.py [--check]

    --check  exit 1 if the committed output is stale (for CI)
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
WIKI = REPO / "wiki"
SITE = "https://tech.helloally.ai/#/wiki"

# Pages that are machinery or archives rather than things to read for a task.
# Listed so the router can say "don't load this" instead of staying silent.
NOT_FOR_TASKS = {
    "log.md": "append-only history — read only when auditing what changed",
    "context.md": "session handoff state — not task context",
    "index.md": "human navigation catalog — ROUTING.md supersedes it for agents",
    "ROUTING.md": "this file",
}

SECTIONS = [
    ("Product practice — DEPRECATED 2026-08-07, superseded by the Stacks MCP; history only", ("product/",)),
    ("Platform & architecture", ("platform/",)),
    ("Per-repo pages", ("repos/",)),
    ("Contributing & setup", ("contributing/",)),
    ("Agent memory", ("memory.md",)),
    ("Skills", ("skills/",)),
    ("Start here", ("welcome.md", "getting-started.md", "overview.md")),
]

SUMMARY_WORD_CAP = 15


def parse_frontmatter(text: str) -> tuple[dict, str]:
    """Minimal YAML-frontmatter reader. No dependency; the schema is flat by convention."""
    if not text.startswith("---"):
        return {}, text
    end = text.find("\n---", 3)
    if end == -1:
        return {}, text
    raw, body = text[3:end], text[end + 4 :]
    meta: dict[str, object] = {}
    for line in raw.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or ":" not in line:
            continue
        key, _, value = line.partition(":")
        value = value.strip()
        if value.startswith("[") and value.endswith("]"):
            meta[key.strip()] = [v.strip() for v in value[1:-1].split(",") if v.strip()]
        else:
            meta[key.strip()] = value.strip('"').strip("'")
    return meta, body


def first_heading(body: str) -> str:
    m = re.search(r"^#\s+(.+)$", body, re.MULTILINE)
    return m.group(1).strip() if m else ""


# A deprecation notice belongs on the section header once, not on every line under it.
# Stripping it here buys back the words for what the page actually says.
DEPRECATION_PREFIX = re.compile(
    r"^DEPRECATED[^—]*—\s*kept for history\.\s*", re.IGNORECASE
)


def clip(summary: str, cap: int = SUMMARY_WORD_CAP) -> str:
    summary = DEPRECATION_PREFIX.sub("", summary)
    words = summary.split()
    if len(words) <= cap:
        return summary.rstrip(".")
    return " ".join(words[:cap]).rstrip(",;.") + "…"


def collect() -> list[dict]:
    pages = []
    for path in sorted(WIKI.rglob("*.md")):
        rel = path.relative_to(WIKI).as_posix()
        if rel == "ROUTING.md":
            continue
        text = path.read_text(encoding="utf-8")
        meta, body = parse_frontmatter(text)
        # Skill manifests use the SKILL.md schema (name/description), not the wiki
        # page schema — read whichever this file actually has.
        pages.append(
            {
                "path": rel,
                "title": meta.get("title") or meta.get("name") or first_heading(body) or rel,
                "summary": meta.get("summary") or meta.get("description", ""),
                "tags": meta.get("tags", []),
                "last_reconciled": meta.get("last_reconciled", ""),
                "words": len(body.split()),
                "url": f"{SITE}/{rel}",
                "skip_reason": NOT_FOR_TASKS.get(rel, ""),
            }
        )
    return pages


def section_for(rel: str) -> str:
    for name, prefixes in SECTIONS:
        if any(rel == p or rel.startswith(p) for p in prefixes):
            return name
    return "Other"


def render_routing(pages: list[dict]) -> str:
    by_section: dict[str, list[dict]] = {}
    for p in pages:
        if p["skip_reason"]:
            continue
        by_section.setdefault(section_for(p["path"]), []).append(p)

    out = [
        "# Wiki routing index",
        "",
        "**Generated — do not edit.** Produced by `scripts/gen-routing.py` in the",
        "[wiki repo](https://github.com/helloallytech/helloallytech.github.io) from each page's",
        "frontmatter, and copied into every code repo.",
        "",
        "One line per page, so you can pick the right one *before* spending a fetch. Read the",
        "page, not the section. Word counts distinguish a rule set from a reference.",
        "",
        f"Fetch as `{SITE}/<path>`, or raw Markdown at `https://tech.helloally.ai/wiki/<path>`.",
        "",
    ]

    ordered = [name for name, _ in SECTIONS if name in by_section]
    ordered += [s for s in by_section if s not in ordered]

    for section in ordered:
        out.append(f"## {section}")
        out.append("")
        for p in sorted(by_section[section], key=lambda x: x["path"]):
            summary = clip(p["summary"]) if p["summary"] else "_no summary in frontmatter_"
            out.append(f"- `{p['path']}` ({p['words']}w) — {summary}")
        out.append("")

    skipped = [p for p in pages if p["skip_reason"]]
    if skipped:
        out.append("## Don't load these for a task")
        out.append("")
        for p in sorted(skipped, key=lambda x: x["path"]):
            out.append(f"- `{p['path']}` — {p['skip_reason']}")
        out.append("")

    total = sum(p["words"] for p in pages)
    out.append(
        f"_{len(pages)} pages, {total:,} words total. Loading all of it would cost roughly "
        f"{total * 4 // 3:,} tokens — which is the entire reason this index exists._"
    )
    out.append("")
    return "\n".join(out)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="fail if committed output is stale")
    args = ap.parse_args()

    pages = collect()
    manifest = json.dumps(
        {"site": SITE, "pages": pages}, indent=2, ensure_ascii=False
    ) + "\n"
    routing = render_routing(pages)

    targets = {WIKI / "manifest.json": manifest, WIKI / "ROUTING.md": routing}

    if args.check:
        stale = [
            p.relative_to(REPO).as_posix()
            for p, want in targets.items()
            if not p.exists() or p.read_text(encoding="utf-8") != want
        ]
        if stale:
            print("Stale generated files: " + ", ".join(stale), file=sys.stderr)
            print("Run: python3 scripts/gen-routing.py", file=sys.stderr)
            return 1
        print(f"Routing index up to date ({len(pages)} pages).")
        return 0

    for path, content in targets.items():
        path.write_text(content, encoding="utf-8")
        print(f"wrote {path.relative_to(REPO)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
