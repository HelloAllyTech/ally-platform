"""The six model steps: what each is sent, how the run view explains it, and
where the run goes when it succeeds or fails (ally-be's runner, step by step).
"""

from __future__ import annotations

from typing import Any, Dict

from app.core.debrief_graph import inputs as body
from app.core.debrief_graph.constants import FallbackRung, Status, Step
from app.core.debrief_graph.context import DebriefRunContext as Ctx
from app.core.debrief_graph.model_step import ModelStep
from app.core.debrief_graph.narration import (
    cards_summary,
    evaluator_summary,
    evidence_summary,
    n,
    progress_summary,
    revision_why,
    safety_narration,
    safety_summary,
)
from app.core.debrief_graph.state import DebriefState as State


def _stay(*_: Any):
    return {}, None


# --- 1. Safety reader and Analyst, side by side --------------------------------

SAFETY_READER = ModelStep(
    step=Step.SAFETY_READER,
    path="safety-reader",
    body=body.safety_body,
    why=lambda s, c: (
        "Always runs first: nothing is published without a safety reading."
    ),
    inputs=lambda s, c: [c.turns_line],
    reasoning=lambda r: safety_narration(
        {
            "risk_cues": r.get("risk_cues") or [],
            "learner_distress": r.get("learner_distress") or [],
        }
    ),
    summarise=safety_summary,
    on_success=_stay,
    on_failure=_stay,
)


def _analyst_inputs(state: State, ctx: Ctx):
    live = body.live_detections(state, ctx)
    detected = len([d for d in live if d.get("detected")])
    return [
        ctx.turns_line,
        "the scenario",
        n(len(ctx.sess("expected_behaviours") or []), "expected behaviour"),
        *(["the case memory"] if body.case_memory(state, ctx) else []),
        *(
            [f"the live detector’s record ({detected} of {len(live)} detected)"]
            if live
            else []
        ),
    ]


ANALYST = ModelStep(
    step=Step.ANALYST,
    path="analyst",
    body=body.analyst_body,
    why=lambda s, c: "Builds the evidence map the Writer writes from.",
    inputs=_analyst_inputs,
    summarise=lambda r: evidence_summary(r["evidence"]),
    on_success=_stay,
    on_failure=_stay,
)


# --- 2. Progress reader --------------------------------------------------------


def _progress_done(state: State, ctx: Ctx, res: Dict[str, Any]):
    reading = res.get("progress") or {}
    if not reading.get("items"):
        return {"progress": None, "history": None}, None
    past = body.past_points(ctx)
    history = "\n".join(f"{p['date']} · {p['skill']}: {p['point']}" for p in past)
    return {"progress": reading, "history": history}, None


PROGRESS_READER = ModelStep(
    step=Step.PROGRESS_READER,
    path="progress-reader",
    body=body.progress_body,
    why=lambda s, c: (
        f"This learner has {n(len(body.past_points(c)), 'earlier Work-on-this point')}"
        " to follow up."
    ),
    inputs=lambda s, c: [
        "the evidence map",
        n(len(body.past_points(c)), "past point"),
    ],
    summarise=progress_summary,
    on_success=_progress_done,
    on_failure=lambda s, c: ({"rung": int(FallbackRung.SKIP_PROGRESS)}, None),
)


# --- 4. Writer -----------------------------------------------------------------


def _writer_why(state: State, ctx: Ctx) -> str:
    r = body.recipe(state, ctx)
    if r.get("shortForm"):
        return "Writes a short debrief: the session had few learner turns."
    return f"Writes the cards from the evidence ({r['key']} recipe)."


def _writer_inputs(state: State, ctx: Ctx):
    passages = state.get("passages") or []
    return [
        (
            "the evidence map"
            if body.analyst_ran(state)
            else "no evidence map (the Analyst did not run)"
        ),
        "the safety reading",
        ctx.turns_line,
        *([n(len(passages), "guidance passage")] if passages else []),
        *(["the progress reading"] if state.get("progress") else []),
        *(["the case memory"] if body.case_memory(state, ctx) else []),
        *(
            ["how other trainees did on this roleplay (5 or more)"]
            if body.cohort(ctx)
            else []
        ),
        n(len(body.practice_options(ctx)), "roleplay", "roleplays")
        + " Practise next may point to",
    ]


def _written(state: State, ctx: Ctx, res: Dict[str, Any]):
    cards = res["cards"]
    return {
        "current": {"cards": cards, "round": 0},
        "drafts": [{"round": 0, "cards": cards, "critique": []}],
    }, "checks"


def _writer_failed(state: State, ctx: Ctx):
    return {
        "rung": int(FallbackRung.PERSON_FINISHES),
        "outcome": {"status": Status.NEEDS_PERSON, "skip_reason": "writer_failed"},
    }, "finish"


WRITER = ModelStep(
    step=Step.WRITER,
    path="writer",
    body=body.writer_body,
    why=_writer_why,
    inputs=_writer_inputs,
    summarise=lambda r: cards_summary(r["cards"]),
    on_success=_written,
    on_failure=_writer_failed,
    destinations=("checks", "finish"),
)


# --- 5. Evaluator and Reviser --------------------------------------------------


def _current_round(state: State) -> int:
    return state["current"]["round"]


EVALUATOR = ModelStep(
    step=Step.EVALUATOR,
    path="evaluator",
    body=body.evaluator_body,
    round_of=_current_round,
    why=lambda s, c: (
        "Scores the first draft against the rubric before anything is published."
        if _current_round(s) == 0
        else f"Scores revision {_current_round(s)} against the rubric."
    ),
    inputs=lambda s, c: [
        "the draft" if _current_round(s) == 0 else f"revision {_current_round(s)}",
        c.turns_line,
        "the rubric",
        *(["the learner’s past points"] if s.get("history") else []),
    ],
    summarise=evaluator_summary,
    on_success=_stay,
    on_failure=_stay,
)


def _revised(state: State, ctx: Ctx, res: Dict[str, Any]):
    rnd = state["round"]
    return {
        "current": {"cards": res["cards"], "round": rnd},
        "drafts": [
            {
                "round": rnd,
                "cards": res["cards"],
                "critique": body.critique(state["best"]),
            }
        ],
    }, "checks"


REVISER = ModelStep(
    step=Step.REVISER,
    path="reviser",
    body=body.reviser_body,
    round_of=lambda s: s["round"],
    why=lambda s, c: revision_why(
        s["best"], c.setting("passScore", 8), set(s.get("advisory") or [])
    ),
    inputs=lambda s, c: [
        f"the best draft so far (round {s['best']['round']})",
        n(len(body.critique(s["best"])), "critique note"),
        "the evidence map",
        n(len(body.excerpts(s, c)), "transcript excerpt"),
    ],
    summarise=lambda r: cards_summary(r["cards"]),
    on_success=_revised,
    on_failure=lambda s, c: ({}, "decide"),
    destinations=("checks", "decide"),
)
