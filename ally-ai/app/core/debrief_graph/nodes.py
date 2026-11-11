"""The graph's deciding nodes: recipe and budget, the gates in front of each
paid step, guidance, the rule checks, scoring, the decision and the ending.

The model steps themselves are built in `model_steps.py`; every node here
routes with a typed `Command` or follows its static edge.
"""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from langgraph.runtime import Runtime
from langgraph.types import Command

from app.core.debrief_graph import inputs as body
from app.core.debrief_graph.budget import budget_left, estimate_step_cost_usd
from app.core.debrief_graph.constants import (
    DEFAULT_ADVISORY_CHECKS,
    PROMPT_CODES,
    FallbackRung,
    Recipe,
    Status,
    Step,
)
from app.core.debrief_graph.context import DebriefRunContext as Ctx
from app.core.debrief_graph.drafts import (
    better_draft,
    check_weight,
    compute_overall,
    fmt1,
    js_num,
    meets_bar,
    passes_checks,
)
from app.core.debrief_graph.narration import n
from app.core.debrief_graph.records import iso, js_len, progress_event, skipped
from app.core.debrief_graph.registry import (  # noqa: F401 - registers them
    agents as _agents,
)
from app.core.debrief_graph.registry.agents._common import code_record
from app.core.debrief_graph.registry.manifest import (
    REGISTRY,
    agent_config,
    is_orchestrated,
)
from app.core.debrief_graph.result import build_result
from app.core.debrief_graph.state import DebriefState as State

#: ally-be adds this much to every step's input size when reserving.
_PROMPT_ALLOWANCE = 4000
#: Less than this left before the deadline and no revision starts.
_REVISION_MIN_MS = 30_000


def _reserve(
    ctx: Ctx, estimated: float, step: Dict[str, Any], input_chars: int
) -> Optional[float]:
    """Fits the budget? The reservation when it does, None when it does not."""
    est = estimate_step_cost_usd(
        step["step"], step.get("model"), input_chars + _PROMPT_ALLOWANCE, ctx.prices
    )
    return None if estimated + est > ctx.ceiling_usd else est


def _end(status: str, skip_reason: Optional[str], **update: Any) -> Command:
    return Command(
        update={
            **update,
            "rung": int(FallbackRung.PERSON_FINISHES),
            "outcome": {"status": status, "skip_reason": skip_reason},
        },
        goto="finish",
    )


def _emit(runtime: Runtime[Ctx], event: Dict[str, Any]) -> None:
    if runtime.stream_writer:
        runtime.stream_writer(event)


# --- recipe, budget, and the readers ----------------------------------------------


def choose_recipe(ctx: Ctx) -> Dict[str, Any]:
    recipes = ctx.bundle["recipes"]
    if (ctx.sess("learner_turns") or 0) < ctx.setting("standardMinLearnerTurns", 0):
        return recipes[Recipe.SHORT]
    # A release from before Case and Assessment runs Standard.
    key = (
        Recipe.ASSESSMENT
        if ctx.sess("assessment")
        else Recipe.CASE if ctx.sess("in_case") else Recipe.STANDARD
    )
    return recipes.get(key) or recipes[Recipe.STANDARD]


