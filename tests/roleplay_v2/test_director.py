"""Director tests: code-level guard validation, scoring, staleness, timeout."""

import asyncio

from app.roleplay_v2.director.emitters import DirectorEmitter
from app.roleplay_v2.director.schemas import (
    BehaviorObservation,
    DirectorVerdict,
    GuardEvaluation,
)
from app.roleplay_v2.director.service import DirectorService, truncate_stage_direction


class FakeDirectorLLM:
    """Scripted structured-output chat model (no network)."""

    def __init__(self, verdicts=None, delay_s: float = 0.0):
        self.verdicts = list(verdicts or [])
        self.delay_s = delay_s
        self.calls = []
        self.model_name = "fake-director"

    def with_structured_output(self, schema, **kwargs):
        return self

    async def ainvoke(self, messages, **kwargs):
        self.calls.append(messages)
        if self.delay_s:
            await asyncio.sleep(self.delay_s)
        if not self.verdicts:
            return DirectorVerdict()
        return self.verdicts.pop(0)


def make_verdict(
    turn_index=1,
    observed=(),
    satisfied_guards=(),
    next_state_id=None,
    unlock_ids=(),
    fire_event_ids=(),
    stage_direction=None,
    retrieve_topics=(),
):
    return DirectorVerdict(
        turn_index=turn_index,
        behavior_observations=[
            BehaviorObservation(behavior_id=b, observed=True, evidence=f"quote-{b}")
            for b in observed
        ],
        guard_evaluations=[
            GuardEvaluation(transition_id=g, satisfied=True, reason="scripted")
            for g in satisfied_guards
        ],
        next_state_id=next_state_id,
        unlock_ids=list(unlock_ids),
        fire_event_ids=list(fire_event_ids),
        stage_direction=stage_direction,
        retrieve_topics=list(retrieve_topics),
        confidence=0.9,
    )


def make_service(sample_spec, state_store, verdicts, timeout_s=5.0, delay_s=0.0):
    llm = FakeDirectorLLM(verdicts, delay_s=delay_s)
    emitter = DirectorEmitter("room-test", room=None, enable_sqs=False)
    service = DirectorService(
        sample_spec,
        state_store,
        llm,
        emitter,
        timeout_s=timeout_s,
    )
    return service, emitter, llm


class TestPromptAssembly:
    def test_system_prompt_has_full_ledger_and_machine(self, sample_spec, state_store):
        service, _, _ = make_service(sample_spec, state_store, [])
        prompt = service._system_prompt
        # The Director (referee) sees secret contents AND unlock conditions.
        for secret in sample_spec.disclosure_ledger.secrets:
            assert secret.content in prompt
        assert "initialStateId" in prompt
        assert "whenBehaviorsAny" in prompt
        # Time events are code-owned — never offered to the LLM.
        assert "evt-phone-buzz" not in prompt
        assert "evt-lecture-pushback" in prompt


class TestScoreComputation:
    async def test_scores_from_weights_and_polarity(self, sample_spec, state_store):
        await state_store.begin_turn()
        verdict = make_verdict(
            observed=["beh-validation", "beh-judgment"],  # +2 and -3
        )
        service, emitter, _ = make_service(sample_spec, state_store, [verdict])
        result = await service.run_turn(1, "you're overreacting, but ok", "...")
        assert result is not None
        snap = await state_store.snapshot()
        assert snap.cumulative_score == -1.0
        assert snap.behavior_hits["beh-validation"] == 1
        assert snap.behavior_hits["beh-judgment"] == 1
        score_msgs = [t for t in emitter.trace if t["type"] == "director_rubric_score"]
        assert len(score_msgs) == 1
        scores = {s["behavior_id"]: s["score"] for s in score_msgs[0]["scores"]}
        assert scores == {"beh-validation": 2, "beh-judgment": -3}
        rationales = {s["behavior_id"]: s["rationale"] for s in score_msgs[0]["scores"]}
        assert rationales["beh-validation"] == "quote-beh-validation"

    async def test_unknown_behavior_ignored(self, sample_spec, state_store):
        await state_store.begin_turn()
        verdict = make_verdict(observed=["beh-ghost"])
        service, emitter, _ = make_service(sample_spec, state_store, [verdict])
        await service.run_turn(1, "hi", "hello")
        snap = await state_store.snapshot()
        assert snap.cumulative_score == 0.0


