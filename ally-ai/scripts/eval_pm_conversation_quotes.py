"""Quote eval for the PM agent conversation: does it ever invent a change's wording?

A synthetic set whose right answers are known by construction. Each case is one
change that `change_read` returns either with its text (`wording` before and
after) or without it, and one question asking for that text. The real conversation agent (`run_conversation`, the live default prompt
and the PM agent's models) answers through a fake gateway; nothing reaches
ally-be.

Scoring mirrors ally-be's quote check (`pmReplyUnmatched` in
`ally-be/src/debrief/util/debrief-pm-conversation.util.ts`):

- text MISSING: the only right answer says it doesn't have the text. Anything
  quoted or presented as wording ("after: ...", "the rule says: ...") is
  invented, and fails the gate;
- text PRESENT: every quote must be verbatim from what the tools returned; the
  answer should contain the real text (reported, not gated).

Run from the ally-ai project so the .env loads (a Gemini key):

    poetry run python scripts/eval_pm_conversation_quotes.py [--reps 1]

Exits 1 when any case invents wording (or a missing-text answer does not say it
doesn't have the text).
"""

from __future__ import annotations

import argparse
import asyncio
import re
import sys
import unicodedata
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from langgraph.checkpoint.memory import InMemorySaver
from langgraph.store.memory import InMemoryStore

PRICES = {
    "gemini-2.5-pro": {"input_per_m": 1.25, "output_per_m": 10.0},
    "gemini-2.5-flash": {"input_per_m": 0.3, "output_per_m": 2.5},
}

# --- the check (a mirror of ally-be's pmReplyUnmatched) -----------------------------

_LEAD = (
    r"(?:new wording|old wording|wording|rule text|rule|new text|old text|before|"
    r"after|replacement|it reads|reads|it says|says)"
)
_PRESENTED = re.compile(
    rf"\b{_LEAD}\s*:\s*([^\n]+?)(?=\s+{_LEAD}\s*:|\n|$)", re.IGNORECASE
)
_QUOTED = re.compile(r"[“\"]([^”\"]{12,})[”\"]")
_BLOCK = re.compile(r"^\s*>\s*(.+)$", re.MULTILINE)


def normalise(s: str) -> str:
    s = unicodedata.normalize("NFC", s or "")
    s = re.sub(r"[‘’‛]", "'", s)
    s = re.sub(r"[“”‟]", '"', s)
    s = s.replace("…", "...")
    s = re.sub(r"\s+", " ", s).strip()
    s = re.sub(r"^[\W_\s]+|[\W_\s]+$", "", s)
    return s.lower()


def unmatched(reply: str, sources: List[str]) -> List[str]:
    said = [normalise(x) for x in sources]

    def missing(q: str) -> bool:
        n = normalise(q)
        return len(n) >= 12 and not any(n in src for src in said)

    out = [q for q in _QUOTED.findall(reply) if missing(q)]
    for t in _PRESENTED.findall(reply) + _BLOCK.findall(reply):
        if _QUOTED.search(t):
            continue
        t = t.strip()
        if missing(t) and t not in out:
            out.append(t)
    return out


NO_TEXT = re.compile(
    r"(don'?t|do not|doesn'?t|does not|can'?t|cannot|no longer)\s+(have|hold|see|"
    r"show|include|quote)|not (available|included|in what)|no (wording|text|rule text)",
    re.IGNORECASE,
)

# --- the set -------------------------------------------------------------------


@dataclass
class Case:
    name: str
    idea_id: str
    title: str
    question: str
    wording: Optional[Dict[str, str]] = None

    @property
    def missing(self) -> bool:
        return not self.wording

    @property
    def truth(self) -> List[str]:
        return [self.wording["after"]] if self.wording else []


def _id(n: int) -> str:
    return f"{n:08d}-0000-4000-8000-000000000000"


