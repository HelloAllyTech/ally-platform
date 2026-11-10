"""Risk rules (spec §9): risk paths, the crisis/safety keyword check on changed code,
and the risk level shown to the approver. Pure functions; no model."""

from __future__ import annotations

import re
from typing import Iterable, Literal

from bug_hunter.safety.paths import PathPolicy

RiskLevel = Literal["low", "medium", "high", "human_only"]

# Human-only regardless of path on a mental-health platform (spec §9).
SAFETY_KEYWORDS = (
    "crisis",
    "self_harm",
    "self-harm",
    "selfharm",
    "suicid",
    "guardrail",
    "emergency",
)
_KEYWORD_RE = re.compile("|".join(re.escape(k) for k in SAFETY_KEYWORDS), re.IGNORECASE)


def keyword_hits(changed_lines: Iterable[str]) -> list[str]:
    """Added or removed diff lines that mention a safety keyword."""
    hits = []
    for line in changed_lines:
        if (
            line[:1] in "+-"
            and not line.startswith(("+++", "---"))
            and _KEYWORD_RE.search(line)
        ):
            hits.append(line.strip()[:120])
    return hits


def risk_hits(
    policy: PathPolicy, app: str, files: Iterable[str], diff: str
) -> list[str]:
    """Why a change is human-only: risk-path files and safety keywords in the diff."""
    reasons = list(policy.touches_risk(list(files), app))
    reasons += [f"safety keyword: {h}" for h in keyword_hits(diff.splitlines())]
    return reasons


def risk_level(
    *,
    human_only_reasons: list[str],
    lines_changed: int,
    files_changed: int,
    severity: str,
    review_verdict: str | None,
) -> RiskLevel:
    if human_only_reasons:
        return "human_only"
    score = 0
    if lines_changed > 40 or files_changed > 3:
        score += 1
    if severity in ("critical", "high"):
        score += 1
    if review_verdict != "approve":
        score += 1
    return ("low", "medium", "high")[min(score, 2)]


# (a) Human-only by topic, whatever the paths: a finding about tenancy, data exposure,
# authentication or permissions. Checked on the finding's own words (title, hypothesis,
# root cause), not on quoted evidence, which is code.
_TOPIC_RE = re.compile(
    r"\b(?:tenant|tenants|tenancy|cross-tenant|multi-tenant)\b"
    r"|\bauth\b|authenticat|authoriz|\bpermission|\bprivilege|\baccess control"
    r"|\broles?\b|\bimpersonat|\bsuper ?admin|\bplatform admin"
    r"|data exposure|\bexpos(?:e|es|ed|ing) (?:data|users?|accounts?|records?)"
    r"|\bleak(?:s|ed|ing)? (?:data|users?|accounts?|records?)|\bPII\b|\bPHI\b"
    r"|\bvisible to (?:other|another|the wrong)",
    re.IGNORECASE,
)


def topic_hits(*texts: str) -> list[str]:
    """Human-only topics named in the finding's text (deduplicated, in order)."""
    seen: dict[str, None] = {}
    for text in texts:
        for m in _TOPIC_RE.finditer(text or ""):
            seen.setdefault(m.group(0).lower(), None)
    return [f"topic: {t}" for t in seen]


_PLUS_FILE = re.compile(r"^\+\+\+ (?:[a-z]/)?(\S+)", re.MULTILINE)
_HUNK = re.compile(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@", re.MULTILINE)


def changed_ranges(diff: str, app_prefix: str) -> dict[str, list[tuple[int, int]]]:
    """``{app-relative file: [(line, line)]}`` for the new-side lines that actually
    changed (added lines, and the position of removed ones); context lines are not
    changes. Any prefix style (``a/ b/`` or git's mnemonic ``i/ w/``)."""
    out: dict[str, list[tuple[int, int]]] = {}
    current: str | None = None
    new_line = 0
    for line in diff.splitlines():
        if line.startswith("+++ "):
            m = _PLUS_FILE.match(line)
            path = m.group(1) if m else None
            if path in (None, "/dev/null", "dev/null"):
                current = None
                continue
            if app_prefix and path.startswith(app_prefix + "/"):
                path = path[len(app_prefix) + 1 :]
            current = path
            out.setdefault(current, [])
        elif line.startswith("--- ") or current is None:
            continue
        elif line.startswith("@@"):
            m = _HUNK.match(line)
            new_line = int(m.group(1)) if m else 0
        elif line.startswith("+"):
            out[current].append((new_line, new_line))
            new_line += 1
        elif line.startswith("-"):
            out[current].append((new_line, new_line))  # removed here; no advance
        else:
            new_line += 1
    return out


def risky_dependents(
    repo_map, policy: PathPolicy, app: str, app_root, diff: str, app_prefix: str
) -> list[str]:
    """(b) A changed file is risky when a risk-path file uses what it changed: callers
    of the changed symbols (call graph) and files importing those names (imports also
    cover constants, which are referenced, not called)."""
    if repo_map is None:
        return []
    hits: list[str] = []
    for file, ranges in changed_ranges(diff, app_prefix).items():
        symbols = [
            s
            for start, end in ranges
            for s in repo_map.symbols_in_range(file, start, end)
        ]
        names = {s.name for s in symbols}
        users: dict[str, str] = {}
        for sym in symbols:
            for edge in repo_map._callers.get(sym.id, []):
                caller = repo_map.symbols.get(edge.caller)
                if caller is not None and caller.file != file:
                    users.setdefault(caller.file, f"calls {sym.name}")
        for importer in repo_map._importers.get(file, []):
            entry = repo_map.files.get(importer)
            if entry is None or importer == file:
                continue
            imported = {
                n for imp in entry.imports if imp.resolved == file for n in imp.names
            }
            used = names & imported if names else imported
            if used or (not names and imported):
                users.setdefault(
                    importer, f"imports {', '.join(sorted(used or imported))}"
                )
        for user, how in users.items():
            if repo_map.is_test_file(user):
                continue
            rule = policy.touches_risk([app_root / user], app)
            if rule:
                hits.append(f"{file} is used by risk-path {rule[0]} ({how})")
    return hits
