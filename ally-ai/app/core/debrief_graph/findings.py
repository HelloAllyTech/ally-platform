"""The findings contract (spec A3): every registry agent answers in one shape,
quotes are checked against the transcript before anything reads them, and the
Writer gets one generic section grouped by kind, most important first.

A finding as the run keeps it (camelCase, as the spec and the Console read it):
`{kind, point, turnIndex, quote, importance, confidence, source}`, where
importance 1 matters most.
"""

from __future__ import annotations

import re
import unicodedata
from typing import Any, Dict, Iterable, List, Optional

from app.core.debrief_graph.context import DebriefRunContext

KINDS = ("risk", "missed", "done_well", "progress", "comparison", "context")
CONFIDENCE = ("high", "medium", "low")

_PUNCT_EDGES = re.compile(r"^[\W_]+|[\W_]+$", re.UNICODE)


def normalise_quote(text: Optional[str]) -> str:
    """ally-be's `normaliseForQuote`: the same quote matches on both sides."""
    s = unicodedata.normalize("NFC", text or "")
    s = re.sub("[‘’‛]", "'", s)
    s = re.sub("[“”‟]", '"', s)
    s = s.replace("…", "...")
    s = re.sub(r"\s+", " ", s).strip()
    return _PUNCT_EDGES.sub("", s).lower()


def _turn_of(quote: str, turn: Optional[int], ctx: DebriefRunContext) -> Optional[int]:
    """The turn the quote is really in: the named turn when it is there, else
    the first turn that holds it; None when no turn does."""
    q = normalise_quote(quote)
    if not q:
        return None
    turns = ctx.transcript
    named = next((t for t in turns if t.get("turn_index") == turn), None)
    if named and q in normalise_quote(named.get("text")):
        return turn
    for t in turns:
        if q in normalise_quote(t.get("text")):
            return t.get("turn_index")
    return None


def verify(
    raw: Iterable[Dict[str, Any]],
    ctx: DebriefRunContext,
    *,
    no_quotes: bool = False,
) -> Dict[str, Any]:
    """Findings in the run's shape with every quote checked. A quote no turn
    holds is dropped (the point stays, its confidence falls to low); an
    aggregate agent's findings never carry quotes at all."""
    kept: List[Dict[str, Any]] = []
    dropped = 0
    turns = {t.get("turn_index") for t in ctx.transcript}
    for f in raw or []:
        if not isinstance(f, dict):
            continue
        point = str(f.get("point") or "").strip()
        kind = f.get("kind")
        if not point or kind not in KINDS:
            continue
        turn = f.get("turnIndex", f.get("turn_index"))
        turn = turn if isinstance(turn, int) and turn in turns else None
        confidence = (
            f.get("confidence") if f.get("confidence") in CONFIDENCE else "medium"
        )
        quote = f.get("quote")
        quote = quote.strip() if isinstance(quote, str) and quote.strip() else None
        if quote and no_quotes:
            quote = None
        if quote:
            at = _turn_of(quote, turn, ctx)
            if at is None:
                quote, dropped, confidence = None, dropped + 1, "low"
            else:
                turn = at
        try:
            importance = min(3, max(1, int(f.get("importance") or 2)))
        except (TypeError, ValueError):
            importance = 2
        source = f.get("source")
        kept.append(
            {
                "kind": kind,
                "point": point[:500],
                "turnIndex": turn,
                "quote": quote,
                "importance": importance,
                "confidence": confidence,
                "source": str(source)[:120] if source else None,
            }
        )
    return {"findings": kept, "droppedQuotes": dropped}


def agent_findings(
    agent: str,
    raw: Iterable[Dict[str, Any]],
    ctx: DebriefRunContext,
    res: Optional[Dict[str, Any]] = None,
    *,
    no_quotes: bool = False,
) -> Dict[str, Any]:
    """One agent's answer as the contract has it, quotes checked."""
    checked = verify(raw, ctx, no_quotes=no_quotes)
    reasoning = (res or {}).get("reasoning")
    return {
        "agent": agent,
        **checked,
        "reasoning": reasoning.strip()[:2000] if isinstance(reasoning, str) else None,
    }


def evidence_findings(evidence: Dict[str, Any]) -> List[Dict[str, Any]]:
    """The Analyst's evidence map, summarised into findings. The map itself
    stays the Writer's and the checks' richer input."""
    out: List[Dict[str, Any]] = []
    for b in (evidence or {}).get("behaviours") or []:
        if not isinstance(b, dict) or b.get("opportunity") is False:
            continue
        observation = b.get("observation")
        kind = "done_well" if observation == "observed" else "missed"
        out.append(
            {
                "kind": kind,
                "point": f"{b.get('skill')}: {b.get('note') or observation}",
                "turnIndex": b.get("turn_index"),
                "quote": b.get("quote"),
                # The evidence map's 3 = mattered most; a finding's 1 does.
                "importance": 4 - int(b.get("importance") or 2),
                "confidence": b.get("confidence") or "medium",
                "source": None,
            }
        )
    for m in (evidence or {}).get("pivotal_moments") or []:
        if isinstance(m, dict) and m.get("summary"):
            out.append(
                {
                    "kind": "context",
                    "point": f"{m['summary']}. {m.get('why_it_matters') or ''}".strip(),
                    "turnIndex": m.get("turn_index"),
                    "quote": None,
                    "importance": 2,
                    "confidence": "medium",
                    "source": None,
                }
            )
    return out


def for_writer(
    findings: Dict[str, Dict[str, Any]],
    agents: Iterable[str],
    *,
    quoted_only: bool = False,
) -> Dict[str, List[Dict[str, Any]]]:
    """The Writer's one findings section: the named agents' findings grouped
    by kind (risk first), most important first. `quoted_only` keeps only
    findings anchored to a checked quote (an assessment: every point rests on
    a quoted moment)."""
    grouped: Dict[str, List[Dict[str, Any]]] = {}
    for agent in agents:
        for f in (findings.get(agent) or {}).get("findings") or []:
            if quoted_only and not f.get("quote"):
                continue
            grouped.setdefault(f["kind"], []).append(
                {
                    k: f[k]
                    for k in ("point", "turnIndex", "quote", "confidence")
                    if f.get(k) is not None
                }
                | {"importance": f["importance"]}
            )
    return {
        kind: sorted(grouped[kind], key=lambda f: f["importance"])
        for kind in KINDS
        if grouped.get(kind)
    }


def count(findings: Dict[str, Dict[str, Any]]) -> int:
    return sum(len((v or {}).get("findings") or []) for v in findings.values())
