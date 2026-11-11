"""The orchestrated debrief (spec A1–A5, D2, D3): the registry, the planner and
its fallback, budget drops, requires, Send fan-out, findings with checked
quotes, the one top-up, and refusal of agents the release does not enable.
With the challenger flag off the fixed recipe runs unchanged
(test_debrief_graph.py covers that path)."""

import asyncio
from dataclasses import replace

import pytest

from app.core.debrief_graph import circuit, orchestrator
from app.core.debrief_graph.registry.agents._common import ToolRefused, tool
from app.core.debrief_graph.registry.manifest import REGISTRY, SCOPES
from tests.core.debrief_graph.fakes import (
    ALL_AGENTS,
    CONTEXT,
    SESSION,
    FakeGateway,
    FakeSteps,
    bundle,
    evaluation,
    make_ctx,
    new_graph,
    orchestrated_bundle,
    run,
)

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
def closed_circuits():
    circuit.reset_model_circuits()
    yield
    circuit.reset_model_circuits()


@pytest.fixture
def steps():
    return FakeSteps()


@pytest.fixture
def gateway():
    return FakeGateway()


async def orun(steps, gateway, **kw):
    """An orchestrated run on a Hindi session (so every agent can be offered)."""
    kw["session"] = {**SESSION, "language": "hi", **kw.pop("session", {})}
    return await run(steps, gateway, **kw)


def plan_of(result, phase="plan"):
    return next(p for p in result["workspace"]["plans"] if p["phase"] == phase)


def ran(result):
    return [s["step"] for s in result["steps"] if s["status"] == "done"]


def planned(*agents, considered=()):
    return {
        "plan": {
            "actions": [
                {"agent": a, "why": f"{a} fits", "focus_turns": [2]} for a in agents
            ],
            "considered": [{"agent": a, "why_not": "not here"} for a in considered],
        },
        "reasoning": "From the profile.",
    }


class TestRegistry:
    async def test_first_registry_has_every_a9_agent_with_its_manifest(self):
        assert sorted(REGISTRY) == sorted(ALL_AGENTS)
        for m in REGISTRY.values():
            assert m.version >= 1 and m.description and m.use_when and m.skip_when
            assert m.progress_label and m.progress_label_key.startswith(
                "debrief.progress."
            )
            assert set(m.reads) <= set(SCOPES)
            assert all(r in REGISTRY for r in m.requires)
            assert m.outputs["required"] == ["agent", "findings"]
            assert m.record()["scopes"] == {"reads": list(m.reads)}

    async def test_new_prompt_agents_have_prompts_and_ai_task_rows(self):
        for agent in ("protocol_check", "history_deep", "language_specialist"):
            m = REGISTRY[agent]
            assert m.prompt == f"debrief_{agent}_system"
            assert m.ai_task_id == "debrief-" + agent.replace("_", "-")
            assert m.status == "experimental"

    async def test_an_agent_may_only_call_the_tools_its_manifest_lists(
        self, steps, gateway
    ):
        ctx = make_ctx(steps, gateway)
        with pytest.raises(ToolRefused):
            await tool(ctx, "language_specialist", "get_org_protocols", {})
        assert await tool(ctx, "protocol_check", "get_org_protocols", {})


class TestFlagOff:
    async def test_no_orchestrator_block_runs_the_fixed_recipe(self, steps, gateway):
        result = await run(steps, gateway, bundle=bundle())
        assert steps.count("planner") == 0
        assert "plans" not in result["workspace"]
        assert all(s["step"] != "plan" for s in result["steps"])

    async def test_a_disabled_block_runs_the_fixed_recipe(self, steps, gateway):
        b = orchestrated_bundle(enabled=False)
        flag_off = await run(steps, gateway, bundle=b)
        plain = await run(FakeSteps(), FakeGateway(), bundle=bundle())
        assert steps.count("planner") == 0
        assert [s["step"] for s in flag_off["steps"]] == [
            s["step"] for s in plain["steps"]
        ]
        assert flag_off["estimated_cost_usd"] == plain["estimated_cost_usd"]


