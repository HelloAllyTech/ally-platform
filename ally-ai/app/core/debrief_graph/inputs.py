"""What each model step is sent, built from the state and the run's inputs.

Shared by the node that reserves a step's budget (which sizes the body) and the
step itself (which sends it), so both see the same thing. Key order follows
ally-be's runner, so `JSON.stringify(body).length` sizes match.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from app.core.debrief import framework
from app.core.debrief_graph.constants import PROMPT_CODES, Recipe, Step
from app.core.debrief_graph.context import DebriefRunContext as Ctx
from app.core.debrief_graph.state import DebriefState as State


def contract_extras(ctx: Ctx, *keys: str) -> Dict[str, Any]:
    """The optional contract fields the session carries (framework, risk_cue,
    speaker_labels), normalised, for a step body. A field the session does not
    carry is left out, so an absent contract builds exactly the bodies it did
    before."""
    getters = {
        "framework": framework.framework_of,
        "risk_cue": framework.risk_cue_of,
        "speaker_labels": framework.speaker_labels_of,
    }
    session = getattr(ctx, "session", None) or {}
    return {k: getters[k](session) for k in keys if framework.session_has(session, k)}


def recipe(state: State, ctx: Ctx) -> Dict[str, Any]:
    return ctx.recipe(state["recipe_key"])


def live_detections(state: State, ctx: Ctx) -> List[Dict[str, Any]]:
    """The live detector's record: a second opinion for the Analyst (v9 FR-17)."""
    if not ctx.step_of(state["recipe_key"], Step.ANALYST):
        return []
    return ctx.inputs.get("live_detections") or []


def case_memory(state: State, ctx: Ctx) -> Optional[str]:
    """A case's memory so far, for Case runs only (v9 FR-4); in an
    orchestrated run, only when the planner chose the `case_memory` agent."""
    if state.get("orchestrated"):
        if "case_memory" not in (state.get("data_agents") or []):
            return None
        return ctx.inputs.get("case_memory") or None
    if state["recipe_key"] != Recipe.CASE:
        return None
    return ctx.inputs.get("case_memory") or None


def past_points(ctx: Ctx) -> List[Dict[str, Any]]:
    return ctx.inputs.get("past_work_on_this") or []


def practice_options(ctx: Ctx) -> List[Dict[str, Any]]:
    return ctx.inputs.get("practice_options") or []


def cohort(ctx: Ctx) -> Optional[Dict[str, Any]]:
    return ctx.inputs.get("cohort") or None


def analyst_ran(state: State) -> bool:
    return bool((state.get("results") or {}).get("analyst#0"))


def safety_body(state: State, ctx: Ctx) -> Dict[str, Any]:
    return {
        "transcript": ctx.transcript,
        "language": ctx.language,
        "system_prompt": ctx.prompt(PROMPT_CODES["safety_reader"]),
        "risk_cue_definition": ctx.prompt(PROMPT_CODES["risk_cue_definition"]),
        **contract_extras(ctx, "risk_cue", "speaker_labels"),
        **practice_context(ctx),
    }


def practice_context(ctx: Ctx) -> Dict[str, Any]:
    """What the Safety reader needs to say which cues are part of the practice:
    only for a roleplay whose risk cues are assessed."""
    if ctx.risk_cue["handling"] != "assessed":
        return {}
    return {
        "scenario": ctx.sess("scenario") or {},
        "roleplay_expectations": roleplay_expectations(ctx) or {},
    }


def analyst_body(state: State, ctx: Ctx) -> Dict[str, Any]:
    return {
        "transcript": ctx.transcript,
        "language": ctx.language,
        "scenario": ctx.sess("scenario") or {},
        "expected_behaviours": ctx.sess("expected_behaviours") or [],
        "helpful_behaviours": ctx.sess("helpful_behaviours") or [],
        "unhelpful_behaviours": ctx.sess("unhelpful_behaviours") or [],
        "competencies": ctx.sess("competencies") or [],
        "learner_level": ctx.sess("learner_level"),
        "live_detections": live_detections(state, ctx),
        "case_memory": case_memory(state, ctx),
        "system_prompt": ctx.prompt(PROMPT_CODES["analyst"]),
        **contract_extras(ctx, "framework", "speaker_labels"),
    }


def progress_profile(ctx: Ctx) -> Optional[Dict[str, Any]]:
    """The learner's progress profile when it has history (PROGRESS_CONTRACT §1)."""
    from app.core.debrief_graph.progress import profile_of

    return profile_of(ctx.inputs)


def progress_agent_body(state: State, ctx: Ctx) -> Dict[str, Any]:
    """The progress agent: this session's evidence map and the profile, never
    the transcript."""
    from app.core.debrief_graph.progress import agent_input

    profile = progress_profile(ctx) or {}
    evidence = state.get("evidence") or {}
    return {
        "evidence": evidence,
        "profile": profile,
        "this_session": agent_input(profile, evidence, ctx.skill_names()),
        "language": ctx.language,
        "system_prompt": ctx.prompt(PROMPT_CODES["progress"]),
        **contract_extras(ctx, "framework"),
    }


def progress_body(state: State, ctx: Ctx) -> Dict[str, Any]:
    """The orchestrated path's Progress reader (registry agent)."""
    return {
        "evidence": state.get("evidence") or {},
        "past_points": past_points(ctx),
        "language": ctx.language,
        "system_prompt": ctx.prompt(PROMPT_CODES["progress_reader"]),
    }


