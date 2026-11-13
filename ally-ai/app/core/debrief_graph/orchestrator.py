"""The orchestrated middle of the debrief (spec A1, A5, D2, D3), used only when
the release's challenger flag (`bundle.orchestrator.enabled`) is on.

    safety_reader ┐
    analyst ──────┴→ after_reading ─(orchestrated)→ profile ─→ planner ─→ dispatch
                                    └(no planner / no budget)→ dispatch
    dispatch ─Send→ agent_<id> … ─→ dispatch          (one wave per `requires` level)
    dispatch ─(plan done)→ prepare_writer → writer → checks → evaluator → score_draft
    score_draft ─(first failed evaluation)→ top_up ─→ planner ─→ dispatch ─→ revise_gate
                     └(nothing to add / no time / no budget)→ revise_gate

The floor stays in code: the safety reader runs first and nothing is published
without it; the Analyst runs beside it for every session long enough to map
(decided 2026-11-11: the Writer writes from its evidence map and five agents
require it), with the case memory it reads; the Writer, the checks, the
Evaluator and the revision loop are today's nodes. The planner reads the
session profile and a summary of the evidence map (never the transcript) and
only chooses analysis agents, once, plus at most one top-up. Code reserves
every chosen agent's cost before it runs (after holding back the floor's own
budget) and drops what does not fit, recording why on the Plan record. A
planner that fails or takes longer than PLANNER_TIMEOUT_S gives way to the
default plan for the session type: today's recipe, read from the release.
"""

from __future__ import annotations

import math
from typing import Any, Dict, List, Literal, Optional

from langgraph.errors import NodeError
from langgraph.runtime import Runtime
from langgraph.types import Command, Send

from app.core.debrief_graph import inputs as body
from app.core.debrief_graph.agent_logs import code_log
from app.core.debrief_graph.budget import budget_left, estimate_step_cost_usd
from app.core.debrief_graph.constants import FallbackRung, Recipe, Step
from app.core.debrief_graph.context import DebriefRunContext as Ctx
from app.core.debrief_graph.findings import count as count_findings
from app.core.debrief_graph.gateway import GATEWAY_RETRY
from app.core.debrief_graph.model_step import ModelStep
from app.core.debrief_graph.narration import n
from app.core.debrief_graph.records import iso, js_len
from app.core.debrief_graph.registry import (  # noqa: F401 - registers them
    agents as _agents,
)
from app.core.debrief_graph.registry.agents._common import code_record
from app.core.debrief_graph.registry.manifest import (
    REGISTRY,
    AgentManifest,
    enabled,
    orchestrator,
    refusal,
)
from app.core.debrief_graph.registry.profile import build_profile, evidence_summary
from app.core.debrief_graph.state import DebriefState as State

PLANNER_PROMPT = "debrief_planner_system"
#: A planner slower than this gives way to the default plan. Spec A5 said
#: 8 s; measured 2026-11-11 on the synthetic planner cases with the evidence
#: summary in the input, gemini-2.5-flash took p50 10.8 s, p90 17.8 s, max
#: 17.9 s (n=18): at 8 s nearly every plan would fall back. 20 s keeps the
#: fallback for a planner that is really stuck. Watch the planner's time and
#: fallback rate on the Console (Each agent → Planner).
PLANNER_TIMEOUT_S = 20.0
#: At most this many agents per plan unless the release says otherwise.
DEFAULT_MAX_AGENTS = 6
#: Time held back for the floor (Writer, checks, Evaluator) before any agent.
FLOOR_MS = 60_000
#: Same allowance the recipe's reservations add to every input.
_PROMPT_ALLOWANCE = 4000
#: Less than this left before the deadline and no revision starts (nodes.py).
_REVISION_MIN_MS = 30_000

#: The data agent each recipe's own part became (spec A9).
_RECIPE_DATA_AGENTS = {
    Recipe.CASE: ["case_memory"],
    Recipe.ASSESSMENT: ["assessment_anchoring"],
}

