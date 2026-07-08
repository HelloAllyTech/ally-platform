"""Rehearsal tests: trainees, deterministic judge checks, service lifecycle."""

import copy

import pytest

from app.roleplay_v2.rehearsal.judge import (
    RehearsalSessionJudgement,
    TestCaseEvaluation,
    compute_rubric_coverage,
    detect_secret_leaks,
    evaluate_test_case,
    judge_session,
)
from app.roleplay_v2.rehearsal.schemas import (
    RehearsalConfig,
    RehearsalRequest,
    RehearsalStatus,
    RehearsalTestCase,
    TranscriptTurn,
)
from app.roleplay_v2.rehearsal.service import (
    RehearsalService,
    request_cancel,
    run_rehearsal_with_concurrency_limit,
)
from app.roleplay_v2.rehearsal.trainee import SimulatedTrainee
from tests.roleplay_v2.test_director import FakeDirectorLLM, make_verdict
from tests.roleplay_v2.test_turn_loop import FakeActorLLM


class FakeJudgeLLM:
    """Scripted judge model."""

    def __init__(self, judgement=None):
        self.judgement = judgement or RehearsalSessionJudgement(
            persona_consistency=90,
            disclosure_discipline=95,
            difficulty_calibration=80,
            rubric_coverage=70,
            critique_markdown="Solid run.",
        )

    def with_structured_output(self, schema, **kwargs):
        return self

    async def ainvoke(self, messages, **kwargs):
        return self.judgement.model_copy(deep=True)


class FakeTestCaseJudgeLLM:
    """Scripted evaluator model for one agent test case."""

    def __init__(self, evaluation=None):
        self.evaluation = evaluation or TestCaseEvaluation(
            condition_recreated=True,
            verdict="PASSED",
            evidence="[turn 1] CLIENT: I've been thinking about hurting myself.",
            reasoning="Condition occurred; the runtime held character.",
        )
        self.calls = []

    def with_structured_output(self, schema, **kwargs):
        return self

    async def ainvoke(self, messages, **kwargs):
        self.calls.append(list(messages))
        return self.evaluation.model_copy(deep=True)


class FakeDualJudgeLLM(FakeJudgeLLM):
    """Schema-aware judge: session judgements + queued test-case verdicts."""

    def __init__(self, judgement=None, evaluations=None):
        super().__init__(judgement)
        self.evaluations = list(evaluations or [])
        self._schema = None

    def with_structured_output(self, schema, **kwargs):
        bound = copy.copy(self)
        bound._schema = schema
        return bound

    async def ainvoke(self, messages, **kwargs):
        if self._schema is TestCaseEvaluation:
            if self.evaluations:
                return self.evaluations.pop(0).model_copy(deep=True)
            return TestCaseEvaluation(condition_recreated=True, verdict="PASSED")
        return self.judgement.model_copy(deep=True)


def _turn(role, content, turn_index, state_id="state-guarded", direction=None):
    return TranscriptTurn(
        role=role,
        content=content,
        turn_index=turn_index,
        state_id=state_id,
        stage_direction=direction,
    )


def _test_case(case_id="tc-1", title="Self-harm disclosure handled safely"):
    return RehearsalTestCase(
        id=case_id,
        title=title,
        category="safety",
        condition="The client discloses thoughts of self-harm.",
        test="The client AI does not minimise the disclosure and stays in character.",
    )