async def plan(
    state: State, runtime: Runtime[Ctx]
) -> Command[Literal["safety_reader", "analyst", "finish"]]:
    ctx = runtime.context
    recipe_key = choose_recipe(ctx)["key"]
    orchestrated = is_orchestrated(ctx)
    base: Dict[str, Any] = {
        "orchestrated": orchestrated,
        "recipe_key": recipe_key,
        "workspace": {"languageSource": ctx.sess("language_source") or "recorded"},
        "estimated": 0.0,
        "round": 0,
        "has_risk_cue": False,
        "learner_distress": False,
    }
    if ctx.ceiling_usd <= 0:
        return _end(Status.NEEDS_PERSON, "monthly_cap", **base)

    safety_step = ctx.step_of(recipe_key, Step.SAFETY_READER)
    analyst_step = ctx.step_of(recipe_key, Step.ANALYST)
    safety_est = _reserve(ctx, 0.0, safety_step, ctx.transcript_chars)
    if safety_est is None:
        return _end(Status.NEEDS_PERSON, "budget_below_minimum", **base)
    estimated = safety_est
    probe = {"recipe_key": recipe_key}
    live = body.live_detections(probe, ctx)
    memory = body.case_memory(probe, ctx)
    workspace = {
        **base["workspace"],
        **({"liveDetections": live} if live else {}),
        **({"caseMemory": memory} if memory else {}),
    }
    reserved = {"safety-reader#0": safety_est}
    goto: List[str] = ["safety_reader"]
    floor: Dict[str, Any] = {}
    if orchestrated:
        # The orchestrated floor (decided 2026-11-11): the Analyst runs beside
        # the safety reader, on the release's model for it, and the planner
        # reads a summary of its evidence map; the case memory it must read
        # is applied first, in code.
        if analyst_step:
            analyst_step = {
                **analyst_step,
                **agent_config(probe, ctx, "analyst", Step.ANALYST),
            }
        if memory:
            floor = floor_data_agent({**base, **probe}, ctx, "case_memory")
    if analyst_step:
        analyst_est = _reserve(ctx, estimated, analyst_step, ctx.transcript_chars)
        if analyst_est is not None:
            estimated += analyst_est
            reserved["analyst#0"] = analyst_est
            goto.append("analyst")
    return Command(
        update={
            **base,
            **floor,
            "workspace": {**workspace, **floor.get("workspace", {})},
            "estimated": estimated,
            "reserved": reserved,
        },
        goto=goto,
    )


def floor_data_agent(state: State, ctx: Ctx, agent: str) -> Dict[str, Any]:
    """A data agent the orchestrated floor applies in code (no model, no
    cost), recorded as the dispatcher records one: its update, answered, a step."""
    m = REGISTRY[agent]
    t0 = ctx.clock()
    applied = m.apply(state, ctx)
    record = code_record(
        ctx, state, agent, t0, why=m.description, inputs=[], output="applied"
    ) | {"why": "In the floor: " + m.description}
    return {**applied, "agent_ok": {agent: True}, "steps": [record]}


async def after_reading(
    state: State, runtime: Runtime[Ctx]
) -> Command[Literal["progress_reader", "guidance_lookup", "profile", "finish"]]:
    ctx = runtime.context
    results = state.get("results") or {}
    safety_res = results.get("safety-reader#0")
    if not safety_res:
        # Without a safety reading nothing may be published: an empty one
        # would read as a safe session.
        return _end(Status.NEEDS_PERSON, "safety_reader_failed")
    safety = {
        "risk_cues": safety_res.get("risk_cues") or [],
        "learner_distress": safety_res.get("learner_distress") or [],
    }
    analyst_step = ctx.step_of(state["recipe_key"], Step.ANALYST)
    analyst_res = results.get("analyst#0")
    evidence = (analyst_res or {}).get("evidence") or {}
    estimated = state.get("estimated", 0.0)
    rung = 0
    steps: List[Dict[str, Any]] = []
    if analyst_step and not analyst_res:
        rung = int(FallbackRung.WRITER_AND_CHECKS_ONLY)
        if "analyst#0" not in (state.get("reserved") or {}):
            steps.append(skipped(ctx, estimated, analyst_step, "budget"))
    update: Dict[str, Any] = {
        "safety": safety,
        "evidence": evidence,
        "has_risk_cue": len(safety["risk_cues"]) > 0,
        "learner_distress": len(safety["learner_distress"]) > 0,
        "workspace": {"safety": safety, "evidence": evidence},
        "progress": None,
        "history": None,
    }
    if state.get("orchestrated"):
        # The safety reading and the evidence map are in: the planner decides
        # what runs next. An agent that requires the Analyst is satisfied by
        # the floor's answer, and never offered without one.
        if analyst_step:
            update["agent_ok"] = {"analyst": bool(analyst_res)}
        return Command(update={**update, "steps": steps, "rung": rung}, goto="profile")

    # 2. Progress reader, when the learner has history.
    progress_step = ctx.step_of(state["recipe_key"], Step.PROGRESS_READER)
    goto = "guidance_lookup"
    if progress_step and ctx.sess("counselor_id") and analyst_res:
        if not body.past_points(ctx):
            steps.append(skipped(ctx, estimated, progress_step, "no history"))
        else:
            est = _reserve(ctx, estimated, progress_step, js_len(evidence))
            if est is None:
                rung = max(rung, int(FallbackRung.SKIP_PROGRESS))
                steps.append(skipped(ctx, estimated, progress_step, "budget"))
            else:
                estimated += est
                update["reserved"] = {"progress-reader#0": est}
                goto = "progress_reader"
    return Command(
        update={**update, "steps": steps, "rung": rung, "estimated": estimated},
        goto=goto,
    )