def writer_findings(
    state: State, agents: Optional[List[str]] = None, own_blocks: bool = False
):
    """The Writer's generic findings section (spec A3): every agent whose output
    has no block of its own, grouped by kind, most important first."""
    from app.core.debrief_graph.findings import for_writer
    from app.core.debrief_graph.registry.manifest import REGISTRY

    found = state.get("findings") or {}
    names = [
        a
        for a in (agents if agents is not None else list(found))
        if a in REGISTRY and (own_blocks or not REGISTRY[a].writer_has_own_block)
    ]
    return for_writer(found, names, quoted_only=bool(state.get("anchor_quotes")))


def writer_body(state: State, ctx: Ctx) -> Dict[str, Any]:
    r = recipe(state, ctx)
    out = {
        "practice_options": practice_options(ctx),
        "case_memory": case_memory(state, ctx),
        "cohort": cohort(ctx),
        "assessment": r["key"] == Recipe.ASSESSMENT,
        "evidence": state.get("evidence") or {},
        "safety": state["safety"],
        "transcript": ctx.transcript,
        "passages": state.get("passages") or [],
        "progress": state.get("progress"),
        "language": ctx.language,
        "learner_level": ctx.sess("learner_level"),
        "short": bool(r.get("shortForm")),
        "system_prompt": ctx.prompt(PROMPT_CODES["writer"]),
        "risk_cue_definition": ctx.prompt(PROMPT_CODES["risk_cue_definition"]),
        **contract_extras(ctx, "risk_cue", "speaker_labels"),
    }
    if state.get("orchestrated"):
        out["findings"] = writer_findings(state) or None
    return out


def roleplay_expectations(ctx: Ctx) -> Optional[Dict[str, Any]]:
    """The roleplay's own expectations for the Evaluator's practice_alignment
    (None when the roleplay lists none, so the wording stays today's)."""
    helpful = [b for b in ctx.sess("helpful_behaviours") or [] if b]
    unhelpful = [b for b in ctx.sess("unhelpful_behaviours") or [] if b]
    named = [
        c
        for c in ctx.sess("competencies") or []
        if isinstance(c, dict) and c.get("name")
    ]
    if not (helpful or unhelpful or named):
        return None
    return {
        "helpful_behaviours": helpful,
        "unhelpful_behaviours": unhelpful,
        "competencies": named,
    }


def evaluator_body(state: State, ctx: Ctx) -> Dict[str, Any]:
    return {
        "transcript": ctx.transcript,
        "debrief": state["current"]["debrief"],
        "rubric": ctx.prompt(PROMPT_CODES["rubric"]),
        "history": state.get("history"),
        "language": ctx.language,
        "learner_level": ctx.sess("learner_level"),
        "risk_cue_definition": ctx.prompt(PROMPT_CODES["risk_cue_definition"]),
        "system_prompt": ctx.prompt(PROMPT_CODES["evaluator"]),
        "fix_prompt": ctx.prompt(PROMPT_CODES["evaluator_fix"]),
        "pass_score": ctx.setting("passScore", 8),
        # What the debrief may claim over time (null: nothing).
        "progress": state.get("progress"),
        **contract_extras(ctx, "risk_cue", "speaker_labels"),
        **(
            {"roleplay_expectations": exp}
            if (exp := roleplay_expectations(ctx))
            else {}
        ),
    }


def critique(best: Dict[str, Any]) -> List[Dict[str, Any]]:
    ev = best.get("evaluation") or {}
    return [
        *(
            {"section": c["section"], "note": f"{c['code']}: {c['detail']}"}
            for c in best["checks"]
        ),
        *(
            {
                "section": "whole debrief",
                "note": f"hard fail {h['code']}: {h['evidence']}",
            }
            for h in ev.get("hardFails") or []
        ),
        *(ev.get("fixes") or []),
    ]


def excerpts(state: State, ctx: Ctx) -> List[Dict[str, Any]]:
    """The transcript turns the draft's cards and the risk cues point at, and
    their neighbours."""
    cards = state["best"]["cards"]
    anchored = {c["turn_index"] for c in state["safety"].get("risk_cues") or []}
    anchored |= {c["turn_index"] for c in cards.get("what_worked") or []}
    anchored |= {c["turn_index"] for c in cards.get("work_on_this") or []}
    if cards.get("important_moment"):
        anchored.add(cards["important_moment"]["turn_index"])
    return [
        t
        for t in ctx.transcript
        if t["turn_index"] in anchored
        or t["turn_index"] + 1 in anchored
        or t["turn_index"] - 1 in anchored
    ]


def reviser_body(state: State, ctx: Ctx) -> Dict[str, Any]:
    best = state["best"]
    return {
        "draft": best["cards"],
        "critique": critique(best),
        "evidence": state.get("evidence") or {},
        "excerpts": excerpts(state, ctx),
        "language": ctx.language,
        "system_prompt": ctx.prompt(PROMPT_CODES["reviser"]),
        # The clear cues it must keep covered (RISK CUES TO COVER).
        "safety": state.get("safety") or {},
        "risk_cue_definition": ctx.prompt(PROMPT_CODES["risk_cue_definition"]),
        **contract_extras(ctx, "risk_cue", "speaker_labels"),
        # What the evidence top-up found (D3), for an orchestrated run only.
        **(
            {
                "findings": writer_findings(state, state.get("top_up_agents"), True)
                or None
            }
            if state.get("orchestrated") and state.get("top_up_agents")
            else {}
        ),
    }
