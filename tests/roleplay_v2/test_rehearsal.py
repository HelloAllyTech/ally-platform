"""Rehearsal tests: trainees, deterministic judge checks, service lifecycle."""

from app.roleplay_v2.rehearsal.judge import (
    RehearsalSessionJudgement,
    compute_rubric_coverage,
    detect_secret_leaks,
    judge_session,
)
from app.roleplay_v2.rehearsal.schemas import (
    RehearsalConfig,
    RehearsalRequest,
    RehearsalStatus,
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


def _turn(role, content, turn_index, state_id="state-guarded", direction=None):
    return TranscriptTurn(
        role=role,
        content=content,
        turn_index=turn_index,
        state_id=state_id,
        stage_direction=direction,
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


def _make_rehearsal_service(sample_spec_dict, monkeypatch, profiles, turns=2):
    request = RehearsalRequest(
        rehearsal_id="rhs-1",
        spec=sample_spec_dict,
        config=RehearsalConfig(trainee_profiles=profiles, turns_per_profile=turns),
    )
    service = RehearsalService(request)

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
    monkeypatch.setattr(service, "_build_judge_llm", lambda spec: FakeJudgeLLM())
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