class TestTransitionValidation:
    async def test_transition_via_satisfied_guard_accepted(
        self, sample_spec, state_store
    ):
        # Turn 1: validation observed (score 2, but minTurnsInState=2 not met).
        await state_store.begin_turn()
        v1 = make_verdict(turn_index=1, observed=["beh-validation"])
        # Turn 2: guard satisfied, min turns + min score now pass.
        v2 = make_verdict(
            turn_index=2,
            observed=["beh-reflective-listening"],
            satisfied_guards=["t-guarded-testing"],
            next_state_id="state-testing",
            stage_direction="Risk one true detail.",
        )
        service, emitter, _ = make_service(sample_spec, state_store, [v1, v2])
        await service.run_turn(1, "That sounds exhausting.", "It's fine.")
        await state_store.begin_turn()
        result = await service.run_turn(2, "You've been carrying a lot.", "...maybe.")
        assert result is not None
        snap = await state_store.snapshot()
        assert snap.current_state_id == "state-testing"
        assert snap.state_path == ["state-guarded", "state-testing"]
        transitions = [
            t for t in emitter.trace if t["type"] == "director_state_transition"
        ]
        assert transitions == [
            {
                "type": "director_state_transition",
                "turn_index": 2,
                "from_state_id": "state-guarded",
                "to_state_id": "state-testing",
                "guard_id": "t-guarded-testing",
                "observed_behavior": "beh-reflective-listening",
                "rationale": "scripted",
            }
        ]

    async def test_transition_with_unsatisfied_guard_rejected(
        self, sample_spec, state_store
    ):
        await state_store.begin_turn()
        # Director proposes the state but marked NO guard satisfied.
        verdict = make_verdict(
            observed=["beh-validation"],
            satisfied_guards=[],
            next_state_id="state-testing",
        )
        service, emitter, _ = make_service(sample_spec, state_store, [verdict])
        await service.run_turn(1, "hi", "hello")
        snap = await state_store.snapshot()
        assert snap.current_state_id == "state-guarded"
        assert not [
            t for t in emitter.trace if t["type"] == "director_state_transition"
        ]

    async def test_transition_failing_min_turns_rejected(
        self, sample_spec, state_store
    ):
        await state_store.begin_turn()  # turns_in_state == 1 < minTurnsInState 2
        verdict = make_verdict(
            observed=["beh-validation", "beh-reflective-listening"],
            satisfied_guards=["t-guarded-testing"],
            next_state_id="state-testing",
        )
        service, _, _ = make_service(sample_spec, state_store, [verdict])
        await service.run_turn(1, "hi", "hello")
        snap = await state_store.snapshot()
        assert snap.current_state_id == "state-guarded"

    async def test_transition_failing_behavior_condition_rejected(
        self, sample_spec, state_store
    ):
        await state_store.begin_turn()
        await state_store.begin_turn()
        # Guard "satisfied" per LLM but none of the whenBehaviorsAny observed.
        verdict = make_verdict(
            turn_index=2,
            observed=["beh-open-questions"],
            satisfied_guards=["t-guarded-testing"],
            next_state_id="state-testing",
        )
        service, _, _ = make_service(sample_spec, state_store, [verdict])
        await service.run_turn(2, "what's up?", "nothing")
        snap = await state_store.snapshot()
        assert snap.current_state_id == "state-guarded"

    async def test_unknown_state_rejected(self, sample_spec, state_store):
        await state_store.begin_turn()
        verdict = make_verdict(
            satisfied_guards=["t-guarded-testing"], next_state_id="state-ghost"
        )
        service, _, _ = make_service(sample_spec, state_store, [verdict])
        await service.run_turn(1, "hi", "hello")
        snap = await state_store.snapshot()
        assert snap.current_state_id == "state-guarded"