class TestPlan:
    async def test_planned_agents_run_and_the_plan_is_recorded(self, steps, gateway):
        steps.answers["planner"] = planned(
            "analyst",
            "guidance_lookup",
            "language_specialist",
            considered=["progress_reader"],
        )
        result = await orun(steps, gateway, bundle=orchestrated_bundle())

        assert result["status"] == "published"
        assert steps.count("planner") == 1
        assert steps.count("agent-language-specialist") == 1
        assert steps.count("progress-reader") == 0
        plan = plan_of(result)
        assert plan["source"] == "planner"
        assert [c["agent"] for c in plan["chosen"]] == [
            "analyst",
            "guidance_lookup",
            "language_specialist",
        ]
        assert {"agent": "progress_reader", "whyNot": "not here"} in plan["considered"]
        assert plan["profile"]["session_type"] == "standard"
        record = next(s for s in result["steps"] if s["step"] == "plan")
        assert record["output"].startswith("Chose analyst, guidance_lookup")
        # Safety first, then the plan, then the agents, then the floor.
        order = ran(result)
        assert (
            order.index("safety_reader")
            < order.index("planner")
            < order.index("analyst")
        )
        assert order.index("guidance_lookup") < order.index("writer")
        # The planner never sees the transcript.
        planner_body = next(c["body"] for c in steps.calls if c["path"] == "planner")
        assert "transcript" not in planner_body
        assert {a["id"] for a in planner_body["agents"]} >= {
            "analyst",
            "language_specialist",
        }

    async def test_the_writer_gets_one_findings_section_by_kind(self, steps, gateway):
        steps.answers["planner"] = planned("analyst", "language_specialist")
        result = await orun(steps, gateway, bundle=orchestrated_bundle())
        writer = next(c["body"] for c in steps.calls if c["path"] == "writer")
        # The Analyst has its own block (the evidence map); the new agent's
        # findings are the generic section.
        assert writer["findings"] == {
            "context": [
                {
                    "point": "agent-language-specialist found something.",
                    "turnIndex": 2,
                    "quote": "I don't see the point anymore.",
                    "confidence": "high",
                    "importance": 1,
                }
            ]
        }
        found = result["workspace"]["findings"]
        assert found["analyst"]["findings"]  # the evidence map, summarised
        assert {f["kind"] for f in found["analyst"]["findings"]} >= {
            "done_well",
            "missed",
        }

    async def test_planner_timeout_falls_back_to_the_default_plan(
        self, steps, gateway, monkeypatch
    ):
        monkeypatch.setattr(
            orchestrator, "PLANNER", replace(orchestrator.PLANNER, timeout_s=0.2)
        )
        steps.delay["planner"] = 1.0
        result = await orun(
            steps, gateway, graph=new_graph(), bundle=orchestrated_bundle()
        )
        assert result["status"] == "published"
        plan = plan_of(result)
        assert plan["source"] == "default"
        assert "planner failed or took longer than 8 s" in plan["fallback"]
        # Today's Standard recipe, as data.
        assert [c["agent"] for c in plan["chosen"]] == [
            "analyst",
            "progress_reader",
            "guidance_lookup",
        ]
        failed = next(s for s in result["steps"] if s["step"] == "planner")
        assert failed["status"] == "failed" and "timeout" in failed["note"]

    async def test_a_failed_planner_falls_back_too(self, steps, gateway):
        steps.fail["planner"] = "always"
        result = await orun(steps, gateway, bundle=orchestrated_bundle())
        assert steps.count("planner") == 1  # no retry: the default plan is the fallback
        assert plan_of(result)["source"] == "default"
        assert result["status"] == "published"

    async def test_case_session_default_plan_includes_case_memory(self, steps, gateway):
        b = orchestrated_bundle()
        b["recipes"]["case"] = {**b["recipes"]["standard"], "key": "case"}
        steps.fail["planner"] = "always"
        result = await orun(
            steps,
            gateway,
            bundle=b,
            session={"in_case": True},
            inputs={**CONTEXT, "case_memory": "The client lost her job."},
        )
        plan = plan_of(result)
        assert [c["agent"] for c in plan["chosen"]][0] == "case_memory"
        analyst = next(c["body"] for c in steps.calls if c["path"] == "analyst")
        assert analyst["case_memory"] == "The client lost her job."

    async def test_profile_reads_risk_cues_and_language(self, steps, gateway):
        steps.answers["safety-reader"] = {
            "risk_cues": [
                {
                    "turn_index": 2,
                    "category": "hopelessness",
                    "learner_response": "missed",
                    "evidence": "x",
                }
            ],
            "learner_distress": [],
        }
        steps.answers["planner"] = planned("analyst")
        result = await orun(steps, gateway, bundle=orchestrated_bundle())
        prof = plan_of(result)["profile"]
        assert prof["risk_cues"] == 1 and prof["risk_cue_turns"] == [2]
        assert prof["language"] == "hi" and prof["indic"] is True
        assert prof["code_mixed"] is False and prof["script_mismatch"] is True
        assert prof["org_protocols"] == 0