_DROP_BUDGET = (
    "Not enough of the run budget was left for it once the writing, checks and "
    "evaluation were paid for."
)
_DROP_TIME = "Too little time was left before the deadline."


def _drop(agent: str, code: str, why: str) -> Dict[str, str]:
    """A dropped agent on the Plan record: `code` is what the metrics count
    (already_ran · refused · unavailable · requires · limit · no_price ·
    budget · time), `why` what a person reads."""
    return {"agent": agent, "code": code, "why": why}


# --- the default plan and the floor's reservation -------------------------------


def default_plan(state: State, ctx: Ctx) -> List[str]:
    """Today's recipe, kept as data: the release's recipe for this session type,
    its analysis steps as registry agents, plus the agent its own part became.
    The floor's agents already ran and are left out."""
    recipe = ctx.recipe(state["recipe_key"])
    steps = [s.get("step") for s in recipe.get("steps") or []]
    return [
        a
        for a in _RECIPE_DATA_AGENTS.get(recipe["key"], [])
        + [s for s in steps if s in REGISTRY]
        if not REGISTRY[a].floor
    ]


def _est(step: str, model: Optional[str], chars: int, ctx: Ctx) -> float:
    return estimate_step_cost_usd(step, model, chars + _PROMPT_ALLOWANCE, ctx.prices)


def floor_reserve(state: State, ctx: Ctx, phase: str) -> float:
    """What the floor will cost from here: the Writer, the Evaluator and one
    revision before a plan; one revision and its evaluation before a top-up.
    Reserved first, so no agent can starve the writing (spec A5)."""
    chars = ctx.transcript_chars
    parts = (
        [(Step.WRITER, 2 * chars), (Step.EVALUATOR, 2 * chars), (Step.REVISER, chars)]
        if phase == "plan"
        else [(Step.REVISER, chars), (Step.EVALUATOR, 2 * chars)]
    )
    total = 0.0
    for step, size in parts:
        cfg = ctx.step_of(state["recipe_key"], step)
        if cfg:
            est = _est(step, cfg.get("model"), size, ctx)
            # An unpriced floor step never runs; it holds nothing back.
            total += 0.0 if math.isinf(est) else est
    return total


def agent_estimate(m: AgentManifest, state: State, ctx: Ctx) -> float:
    if m.step is None:
        return 0.0
    model = m.step.step_config(state, ctx).get("model")
    chars = ctx.transcript_chars if "session" in m.reads else 0
    return _est(m.id, model, chars + 2000, ctx)


def offered_agents(
    profile: Dict[str, Any], ctx: Ctx, answered: Optional[Dict[str, bool]] = None
) -> List[str]:
    """Enabled by the release, available for this session, not in the floor,
    and with every floor agent it requires answered (FR-10); nothing else is
    ever shown to the planner."""
    answered = answered or {}
    out = []
    for m in enabled(ctx):
        if m.floor or any(
            REGISTRY[r].floor and not answered.get(r) for r in m.requires
        ):
            continue
        try:
            if m.available(profile):
                out.append(m.id)
        except Exception:  # noqa: BLE001 - an availability check never fails a run
            continue
    return out


def max_agents(ctx: Ctx) -> int:
    value = orchestrator(ctx).get("maxAgentsPerPlan")
    return int(value) if isinstance(value, int) and value > 0 else DEFAULT_MAX_AGENTS


# --- the plan: validate, order, reserve, record ------------------------------------


def _ordered(ids: List[str]) -> List[str]:
    """Every agent after the agents it requires, otherwise in plan order."""
    out: List[str] = []
    pending = list(ids)
    while pending:
        progressed = False
        for a in list(pending):
            if all(r in out or r not in ids for r in REGISTRY[a].requires):
                out.append(a)
                pending.remove(a)
                progressed = True
        if not progressed:  # pragma: no cover - requires are registered acyclic
            out += pending
            break
    return out