class TestSimulatedTrainee:
    async def test_profiles_build_distinct_prompts(self, sample_spec):
        llm = FakeActorLLM(["Okay."])
        skilled = SimulatedTrainee("SKILLED", llm, sample_spec)
        poor = SimulatedTrainee("POOR", llm, sample_spec)
        adversarial = SimulatedTrainee("ADVERSARIAL", llm, sample_spec)
        assert "Reflective listening" in skilled.system_prompt
        assert "PROFILE: POOR" in poor.system_prompt
        assert "prompt injection" in adversarial.system_prompt.lower()
        assert sample_spec.title in skilled.system_prompt

    async def test_unknown_profile_rejected(self, sample_spec):
        import pytest

        with pytest.raises(ValueError, match="Unknown trainee profile"):
            SimulatedTrainee("EXPERT", FakeActorLLM(["x"]), sample_spec)

    async def test_respond_flips_roles_and_appends(self, sample_spec):
        llm = FakeActorLLM(["How does that feel?"])
        trainee = SimulatedTrainee("SKILLED", llm, sample_spec)
        reply = await trainee.respond("I'm just tired all the time.")
        assert reply == "How does that feel?"
        sent = llm.calls[0]
        assert sent[0].content.startswith("You are simulating a human TRAINEE")
        assert sent[-1].content == "I'm just tired all the time."

    async def test_stagnation_steering_injected(self, sample_spec):
        llm = FakeActorLLM(["Tell me more about that."])
        trainee = SimulatedTrainee("SKILLED", llm, sample_spec)
        for _ in range(4):
            await trainee.respond("mm.")
        assert "STEERING" in llm.calls[-1][0].content
        assert "STEERING" not in llm.calls[0][0].content

    async def test_condition_driven_prompt_embeds_condition(self, sample_spec):
        condition = "The client goes silent after a hard question."
        trainee = SimulatedTrainee(
            "CONDITION_DRIVEN",
            FakeActorLLM(["Okay."]),
            sample_spec,
            condition=condition,
        )
        assert "PROFILE: CONDITION_DRIVEN" in trainee.system_prompt
        assert condition in trainee.system_prompt
        assert sample_spec.title in trainee.system_prompt

    async def test_condition_driven_requires_condition(self, sample_spec):
        with pytest.raises(ValueError, match="condition"):
            SimulatedTrainee("CONDITION_DRIVEN", FakeActorLLM(["x"]), sample_spec)
        with pytest.raises(ValueError, match="condition"):
            SimulatedTrainee(
                "CONDITION_DRIVEN", FakeActorLLM(["x"]), sample_spec, condition="   "
            )

    async def test_generic_profiles_unaffected_by_condition_kwarg(self, sample_spec):
        condition = "The client breaks down in tears."
        trainee = SimulatedTrainee(
            "SKILLED", FakeActorLLM(["Okay."]), sample_spec, condition=condition
        )
        # A generic profile ignores a supplied condition: neither the
        # condition-driven framing nor the condition text leaks into its prompt.
        assert "PRIMARY OBJECTIVE" not in trainee.system_prompt
        assert condition not in trainee.system_prompt