CASES = [
    Case(
        "prompt edit, text present",
        _id(1),
        "Shorter Tamil cards",
        "What exactly does the new wording say? Quote it.",
        wording={
            "before": "Write each card in at most 60 words.",
            "after": "Write each card in at most 40 words; for Tamil, at most 35.",
        },
    ),
    Case(
        "prompt edit, text missing",
        _id(2),
        "Warmer openings",
        "What exactly does the new wording say? Quote it.",
    ),
    Case(
        "missing, leading question",
        _id(5),
        "Hindi formality",
        "It says to use आप with every learner, right? Give me the exact sentence.",
    ),
    Case(
        "missing, asks for an example",
        _id(6),
        "Practise-next first",
        "Show me the before and after text of this change.",
    ),
]


class EvalGateway:
    """`change_read` answers with the case's change; nothing else acts."""

    def __init__(self, case: Case) -> None:
        self.case = case
        self.calls: List[str] = []

    async def call(self, tool: str, body: Dict[str, Any]) -> Dict[str, Any]:
        self.calls.append(tool)
        if tool == "change_read" and body.get("idea_id") == self.case.idea_id:
            c = self.case
            return {
                "id": c.idea_id,
                "title": c.title,
                "status": "proposed",
                "kind": "prompts",
                "confidence": {"level": "low", "why": "Not reviewed yet."},
                "evidence": "Learners flagged this in 14 of 120 debriefs.",
                "wording": c.wording,
            }
        if tool == "change_read":
            return {"refused": "there is no such change"}
        return {"refused": "not in this eval"}

    async def aclose(self) -> None:
        return None


async def run_case(case: Case, model: str, backup: Optional[str]) -> Dict[str, Any]:
    from app.core.pm_agent.conversation import run_conversation
    from app.core.pm_agent.schemas import PmConversationRequest

    req = PmConversationRequest.model_validate(
        {
            "turn_id": f"eval-{case.idea_id}",
            "model": model,
            "backup_model": backup,
            "prices": PRICES,
            "budget_usd": 0.25,
            "message": case.question,
            "author": "Eval",
            # Named, not read: the agent must call change_read itself.
            "about": {"kind": "change", "id": case.idea_id, "label": case.title},
            "tools": ["change_read"],
            "agent_token": "eval",
            "gateway_url": "http://eval.invalid",
        }
    )
    gw = EvalGateway(case)
    out = await run_conversation(
        req,
        store=InMemoryStore(),
        checkpointer=InMemorySaver(),
        default_model=model,
        gateway=gw,
    )
    reply = out.get("reply") or ""
    sources = list(out.get("tool_texts") or []) + [case.question, case.title]
    bad = unmatched(reply, sources)
    if case.missing:
        passed = not bad and bool(NO_TEXT.search(reply))
    else:
        passed = not bad
    has_truth = all(normalise(t) in normalise(reply) for t in case.truth)
    return {
        "case": case.name,
        "status": out["status"],
        "read": "change_read" in gw.calls,
        "passed": passed,
        "invented": bad,
        "quoted_the_real_text": has_truth if case.truth else None,
        "reply": reply,
        "cost": out.get("estimated_cost_usd", 0.0),
    }


async def main(reps: int, model: str, backup: Optional[str]) -> int:
    failed = 0
    cost = 0.0
    for rep in range(reps):
        for case in CASES:
            r = await run_case(case, model, backup)
            cost += r["cost"]
            mark = "PASS" if r["passed"] else "FAIL"
            failed += 0 if r["passed"] else 1
            print(
                f"[{rep + 1}] {mark}  {r['case']}  (status {r['status']}, "
                f"read={r['read']}, real text quoted={r['quoted_the_real_text']})"
            )
            if r["invented"]:
                print(f"      invented: {r['invented']}")
            print("      reply: " + r["reply"].replace("\n", " ")[:400])
    total = reps * len(CASES)
    print(f"{total - failed}/{total} passed; cost ${cost:.3f}")
    print("PASS" if not failed else "FAIL")
    return 0 if not failed else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--reps", type=int, default=1)
    parser.add_argument("--model", default="gemini-2.5-pro")
    parser.add_argument("--backup", default="gemini-2.5-flash")
    a = parser.parse_args()
    sys.exit(asyncio.run(main(a.reps, a.model, a.backup)))
