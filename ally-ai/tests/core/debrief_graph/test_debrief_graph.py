"""The Debrief graph reproduces ally-be's runner: the recipe, the budget and its
fallback rungs, the backup model and the circuit breaker, the check → evaluate ⇄
revise loop, the deadline, every ending, and a resume that pays for nothing twice.
"""

import pytest

from app.core.debrief_graph import circuit, constants
from app.core.debrief_graph.gateway import GatewayError
from tests.core.debrief_graph.fakes import (
    PRICES,
    SESSION,
    FakeGateway,
    FakeSteps,
    bundle,
    evaluation,
    names,
    new_graph,
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


class TestStandardRun:
    async def test_publishes_with_the_runners_step_records(self, steps, gateway):
        result = await run(steps, gateway)

        assert result["status"] == "published"
        assert result["skip_reason"] is None
        assert result["recipe_key"] == "standard"
        assert result["fallback_rung"] == 0
        assert names(result) == [
            "analyst:done",
            "safety_reader:done",
            "progress_reader:done",
            "guidance_lookup:done",
            "writer:done",
            "checks:done",
            "evaluator:done",
        ] or names(result) == [
            "safety_reader:done",
            "analyst:done",
            "progress_reader:done",
            "guidance_lookup:done",
            "writer:done",
            "checks:done",
            "evaluator:done",
        ]
        by_step = {s["step"]: s for s in result["steps"]}
        safety = by_step["safety_reader"]
        assert safety["why"] == (
            "Always runs first: nothing is published without a safety reading."
        )
        assert safety["reasoning"] == (
            "No client risk cues and no sign of the learner’s own distress."
        )
        assert safety["output"] == (
            "0 risk cues, 0 signs of the learner’s own distress"
        )
        assert safety["model"] == "safety-m"
        assert safety["inputs"] == ["the transcript (5 turns)"]
        analyst = by_step["analyst"]
        assert analyst["output"] == (
            "2 skills read: 1 observed, 0 partial, 1 missed; 2 pivotal moments"
        )
        assert analyst["reasoning"] == "Weighed the turns."
        assert analyst["inputs"][-1] == "the live detector’s record (1 of 1 detected)"
        assert by_step["progress_reader"]["why"] == (
            "This learner has 1 earlier Work-on-this point to follow up."
        )
        assert by_step["guidance_lookup"]["note"] == "2 lookup(s), 2 passage(s)"
        assert by_step["guidance_lookup"]["reasoning"] == (
            "Led by the skill that mattered most: open questions."
        )
        assert by_step["writer"]["why"] == (
            "Writes the cards from the evidence (standard recipe)."
        )
        assert by_step["checks"]["output"] == "every check passed"
        assert by_step["checks"]["round"] == 0
        assert (
            by_step["evaluator"]["output"] == "9.0 overall; no hard fail; 0 fix notes"
        )
        assert all(s["budgetLeftUsd"] <= 0.5 for s in result["steps"])
        assert by_step["writer"]["estimatedUsd"] > 0

        ws = result["workspace"]
        for key in [
            "languageSource",
            "liveDetections",
            "safety",
            "evidence",
            "passages",
            "progress",
            "history",
            "evaluations",
            "bestRound",
            "drafts",
            "decision",
        ]:
            assert key in ws, key
        assert ws["history"] == "2026-10-20 · pacing: Let the client finish."
        assert ws["decision"]["status"] == "published"
        assert ws["decision"]["why"] == (
            "Published round 0: it passed every check and scored 9.0 with no hard "
            "fail (the bar is 8)."
        )
        assert result["cards"]["point_ids"] is True
        assert gateway.tools("finalise_cards")[0]["offered"] == [41]
        assert result["evaluator_overall"] == 9.0
        assert result["check_failures"] == []
        assert result["estimated_cost_usd"] > 0
        assert result["resumed"] is False

        writer_body = [c for c in steps.calls if c["path"] == "writer"][0]["body"]
        assert writer_body["system_prompt"] == "Write well."
        assert [p["title"] for p in writer_body["passages"]] == [
            "Guide on client signals hopelessness",
            "Guide on client describes heaviness",
        ]
        assert writer_body["short"] is False
        assert [p["step"] for p in gateway.tools("progress")][:1] in (
            ["safety_reader"],
            ["analyst"],
        )

    async def test_short_recipe(self, steps, gateway):
        result = await run(steps, gateway, session={**SESSION, "learner_turns": 2})

        assert result["recipe_key"] == "short"
        assert result["status"] == "published"
        assert steps.count("analyst") == 0
        assert steps.count("progress-reader") == 0
        writer = [c for c in steps.calls if c["path"] == "writer"][0]
        assert writer["body"]["short"] is True
        assert writer["body"]["evidence"] == {}
        record = next(s for s in result["steps"] if s["step"] == "writer")
        assert (
            record["why"]
            == "Writes a short debrief: the session had few learner turns."
        )
        assert record["inputs"][0] == "no evidence map (the Analyst did not run)"


class TestEndings:
    async def test_safety_reader_failure_holds_for_a_person(self, steps, gateway):
        steps.fail["safety-reader"] = "always"
        result = await run(steps, gateway)

        assert result["status"] == "needs_person"
        assert result["skip_reason"] == "safety_reader_failed"
        assert result["fallback_rung"] == 6
        failed = [s for s in result["steps"] if s["step"] == "safety_reader"]
        assert [s["status"] for s in failed] == ["failed", "failed"]
        assert [s["model"] for s in failed] == ["safety-m", "safety-b"]
        assert failed[0]["note"] == "502: safety-reader returned no usable answer"
        assert failed[1]["why"] == "Retried once after the first attempt failed."
        assert result["workspace"]["decision"] == {
            "status": "needs_person",
            "round": None,
            "why": constants.END_WHY["safety_reader_failed"],
        }
        assert steps.count("writer") == 0

    async def test_writer_failing_on_both_models(self, steps, gateway):
        steps.fail["writer"] = "always"
        result = await run(steps, gateway)

        assert result["status"] == "needs_person"
        assert result["skip_reason"] == "writer_failed"
        assert result["fallback_rung"] == 6
        assert steps.models("writer") == ["writer-m", "writer-b"]
        assert result["cards"] is None
        assert gateway.tools("run_checks") == []

    async def test_failed_check_gets_a_revision_then_publishes(self, steps, gateway):
        gateway.checks = [
            [
                {
                    "code": "quote_mismatch",
                    "section": "what_worked[0]",
                    "detail": "not verbatim",
                }
            ],
            [],
        ]
        result = await run(steps, gateway)

        assert result["status"] == "published"
        assert result["revision_rounds"] == 1
        assert names(result)[-5:] == [
            "checks:done",
            "evaluator:done",
            "reviser:done",
            "checks:done",
            "evaluator:done",
        ]
        reviser = next(s for s in result["steps"] if s["step"] == "reviser")
        assert reviser["round"] == 1
        assert reviser["why"] == "Revising round 0 because it failed quote_mismatch."
        body = [c for c in steps.calls if c["path"] == "reviser"][0]["body"]
        assert body["critique"][0] == {
            "section": "what_worked[0]",
            "note": "quote_mismatch: not verbatim",
        }
        assert {t["turn_index"] for t in body["excerpts"]} == {1, 2, 3}
        ws = result["workspace"]
        assert [d["round"] for d in ws["drafts"]] == [0, 1]
        assert ws["bestRound"] == 1
        assert [e["checks"] for e in ws["evaluations"]] == [["quote_mismatch"], []]
        assert result["cards"]["opening"] == "Revised opening."

    async def test_advisory_check_is_still_publishable(self, steps, gateway):
        gateway.checks = [
            [
                {
                    "code": "total_too_long",
                    "section": "whole debrief",
                    "detail": "240 words",
                }
            ]
        ]
        result = await run(steps, gateway)

        assert result["status"] == "published"
        assert steps.count("reviser") == 0
        record = next(s for s in result["steps"] if s["step"] == "checks")
        assert record["output"] == "1 check failed (advisory only; still publishable)"
        assert result["check_failures"] == [
            {
                "code": "total_too_long",
                "section": "whole debrief",
                "detail": "240 words",
            }
        ]

    async def test_below_bar_at_the_deadline(self, steps, gateway):
        steps.answers["evaluator"] = {"evaluation": evaluation(6), "reasoning": ""}
        # 20 s to the deadline: guidance still runs (half the deadline left),
        # but less than 30 s is too little for a revision.
        result = await run(steps, gateway, bundle=bundle(deadlineMs=20_000))

        assert result["status"] == "below_bar"
        assert result["fallback_rung"] == 4
        skipped = result["steps"][-1]
        assert skipped["step"] == "reviser"
        assert skipped["status"] == "skipped"
        assert skipped["note"] == "deadline"
        assert (
            skipped["why"] == "Skipped: too little time was left before the deadline."
        )
        assert result["workspace"]["decision"]["why"] == (
            "Published round 0 below the bar and sent it to review: it passed every "
            "check but scored 6.0, and there was no budget or time for another "
            "revision."
        )
        assert steps.count("reviser") == 0

    async def test_missed_risk_cue_is_never_published(self, steps, gateway):
        steps.answers["evaluator"] = {
            "evaluation": evaluation(
                9, hard_fails=[{"code": "missed_risk_cue", "evidence": "turn 2"}]
            )
        }
        result = await run(steps, gateway, bundle=bundle(deadlineMs=20_000))

        assert result["status"] == "needs_person"
        assert result["skip_reason"] == "not_evaluated_or_risk"
        assert result["evaluator_overall"] == 4.0


class TestBudget:
    async def test_tiny_ceiling_walks_the_fallback_rungs(self, steps, gateway):
        prices = dict(PRICES)
        prices["analyst-m"] = {"input_per_m": 10_000, "output_per_m": 10_000}
        del prices["reviser-m"]  # unpriced: reserves infinity
        steps.answers["evaluator"] = {"evaluation": evaluation(6)}
        result = await run(steps, gateway, prices=prices, ceiling_usd=0.05)

        assert steps.count("analyst") == 0
        assert steps.count("reviser") == 0
        statuses = names(result)
        assert "analyst:skipped" in statuses
        assert statuses[-1] == "reviser:skipped"
        assert result["steps"][-1]["note"] == "budget"
        # No evidence map → no progress reading, writer and checks only.
        assert steps.count("progress-reader") == 0
        assert result["fallback_rung"] == constants.FallbackRung.WRITER_AND_CHECKS_ONLY
        assert result["status"] == "below_bar"
        assert result["estimated_cost_usd"] <= 0.05

    async def test_no_budget_for_the_safety_reader(self, steps, gateway):
        prices = dict(PRICES)
        del prices["safety-m"]
        result = await run(steps, gateway, prices=prices)

        assert result["status"] == "needs_person"
        assert result["skip_reason"] == "budget_below_minimum"
        assert result["fallback_rung"] == 6
        assert steps.calls == []
        assert result["workspace"]["decision"]["why"] == (
            constants.END_WHY["budget_below_minimum"]
        )


class TestModels:
    async def test_backup_model_after_a_primary_failure(self, steps, gateway):
        steps.fail["writer"] = 1
        result = await run(steps, gateway)

        assert result["status"] == "published"
        assert steps.models("writer") == ["writer-m", "writer-b"]
        records = [s for s in result["steps"] if s["step"] == "writer"]
        assert [r["status"] for r in records] == ["failed", "done"]
        assert records[1]["note"] == "retried"
        assert records[1]["model"] == "writer-b"

    async def test_open_circuit_tries_the_backup_first(self, steps, gateway):
        for _ in range(circuit.FAILURES_TO_OPEN):
            circuit.record_model_failure("writer-m")
        result = await run(steps, gateway)

        assert result["status"] == "published"
        assert steps.models("writer") == ["writer-b"]

    async def test_failures_open_the_circuit_across_runs(self, steps, gateway):
        steps.fail["analyst"] = "always"
        for i in range(circuit.FAILURES_TO_OPEN):
            await run(steps, gateway, run_id=f"run-{i}")
        assert circuit.is_model_circuit_open("analyst-m")
        result = await run(steps, gateway, run_id="run-next")

        assert steps.models("analyst")[-2:] == ["analyst-b", "analyst-m"]
        # The Analyst is optional: without it the run carries on, writer only.
        assert result["fallback_rung"] == 5
        assert result["status"] == "published"

    async def test_a_hung_attempt_times_out_and_retries(
        self, steps, gateway, monkeypatch
    ):
        monkeypatch.setitem(constants.STEP_TIMEOUT_S, "safety-reader", 0.05)
        monkeypatch.setattr(
            "app.core.debrief_graph.model_step.STEP_TIMEOUT_S", constants.STEP_TIMEOUT_S
        )
        steps.delay["safety-reader"] = 1.0
        result = await run(steps, gateway)

        records = [s for s in result["steps"] if s["step"] == "safety_reader"]
        assert [r["status"] for r in records] == ["failed", "done"]
        assert records[0]["note"] == "network: timeout of 50ms exceeded"
        assert result["status"] == "published"


class TestResume:
    async def test_resume_does_not_repeat_paid_steps(self, steps, gateway):
        graph = new_graph()
        gateway.raise_on["run_checks"] = lambda: GatewayError("run_checks", 403, "no")
        first = await run(steps, gateway, graph=graph)

        assert first["status"] == "failed"
        assert first["error"]
        assert first["fallback_rung"] == 6
        assert first["workspace"]["decision"]["why"] == constants.FAILED_WHY
        assert steps.count("writer") == 1

        del gateway.raise_on["run_checks"]
        second = await run(steps, gateway, graph=graph, resume=True)

        assert second["status"] == "published"
        assert second["resumed"] is True
        assert second["workspace"]["resumes"] == 1
        assert steps.count("safety-reader") == 1
        assert steps.count("analyst") == 1
        assert steps.count("writer") == 1
        # The steps recorded before the stop are kept, once each.
        assert [s["step"] for s in second["steps"]].count("writer") == 1

        third = await run(steps, gateway, graph=graph, resume=True)
        assert third == second
        assert steps.count("evaluator") == 1

    async def test_transient_gateway_errors_are_retried(self, steps, gateway):
        original = gateway.call
        busy = {"left": 1}

        async def call(tool, body):
            if tool == "render_cards" and busy["left"]:
                busy["left"] -= 1
                raise GatewayError("render_cards", 503, "busy")
            return await original(tool, body)

        gateway.call = call
        result = await run(steps, gateway)

        assert result["status"] == "published"
        assert len(gateway.tools("render_cards")) == 1


class TestProgress:
    async def test_progress_failures_never_fail_the_run(self, steps, gateway):
        gateway.progress_error = GatewayError("progress", 403, "not running")
        result = await run(steps, gateway)

        assert result["status"] == "published"
        sent = gateway.tools("progress")
        assert {p["step"] for p in sent} >= {"writer", "evaluator", "guidance_lookup"}
        guidance = next(p for p in sent if p["step"] == "guidance_lookup")
        assert guidance["topic"] == "open questions"
        assert guidance["has_risk_cue"] is False

    async def test_guidance_unavailable_writes_without_it(self, steps, gateway):
        original = gateway.call

        async def call(tool, body):
            if tool == "guidance_search":
                return {
                    "passages": [],
                    "no_confident_match": False,
                    "unavailable": True,
                }
            return await original(tool, body)

        gateway.call = call
        result = await run(steps, gateway)

        record = next(s for s in result["steps"] if s["step"] == "guidance_lookup")
        assert record["note"] == "1 lookup(s), 0 passage(s)"
        assert (
            "Guidance could not be reached; writing without it." in record["reasoning"]
        )
        assert result["status"] == "published"