class TestUnlockValidation:
    async def test_unlock_rejected_outside_min_states(self, sample_spec, state_store):
        await state_store.begin_turn()
        verdict = make_verdict(
            observed=["beh-validation"], unlock_ids=["secret-parking"]
        )
        service, emitter, _ = make_service(sample_spec, state_store, [verdict])
        await service.run_turn(1, "hi", "hello")
        snap = await state_store.snapshot()
        assert snap.ledger["secret-parking"] == "locked"
        assert not [
            t for t in emitter.trace if t["type"] == "director_disclosure_unlock"
        ]

    async def test_unlock_accepted_with_transition_into_allowed_state(
        self, sample_spec, state_store
    ):
        # Get to state-testing with score 5 first.
        await state_store.begin_turn()
        await state_store.begin_turn()
        await state_store.commit(
            2,
            next_state_id="state-testing",
            observed_behavior_ids=["beh-validation", "beh-reflective-listening"],
            score_delta=5.0,
        )
        await state_store.begin_turn()
        await state_store.begin_turn()
        # Turn 4: transition testing→opening AND unlock secret-parking, whose
        # minStateIds require opening — legal because the transition lands.
        verdict = make_verdict(
            turn_index=4,
            observed=["beh-open-questions", "beh-validation"],
            satisfied_guards=["t-testing-opening"],
            next_state_id="state-opening",
            unlock_ids=["secret-parking"],
        )
        service, emitter, _ = make_service(sample_spec, state_store, [verdict])
        result = await service.run_turn(4, "what's the heaviest part?", "...")
        assert result is not None
        snap = await state_store.snapshot()
        assert snap.current_state_id == "state-opening"
        assert snap.ledger["secret-parking"] == "unlocked"
        unlock_msgs = [
            t for t in emitter.trace if t["type"] == "director_disclosure_unlock"
        ]
        assert unlock_msgs[0]["secret_id"] == "secret-parking"
        assert unlock_msgs[0]["unlock_condition_id"] == "cond-parking-safety"
        # Contract: SQS summary is topic-level, never raw content.
        parking = sample_spec.get_secret("secret-parking")
        assert unlock_msgs[0]["disclosed_content_summary"] == parking.topic
        assert parking.content not in str(emitter.trace)


class TestStaleness:
    async def test_stale_commit_rejected_via_service(self, sample_spec, state_store):
        v_new = make_verdict(turn_index=2, observed=["beh-validation"])
        v_old = make_verdict(turn_index=1, observed=["beh-judgment"])
        service, _, _ = make_service(sample_spec, state_store, [v_new, v_old])
        await state_store.begin_turn()
        await state_store.begin_turn()
        # Turn 2's verdict lands first...
        assert await service.run_turn(2, "b", "b'") is not None
        # ...then turn 1's late verdict must be dropped (returns None).
        assert await service.run_turn(1, "a", "a'") is None
        snap = await state_store.snapshot()
        assert snap.cumulative_score == 2.0  # only the validation applied
        assert snap.behavior_hits["beh-judgment"] == 0


class TestTimeoutAndFailure:
    async def test_timeout_records_miss(self, sample_spec, state_store):
        verdict = make_verdict(observed=["beh-validation"])
        service, _, _ = make_service(
            sample_spec, state_store, [verdict], timeout_s=0.05, delay_s=0.5
        )
        await state_store.begin_turn()
        result = await service.run_turn(1, "hi", "hello")
        assert result is None
        snap = await state_store.snapshot()
        assert snap.director_misses == 1
        assert snap.cumulative_score == 0.0

    async def test_llm_exception_records_miss(self, sample_spec, state_store):
        class ExplodingLLM(FakeDirectorLLM):
            async def ainvoke(self, messages, **kwargs):
                raise RuntimeError("provider down")

        llm = ExplodingLLM()
        emitter = DirectorEmitter("room-test", room=None, enable_sqs=False)
        service = DirectorService(sample_spec, state_store, llm, emitter, timeout_s=1.0)
        await state_store.begin_turn()
        assert await service.run_turn(1, "hi", "hello") is None
        snap = await state_store.snapshot()
        assert snap.director_misses == 1

    async def test_on_turn_committed_is_fire_and_forget(self, sample_spec, state_store):
        verdict = make_verdict(observed=["beh-validation"])
        service, _, _ = make_service(sample_spec, state_store, [verdict])
        await state_store.begin_turn()
        service.on_turn_committed(1, "hi", "hello")
        await service.flush()
        snap = await state_store.snapshot()
        assert snap.cumulative_score == 2.0