class TestRefusalsAndLimits:
    async def test_agents_outside_the_release_are_refused(self, steps, gateway):
        agents = [a for a in ALL_AGENTS if a != "language_specialist"]
        steps.answers["planner"] = planned("analyst", "language_specialist")
        result = await orun(steps, gateway, bundle=orchestrated_bundle(agents))
        assert steps.count("agent-language-specialist") == 0
        assert {
            "agent": "language_specialist",
            "why": "Refused: this release does not enable it.",
        } in plan_of(result)["dropped"]
        # Never offered to the planner either.
        planner_body = next(c["body"] for c in steps.calls if c["path"] == "planner")
        assert "language_specialist" not in {a["id"] for a in planner_body["agents"]}

    async def test_a_version_the_build_lacks_is_refused(self, steps, gateway):
        b = orchestrated_bundle()
        for e in b["orchestrator"]["agents"]:
            if e["id"] == "language_specialist":
                e["version"] = 2
        steps.answers["planner"] = planned("analyst", "language_specialist")
        result = await orun(steps, gateway, bundle=b)
        assert steps.count("agent-language-specialist") == 0
        dropped = {d["agent"]: d["why"] for d in plan_of(result)["dropped"]}
        assert dropped["language_specialist"].startswith(
            "Refused: the release enables version 2"
        )

    async def test_unavailable_and_unmet_requires_are_dropped(self, steps, gateway):
        # protocol_check: the org has no protocols; guidance_lookup: needs the Analyst.
        steps.answers["planner"] = planned("protocol_check", "guidance_lookup")
        result = await orun(steps, gateway, bundle=orchestrated_bundle())
        dropped = {d["agent"]: d["why"] for d in plan_of(result)["dropped"]}
        assert dropped["protocol_check"] == "Not available for this session."
        assert dropped["guidance_lookup"] == "Needs analyst, which is not in the plan."
        assert result["status"] in ("published", "below_bar", "needs_person")

    async def test_budget_drops_what_does_not_fit_after_the_floor(self, steps, gateway):
        prices = {
            **make_ctx(steps, gateway).prices,
            # One expensive agent model: the language agent cannot fit.
            "agent-m": {"input_per_m": 10_000.0, "output_per_m": 10_000.0},
        }
        b = orchestrated_bundle()
        for e in b["orchestrator"]["agents"]:
            if e["id"] == "analyst":
                e["model"] = None  # the recipe's analyst model
        steps.answers["planner"] = planned("analyst", "language_specialist")
        result = await orun(steps, gateway, bundle=b, prices=prices)
        dropped = {d["agent"]: d["why"] for d in plan_of(result)["dropped"]}
        assert dropped["language_specialist"].startswith("Not enough of the run budget")
        assert steps.count("agent-language-specialist") == 0
        assert steps.count("analyst") == 1
        assert steps.count("writer") == 1  # the floor still runs

    async def test_max_agents_per_plan(self, steps, gateway):
        steps.answers["planner"] = planned(
            "analyst", "language_specialist", "guidance_lookup"
        )
        result = await orun(
            steps, gateway, bundle=orchestrated_bundle(maxAgentsPerPlan=2)
        )
        dropped = {d["agent"]: d["why"] for d in plan_of(result)["dropped"]}
        assert dropped["guidance_lookup"] == "The plan already has 2 agents."

    async def test_a_dependant_is_skipped_when_its_requirement_fails(
        self, steps, gateway
    ):
        steps.answers["planner"] = planned("analyst", "progress_reader")
        steps.fail["analyst"] = "always"
        result = await orun(steps, gateway, bundle=orchestrated_bundle())
        assert steps.count("progress-reader") == 0
        skipped = next(s for s in result["steps"] if s["step"] == "progress_reader")
        assert skipped["status"] == "skipped"
        assert "needs analyst" in skipped["why"]
        assert result["fallback_rung"] >= 5  # writer and checks only, as today