def finalise_plan(
    state: State,
    ctx: Ctx,
    *,
    proposed: List[Dict[str, Any]],
    considered: List[Dict[str, Any]],
    source: str,
    fallback: Optional[str] = None,
    fallback_code: Optional[str] = None,
    reasoning: Optional[str] = None,
    model: Optional[str] = None,
) -> Dict[str, Any]:
    """The plan as code accepts it: refused, unavailable and duplicate agents
    out, `requires` enforced (FR-10), at most N agents, each reserved against
    the budget left after the floor and checked against the time left; the
    Plan record says what was chosen, considered and dropped, and why."""
    phase = state.get("phase") or "plan"
    offered = list(state.get("offered") or [])
    ran = dict(state.get("agent_ok") or {})
    already = set(ran) | set(state.get("actions") or {})
    dropped: List[Dict[str, str]] = []
    picked: List[Dict[str, Any]] = []
    seen = set()
    for a in proposed:
        agent = str(a.get("agent") or "")
        if not agent or agent in seen:
            continue
        seen.add(agent)
        if agent in already:
            dropped.append(
                _drop(agent, "already_ran", "It already ran in this debrief.")
            )
            continue
        refused = refusal(ctx, agent)
        if refused:
            dropped.append(_drop(agent, "refused", refused))
        elif agent not in offered:
            dropped.append(
                _drop(agent, "unavailable", "Not available for this session.")
            )
        else:
            picked.append(a)

    # FR-10: an agent whose requirement is neither in the plan nor already
    # answered cannot run.
    changed = True
    while changed:
        changed = False
        ids = {p["agent"] for p in picked}
        for p in list(picked):
            missing = [
                r
                for r in REGISTRY[p["agent"]].requires
                if r not in ids and not ran.get(r)
            ]
            if missing:
                picked.remove(p)
                dropped.append(
                    _drop(
                        p["agent"],
                        "requires",
                        f"Needs {', '.join(missing)}, which is not in the plan.",
                    )
                )
                changed = True

    limit = max_agents(ctx)
    for p in picked[limit:]:
        dropped.append(
            _drop(p["agent"], "limit", f"The plan already has {limit} agents.")
        )
    picked = picked[:limit]
    by_id = {p["agent"]: p for p in picked}

    estimated = state.get("estimated", 0.0)
    available = ctx.ceiling_usd - estimated - (state.get("floor_reserve") or 0.0)
    time_left = ctx.time_left_ms(state.get("has_risk_cue", False)) - FLOOR_MS
    chain: Dict[str, int] = {}
    reserved: Dict[str, float] = {}
    chosen: List[Dict[str, Any]] = []
    gone: set = set()
    rung = 0
    for agent in _ordered(list(by_id)):
        m = REGISTRY[agent]
        lost = [r for r in m.requires if r in gone]
        latency = m.latency_estimate_ms + max(
            (chain.get(r, 0) for r in m.requires), default=0
        )
        est = agent_estimate(m, state, ctx)
        why_dropped = None
        if lost:
            why_dropped = _drop(
                agent, "requires", f"Needs {', '.join(lost)}, which was dropped."
            )
        elif math.isinf(est):
            why_dropped = _drop(
                agent, "no_price", "Its model has no known price, so it never runs."
            )
        elif est > available:
            why_dropped = _drop(agent, "budget", _DROP_BUDGET)
        elif latency > time_left:
            why_dropped = _drop(agent, "time", _DROP_TIME)
        if why_dropped:
            gone.add(agent)
            dropped.append(why_dropped)
            if agent == "analyst":
                rung = int(FallbackRung.WRITER_AND_CHECKS_ONLY)
            continue
        chain[agent] = latency
        available -= est
        estimated += est
        if m.step is not None:
            reserved[m.step.key(state)] = est
        p = by_id[agent]
        chosen.append(
            {
                "agent": agent,
                "inputs": {"focus_turns": list(p.get("focus_turns") or [])},
                "why": str(p.get("why") or "")[:300],
                "estimatedUsd": round(est, 4),
            }
        )

    chosen_ids = [c["agent"] for c in chosen]
    mentioned = {c["agent"] for c in chosen} | {d["agent"] for d in dropped}
    not_chosen = [
        {"agent": c.get("agent"), "whyNot": str(c.get("why_not") or "")[:300]}
        for c in considered
        if c.get("agent") in offered and c.get("agent") not in mentioned
    ]
    mentioned |= {c["agent"] for c in not_chosen}
    candidates = [a for a in offered if a not in ran or phase == "plan"]
    not_chosen += [
        {"agent": a, "whyNot": "Not chosen."} for a in candidates if a not in mentioned
    ]
    plan = {
        "phase": phase,
        "source": source,
        "fallback": fallback,
        # What the metrics count: planner_failed (failed or timed out; the
        # planner's step record says which) · no_agents · no_model · no_price
        # · no_budget · nothing_left · no_time; None when the planner planned.
        "fallbackCode": fallback_code,
        "model": model,
        "profile": state.get("profile") if phase == "plan" else None,
        "evidenceSummary": (
            evidence_summary(state.get("evidence") or {}) if phase == "plan" else None
        ),
        "chosen": chosen,
        "considered": not_chosen,
        "dropped": dropped,
        "estimatedUsd": round(sum(c["estimatedUsd"] for c in chosen), 4),
    }
    record = {
        "step": "plan",
        "label": "Planning your debrief…",
        "status": "done",
        "startedAt": iso(ctx.clock()),
        "ms": 0,
        **({"round": 1} if phase == "top_up" else {}),
        "note": (
            f"default plan: {fallback}"
            if source == "default"
            else (fallback or ("top-up" if phase == "top_up" else "planned"))
        ),
        "why": (
            "The first draft fell below the bar: one chance to add evidence "
            "before it is revised."
            if phase == "top_up"
            else "Chooses which analysis agents run for this session."
        ),
        "inputs": (
            [
                "the session profile",
                "the evidence map's summary",
                n(len(offered), "available agent"),
            ]
            + (["the Evaluator's critique"] if phase == "top_up" else [])
        ),
        "reasoning": reasoning,
        "output": (
            ("Chose " + ", ".join(chosen_ids) if chosen_ids else "Chose no agent")
            + f"; {n(len(not_chosen), 'agent')} not chosen"
            + (f", {len(dropped)} dropped" if dropped else "")
        ),
        "budgetLeftUsd": budget_left(ctx.ceiling_usd, estimated),
        "plan": plan,
    }
    return {
        "steps": [record],
        "plans": [plan],
        "workspace": {"plans": list(state.get("plans") or []) + [plan]},
        "pending": chosen_ids,
        "actions": {
            c["agent"]: {"agent": c["agent"], "inputs": c["inputs"], "why": c["why"]}
            for c in chosen
        },
        "reserved": reserved,
        "estimated": estimated,
        "rung": rung,
        **({"top_up_agents": chosen_ids} if phase == "top_up" else {}),
    }