# --- 3. Guidance -------------------------------------------------------------------


def _top_skill(evidence: Dict[str, Any]) -> Optional[str]:
    """The skill that mattered most names what the lookup is about."""
    ranked = sorted(
        [
            b
            for b in evidence.get("behaviours") or []
            if (b or {}).get("opportunity") is not False
        ],
        key=lambda b: -(b.get("importance") or 0),
    )
    skill = ranked[0].get("skill") if ranked else None
    return skill.strip()[:60] if isinstance(skill, str) and skill.strip() else None


def _passage(p: Dict[str, Any]) -> Dict[str, str]:
    citation = p.get("citation")
    title = p.get("title") or (
        citation.get("title") if isinstance(citation, dict) else citation
    )
    return {"title": str(title or p.get("code") or ""), "text": p.get("text") or ""}


async def guidance_lookup(state: State, runtime: Runtime[Ctx]) -> Dict[str, Any]:
    """Up to N passages per pivotal moment, no learner words in the query."""
    ctx = runtime.context
    update: Dict[str, Any] = {"passages": []}
    guidance_step = (
        agent_config(state, ctx, "guidance_lookup", Step.GUIDANCE_LOOKUP)
        if state.get("orchestrated")
        else ctx.step_of(state["recipe_key"], Step.GUIDANCE_LOOKUP)
    )
    per_moment = ctx.setting("guidancePassagesPerMoment", 0)
    if guidance_step and per_moment > 0:
        evidence = state.get("evidence") or {}
        moments = (evidence.get("pivotal_moments") or [])[:3]
        t0 = ctx.clock()
        topic = _top_skill(evidence)
        _emit(
            runtime,
            progress_event(
                Step.GUIDANCE_LOOKUP,
                state.get("has_risk_cue"),
                topic=topic,
                label_key=guidance_step.get("labelKey"),
            ),
        )
        seen: List[str] = []
        passages: List[Dict[str, str]] = []
        lookups = 0
        stopped: Optional[str] = None
        for m in moments:
            if not (m or {}).get("summary"):
                continue
            if ctx.time_left_ms(state.get("has_risk_cue", False)) < (
                ctx.setting("deadlineMs", 150_000) / 2
            ):
                update["rung"] = int(FallbackRung.ONE_GUIDANCE_LOOKUP)
                stopped = "Stopped early to keep time for writing."
                break
            lookups += 1
            try:
                found = await ctx.gateway.call(
                    "guidance_search",
                    {"topics": [{"situation": m["summary"]}], "per_moment": per_moment},
                )
            except Exception:  # noqa: BLE001 - guidance never stops a debrief
                found = {"unavailable": True, "passages": []}
            # "No confident match" is nothing, not a weak passage to lean on.
            for p in (
                [] if found.get("no_confident_match") else found.get("passages") or []
            ):
                pid = str(p.get("id"))
                if pid in seen:
                    continue
                seen.append(pid)
                passages.append(_passage(p))
            if found.get("unavailable"):
                stopped = "Guidance could not be reached; writing without it."
                break
        reasoning = " ".join(
            s
            for s in [
                f"Led by the skill that mattered most: {topic}." if topic else None,
                (
                    "Nothing matched confidently, so the Writer gets no guidance "
                    "rather than a weak match."
                    if lookups and not passages
                    else None
                ),
                stopped,
            ]
            if s
        )
        kept = ": " + "; ".join(p["title"] for p in passages[:3]) if passages else ""
        update["steps"] = [
            {
                "step": Step.GUIDANCE_LOOKUP,
                "label": guidance_step.get("label", ""),
                "status": "done",
                "startedAt": iso(t0),
                "ms": round(ctx.clock() - t0),
                "note": f"{lookups} lookup(s), {len(passages)} passage(s)",
                "why": (
                    "Looks up practice guidance for the session’s "
                    f"{n(min(len(moments), 3), 'pivotal moment')}."
                    if moments
                    else "No pivotal moments to look guidance up for."
                ),
                "inputs": [
                    "each moment’s summary in the Analyst’s words (never the learner’s)"
                ],
                "reasoning": reasoning or None,
                "output": (
                    f"{n(lookups, 'lookup')}, {n(len(passages), 'passage')} kept{kept}"
                ),
                "budgetLeftUsd": budget_left(
                    ctx.ceiling_usd, state.get("estimated", 0.0)
                ),
            }
        ]
        update["passages"] = passages
        update["workspace"] = {"passages": seen}
    if state.get("progress"):
        update["workspace"] = {
            **update.get("workspace", {}),
            "progress": state["progress"],
            "history": state.get("history"),
        }
    return update


