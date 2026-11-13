"""The run's Agent logs: every model call's exact message and full reply (with
its prompt code, model, tokens, cost, retries and error), every deciding code
step's real inputs and results, and the whole planning chain in order."""

from unittest.mock import AsyncMock, patch

import pytest
from pydantic import BaseModel

from app.core.debrief_graph import circuit
from app.core.debrief_graph.agent_logs import SYSTEM_PROMPT_MARKER
from app.core.llm import dispatch
from app.core.llm.capture import (
    call_started,
    capture_calls,
    reply_of,
    usage_reported,
)
from tests.core.debrief_graph.fakes import (
    SESSION,
    FakeGateway,
    FakeSteps,
    evaluation,
    orchestrated_bundle,
    run,
)

pytestmark = pytest.mark.asyncio

WRITER_SYSTEM = "You are the Writer. Write well and kindly."
PROMPTS = {
    "debrief_writer_system": WRITER_SYSTEM,
    "debrief_planner_system": "You are the planner.",
    "debrief_quality_rubric": "THE RUBRIC",
}


class CapturingSteps(FakeSteps):
    """FakeSteps that goes through the capture as `generate_structured` does:
    the message (the system prompt first, as the step functions build it),
    the usage report and the parsed reply."""

    def message(self, path, body):
        system = body.get("system_prompt") or body.get("rubric") or "DEFAULT"
        return f"{system}\n\nSESSION LANGUAGE: en\n<message for {path}>"

    async def run(self, path, body, model, session_id):
        record = call_started(
            prompt=self.message(path, body),
            system=None,
            task="debrief_" + path,
            provider="gemini",
            model=model,
        )
        try:
            answer = await super().run(path, body, model, session_id)
        except Exception as e:
            if record is not None:
                record["error"] = f"{type(e).__name__}: {e}"
            raise
        usage_reported(1000, 200)
        if record is not None:
            record["reply"] = reply_of(
                {k: v for k, v in answer.items() if k != "model"}
            )
        return answer


@pytest.fixture(autouse=True)
def closed_circuits():
    circuit.reset_model_circuits()
    yield
    circuit.reset_model_circuits()


@pytest.fixture
def steps():
    return CapturingSteps()


@pytest.fixture
def gateway():
    return FakeGateway()


def by_step(result, step, kind=None):
    return [
        e
        for e in result["logs"]
        if e["step"] == step and (kind is None or e["kind"] == kind)
    ]


def in_order(seq, wanted):
    """`wanted` appears in `seq` in this order (other entries may sit between)."""
    it = iter(seq)
    return all(any(x == w for x in it) for w in wanted)


class TestModelEntries:
    async def test_the_exact_message_reply_and_prompt_reference(self, steps, gateway):
        result = await run(steps, gateway, prompts=dict(PROMPTS))

        assert [e["seq"] for e in result["logs"]] == list(
            range(1, len(result["logs"]) + 1)
        )
        (writer,) = by_step(result, "writer", "model")
        # The system prompt is named, not copied: put back, it is the message.
        assert writer["promptCode"] == "debrief_writer_system"
        assert writer["promptInlined"] is True
        assert WRITER_SYSTEM not in writer["input"]
        assert writer["input"].replace(SYSTEM_PROMPT_MARKER, WRITER_SYSTEM) == (
            steps.message(
                "writer", next(c["body"] for c in steps.calls if c["path"] == "writer")
            )
        )
        assert writer["output"]["cards"]["opening"] == "You stayed with the client."
        assert writer["output"]["reasoning"] == "Led with risk."
        assert writer["model"] == "writer-m" and writer["fallbackModel"] is None
        assert writer["tokensIn"] == 1000 and writer["tokensOut"] == 200
        assert writer["costUsd"] is not None and writer["costUsd"] > 0
        assert writer["retries"] == 0 and writer["error"] is None
        # The evaluator's rubric is the Skills Store prompt it carries.
        (ev,) = by_step(result, "evaluator", "model")
        assert ev["promptCode"] == "debrief_quality_rubric"
        assert "THE RUBRIC" not in ev["input"]
        # A step whose live prompt was absent keeps its whole (default) message.
        (safety,) = by_step(result, "safety_reader", "model")
        assert safety["promptInlined"] is False
        assert safety["input"].startswith("DEFAULT")

    async def test_every_floor_agent_logs_a_model_call(self, steps, gateway):
        result = await run(steps, gateway, prompts=dict(PROMPTS))
        models = {e["step"] for e in result["logs"] if e["kind"] == "model"}
        assert {
            "safety_reader",
            "analyst",
            "progress_reader",
            "writer",
            "evaluator",
        } <= models

    async def test_a_failed_attempt_and_its_retry_on_the_backup(self, steps, gateway):
        steps.fail["writer"] = 1
        result = await run(steps, gateway, prompts=dict(PROMPTS))

        first, second = by_step(result, "writer", "model")
        assert first["retries"] == 0 and second["retries"] == 1
        assert "no usable answer" in first["error"]
        assert first["attention"] is True and first["output"] is None
        assert first["input"] == second["input"]  # the same message, sent twice
        assert second["model"] == "writer-m"
        assert second["fallbackModel"] == "writer-b"
        assert second["error"] is None and second["output"]["cards"]

    async def test_a_step_that_failed_twice_is_logged_twice(self, steps, gateway):
        steps.fail["progress-agent"] = "always"
        result = await run(steps, gateway, prompts=dict(PROMPTS))
        entries = by_step(result, "progress_reader", "model")
        assert len(entries) == 2
        assert all(e["error"] and e["attention"] for e in entries)

    async def test_without_a_capture_the_request_is_the_input(self, gateway):
        result = await run(FakeSteps(), gateway, prompts=dict(PROMPTS))
        (writer,) = by_step(result, "writer", "model")
        assert isinstance(writer["input"], dict) and "evidence" in writer["input"]
        assert "system_prompt" not in writer["input"]


