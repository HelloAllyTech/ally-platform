"""The six model steps: what each is sent, how the run view explains it, and
where the run goes when it succeeds or fails (ally-be's runner, step by step).
"""

from __future__ import annotations

from typing import Any, Dict

from app.core.debrief_graph import inputs as body
from app.core.debrief_graph import progress
from app.core.debrief_graph.agent_logs import code_log
from app.core.debrief_graph.constants import PROMPT_CODES, FallbackRung, Status, Step
from app.core.debrief_graph.context import DebriefRunContext as Ctx
from app.core.debrief_graph.findings import evidence_findings
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
from app.core.debrief_graph.progress_vetoes import apply_vetoes
from app.core.debrief_graph.registry.manifest import agent_config
from app.core.debrief_graph.state import DebriefState as State


def _stay(*_: Any):
    return {}, None


# --- 1. Safety reader and Analyst, side by side --------------------------------

SAFETY_READER = ModelStep(
    prompt_code=PROMPT_CODES["safety_reader"],
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
    # An error handler's update follows no static edge: without this, a failed
    # safety reading with no Analyst beside it would end the run unanswered.
    on_failure=lambda s, c: ({}, "after_reading"),
    destinations=("after_reading",),
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


def _analyst_config(state: State, ctx: Ctx) -> Dict[str, Any]:
    """The recipe's step; with the orchestrator on, the release's `analyst`
    entry first (the Analyst is in the orchestrated floor, decided 2026-11-11)."""
    if state.get("orchestrated"):
        return agent_config(state, ctx, "analyst", Step.ANALYST)
    return ctx.step_of(state["recipe_key"], Step.ANALYST) or {}


ANALYST = ModelStep(
    prompt_code=PROMPT_CODES["analyst"],
    step=Step.ANALYST,
    path="analyst",
    body=body.analyst_body,
    why=lambda s, c: "Builds the evidence map the Writer writes from.",
    inputs=_analyst_inputs,
    summarise=lambda r: evidence_summary(r["evidence"]),
    on_success=_stay,
    on_failure=_stay,
    config=_analyst_config,
    # Kept on the run as findings in orchestrated runs only (model_step.py).
    findings=lambda s, c, r: evidence_findings(r.get("evidence") or {}),
)


# --- 2. Progress agent ---------------------------------------------------------
#
# Runs under the bundle's `progress_reader` step (releases name it) with its
# own prompt, `debrief_progress_system`. AI judges, code vetoes: the vetoes run
# here, straight after the answer, and the Writer reads the vetoed report in
# the old ProgressReading shape (progress.py).


def _progress_agent_done(state: State, ctx: Ctx, res: Dict[str, Any]):
    profile = body.progress_profile(ctx) or {}
    t0 = ctx.clock()
    report, vetoes = apply_vetoes(
        res.get("report") or {}, profile, state.get("evidence") or {}
    )
    if res.get("reasoning"):
        report["reasoning"] = res["reasoning"]
    record = progress.response_record(report, vetoes, profile, res.get("model"))
    reading = progress.writer_reading(report, profile)
    update: Dict[str, Any] = {
        "progress_result": record,
        "progress": reading,
        "history": (
            progress.history_text(profile, body.past_points(ctx)) if reading else None
        ),
        "logs": [
            code_log(
                ctx,
                "progress_vetoes",
                t0,
                input={
                    "proposed": res.get("report") or {},
                    "settings": profile.get("settings") or {},
                },
                output={
                    "vetoes": vetoes,
                    "skills": [
                        {
                            "skill": s.get("skill"),
                            "trend": s.get("trend"),
                            "hiddenFromLearner": s.get("hidden_from_learner"),
                        }
                        for s in report.get("skills") or []
                    ],
                    "shownAs": report.get("shown_as"),
                    "writer": reading,
                },
                attention=bool(vetoes),
            )
        ],
    }
    return update, None


def _progress_agent_summary(res: Dict[str, Any]) -> str:
    skills = (res.get("report") or {}).get("skills") or []
    if not skills:
        return "no skill to read a trend for this time"
    return (
        "; ".join(
            f"{s.get('skill')}: {str(s.get('trend') or '').replace('_', ' ')}"
            for s in skills
        )
        + " (before the vetoes)"
    )


def _progress_agent_inputs(state: State, ctx: Ctx):
    profile = body.progress_profile(ctx) or {}
    return [
        "the evidence map",
        n(len(profile.get("sessions") or []), "earlier session"),
        *(["the Foundational Skills levels"] if profile.get("fhs") else []),
        *(["the last progress report"] if profile.get("last_report") else []),
    ]


PROGRESS_AGENT = ModelStep(
    prompt_code=PROMPT_CODES["progress"],
    step=Step.PROGRESS_READER,
    path="progress-agent",
    body=body.progress_agent_body,
    why=lambda s, c: (
        "Reads how this learner’s skills are changing across their last "
        f"{n(len((body.progress_profile(c) or {}).get('sessions') or []), 'session')}"
        " and this one."
    ),
    inputs=_progress_agent_inputs,
    summarise=_progress_agent_summary,
    on_success=_progress_agent_done,
    # An error handler's update follows no static edge: route the failure on
    # to guidance, or a failed progress agent would end the run unanswered.
    on_failure=lambda s, c: (
        {"rung": int(FallbackRung.SKIP_PROGRESS)},
        "guidance_lookup",
    ),
    destinations=("guidance_lookup",),
)


# --- The orchestrated path's Progress reader (registry agent) --------------------


def _progress_done(state: State, ctx: Ctx, res: Dict[str, Any]):
    reading = res.get("progress") or {}
    if not reading.get("items"):
        return {"progress": None, "history": None}, None
    past = body.past_points(ctx)
    history = "\n".join(f"{p['date']} · {p['skill']}: {p['point']}" for p in past)
    return {"progress": reading, "history": history}, None


PROGRESS_READER = ModelStep(
    prompt_code=PROMPT_CODES["progress_reader"],
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
    prompt_code=PROMPT_CODES["writer"],
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
    prompt_code=PROMPT_CODES["rubric"],
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
    prompt_code=PROMPT_CODES["reviser"],
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