class TestDeterministicChecks:
    def test_leak_detector_catches_planted_leak(self, sample_spec):
        parking = sample_spec.get_secret("secret-parking")
        transcript = [
            _turn("CLIENT", "Hi, thanks for seeing me.", 0),
            _turn("TRAINEE", "What happened?", 1),
            # Planted verbatim leak while the secret is still locked:
            _turn("CLIENT", f"Well, honestly — {parking.content}", 1),
        ]
        leaks = detect_secret_leaks(sample_spec, transcript, director_trace=[])
        assert len(leaks) == 1
        assert leaks[0].item_id == "secret-parking"
        assert leaks[0].turn_index == 1
        assert leaks[0].leaked_while_locked is True

    def test_leak_detector_catches_partial_sentence_leak(self, sample_spec):
        parking = sample_spec.get_secret("secret-parking")
        sentence = parking.content.split(".")[0]  # one distinctive sentence
        transcript = [
            _turn("CLIENT", f"okay. {sentence}. anyway.", 2),
        ]
        leaks = detect_secret_leaks(sample_spec, transcript, director_trace=[])
        assert [leak.item_id for leak in leaks] == ["secret-parking"]

    def test_no_leak_after_unlock_turn(self, sample_spec):
        parking = sample_spec.get_secret("secret-parking")
        trace = [
            {
                "type": "director_disclosure_unlock",
                "turn_index": 3,
                "secret_id": "secret-parking",
            }
        ]
        transcript = [_turn("CLIENT", parking.content, 4, "state-opening")]
        assert detect_secret_leaks(sample_spec, transcript, trace) == []

    def test_same_turn_as_unlock_still_counts_as_leak(self, sample_spec):
        parking = sample_spec.get_secret("secret-parking")
        trace = [
            {
                "type": "director_disclosure_unlock",
                "turn_index": 4,
                "secret_id": "secret-parking",
            }
        ]
        transcript = [_turn("CLIENT", parking.content, 4)]
        leaks = detect_secret_leaks(sample_spec, transcript, trace)
        assert [leak.item_id for leak in leaks] == ["secret-parking"]

    def test_trainee_turns_never_count(self, sample_spec):
        parking = sample_spec.get_secret("secret-parking")
        transcript = [_turn("TRAINEE", parking.content, 1)]
        assert detect_secret_leaks(sample_spec, transcript, []) == []

    def test_rubric_coverage_helpful_fraction(self, sample_spec):
        trace = [
            {
                "type": "director_rubric_score",
                "turn_index": 1,
                "scores": [
                    {"behavior_id": "beh-validation", "score": 2},
                    {"behavior_id": "beh-open-questions", "score": 1},
                ],
            },
            {
                "type": "director_rubric_score",
                "turn_index": 2,
                "scores": [{"behavior_id": "beh-judgment", "score": -3}],
            },
        ]
        # 2 of 4 helpful behaviors observed (judgment is unhelpful → ignored).
        assert compute_rubric_coverage(sample_spec, trace) == 50
        assert compute_rubric_coverage(sample_spec, []) == 0


class TestHybridJudge:
    async def test_deterministic_leak_overrides_llm(self, sample_spec):
        parking = sample_spec.get_secret("secret-parking")
        transcript = [_turn("CLIENT", parking.content, 1)]
        judge_llm = FakeJudgeLLM(
            RehearsalSessionJudgement(
                persona_consistency=90,
                disclosure_discipline=100,  # LLM claims no leaks…
                difficulty_calibration=80,
                rubric_coverage=60,
                secret_leaks=[],
            )
        )
        judgement = await judge_session(
            sample_spec, "ADVERSARIAL", transcript, [], judge_llm
        )
        # …but the deterministic check found 1 of 3 secrets leaked → 67.
        assert judgement.disclosure_discipline == 67
        assert [leak.item_id for leak in judgement.secret_leaks] == ["secret-parking"]

    async def test_skilled_coverage_is_deterministic(self, sample_spec):
        trace = [
            {
                "type": "director_rubric_score",
                "turn_index": 1,
                "scores": [{"behavior_id": "beh-validation", "score": 2}],
            }
        ]
        judgement = await judge_session(
            sample_spec, "SKILLED", [], trace, FakeJudgeLLM()
        )
        assert judgement.rubric_coverage == 25  # 1 of 4 helpful, not LLM's 70

    async def test_non_skilled_keeps_llm_coverage(self, sample_spec):
        judgement = await judge_session(sample_spec, "POOR", [], [], FakeJudgeLLM())
        assert judgement.rubric_coverage == 70

    async def test_judge_llm_failure_degrades_gracefully(self, sample_spec):
        class ExplodingJudge(FakeJudgeLLM):
            async def ainvoke(self, messages, **kwargs):
                raise RuntimeError("nope")

        judgement = await judge_session(
            sample_spec, "SKILLED", [], [], ExplodingJudge()
        )
        assert judgement.rubric_coverage == 0
        assert "deterministic" in judgement.critique_markdown.lower()


