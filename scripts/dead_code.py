#!/usr/bin/env python3
"""dead-code — find code nothing uses, and stop new dead code from piling up.

Why this exists: dead code is cheap to write and expensive to carry. Every unused function
is one more thing a new engineer (or an agent) reads, assumes matters, and works around.
Static tools can find candidates, but run raw they are noisy: on ally-ai, vulture at its
default setting flags ~530 items, mostly FastAPI routes and Pydantic fields that ARE in use.
So this script does three jobs:

  1. SCAN     run one scanner per repo, tuned to that repo's frameworks, and normalise
              the output into findings. Only code that can be deleted is reported
              (functions, classes, methods, imports, files, exports) -- never variables.
  2. RATCHET  compare against `scripts/dead-code-baseline.json`. Findings in the baseline
              are known debt; a finding NOT in it is new dead code and fails `--check`.
              The baseline only ever shrinks: clean something up, re-baseline, commit.
  3. REPORT   print a markdown report (what's new, what's old, per-repo counts).

    python3 scripts/dead_code.py                     # report, never fails
    python3 scripts/dead_code.py --check             # exit 1 on new findings (PR gate)
    python3 scripts/dead_code.py --update-baseline   # accept the current state
    python3 scripts/dead_code.py --repo ally-ai      # one repo only

A finding is a candidate, not a verdict: dynamic dispatch (getattr, decorators, DI by
string, reflection) hides real use from static tools. When a finding is wrong, don't
delete it -- add it to `ignore` in `scripts/dead-code.config.json` with a `why`.
Finding ids carry no line numbers, so moving code around does not churn the baseline.

Scanners: `vulture` (Python) and `knip` (TypeScript) run today. Flutter and Go are not
wired up yet; see the wiki page for what each needs.
"""

from __future__ import annotations

import argparse
import fnmatch
import json
import re
import shutil
import subprocess
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = ROOT / "scripts" / "dead-code.config.json"
BASELINE_PATH = ROOT / "scripts" / "dead-code-baseline.json"

# vulture lines look like:  app/x.py:12: unused function 'foo' (60% confidence)
VULTURE_RE = re.compile(
    r"^(?P<path>.+?):(?P<line>\d+): unused (?P<kind>\w+) '(?P<name>[^']+)' "
    r"\((?P<conf>\d+)% confidence\)$"
)
# Variables and attributes are noise (Pydantic fields, ORM columns, kwargs), and `unused
# variable` is rarely worth a PR. Everything else is something you can delete.
PY_KINDS = {"function", "class", "method", "import"}


def load_json(path: Path, default):
    return json.loads(path.read_text()) if path.exists() else default


def finding(repo: str, kind: str, path: str, name: str, line: int | None = None) -> dict:
    # No line number in the id: it changes every time someone edits above the symbol.
    return {
        "id": f"{repo}|{kind}|{path}|{name}",
        "repo": repo,
        "kind": kind,
        "path": path,
        "name": name,
        "line": line,
    }


def scan_vulture(repo: str, cfg: dict) -> list[dict]:
    if not shutil.which("vulture"):
        sys.exit("vulture is not installed (pip install 'vulture>=2.14')")
    cmd = [
        "vulture",
        *cfg.get("paths", ["app"]),
        "--min-confidence",
        str(cfg.get("min_confidence", 60)),
        "--ignore-decorators",
        ",".join(cfg.get("ignore_decorators", [])),
    ]
    if cfg.get("ignore_names"):
        cmd += ["--ignore-names", ",".join(cfg["ignore_names"])]
    out = subprocess.run(cmd, cwd=ROOT / repo, capture_output=True, text=True)
    # vulture exits 3 when it finds something; anything else non-zero is a real failure.
    if out.returncode not in (0, 3):
        sys.exit(f"vulture failed in {repo}:\n{out.stderr}")
    found = []
    for raw in out.stdout.splitlines():
        m = VULTURE_RE.match(raw.strip())
        if m and m["kind"] in PY_KINDS:
            found.append(
                finding(repo, m["kind"], f"{repo}/{m['path']}", m["name"], int(m["line"]))
            )
    return found