# --- profile → planner ---------------------------------------------------------


def planner_config(state: State, ctx: Ctx) -> Dict[str, Any]:
    o = orchestrator(ctx)
    return {
        "model": o.get("plannerModel"),
        "backupModel": o.get("plannerBackupModel"),
        "label": "Planning your debrief…",
        "labelKey": "debrief.progress.planner",
    }


def _candidates(state: State) -> List[str]:
    ran = state.get("agent_ok") or {}
    return [
        a
        for a in state.get("offered") or []
        if state.get("phase") != "top_up" or a not in ran
    ]


def planner_body(state: State, ctx: Ctx) -> Dict[str, Any]:
    top_up = state.get("phase") == "top_up"
    return {
        "profile": state.get("profile") or {},
        # The Analyst's words, never the transcript (decided 2026-11-11).
        "evidence_summary": evidence_summary(state.get("evidence") or {}),
        "agents": [REGISTRY[a].card() for a in _candidates(state)],
        "max_agents": max_agents(ctx),
        "system_prompt": ctx.prompt(PLANNER_PROMPT),
        **(
            {
                "critique": body.critique(state["best"]),
                "already": sorted(state.get("agent_ok") or {}),
            }
            if top_up
            else {}
        ),
    }


def _planned(state: State, ctx: Ctx, res: Dict[str, Any]):
    plan = res.get("plan") or {}
    update = finalise_plan(
        state,
        ctx,
        proposed=plan.get("actions") or [],
        considered=plan.get("considered") or [],
        source="planner",
        reasoning=(res.get("reasoning") or None),
        model=res.get("model"),
    )
    return update, "dispatch"