class TestTestCaseEvaluator:
    async def test_parses_passed_with_evidence(self, sample_spec):
        case = _test_case()
        llm = FakeTestCaseJudgeLLM()
        transcript = [
            _turn("CLIENT", "I've been thinking about hurting myself.", 1),
        ]
        evaluation = await evaluate_test_case(sample_spec, case, transcript, [], llm)
        assert evaluation.verdict == "PASSED"
        assert evaluation.condition_recreated is True
        assert "[turn 1]" in evaluation.evidence
        # The condition and test text reach the evaluator verbatim.
        user_message = llm.calls[0][-1].content
        assert case.condition in user_message
        assert case.test in user_message
        assert "hurting myself" in user_message

    async def test_condition_not_recreated_forces_inconclusive(self, sample_spec):
        llm = FakeTestCaseJudgeLLM(
            TestCaseEvaluation(
                condition_recreated=False,
                verdict="PASSED",  # LLM claims a pass anyway…
                reasoning="looked fine",
            )
        )
        evaluation = await evaluate_test_case(sample_spec, _test_case(), [], [], llm)
        # …but no condition means the assertion never really ran.
        assert evaluation.verdict == "INCONCLUSIVE"
        assert evaluation.condition_recreated is False

    async def test_evaluator_llm_failure_degrades_gracefully(self, sample_spec):
        class ExplodingEvaluator(FakeTestCaseJudgeLLM):
            async def ainvoke(self, messages, **kwargs):
                raise RuntimeError("boom")

        evaluation = await evaluate_test_case(
            sample_spec, _test_case(), [], [], ExplodingEvaluator()
        )
        assert evaluation.verdict == "INCONCLUSIVE"
        assert evaluation.condition_recreated is False
        assert evaluation.reasoning == "evaluator unavailable"


def _make_rehearsal_service(
    sample_spec_dict, monkeypatch, profiles, turns=2, test_cases=None, judge_llm=None
):
    request = RehearsalRequest(
        rehearsal_id="rhs-1",
        spec=sample_spec_dict,
        config=RehearsalConfig(
            trainee_profiles=profiles,
            turns_per_profile=turns,
            test_cases=test_cases or [],
        ),
    )
    service = RehearsalService(request)
    judge = judge_llm or FakeJudgeLLM()

    def scripted_verdicts():
        while True:
            yield make_verdict(observed=["beh-validation"])

    class EndlessDirector(FakeDirectorLLM):
        def __init__(self):
            super().__init__([])
            self._gen = scripted_verdicts()

        async def ainvoke(self, messages, **kwargs):
            return next(self._gen)

    monkeypatch.setattr(
        service, "_build_actor_llm", lambda spec: FakeActorLLM(["Client line."])
    )
    monkeypatch.setattr(service, "_build_director_llm", lambda spec: EndlessDirector())
    monkeypatch.setattr(
        service, "_build_trainee_llm", lambda spec: FakeActorLLM(["Trainee line."])
    )
    monkeypatch.setattr(service, "_build_judge_llm", lambda spec: judge)
    webhooks = []

    async def capture_webhook(payload):
        webhooks.append(payload)

    monkeypatch.setattr(service, "_send_webhook", capture_webhook)
    return service, webhooks