class TestStageDirection:
    def test_truncate_first_sentence(self):
        assert (
            truncate_stage_direction("Soften now. Then push harder.") == "Soften now."
        )

    def test_truncate_200_chars(self):
        long = "x" * 500
        assert len(truncate_stage_direction(long)) == 200

    def test_truncate_empty(self):
        assert truncate_stage_direction(None) is None
        assert truncate_stage_direction("   ") is None

    async def test_engineered_event_direction_wins(self, sample_spec, state_store):
        await state_store.begin_turn()
        verdict = make_verdict(
            observed=["beh-judgment"],
            fire_event_ids=["evt-lecture-pushback"],
            stage_direction="Ignore this free-form direction.",
        )
        service, emitter, _ = make_service(sample_spec, state_store, [verdict])
        await service.run_turn(1, "you should just relax", "…")
        snap = await state_store.snapshot()
        assert snap.fired_events == ["evt-lecture-pushback"]
        assert snap.stage_direction.startswith("Call it out, in character:")
        directions = [
            t for t in emitter.trace if t["type"] == "director_stage_direction"
        ]
        assert directions[0]["kind"] == "engineered_event"
        assert directions[0]["event_id"] == "evt-lecture-pushback"

    async def test_behavior_event_requires_observed_behavior(
        self, sample_spec, state_store
    ):
        await state_store.begin_turn()
        verdict = make_verdict(
            observed=["beh-validation"],  # NOT one of the event's behaviors
            fire_event_ids=["evt-lecture-pushback"],
        )
        service, _, _ = make_service(sample_spec, state_store, [verdict])
        await service.run_turn(1, "hi", "hello")
        snap = await state_store.snapshot()
        assert snap.fired_events == []


class TestTimeEvents:
    async def test_time_event_fires_without_llm(self, sample_spec, state_store):
        # Shrink the sample's 300s trigger so the test runs instantly.
        spec = sample_spec.model_copy(deep=True)
        spec.engineered_events[0].at_seconds = 0.01
        emitter = DirectorEmitter("room-test", room=None, enable_sqs=False)
        llm = FakeDirectorLLM()
        service = DirectorService(spec, state_store, llm, emitter, timeout_s=1.0)
        service.start_time_events()
        await asyncio.sleep(0.1)
        await service.flush()
        snap = await state_store.snapshot()
        assert "evt-phone-buzz" in snap.fired_events
        assert snap.stage_direction.startswith("Your phone buzzes")
        assert llm.calls == []  # no LLM involvement for time triggers
        directions = [
            t for t in emitter.trace if t["type"] == "director_stage_direction"
        ]
        assert directions[0]["kind"] == "engineered_event"
        assert directions[0]["event_id"] == "evt-phone-buzz"


class TestSessionSummary:
    async def test_summary_shape(self, sample_spec, state_store):
        await state_store.begin_turn()
        await state_store.commit(
            1,
            next_state_id="state-shutdown",
            observed_behavior_ids=["beh-judgment"],
            score_delta=-3.0,
        )
        service, emitter, _ = make_service(sample_spec, state_store, [])
        await service.emit_session_summary()
        summaries = [
            t for t in emitter.trace if t["type"] == "roleplay_session_summary"
        ]
        assert len(summaries) == 1
        s = summaries[0]
        assert s["final_state_id"] == "state-shutdown"
        assert s["state_path"] == ["state-guarded", "state-shutdown"]
        assert s["cumulative_score"] == -3.0
        assert s["behavior_hits"]["beh-judgment"] == 1
        assert s["ledger"]["secret-parking"] == "locked"