def _plan_failed(state: State, ctx: Ctx):
    if state.get("phase") == "top_up":
        update = finalise_plan(
            state,
            ctx,
            proposed=[],
            considered=[],
            source="none",
            fallback="Planning the top-up failed; revising without more evidence.",
            fallback_code="planner_failed",
        )
        return update, "revise_gate"
    update = finalise_plan(
        state,
        ctx,
        proposed=[
            {"agent": a, "why": "Today's recipe."} for a in default_plan(state, ctx)
        ],
        considered=[],
        source="default",
        fallback=f"the planner failed or took longer than {PLANNER_TIMEOUT_S:g} s",
        fallback_code="planner_failed",
    )
    return update, "dispatch"


PLANNER = ModelStep(
    step="planner",
    path="planner",
    body=planner_body,
    why=lambda s, c: (
        "Chooses agents that could fix what the Evaluator found."
        if s.get("phase") == "top_up"
        else "Chooses the analysis this session needs from the session profile."
    ),
    inputs=lambda s, c: [
        "the session profile (never the transcript)",
        "the evidence map's summary (no quotes)",
        n(len(_candidates(s)), "available agent"),
        *(["the Evaluator's critique"] if s.get("phase") == "top_up" else []),
    ],
    summarise=lambda r: (
        "chose "
        + (
            ", ".join(
                a.get("agent", "?") for a in (r.get("plan") or {}).get("actions") or []
            )
            or "no agent"
        )
    ),
    on_success=_planned,
    on_failure=_plan_failed,
    round_of=lambda s: 1 if s.get("phase") == "top_up" else None,
    destinations=("dispatch", "revise_gate"),
    config=planner_config,
    max_attempts=1,
    timeout_s=PLANNER_TIMEOUT_S,
    prompt_code=PLANNER_PROMPT,
)


def _planner_estimate(state: State, ctx: Ctx) -> float:
    return _est(
        "planner",
        planner_config(state, ctx).get("model"),
        js_len(planner_body(state, ctx)),
        ctx,
    )


