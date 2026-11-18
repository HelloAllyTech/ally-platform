"""Scoring for the Scribe v2 quality gate (DESIGN §10).

An eval case is a real session (kept out of the repo: it is PHI) with a
reference list of facts in session order and the correct field values. A note
— v2's draft or v1's summary — is scored on:

- fact recall: share of reference facts the note states (a judge decides);
- order: Kendall tau between the reference order of the matched facts and the
  order in which the note states them (1 = same order, -1 = reversed);
- field accuracy, and fields filled where the reference says "not discussed";
- length against the budget.

Everything here is plain code; the judge is passed in, so the scoring itself is
deterministic and tested.
"""

from typing import Any, Awaitable, Callable, Dict, List, Optional, Sequence

from pydantic import BaseModel, Field


class EvalFact(BaseModel):
    text: str
    # Optional time in the session, for reading reports; order comes from the
    # list's own order.
    t: Optional[str] = None


class EvalCase(BaseModel):
    id: str
    mode: str = "SCRIBE"
    segments_text: str
    note_spec: Dict[str, Any] = Field(default_factory=dict)
    facts: List[EvalFact] = Field(default_factory=list)
    # field id → correct value; None means "not discussed, must stay empty".
    fields: Dict[str, Any] = Field(default_factory=dict)
    # v1's narrative for the same session, as points in the order shown, for a
    # baseline score with the same judge.
    v1_points: List[str] = Field(default_factory=list)


class FactMatch(BaseModel):
    fact_index: int
    # Index of the note point that states it; None when the note doesn't.
    point_index: Optional[int] = None


class NoteScore(BaseModel):
    fact_recall: Optional[float] = None
    order_tau: Optional[float] = None
    matched: int = 0
    facts: int = 0
    field_accuracy: Optional[float] = None
    fields_scored: int = 0
    invented_fields: int = 0
    missed_fields: int = 0
    narrative_words: int = 0
    length_ratio: Optional[float] = None


# judge(facts, points) -> one FactMatch per fact
Judge = Callable[[List[str], List[str]], Awaitable[List[FactMatch]]]


def kendall_tau(sequence: Sequence[float]) -> Optional[float]:
    """Kendall tau-a of `sequence` against its sorted order. Ties count as
    neither concordant nor discordant. None for fewer than two items."""
    n = len(sequence)
    if n < 2:
        return None
    concordant = discordant = 0
    for i in range(n):
        for j in range(i + 1, n):
            if sequence[i] < sequence[j]:
                concordant += 1
            elif sequence[i] > sequence[j]:
                discordant += 1
    return (concordant - discordant) / (n * (n - 1) / 2)


def score_facts(matches: List[FactMatch], fact_count: int) -> Dict[str, Any]:
    """Recall, and order over the facts the note states (in reference order)."""
    by_fact = {m.fact_index: m.point_index for m in matches}
    positions = [by_fact[i] for i in range(fact_count) if by_fact.get(i) is not None]
    return {
        "fact_recall": (len(positions) / fact_count) if fact_count else None,
        "order_tau": kendall_tau(positions),
        "matched": len(positions),
        "facts": fact_count,
    }


def _norm(value: Any) -> Any:
    if isinstance(value, str):
        return " ".join(value.lower().split())
    if isinstance(value, list):
        return sorted(_norm(v) for v in value)
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return value


def score_fields(
    predicted: Dict[str, Any], reference: Dict[str, Any]
) -> Dict[str, Any]:
    """Exact match after normalising case, spacing and list order.

    Free-text fields rarely match exactly; give them `None` in the reference
    only to test that they stay empty, and judge their content as facts.
    """
    correct = scored = invented = missed = 0
    for fid, gold in reference.items():
        got = predicted.get(fid)
        if gold is None:
            if got is not None:
                invented += 1
            continue
        scored += 1
        if got is None:
            missed += 1
        elif _norm(got) == _norm(gold):
            correct += 1
    return {
        "field_accuracy": (correct / scored) if scored else None,
        "fields_scored": scored,
        "invented_fields": invented,
        "missed_fields": missed,
    }


async def score_note(
    case: EvalCase,
    points: List[str],
    fields: Dict[str, Any],
    judge: Judge,
    budget_words: Optional[int] = None,
) -> NoteScore:
    facts = [f.text for f in case.facts]
    matches = await judge(facts, points) if facts and points else []
    words = sum(len(p.split()) for p in points)
    return NoteScore(
        **score_facts(matches, len(facts)),
        **score_fields(fields, case.fields),
        narrative_words=words,
        length_ratio=(words / budget_words) if budget_words else None,
    )


def summarise(scores: List[NoteScore]) -> Dict[str, Optional[float]]:
    """Means over the cases that have each metric."""

    def mean(name: str) -> Optional[float]:
        values = [getattr(s, name) for s in scores if getattr(s, name) is not None]
        return round(sum(values) / len(values), 3) if values else None

    return {
        "cases": len(scores),
        "fact_recall": mean("fact_recall"),
        "order_tau": mean("order_tau"),
        "field_accuracy": mean("field_accuracy"),
        "invented_fields": sum(s.invented_fields for s in scores),
        "length_ratio": mean("length_ratio"),
    }


JUDGE_INSTRUCTIONS = (
    "You check a counselling session note against a list of reference facts. "
    "For each fact, give the index of the note point that states it (the same "
    "meaning, in any wording or language), or null if no point does. A point "
    "may state several facts. Do not count a point that only hints at a fact."
)


def judge_prompt(facts: List[str], points: List[str]) -> str:
    fact_lines = "\n".join(f"{i}. {f}" for i, f in enumerate(facts))
    point_lines = "\n".join(f"{i}. {p}" for i, p in enumerate(points))
    return (
        f"{JUDGE_INSTRUCTIONS}\n\nReference facts:\n{fact_lines}\n\n"
        f"Note points:\n{point_lines}"
    )


def judge_schema(fact_count: int) -> Dict[str, Any]:
    return {
        "title": "fact_matches",
        "description": "For each reference fact, the note point that states it.",
        "type": "object",
        "additionalProperties": False,
        "required": ["matches"],
        "properties": {
            "matches": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["fact_index", "point_index"],
                    "properties": {
                        "fact_index": {"type": "integer"},
                        "point_index": {"type": ["integer", "null"]},
                    },
                },
            }
        },
    }


def parse_judge(
    answer: Dict[str, Any], fact_count: int, point_count: int
) -> List[FactMatch]:
    """Keep one well-formed match per fact; drop out-of-range indices."""
    seen: Dict[int, Optional[int]] = {}
    for m in (answer or {}).get("matches") or []:
        if not isinstance(m, dict):
            continue
        fi, pi = m.get("fact_index"), m.get("point_index")
        if not isinstance(fi, int) or not 0 <= fi < fact_count or fi in seen:
            continue
        seen[fi] = pi if isinstance(pi, int) and 0 <= pi < point_count else None
    return [FactMatch(fact_index=i, point_index=p) for i, p in seen.items()]