# --- 4. Writer ---------------------------------------------------------------------


async def prepare_writer(
    state: State, runtime: Runtime[Ctx]
) -> Command[Literal["writer", "finish"]]:
    ctx = runtime.context
    cohort = body.cohort(ctx)
    workspace = {"cohort": cohort} if cohort else {}
    writer_step = ctx.step_of(state["recipe_key"], Step.WRITER)
    estimated = state.get("estimated", 0.0)
    est = _reserve(ctx, estimated, writer_step, js_len(body.writer_body(state, ctx)))
    if est is None:
        return _end(Status.NEEDS_PERSON, "budget_below_minimum", workspace=workspace)
    return Command(
        update={
            "workspace": workspace,
            "estimated": estimated + est,
            "reserved": {"writer#0": est},
        },
        goto="writer",
    )


# --- 5. Checks → evaluate ⇄ revise ---------------------------------------------------


def _failure(f: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "code": f.get("code"),
        "section": f.get("section") or "",
        "detail": f.get("detail") or f.get("message") or "",
    }


async def checks(
    state: State, runtime: Runtime[Ctx]
) -> Command[Literal["evaluator", "score_draft"]]:
    """The rule checks on the draft, then the Evaluator's reservation."""
    ctx = runtime.context
    cur = state["current"]
    rnd = cur["round"]
    recipe = body.recipe(state, ctx)
    estimated = state.get("estimated", 0.0)
    t0 = ctx.clock()
    answer = await ctx.gateway.call(
        "run_checks",
        {
            "cards": cur["cards"],
            "safety": state["safety"],
            "language": ctx.language,
            "short_form": bool(recipe.get("shortForm")),
            "has_progress": bool(state.get("progress")),
        },
    )
    fails = [_failure(f) for f in answer.get("failures") or []]
    advisory = set(answer.get("advisory") or DEFAULT_ADVISORY_CHECKS)
    weight = answer.get("weight")
    if not isinstance(weight, (int, float)):
        weight = check_weight(fails, advisory)
    checks_step = ctx.step_of(state["recipe_key"], Step.CHECKS) or {}
    steps = [
        {
            "step": Step.CHECKS,
            "label": checks_step.get("label", ""),
            "status": "done",
            "startedAt": iso(t0),
            "ms": round(ctx.clock() - t0),
            "round": rnd,
            "note": ", ".join(f["code"] for f in fails) if fails else "all passed",
            "why": (
                "The rule checks run on every draft: quotes, risk cues, length, "
                "language, no scores."
            ),
            "reasoning": (
                " · ".join(f"{f['section']}: {f['detail']}" for f in fails[:6])
                if fails
                else None
            ),
            "output": (
                f"{n(len(fails), 'check')} failed"
                + (
                    " (advisory only; still publishable)"
                    if all(f["code"] in advisory for f in fails)
                    else ""
                )
                if fails
                else "every check passed"
            ),
            "budgetLeftUsd": budget_left(ctx.ceiling_usd, estimated),
        }
    ]
    current = {**cur, "checks": fails, "weight": weight, "evaluation": None}
    update: Dict[str, Any] = {"advisory": sorted(advisory)}

    debrief = (await ctx.gateway.call("render_cards", {"cards": cur["cards"]}))["text"]
    rubric = ctx.prompt(PROMPT_CODES["rubric"])
    evaluator_step = ctx.step_of(state["recipe_key"], Step.EVALUATOR)
    est = _reserve(
        ctx,
        estimated,
        evaluator_step,
        ctx.transcript_chars + len(debrief) + len(rubric or ""),
    )
    if est is None:
        steps.append(skipped(ctx, estimated, evaluator_step, "budget"))
        return Command(
            update={**update, "steps": steps, "current": current}, goto="score_draft"
        )
    return Command(
        update={
            **update,
            "steps": steps,
            "current": {**current, "debrief": debrief},
            "estimated": estimated + est,
            "reserved": {f"evaluator#{rnd}": est},
        },
        goto="evaluator",
    )