class TestFanOut:
    async def test_chosen_agents_run_in_parallel(self, gateway):
        started = {}
        both = asyncio.Event()

        class Barrier(FakeSteps):
            async def run(self, path, body, model, session_id):
                if path in ("analyst", "agent-language-specialist"):
                    started[path] = True
                    if len(started) == 2:
                        both.set()
                    # Sequential runs would never see both started.
                    await asyncio.wait_for(both.wait(), timeout=2)
                return await super().run(path, body, model, session_id)

        steps = Barrier()
        steps.answers["planner"] = planned("analyst", "language_specialist")
        result = await orun(steps, gateway, bundle=orchestrated_bundle())
        assert both.is_set()
        assert result["status"] == "published"


class TestFindingsQuotes:
    async def test_quotes_are_checked_against_the_transcript(self, steps, gateway):
        steps.answers["planner"] = planned("analyst", "language_specialist")
        steps.answers["agent-language-specialist"] = {
            "findings": [
                {
                    "kind": "missed",
                    "point": "Made up.",
                    "turn_index": 3,
                    "quote": "words nobody said",
                    "importance": 1,
                    "confidence": "high",
                },
                {
                    "kind": "done_well",
                    "point": "Wrong turn, real words.",
                    "turn_index": 1,
                    "quote": "“Tell me more about that”",
                    "importance": 2,
                    "confidence": "high",
                },
            ],
            "reasoning": "",
        }
        result = await orun(steps, gateway, bundle=orchestrated_bundle())
        got = result["workspace"]["findings"]["language_specialist"]
        made_up, moved = got["findings"]
        assert made_up["quote"] is None and made_up["confidence"] == "low"
        assert moved["turnIndex"] == 3 and moved["quote"]
        assert got["droppedQuotes"] == 1

    async def test_aggregate_findings_never_carry_quotes(self, steps, gateway):
        gateway.answers["query_aggregates"] = {
            "rows": [{"skill": "exploring risk", "learners": 7, "observed_share": 0.2}]
        }
        steps.answers["planner"] = planned("analyst", "cohort_comparison")
        result = await orun(
            steps,
            gateway,
            bundle=orchestrated_bundle(),
            inputs={**CONTEXT, "availability": {"cohort": True}},
        )
        found = result["workspace"]["findings"]["cohort_comparison"]["findings"]
        assert found == [
            {
                "kind": "comparison",
                "point": (
                    "exploring risk: many trainees in the organisation "
                    "find this hard too."
                ),
                "turnIndex": None,
                "quote": None,
                "importance": 2,
                "confidence": "medium",
                "source": "aggregate:cohort_skill_rates",
            }
        ]
        call = gateway.tools("query_aggregates")[0]
        assert call["query"] == "cohort_skill_rates"
        assert "exploring risk" in call["params"]["skills"]

    async def test_protocol_check_reads_the_org_protocols(self, steps, gateway):
        steps.answers["planner"] = planned("protocol_check")
        await orun(
            steps,
            gateway,
            bundle=orchestrated_bundle(),
            inputs={**CONTEXT, "availability": {"org_protocols": 2}},
        )
        sent = next(
            c["body"] for c in steps.calls if c["path"] == "agent-protocol-check"
        )
        assert sent["blocks"]["organisation_protocols"][0]["code"] == "DG-9"
        assert sent["focus_turns"] == [2]
        assert len(gateway.tools("get_org_protocols")) == 1

    async def test_an_agent_whose_tool_fails_is_recorded_not_fatal(
        self, steps, gateway
    ):
        from app.core.debrief_graph.gateway import GatewayError

        gateway.raise_on["query_aggregates"] = lambda: GatewayError(
            "query_aggregates", 500, "down"
        )
        steps.answers["planner"] = planned("analyst", "course_patterns")
        result = await orun(
            steps,
            gateway,
            bundle=orchestrated_bundle(),
            inputs={**CONTEXT, "availability": {"course": True}},
        )
        assert len(gateway.tools("query_aggregates")) == 3  # retried, then recorded
        failed = next(s for s in result["steps"] if s["step"] == "course_patterns")
        assert failed["status"] == "failed"
        assert result["status"] == "published"

    async def test_assessment_anchoring_keeps_only_quoted_findings(
        self, steps, gateway
    ):
        b = orchestrated_bundle()
        b["recipes"]["assessment"] = {**b["recipes"]["standard"], "key": "assessment"}
        steps.answers["planner"] = planned(
            "assessment_anchoring", "analyst", "language_specialist"
        )
        steps.answers["agent-language-specialist"] = {
            "findings": [
                {
                    "kind": "context",
                    "point": "No quote.",
                    "importance": 1,
                    "confidence": "high",
                },
                {
                    "kind": "context",
                    "point": "Quoted.",
                    "turn_index": 1,
                    "quote": "What brings you in today?",
                    "importance": 2,
                    "confidence": "high",
                },
            ]
        }
        await orun(
            steps,
            gateway,
            bundle=b,
            session={"assessment": True},
        )
        writer = next(c["body"] for c in steps.calls if c["path"] == "writer")
        assert [f["point"] for f in writer["findings"]["context"]] == ["Quoted."]
        assert writer["assessment"] is True