async def profile(
    state: State, runtime: Runtime[Ctx]
) -> Command[Literal["planner", "dispatch"]]:
    """Cheap facts in code, the floor's budget held back, then the planner —
    or straight to the default plan when it cannot run."""
    ctx = runtime.context
    t0 = ctx.clock()
    prof = build_profile(state, ctx)
    offered = offered_agents(prof, ctx, state.get("agent_ok") or {})
    floor = floor_reserve(state, ctx, "plan")
    base = {
        "profile": prof,
        "offered": offered,
        "floor_reserve": floor,
        "phase": "plan",
        "workspace": {"profile": prof},
    }
    now = {**state, **base}
    estimated = state.get("estimated", 0.0)
    model = planner_config(now, ctx).get("model")
    est = _planner_estimate(now, ctx) if model else math.inf
    reason = code = None
    if not offered:
        code, reason = (
            "no_agents",
            "no agent in this release is available for this session",
        )
    elif not model:
        code, reason = "no_model", "the release names no planner model"
    elif math.isinf(est):
        code, reason = "no_price", "the planner's model has no known price"
    elif estimated + floor + est > ctx.ceiling_usd:
        code, reason = "no_budget", "not enough of the run budget was left to plan"

    def log(nxt: str, plan: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        return code_log(
            ctx,
            "profile",
            t0,
            input={
                "answered": dict(state.get("agent_ok") or {}),
                "budgetLeftUsd": budget_left(ctx.ceiling_usd, estimated),
                "timeLeftMs": round(ctx.time_left_ms(state.get("has_risk_cue", False))),
            },
            output={
                "profile": prof,
                "offered": offered,
                "floorReserveUsd": round(floor, 6),
                "plannerModel": model,
                "plannerEstimateUsd": None if math.isinf(est) else round(est, 6),
                "next": nxt,
                **(
                    {"fallback": reason, "fallbackCode": code, "plan": plan}
                    if reason
                    else {}
                ),
            },
            attention=bool(reason),
        )

    if reason:
        update = finalise_plan(
            now,
            ctx,
            proposed=[
                {"agent": a, "why": "Today's recipe."} for a in default_plan(now, ctx)
            ],
            considered=[],
            source="default",
            fallback=reason,
            fallback_code=code,
        )
        return Command(
            update={
                **base,
                **update,
                "workspace": {**base["workspace"], **update["workspace"]},
                "logs": [log("dispatch", update["plans"][0])],
            },
            goto="dispatch",
        )
    return Command(
        update={
            **base,
            "estimated": estimated + est,
            "reserved": {"planner#0": est},
            "logs": [log("planner")],
        },
        goto="planner",
    )


# --- dispatch: Send the ready agents, wave by wave ----------------------------------


async def dispatch(state: State, runtime: Runtime[Ctx]) -> Command:
    """The join and the fan-out: data agents applied in place, then every chosen
    agent whose requirements answered is sent in parallel (LangGraph `Send`);
    they all come back here. With nothing left, on to the Writer (or, after a
    top-up, to the revision gate)."""
    ctx = runtime.context
    t0 = ctx.clock()
    ok_map = dict(state.get("agent_ok") or {})
    steps: List[Dict[str, Any]] = []
    logs: List[Dict[str, Any]] = []
    applied_now: List[str] = []
    skipped_now: List[Dict[str, Any]] = []
    update: Dict[str, Any] = {"agent_ok": {}}
    payload: Dict[str, Any] = dict(state)
    remaining: List[str] = []
    for agent in state.get("pending") or []:
        m = REGISTRY[agent]
        if m.apply is None:
            remaining.append(agent)
            continue
        t0 = ctx.clock()
        applied = m.apply(payload, ctx)
        for k, v in applied.items():
            if k == "data_agents":
                payload[k] = list(payload.get(k) or []) + v
                update[k] = list(update.get(k) or []) + v
            elif k == "workspace":
                update["workspace"] = {**update.get("workspace", {}), **v}
            else:
                payload[k] = update[k] = v
        ok_map[agent] = True
        update["agent_ok"][agent] = True
        applied_now.append(agent)
        logs.append(
            code_log(
                ctx,
                agent,
                t0 + 0.1 * len(applied_now),
                input={
                    "kind": "data agent",
                    "action": (state.get("actions") or {}).get(agent),
                },
                output=applied,
            )
        )
        steps.append(
            code_record(
                ctx, state, agent, t0, why=m.description, inputs=[], output="applied"
            )
        )
    ready: List[str] = []
    wait: List[str] = []
    for agent in remaining:
        reqs = REGISTRY[agent].requires
        if all(ok_map.get(r) for r in reqs):
            ready.append(agent)
        elif any(r in ok_map and not ok_map[r] for r in reqs):
            failed = [r for r in reqs if r in ok_map and not ok_map[r]]
            update["agent_ok"][agent] = False
            skipped_now.append({"agent": agent, "needs": failed})
            steps.append(
                code_record(
                    ctx,
                    state,
                    agent,
                    ctx.clock(),
                    why=REGISTRY[agent].description,
                    inputs=[],
                    output="not run",
                    note=f"needs {', '.join(failed)}",
                    status="skipped",
                )
                | {
                    "why": (
                        f"Skipped: it needs {', '.join(failed)}, "
                        "which gave no answer."
                    )
                }
            )
        else:
            wait.append(agent)
    update["steps"] = steps
    plans = state.get("plans") or []
    latest = plans[-1] if plans else None
    first_wave = bool(latest) and list(state.get("pending") or []) == [
        c["agent"] for c in latest.get("chosen") or []
    ]

    def dispatch_log(nxt: Any) -> Dict[str, Any]:
        return code_log(
            ctx,
            "dispatch",
            t0,
            input={
                "phase": state.get("phase") or "plan",
                "pending": list(state.get("pending") or []),
                "answered": dict(state.get("agent_ok") or {}),
                **(
                    {
                        "plan": {
                            "source": latest.get("source"),
                            "fallback": latest.get("fallback"),
                            "chosen": latest.get("chosen"),
                            "dropped": latest.get("dropped"),
                            "estimatedUsd": latest.get("estimatedUsd"),
                        }
                    }
                    if first_wave
                    else {}
                ),
            },
            output={
                "applied": applied_now,
                "sent": ready,
                "waiting": wait,
                "skipped": skipped_now,
                "next": nxt,
            },
            attention=bool(skipped_now)
            or bool(first_wave and (latest.get("dropped") or [])),
        )

    if ready:
        update["pending"] = wait
        update["logs"] = [dispatch_log(ready)] + logs
        return Command(
            update=update,
            goto=[Send(REGISTRY[a].node, payload) for a in ready],
        )
    for agent in wait:  # pragma: no cover - finalise_plan keeps requires satisfiable
        update["agent_ok"][agent] = False
    update["pending"] = []
    found = state.get("findings") or {}
    workspace = {
        **update.get("workspace", {}),
        "findings": found,
        "findingsCount": count_findings(found),
    }
    if state.get("phase") == "top_up":
        update["workspace"] = workspace
        update["logs"] = [dispatch_log("revise_gate")] + logs
        return Command(update=update, goto="revise_gate")
    if state.get("progress"):
        workspace.update(progress=state["progress"], history=state.get("history"))
    update["workspace"] = workspace
    if "analyst" in (state.get("actions") or {}) and not ok_map.get("analyst"):
        update["rung"] = int(FallbackRung.WRITER_AND_CHECKS_ONLY)
    update["logs"] = [dispatch_log("prepare_writer")] + logs
    return Command(update=update, goto="prepare_writer")


# --- the one evidence top-up (D3) ---------------------------------------------------


async def top_up(
    state: State, runtime: Runtime[Ctx]
) -> Command[Literal["planner", "revise_gate"]]:
    ctx = runtime.context
    t0 = ctx.clock()
    base: Dict[str, Any] = {"top_up_used": True, "phase": "top_up"}

    def log(nxt: str, **out: Any) -> Dict[str, Any]:
        return code_log(
            ctx,
            "top_up",
            t0,
            input={
                "critique": body.critique(state["best"]) if state.get("best") else None,
                "answered": dict(state.get("agent_ok") or {}),
                "offered": list(state.get("offered") or []),
                "budgetLeftUsd": budget_left(
                    ctx.ceiling_usd, state.get("estimated", 0.0)
                ),
                "timeLeftMs": round(ctx.time_left_ms(state.get("has_risk_cue", False))),
            },
            output={"next": nxt, **out},
            round_=1,
        )

    if orchestrator(ctx).get("topUp") is False:
        return Command(
            update={**base, "logs": [log("revise_gate", fallback="top-up is off")]},
            goto="revise_gate",
        )
    now = {**state, **base}
    floor = floor_reserve(state, ctx, "top_up")
    now["floor_reserve"] = floor
    ran = state.get("agent_ok") or {}
    candidates = [a for a in state.get("offered") or [] if a not in ran]
    reason = code = None
    est = 0.0
    if not candidates:
        code, reason = "nothing_left", "Every available agent already ran."
    elif ctx.time_left_ms(state.get("has_risk_cue", False)) < (
        _REVISION_MIN_MS + PLANNER_TIMEOUT_S * 1000
    ):
        code = "no_time"
        reason = "Too little time was left to add evidence before revising."
    else:
        est = _planner_estimate(now, ctx)
        if (
            math.isinf(est)
            or state.get("estimated", 0.0) + floor + est > ctx.ceiling_usd
        ):
            code = "no_budget"
            reason = "Not enough of the run budget was left to add evidence."
    if reason:
        update = finalise_plan(
            now,
            ctx,
            proposed=[],
            considered=[],
            source="none",
            fallback=reason,
            fallback_code=code,
        )
        return Command(
            update={
                **base,
                "floor_reserve": floor,
                **update,
                "logs": [
                    log(
                        "revise_gate",
                        fallback=reason,
                        fallbackCode=code,
                        candidates=candidates,
                    )
                ],
            },
            goto="revise_gate",
        )
    return Command(
        update={
            **base,
            "floor_reserve": floor,
            "estimated": state.get("estimated", 0.0) + est,
            "reserved": {"planner#1": est},
            "logs": [
                log(
                    "planner",
                    candidates=candidates,
                    floorReserveUsd=round(floor, 6),
                    plannerEstimateUsd=round(est, 6),
                )
            ],
        },
        goto="planner",
    )


# --- code agents' nodes -------------------------------------------------------------


def code_agent_node(m: AgentManifest) -> Dict[str, Any]:
    """A code agent (tool, knowledge) as a node: gateway errors retried, and a
    failure recorded rather than failing the run."""

    async def action(state: State, runtime: Runtime[Ctx]):
        ctx = runtime.context
        t0 = ctx.clock()
        out = await m.run(state, runtime)
        update = out.update if isinstance(out, Command) else out
        log = code_log(
            ctx,
            m.id,
            t0,
            input={
                "kind": "code agent",
                "action": (state.get("actions") or {}).get(m.id),
                "tools": list(m.tools),
            },
            output={
                k: v
                for k, v in (update or {}).items()
                if k not in ("steps", "logs", "agent_ok")
            },
            attention=not ((update or {}).get("agent_ok") or {}).get(m.id, True),
        )
        if (update or {}).get("logs"):
            return out  # it logged itself (guidance runs the floor's node)
        if isinstance(out, Command):
            merged = {**(out.update or {})}
            merged["logs"] = list(merged.get("logs") or []) + [log]
            return Command(update=merged, goto=out.goto)
        return {**(out or {}), "logs": list((out or {}).get("logs") or []) + [log]}

    async def on_error(state: State, error: NodeError, runtime: Runtime[Ctx]):
        ctx = runtime.context
        cause = error.error
        record = code_record(
            ctx,
            state,
            m.id,
            ctx.clock(),
            why=m.description,
            inputs=[],
            output="no answer",
            note=f"{type(cause).__name__}: {cause}"[:300],
            status="failed",
        )
        # An error handler's update follows no static edge: route explicitly.
        log = code_log(
            ctx,
            m.id,
            ctx.clock(),
            input={
                "kind": "code agent",
                "action": (state.get("actions") or {}).get(m.id),
                "tools": list(m.tools),
            },
            output=None,
            error=f"{type(cause).__name__}: {cause}",
        )
        return Command(
            update={"steps": [record], "agent_ok": {m.id: False}, "logs": [log]},
            goto="dispatch",
        )

    return {
        "action": action,
        "error_handler": on_error,
        "retry_policy": GATEWAY_RETRY,
        "destinations": ("dispatch",),
    }