def scan_knip(repo: str, cfg: dict) -> list[dict]:
    # knip is a pinned devDependency of the repo (never `npx -y`), so the scan runs the
    # exact version the lockfile names. It needs `npm ci` to have run in the repo first.
    cwd = ROOT / repo
    if not (cwd / "node_modules" / ".bin" / "knip").exists():
        sys.exit(f"knip is not installed in {repo}: run `npm ci` there first")
    cmd = ["npx", "--no-install", "knip", "--no-progress", "--reporter", "json"]
    cmd += cfg.get("extra_args", [])
    out = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    # knip exits 1 when it finds issues; real failures print nothing parseable.
    try:
        data = json.loads(out.stdout)
    except json.JSONDecodeError:
        sys.exit(f"knip failed in {repo}:\n{out.stderr or out.stdout}")
    found = []
    for f in data.get("files", []):
        found.append(finding(repo, "file", f"{repo}/{f}", "(whole file)"))
    for issue in data.get("issues", []):
        path = f"{repo}/{issue['file']}"
        for bucket, kind in (("exports", "export"), ("types", "type"), ("classMembers", "method")):
            for item in issue.get(bucket, []):
                found.append(finding(repo, kind, path, item["name"], item.get("line")))
    return found


SCANNERS = {"vulture": scan_vulture, "knip": scan_knip}


def is_ignored(f: dict, rules: list[dict]) -> bool:
    for r in rules:
        if fnmatch.fnmatch(f["path"], r.get("path", "*")) and fnmatch.fnmatch(
            f["name"], r.get("name", "*")
        ):
            return True
    return False


def scan(config: dict, only: str | None) -> list[dict]:
    found: list[dict] = []
    for repo, cfg in config["repos"].items():
        if only and repo != only:
            continue
        found += SCANNERS[cfg["scanner"]](repo, cfg)
    rules = config.get("ignore", [])
    for r in rules:
        if not r.get("why"):
            sys.exit(f"ignore rule {r} has no `why` -- say why the code is really in use")
    return sorted((f for f in found if not is_ignored(f, rules)), key=lambda f: f["id"])


def report(found: list[dict], baseline: set[str], only: str | None) -> tuple[str, list[dict]]:
    new = [f for f in found if f["id"] not in baseline]
    current = {f["id"] for f in found}
    # With --repo only that repo was scanned, so only its baseline entries can be "fixed".
    scoped = {i for i in baseline if not only or i.startswith(only + "|")}
    fixed = scoped - current
    per_repo = Counter(f["repo"] for f in found)
    lines = ["# Dead code report", ""]
    lines += ["| repo | candidates | new since baseline |", "|---|---|---|"]
    new_by_repo = Counter(f["repo"] for f in new)
    for repo in sorted(per_repo):
        lines.append(f"| {repo} | {per_repo[repo]} | {new_by_repo.get(repo, 0)} |")
    lines += ["", f"Cleaned up since the baseline: **{len(fixed)}**", ""]
    if new:
        lines += [
            f"## New dead code ({len(new)})",
            "",
            "Delete it, or if it is really used (dynamic dispatch, reflection), add it to "
            "`ignore` in `scripts/dead-code.config.json` with a `why`.",
            "",
        ]
        for f in new:
            loc = f"{f['path']}:{f['line']}" if f["line"] else f["path"]
            lines.append(f"- `{loc}` — {f['kind']} `{f['name']}`")
    else:
        lines.append("No new dead code.")
    return "\n".join(lines) + "\n", new


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--check", action="store_true", help="exit 1 if there are new findings")
    ap.add_argument("--update-baseline", action="store_true")
    ap.add_argument("--repo", help="scan one repo only")
    args = ap.parse_args()

    config = load_json(CONFIG_PATH, None) or sys.exit(f"missing {CONFIG_PATH}")
    if args.repo and args.repo not in config["repos"]:
        sys.exit(f"unknown repo {args.repo}; known: {', '.join(config['repos'])}")
    found = scan(config, args.repo)

    if args.update_baseline:
        ids = {f["id"] for f in found}
        if args.repo:  # keep the other repos' entries untouched
            ids |= {i for i in load_json(BASELINE_PATH, []) if not i.startswith(args.repo + "|")}
        BASELINE_PATH.write_text(json.dumps(sorted(ids), indent=1) + "\n")
        print(f"baseline written: {len(ids)} known findings")
        return 0

    text, new = report(found, set(load_json(BASELINE_PATH, [])), args.repo)
    print(text)
    # Only repos marked `gate: true` can fail a PR; the rest report only until their
    # scanner has been tuned enough to trust.
    gated = {r for r, c in config["repos"].items() if c.get("gate")}
    return 1 if args.check and any(f["repo"] in gated for f in new) else 0


if __name__ == "__main__":
    sys.exit(main())