class TestTopUp:
    async def test_one_top_up_before_the_reviser(self, steps, gateway):
        plans = iter(
            [
                planned("analyst"),
                planned("language_specialist"),
                planned("guidance_lookup"),
            ]
        )
        steps.answers["planner"] = lambda body: next(plans)
        steps.answers["evaluator"] = {"evaluation": evaluation(6), "reasoning": ""}
        result = await orun(steps, gateway, bundle=orchestrated_bundle())

        assert steps.count("planner") == 2  # the plan and ONE top-up
        top = plan_of(result, "top_up")
        assert [c["agent"] for c in top["chosen"]] == ["language_specialist"]
        order = [s["step"] for s in result["steps"]]
        first_eval = order.index("evaluator")
        assert first_eval < order.index("language_specialist") < order.index("reviser")
        # The top-up planner read the critique; the Reviser read what it found.
        top_body = [c["body"] for c in steps.calls if c["path"] == "planner"][1]
        assert "critique" in top_body and "analyst" in top_body["already"]
        assert "analyst" not in {a["id"] for a in top_body["agents"]}
        reviser = next(c["body"] for c in steps.calls if c["path"] == "reviser")
        assert reviser["findings"]["context"][0]["point"].startswith(
            "agent-language-specialist"
        )
        # Two rounds of revision still happen (the recipe's max), no second top-up.
        assert steps.count("reviser") == 2
        assert result["status"] == "below_bar"

    async def test_no_top_up_when_switched_off(self, steps, gateway):
        steps.answers["planner"] = planned("analyst")
        steps.answers["evaluator"] = {"evaluation": evaluation(6), "reasoning": ""}
        await orun(steps, gateway, bundle=orchestrated_bundle(topUp=False))
        assert steps.count("planner") == 1
        assert steps.count("reviser") == 2

    async def test_top_up_planner_failure_revises_without_more_evidence(
        self, steps, gateway
    ):
        calls = {"n": 0}

        def plan(body):
            calls["n"] += 1
            if calls["n"] == 2:
                raise RuntimeError("planner down")
            return planned("analyst")

        steps.answers["planner"] = plan
        steps.answers["evaluator"] = {"evaluation": evaluation(6), "reasoning": ""}
        result = await orun(steps, gateway, bundle=orchestrated_bundle())
        top = plan_of(result, "top_up")
        assert top["chosen"] == [] and "failed" in top["fallback"]
        assert steps.count("reviser") == 2


class TestFloor:
    async def test_no_safety_reading_holds_for_a_person(self, steps, gateway):
        steps.fail["safety-reader"] = "always"
        result = await orun(steps, gateway, bundle=orchestrated_bundle())
        assert result["status"] == "needs_person"
        assert result["skip_reason"] == "safety_reader_failed"
        assert steps.count("planner") == 0 and steps.count("writer") == 0

    async def test_fixed_recipe_safety_failure_without_the_analyst(
        self, steps, gateway
    ):
        """Regression: a failed safety reading with no Analyst beside it used
        to end the run with no answer (an error handler follows no edge)."""
        b = bundle()
        b["recipes"]["standard"]["steps"] = [
            s for s in b["recipes"]["standard"]["steps"] if s["step"] != "analyst"
        ]
        steps.fail["safety-reader"] = "always"
        result = await run(steps, gateway, bundle=b)
        assert result["status"] == "needs_person"
        assert result["skip_reason"] == "safety_reader_failed"


async def test_resume_reuses_the_plan(steps, gateway):
    """A resumed run continues from its checkpoint: the plan is state."""
    graph = new_graph()
    steps.answers["planner"] = planned("analyst", "language_specialist")
    steps.fail["writer"] = "always"
    first = await orun(steps, gateway, graph=graph, bundle=orchestrated_bundle())
    assert first["status"] == "needs_person"
    again = await orun(steps, gateway, graph=graph, bundle=orchestrated_bundle())
    assert again == first
    assert steps.count("planner") == 1