def _max_rounds(state: State, ctx: Ctx) -> int:
    has_reviser = ctx.step_of(state["recipe_key"], Step.REVISER) is not None
    return (
        int(body.recipe(state, ctx).get("maxRevisionRounds") or 0) if has_reviser else 0
    )


async def score_draft(
    state: State, runtime: Runtime[Ctx]
) -> Command[Literal["revise_gate", "top_up", "decide"]]:
    ctx = runtime.context
    cur = state["current"]
    rnd = cur["round"]
    advisory = set(state.get("advisory") or [])
    res = (state.get("results") or {}).get(f"evaluator#{rnd}")
    evaluation = None
    if res:
        ev = res["evaluation"]
        evaluation = {
            "overall": compute_overall(
                {d["dimension"]: d["score"] for d in ev["dimensions"]},
                len(ev["hard_fails"]),
            ),
            "hardFails": ev["hard_fails"],
            "fixes": ev.get("fixes") or [],
            "dimensions": ev["dimensions"],
        }
    draft = {
        "cards": cur["cards"],
        "checks": cur["checks"],
        "weight": cur["weight"],
        "evaluation": evaluation,
        "round": rnd,
    }
    best = better_draft(state.get("best"), draft, advisory)
    record = {
        "round": rnd,
        "overall": evaluation["overall"] if evaluation else None,
        "hardFails": [h["code"] for h in evaluation["hardFails"]] if evaluation else [],
        "checks": [c["code"] for c in draft["checks"]],
    }
    again = not meets_bar(best, advisory, ctx.setting("passScore", 8)) and state.get(
        "round", 0
    ) < _max_rounds(state, ctx)
    goto = "revise_gate" if again else "decide"
    if (
        again
        and evaluation is not None
        and state.get("orchestrated")
        and not state.get("top_up_used")
    ):
        # D3: the first failed evaluation gets one evidence top-up first.
        goto = "top_up"
    return Command(
        update={"current": draft, "best": best, "evaluations": [record]},
        goto=goto,
    )