class TestCodeEntries:
    async def test_rule_checks_guidance_and_decision_log_inputs_and_results(
        self, steps, gateway
    ):
        gateway.checks = [
            [{"code": "quote_mismatch", "section": "x", "detail": "y"}],
            [{"code": "quote_mismatch", "section": "x", "detail": "y"}],
            [{"code": "quote_mismatch", "section": "x", "detail": "y"}],
        ]
        result = await run(steps, gateway, prompts=dict(PROMPTS))

        checks = by_step(result, "checks")[0]
        assert checks["kind"] == "code"
        assert checks["input"]["cards"]["opening"]
        assert checks["output"]["failures"][0]["code"] == "quote_mismatch"
        assert checks["attention"] is True
        guidance = by_step(result, "guidance_lookup")[0]
        assert guidance["input"]["situations"] == [
            "client signals hopelessness",
            "client describes heaviness",
        ]
        assert guidance["output"]["passages"][0]["code"] == "DG-1"
        (decide,) = by_step(result, "decide")
        assert decide["output"]["status"] == result["status"]
        assert decide["output"]["why"]


class TestPlanningChain:
    async def test_a_standard_run_logs_the_recipe_choice_first(self, steps, gateway):
        result = await run(steps, gateway, prompts=dict(PROMPTS))
        order = [e["step"] for e in result["logs"]]
        assert order[0] == "plan"
        plan = result["logs"][0]
        assert plan["kind"] == "code"
        assert plan["output"]["recipe"] == "standard"
        assert plan["output"]["why"]
        assert plan["output"]["orchestrated"] is False
        assert plan["input"]["ceilingUsd"] == 0.5
        assert "profile" not in order and "dispatch" not in order
        assert in_order(
            order,
            [
                "plan",
                "progress_reader",
                "guidance_lookup",
                "writer",
                "checks",
                "evaluator",
                "score_draft",
                "decide",
            ],
        )

    async def test_an_orchestrated_run_logs_plan_profile_planner_dispatch_top_up(
        self, steps, gateway
    ):
        plans = iter(
            [
                {
                    "plan": {
                        "actions": [{"agent": "guidance_lookup", "why": "a moment"}],
                        "considered": [
                            {"agent": "cohort_comparison", "why_not": "no cohort"}
                        ],
                    },
                    "reasoning": "From the profile.",
                },
                {
                    "plan": {
                        "actions": [{"agent": "language_specialist", "why": "Hindi"}],
                        "considered": [],
                    },
                    "reasoning": "To fix the critique.",
                },
            ]
        )
        steps.answers["planner"] = lambda body: next(plans)
        steps.answers["evaluator"] = {"evaluation": evaluation(6), "reasoning": ""}
        result = await run(
            steps,
            gateway,
            prompts=dict(PROMPTS),
            bundle=orchestrated_bundle(),
            session={**SESSION, "language": "hi"},
        )
        order = [(e["step"], e["kind"]) for e in result["logs"]]
        assert order[0] == ("plan", "code")
        assert result["logs"][0]["output"]["orchestrated"] is True
        assert in_order(
            order,
            [
                ("plan", "code"),
                ("profile", "code"),
                ("planner", "model"),
                ("dispatch", "code"),
                ("guidance_lookup", "code"),
                ("dispatch", "code"),
                ("writer", "model"),
                ("evaluator", "model"),
                ("score_draft", "code"),
                ("top_up", "code"),
                ("planner", "model"),
                ("dispatch", "code"),
                ("language_specialist", "model"),
                ("dispatch", "code"),
                ("reviser", "model"),
            ],
        )
        assert order.count(("guidance_lookup", "code")) == 1

        profile = by_step(result, "profile")[0]
        assert profile["output"]["profile"] and profile["output"]["offered"]
        assert profile["output"]["next"] == "planner"
        planner = by_step(result, "planner", "model")[0]
        assert planner["promptCode"] == "debrief_planner_system"
        sent = next(c["body"] for c in steps.calls if c["path"] == "planner")
        assert planner["input"].replace(
            SYSTEM_PROMPT_MARKER, "You are the planner."
        ) == steps.message("planner", sent)
        assert [a["agent"] for a in planner["output"]["plan"]["actions"]] == [
            "guidance_lookup"
        ]
        assert planner["output"]["plan"]["considered"][0]["why_not"] == "no cohort"
        first = by_step(result, "dispatch")[0]
        assert [c["agent"] for c in first["input"]["plan"]["chosen"]] == [
            "guidance_lookup"
        ]
        assert all("estimatedUsd" in c for c in first["input"]["plan"]["chosen"])
        assert first["input"]["plan"]["dropped"] == []
        assert first["output"]["sent"] == ["guidance_lookup"]
        top = by_step(result, "top_up")[0]
        assert top["round"] == 1 and top["output"]["next"] == "planner"
        assert top["input"]["critique"] is not None
        second = by_step(result, "planner", "model")[1]
        assert second["round"] == 1

    async def test_budget_drops_are_on_the_dispatch_entry(self, steps, gateway):
        steps.answers["planner"] = {
            "plan": {
                "actions": [{"agent": "language_specialist", "why": "Hindi"}],
                "considered": [],
            },
            "reasoning": "",
        }
        result = await run(
            steps,
            gateway,
            prompts=dict(PROMPTS),
            bundle=orchestrated_bundle(),
            session={**SESSION, "language": "hi"},
            prices={
                **__import__(
                    "tests.core.debrief_graph.fakes", fromlist=["PRICES"]
                ).PRICES,
                "agent-m": {"input_per_m": 1e6, "output_per_m": 1e6},
            },
        )
        dispatch_entry = by_step(result, "dispatch")[0]
        dropped = dispatch_entry["input"]["plan"]["dropped"]
        assert dropped and dropped[0]["code"] in ("budget", "no_price")
        assert dispatch_entry["attention"] is True


