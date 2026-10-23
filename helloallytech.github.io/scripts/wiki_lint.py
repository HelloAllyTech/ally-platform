#!/usr/bin/env python3
"""Health check for the wiki: staleness, orphans, broken links, and facts that rot.

The docs guard only fires when someone touches watched code. Pages that describe the
platform in general have no such trigger and drift silently — which is exactly how
tech-stack.md, dev-setup.md and repos/infra.md went a month without a change while three
code repos committed daily. This is the sweep that catches that class.

Implements the lint flow described in agents.md §3, deterministically:

  1. frontmatter    — required keys present
  2. staleness      — last_reconciled older than the threshold
  3. orphans        — pages with no inbound link and no index entry
  4. links          — relative links that point at nothing
  5. rotting facts  — counts hard-coded in prose that a script should own
  6. generated      — ROUTING.md / manifest.json out of date

Usage:
    python3 scripts/wiki_lint.py [--stale-days 90] [--format md|text] [--fail]
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
WIKI = REPO / "wiki"

REQUIRED_KEYS = ("title", "tags", "summary")
GENERATED = {"ROUTING.md", "manifest.json"}
# Machinery and archives — exempt from the orphan and frontmatter rules.
EXEMPT = {"index.md", "log.md", "context.md", "memory.md", "ROUTING.md"}

LINK = re.compile(r"\[[^\]]*\]\(([^)\s]+?)(?:\s+\"[^\"]*\")?\)")
# Single digits count too — "9 event types" was wrong by one and nobody noticed.
ROTTING = re.compile(
    r"\b\d{1,5}\+?\s+(?:modules?|migrations?|tables?|entities|endpoints?|hooks?|"
    r"collections?|event types?|providers?|numbered guides?|API files?)\b",
    re.IGNORECASE,
)
FENCE = re.compile(r"```.*?```", re.DOTALL)


@dataclass
class Findings:
    missing_frontmatter: list[str] = field(default_factory=list)
    stale: list[str] = field(default_factory=list)
    undated: list[str] = field(default_factory=list)
    orphans: list[str] = field(default_factory=list)
    broken_links: list[str] = field(default_factory=list)
    rotting: list[str] = field(default_factory=list)
    generated_stale: list[str] = field(default_factory=list)

    def total(self) -> int:
        return sum(len(getattr(self, f.name)) for f in self.__dataclass_fields__.values())


def parse_frontmatter(text: str) -> tuple[dict, str]:
    if not text.startswith("---"):
        return {}, text
    end = text.find("\n---", 3)
    if end == -1:
        return {}, text
    meta = {}
    for line in text[3:end].splitlines():
        line = line.strip()
        if not line or ":" not in line:
            continue
        k, _, v = line.partition(":")
        meta[k.strip()] = v.strip().strip('"').strip("'")
    return meta, text[end + 4 :]


def run(argv: list[str]) -> tuple[int, str]:
    p = subprocess.run(argv, capture_output=True, text=True, cwd=REPO)
    return p.returncode, (p.stdout + p.stderr).strip()


def lint(stale_days: int) -> Findings:
    f = Findings()
    pages: dict[str, tuple[dict, str]] = {}

    for path in sorted(WIKI.rglob("*.md")):
        rel = path.relative_to(WIKI).as_posix()
        if rel in GENERATED:
            continue
        pages[rel] = parse_frontmatter(path.read_text(encoding="utf-8"))

    inbound: dict[str, int] = {rel: 0 for rel in pages}
    index_text = (WIKI / "index.md").read_text(encoding="utf-8") if (WIKI / "index.md").exists() else ""

    for rel, (meta, body) in pages.items():
        page_dir = (WIKI / rel).parent

        # Skills follow the SKILL.md schema (name/description); reference material inside
        # a skill folder has no frontmatter contract at all.
        is_skill = rel.startswith("skills/")

        if rel not in EXEMPT and not is_skill:
            missing = [k for k in REQUIRED_KEYS if not meta.get(k)]
            if missing:
                f.missing_frontmatter.append(f"`{rel}` — missing {', '.join(missing)}")

            stamped = meta.get("last_reconciled")
            if not stamped:
                f.undated.append(f"`{rel}`")
            else:
                try:
                    age = (date.today() - datetime.strptime(stamped, "%Y-%m-%d").date()).days
                    if age > stale_days:
                        f.stale.append(f"`{rel}` — {age} days since last reconciled")
                except ValueError:
                    f.missing_frontmatter.append(
                        f"`{rel}` — last_reconciled `{stamped}` is not YYYY-MM-DD"
                    )

        # Archives record what was true at the time; a count there is history, not rot.
        # Blockquotes are where pages quote a bad example on purpose.
        if rel not in EXEMPT:
            prose = "\n".join(
                line for line in FENCE.sub("", body).splitlines()
                if not line.lstrip().startswith(">")
            )
            for hit in ROTTING.findall(prose):
                f.rotting.append(f"`{rel}` — \"{hit.strip()}\"")

        for target in LINK.findall(body):
            if target.startswith(("http://", "https://", "mailto:", "#")):
                continue
            clean = target.split("#", 1)[0]
            if not clean:
                continue
            resolved = (page_dir / clean).resolve()
            try:
                key = resolved.relative_to(WIKI).as_posix()
            except ValueError:
                if not resolved.exists():
                    f.broken_links.append(f"`{rel}` → `{target}`")
                continue
            if key in inbound:
                inbound[key] += 1
            elif not resolved.exists():
                f.broken_links.append(f"`{rel}` → `{target}`")

    for rel in pages:
        # A skill folder's internal files are reached through the skill, not the catalog.
        if rel in EXEMPT or rel.startswith("skills/"):
            continue
        if inbound[rel] == 0 and rel not in index_text:
            f.orphans.append(f"`{rel}`")

    code, out = run([sys.executable, "scripts/gen-routing.py", "--check"])
    if code != 0:
        f.generated_stale.append(out.splitlines()[0] if out else "generated index is stale")

    return f


SECTIONS = [
    ("generated_stale", "Generated files out of date", "Run `python3 scripts/gen-routing.py` and commit."),
    ("broken_links", "Broken relative links", "These point at files that do not exist."),
    ("stale", "Pages past their reconcile-by date", "Verify against the code, then bump `last_reconciled`."),
    ("missing_frontmatter", "Frontmatter problems", "`ROUTING.md` is generated from these keys — a page without them is invisible to agents."),
    ("undated", "Pages with no `last_reconciled`", "Add the key so the sweep can track them."),
    ("orphans", "Orphan pages", "No inbound links and not in `index.md` — nobody will find these."),
    ("rotting", "Counts hard-coded in prose", "These go stale by construction. Move them to generated stats or drop them."),
]


def render(f: Findings, fmt: str, stale_days: int) -> str:
    if f.total() == 0:
        return "✅ Wiki lint clean — no findings."

    lines = [
        "## Wiki health sweep",
        "",
        f"{f.total()} finding(s). Staleness threshold: {stale_days} days.",
        "",
    ]
    for attr, title, hint in SECTIONS:
        items = getattr(f, attr)
        if not items:
            continue
        lines += [f"### {title} ({len(items)})", "", f"_{hint}_", ""]
        lines += [f"- {i}" for i in items]
        lines.append("")

    text = "\n".join(lines)
    if fmt == "text":
        text = re.sub(r"[`*#_]", "", text)
    return text


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--stale-days", type=int, default=90)
    ap.add_argument("--format", choices=["md", "text"], default="md")
    ap.add_argument("--fail", action="store_true", help="exit 1 if anything was found")
    args = ap.parse_args()

    f = lint(args.stale_days)
    print(render(f, args.format, args.stale_days))
    return 1 if (args.fail and f.total()) else 0


if __name__ == "__main__":
    raise SystemExit(main())