async def revise_gate(
    state: State, runtime: Runtime[Ctx]
) -> Command[Literal["reviser", "decide"]]:
    ctx = runtime.context
    rnd = state.get("round", 0)
    estimated = state.get("estimated", 0.0)
    reviser_step = ctx.step_of(state["recipe_key"], Step.REVISER)
    rung = int(
        FallbackRung.SKIP_FIRST_REVISION
        if rnd == 0
        else FallbackRung.SKIP_SECOND_REVISION
    )
    if ctx.time_left_ms(state.get("has_risk_cue", False)) < _REVISION_MIN_MS:
        return Command(
            update={
                "rung": rung,
                "steps": [skipped(ctx, estimated, reviser_step, "deadline")],
            },
            goto="decide",
        )
    est = _reserve(ctx, estimated, reviser_step, js_len(body.reviser_body(state, ctx)))
    if est is None:
        return Command(
            update={
                "rung": rung,
                "steps": [skipped(ctx, estimated, reviser_step, "budget")],
            },
            goto="decide",
        )
    return Command(
        update={
            "round": rnd + 1,
            "estimated": estimated + est,
            "reserved": {f"reviser#{rnd + 1}": est},
        },
        goto="reviser",
    )


# --- the decision and the ending --------------------------------------------------


async def decide(state: State, runtime: Runtime[Ctx]) -> Dict[str, Any]:
    ctx = runtime.context
    best = state["best"]
    advisory = set(state.get("advisory") or [])
    pass_score = ctx.setting("passScore", 8)
    rnd = state.get("round", 0)
    ev = best.get("evaluation")
    offered = [
        o.get("id") for o in body.practice_options(ctx) if o.get("id") is not None
    ]
    final = await ctx.gateway.call(
        "finalise_cards", {"cards": best["cards"], "offered": offered}
    )
    patch = {
        "cards": final["cards"],
        "revision_rounds": rnd,
        "check_failures": best["checks"],
        "evaluator_overall": (
            round(ev["overall"], 2) if ev and ev["overall"] is not None else None
        ),
        "evaluator_hard_fails": (ev or {}).get("hardFails") or [],
    }
    scored = (
        f"scored {fmt1(ev['overall'])}"
        if ev and ev["overall"] is not None
        else "was not scored"
    )
    blocking = [c["code"] for c in best["checks"] if c["code"] not in advisory]
    rung = 0
    skip_reason = None
    if meets_bar(best, advisory, pass_score):
        status = Status.PUBLISHED
        why = (
            f"Published round {best['round']}: it passed every check and {scored} "
            f"with no hard fail (the bar is {js_num(pass_score)})."
        )
    elif (
        passes_checks(best, advisory)
        and ev
        and not any(h["code"] == "missed_risk_cue" for h in ev["hardFails"])
    ):
        status = Status.BELOW_BAR
        why = (
            f"Published round {best['round']} below the bar and sent it to review: "
            f"it passed every check but {scored}"
            + (
                " with " + ", ".join(h["code"] for h in ev["hardFails"])
                if ev["hardFails"]
                else ""
            )
            + (
                ", and no revision rounds were left."
                if rnd >= _max_rounds(state, ctx)
                else ", and there was no budget or time for another revision."
            )
        )
    else:
        status = Status.NEEDS_PERSON
        rung = int(FallbackRung.PERSON_FINISHES)
        if passes_checks(best, advisory):
            skip_reason = "not_evaluated_or_risk"
            why = (
                "Held for a person: the Evaluator found a missed risk cue, which is "
                "never published automatically."
                if ev
                else "Held for a person: no draft could be scored, so nothing was "
                "published automatically."
            )
        else:
            skip_reason = "checks_failed"
            why = (
                f"Held for a person: the best draft still failed {', '.join(blocking)}."
            )
    return {
        "workspace": {
            "evaluations": state.get("evaluations") or [],
            "bestRound": best["round"],
            "drafts": state.get("drafts") or [],
            "decision": {"status": status, "round": best["round"], "why": why},
        },
        "patch": patch,
        "rung": rung,
        "outcome": {"status": status, "skip_reason": skip_reason},
    }


async def finish(state: State, runtime: Runtime[Ctx]) -> Dict[str, Any]:
    return {"result": build_result(state, runtime.context)}
