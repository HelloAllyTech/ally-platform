"""What one debrief run carries from node to node; the checkpointer stores it.

JSON-safe values only (dicts, lists, strings, numbers). Nodes return partial
updates; the reducers say how they merge:

- `steps`, `drafts`, `evaluations` append (the run view's timeline and history);
- `workspace`, `results`, `reserved` merge key by key;
- `rung` keeps the deepest rung reached (the ladder only goes down).
"""

from __future__ import annotations

import operator
from typing import Annotated, Any, Dict, List, Optional, TypedDict


def merge(left: Optional[Dict[str, Any]], right: Optional[Dict[str, Any]]):
    return {**(left or {}), **(right or {})}


def deepest(left: Optional[int], right: Optional[int]) -> int:
    return max(left or 0, right or 0)


class DebriefState(TypedDict, total=False):
    #: DebriefRunStepRecord dicts, in the order they happened.
    steps: Annotated[List[Dict[str, Any]], operator.add]
    #: What the run stores on `debrief_runs.workspace`.
    workspace: Annotated[Dict[str, Any], merge]
    #: Each model step's answer (wire shape) by `path#round`; None = failed.
    results: Annotated[Dict[str, Any], merge]
    #: Each model step's reservation by `path#round`.
    reserved: Annotated[Dict[str, float], merge]
    estimated: float  # everything reserved so far, USD
    rung: Annotated[int, deepest]

    recipe_key: str
    has_risk_cue: bool
    learner_distress: bool
    safety: Dict[str, Any]
    evidence: Dict[str, Any]
    progress: Optional[Dict[str, Any]]
    history: Optional[str]
    passages: List[Dict[str, str]]  # {title, text}, what the Writer reads

    # The check → evaluate ⇄ revise loop.
    round: int  # revision rounds started
    current: Dict[str, Any]  # the draft being checked and scored
    best: Optional[Dict[str, Any]]
    drafts: Annotated[List[Dict[str, Any]], operator.add]
    evaluations: Annotated[List[Dict[str, Any]], operator.add]
    advisory: List[str]  # advisory check codes, as `run_checks` names them

    # The ending.
    outcome: Dict[str, Any]  # {status, skip_reason}
    patch: Dict[str, Any]  # the decided draft's run fields
    result: Dict[str, Any]  # the response, once `finish` has run
