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

    # The orchestrated middle (spec A1–A5; only when the release's challenger
    # flag is on): the profile, the plan(s), the agents the planner chose and
    # what each found.
    orchestrated: bool
    profile: Dict[str, Any]
    offered: List[str]  # agents the release enables and the session allows
    plans: Annotated[List[Dict[str, Any]], operator.add]  # the plan, then the top-up
    phase: str  # "plan" | "top_up": where the dispatcher goes when the agents are done
    pending: List[str]  # chosen agents not started yet, in plan order
    actions: Annotated[Dict[str, Any], merge]  # the planner's action per agent
    agent_ok: Annotated[Dict[str, bool], merge]  # agent → it answered
    findings: Annotated[Dict[str, Any], merge]  # agent → its findings (A3)
    data_agents: Annotated[List[str], operator.add]  # data agents applied
    anchor_quotes: bool  # assessment anchoring: only quoted findings reach the Writer
    floor_reserve: float  # USD held back for the floor before any agent
    top_up_used: bool
    top_up_agents: Annotated[List[str], operator.add]
    action: Dict[str, Any]  # a Send payload's own action (never written)

    # The ending.
    outcome: Dict[str, Any]  # {status, skip_reason}
    patch: Dict[str, Any]  # the decided draft's run fields
    result: Dict[str, Any]  # the response, once `finish` has run