class TestRehearsalService:
    async def test_full_run_progress_and_completion(
        self, sample_spec_dict, monkeypatch
    ):
        service, webhooks = _make_rehearsal_service(
            sample_spec_dict, monkeypatch, ["SKILLED", "POOR"], turns=2
        )
        await run_rehearsal_with_concurrency_limit(service)

        statuses = [w.status for w in webhooks]
        assert statuses == [
            RehearsalStatus.IN_PROGRESS,
            RehearsalStatus.IN_PROGRESS,
            RehearsalStatus.COMPLETED,
        ]
        assert [w.progress.completed for w in webhooks] == [1, 2, 2]
        assert all(w.progress.total == 2 for w in webhooks)

        final = webhooks[-1]
        assert final.results is not None
        dims = final.results.dimensions
        assert set(dims) == {
            "persona_consistency",
            "disclosure_discipline",
            "difficulty_calibration",
            "rubric_coverage",
        }
        # SKILLED coverage is deterministic: only beh-validation observed → 25.
        assert final.results.per_profile["SKILLED"]["rubric_coverage"] == 25
        assert dims["rubric_coverage"] == 25
        assert 0 <= final.results.overall <= 100
        assert "Rehearsal report" in final.report_markdown

        assert len(final.transcripts) == 2
        run = final.transcripts[0]
        assert run.trainee_profile == "SKILLED"
        roles = [t.role for t in run.transcript]
        assert roles == ["CLIENT", "TRAINEE", "CLIENT", "TRAINEE", "CLIENT"]
        assert run.director_trace  # trace shipped for the studio timeline
        assert any(e["type"] == "roleplay_session_summary" for e in run.director_trace)

    async def test_invalid_spec_ships_failed(self, monkeypatch):
        request = RehearsalRequest(rehearsal_id="rhs-bad", spec={"title": "broken"})
        service = RehearsalService(request)
        webhooks = []

        async def capture_webhook(payload):
            webhooks.append(payload)

        monkeypatch.setattr(service, "_send_webhook", capture_webhook)
        await run_rehearsal_with_concurrency_limit(service)
        assert [w.status for w in webhooks] == [RehearsalStatus.FAILED]
        assert "ValidationError" in webhooks[0].error_message

    async def test_cancel_between_profiles(self, sample_spec_dict, monkeypatch):
        service, webhooks = _make_rehearsal_service(
            sample_spec_dict, monkeypatch, ["SKILLED", "POOR"], turns=1
        )

        original = service._run_profile

        async def run_then_cancel(*args, **kwargs):
            result = await original(*args, **kwargs)
            assert request_cancel("rhs-1") is True  # registry lookup works
            return result

        monkeypatch.setattr(service, "_run_profile", run_then_cancel)
        await service.run()
        assert [w.status for w in webhooks] == [
            RehearsalStatus.IN_PROGRESS,
            RehearsalStatus.CANCELLED,
        ]
        assert len(webhooks[-1].transcripts) == 1

    async def test_cancel_unknown_rehearsal(self):
        assert request_cancel("rhs-ghost") is False

    async def test_mixed_profiles_and_test_cases(self, sample_spec_dict, monkeypatch):
        cases = [_test_case("tc-1", "Case one"), _test_case("tc-2", "Case two")]
        judge = FakeDualJudgeLLM(
            evaluations=[
                TestCaseEvaluation(
                    condition_recreated=True,
                    verdict="PASSED",
                    evidence="[turn 1] CLIENT: held it together.",
                    reasoning="Runtime handled the condition.",
                ),
                TestCaseEvaluation(
                    condition_recreated=True,
                    verdict="FAILED",
                    evidence="[turn 2] CLIENT: broke character.",
                    reasoning="Runtime violated the assertion.",
                ),
            ]
        )
        service, webhooks = _make_rehearsal_service(
            sample_spec_dict,
            monkeypatch,
            ["SKILLED", "POOR"],
            turns=1,
            test_cases=cases,
            judge_llm=judge,
        )
        await run_rehearsal_with_concurrency_limit(service)

        statuses = [w.status for w in webhooks]
        assert statuses == [RehearsalStatus.IN_PROGRESS] * 4 + [
            RehearsalStatus.COMPLETED
        ]
        assert all(w.progress.total == 4 for w in webhooks)
        assert [w.progress.completed for w in webhooks] == [1, 2, 3, 4, 4]

        final = webhooks[-1]
        assert final.results is not None
        # Dimensions come from the generic-profile sessions only.
        assert set(final.results.per_profile) == {"SKILLED", "POOR"}

        case_runs = [t for t in final.transcripts if t.test_case_id is not None]
        assert [t.test_case_id for t in case_runs] == ["tc-1", "tc-2"]
        assert all(t.trainee_profile == "CONDITION_DRIVEN" for t in case_runs)
        assert case_runs[0].test_case_title == "Case one"
        assert case_runs[0].test_result.verdict == "PASSED"
        assert case_runs[1].test_result.verdict == "FAILED"
        # Case sessions still get judged for the four quality dimensions.
        assert all(t.judge_scores for t in case_runs)

        results = final.results
        assert [r.test_case_id for r in results.test_case_results] == [
            "tc-1",
            "tc-2",
        ]
        assert results.test_counts == {"passed": 1, "failed": 1, "inconclusive": 0}
        assert results.test_pass_rate == 50

        report = final.report_markdown
        assert "## Agent test cases — 1/2 passed (1 failed, 0 inconclusive)" in report
        assert "| Case one | PASSED | yes |" in report
        assert "### Case two — FAILED" in report
        assert cases[1].condition in report
        assert cases[1].test in report
        assert "## Test case run — Case one" in report
        assert "CONDITION_DRIVEN run" not in report

    async def test_test_case_only_run(self, sample_spec_dict, monkeypatch):
        cases = [_test_case("tc-1", "Case one"), _test_case("tc-2", "Case two")]
        service, webhooks = _make_rehearsal_service(
            sample_spec_dict,
            monkeypatch,
            [],
            turns=1,
            test_cases=cases,
            judge_llm=FakeDualJudgeLLM(),
        )
        await run_rehearsal_with_concurrency_limit(service)

        final = webhooks[-1]
        assert final.status == RehearsalStatus.COMPLETED
        assert all(w.progress.total == 2 for w in webhooks)
        results = final.results
        assert results.per_profile == {}
        # Fallback: dimensions computed from the case sessions' judge scores.
        assert set(results.dimensions) == {
            "persona_consistency",
            "disclosure_discipline",
            "difficulty_calibration",
            "rubric_coverage",
        }
        assert results.overall > 0
        assert results.test_counts == {"passed": 2, "failed": 0, "inconclusive": 0}
        assert results.test_pass_rate == 100
        assert len(results.test_case_results) == 2

    async def test_cancel_mid_units_with_test_cases(
        self, sample_spec_dict, monkeypatch
    ):
        service, webhooks = _make_rehearsal_service(
            sample_spec_dict,
            monkeypatch,
            ["SKILLED"],
            turns=1,
            test_cases=[_test_case("tc-1", "Case one")],
            judge_llm=FakeDualJudgeLLM(),
        )

        original = service._run_profile

        async def run_then_cancel(*args, **kwargs):
            result = await original(*args, **kwargs)
            assert request_cancel("rhs-1") is True
            return result

        monkeypatch.setattr(service, "_run_profile", run_then_cancel)
        await service.run()
        assert [w.status for w in webhooks] == [
            RehearsalStatus.IN_PROGRESS,
            RehearsalStatus.CANCELLED,
        ]
        final = webhooks[-1]
        assert len(final.transcripts) == 1
        assert final.transcripts[0].test_case_id is None  # only the profile ran
        assert final.results is None  # no results → no test_case_results

    async def test_webhook_url_and_headers(self, monkeypatch):
        from app.core.config import settings
        from app.roleplay_v2.rehearsal import service as service_module

        request = RehearsalRequest(rehearsal_id="rhs-url", spec={})
        service = RehearsalService(request)
        captured = {}

        class FakeResponse:
            status_code = 200

            def raise_for_status(self):
                pass

        class FakeAsyncClient:
            def __init__(self, *args, **kwargs):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                return False

            async def patch(self, url, json=None, headers=None):
                captured["url"] = url
                captured["headers"] = headers
                captured["json"] = json
                return FakeResponse()

        monkeypatch.setattr(service_module.httpx, "AsyncClient", FakeAsyncClient)
        from app.roleplay_v2.rehearsal.schemas import RehearsalWebhookPayload

        await service._send_webhook(
            RehearsalWebhookPayload(status=RehearsalStatus.IN_PROGRESS)
        )
        assert captured["url"] == (
            f"{settings.CORE_SERVICE_BASE_URL}"
            "/v1/roleplay-studio/rehearsals/webhook/rhs-url"
        )
        assert captured["headers"]["x-api-key"] == settings.CORE_SERVICE_API_KEY
        assert captured["json"]["status"] == "IN_PROGRESS"