class TestDispatchCapture:
    async def test_generate_structured_records_the_call_when_asked(self):
        class Out(BaseModel):
            answer: str = ""

        async def gemini(**kw):
            dispatch._emit_usage("gemini", kw["model"], "t", (12, 3, 15))
            return Out(answer="yes")

        with (
            patch.object(dispatch.settings.GEMINI, "API_KEY", "g"),
            patch.dict(dispatch._GENERATORS, {"gemini": gemini}),
        ):
            # No capture open: nothing is recorded.
            await dispatch.generate_structured(
                schema=Out, prompt="q", provider="gemini", model="gemini-2.5-flash"
            )
            with capture_calls() as calls:
                await dispatch.generate_structured(
                    schema=Out,
                    prompt="the exact message",
                    provider="gemini",
                    model="gemini-2.5-flash",
                    never_fallback=True,
                )
        assert len(calls) == 1
        call = calls[0]
        assert call["prompt"] == "the exact message"
        assert call["reply"] == {"answer": "yes"}
        assert (call["tokens_in"], call["tokens_out"]) == (12, 3)
        assert call["model"] == "gemini-2.5-flash" and call["error"] is None

    async def test_a_failed_call_records_its_error(self):
        class Out(BaseModel):
            answer: str = ""

        failing = AsyncMock(side_effect=ValueError("bad json"))
        with (
            patch.object(dispatch.settings.GEMINI, "API_KEY", "g"),
            patch.dict(dispatch._GENERATORS, {"gemini": failing}),
        ):
            with capture_calls() as calls:
                with pytest.raises(Exception):
                    await dispatch.generate_structured(
                        schema=Out,
                        prompt="m",
                        provider="gemini",
                        model="gemini-2.5-flash",
                        never_fallback=True,
                    )
        assert calls[0]["reply"] is None
        assert "bad json" in calls[0]["error"]
