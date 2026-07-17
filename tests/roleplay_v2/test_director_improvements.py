"""Tests for the roleplay v2 Director accuracy/safety improvements.

Covers: cumulative-behavior transition/unlock guards (O2), the confidence
gate on irreversible actions (O4), the live locked-secret leak guard on
Director-authored stage directions (O3), unlocked→revealed ledger tracking
(O6), and score-rise engineered events (O9).
"""

import pytest

from app.core.config import settings
from app.roleplay_v2.director.emitters import DirectorEmitter
from app.roleplay_v2.director.schemas import (
    BehaviorObservation,
    DirectorVerdict,
    GuardEvaluation,
)
from app.roleplay_v2.director.service import DirectorService
from app.roleplay_v2.spec.models import ScenarioSpec
from app.roleplay_v2.spec.runtime_state import (
    LEDGER_REVEALED,
    LEDGER_UNLOCKED,
    RuntimeStateStore,
)

pytestmark = pytest.mark.asyncio


class FakeDirectorLLM:
    def __init__(self, verdicts):
        self.verdicts = list(verdicts)
        self.model_name = "fake-director"

    def with_structured_output(self, schema, **kwargs):
        return self

    async def ainvoke(self, messages, **kwargs):
        return self.verdicts.pop(0)


def _verdict(**kwargs):
    observed = kwargs.pop("observed", ())
    satisfied = kwargs.pop("satisfied_guards", ())
    return DirectorVerdict(
        behavior_observations=[
            BehaviorObservation(behavior_id=b, observed=True, evidence=f"q-{b}")
            for b in observed
        ],
        guard_evaluations=[
            GuardEvaluation(transition_id=g, satisfied=True, reason="scripted")
            for g in satisfied
        ],
        confidence=kwargs.pop("confidence", 0.9),
        **kwargs,
    )


def _service(spec, store, verdicts):
    emitter = DirectorEmitter("room-test", room=None, enable_sqs=False)
    return DirectorService(
        spec, store, FakeDirectorLLM(verdicts), emitter, timeout_s=5.0
    )


async def _advance_to_turn(store, target_turn):
    while store._state.turn_index < target_turn:
        await store.begin_turn()


# ---------------------------------------------------------------------------
# O2 — cumulative behaviors satisfy whenBehaviorsAll / unlock conditions
# ---------------------------------------------------------------------------


class TestCumulativeBehaviorGuards:
    async def test_all_of_guard_satisfied_by_earlier_turn(
        self, sample_spec, state_store
    ):
        # Seed: in state-testing, open-questions already observed on an earlier
        # turn (so it lives in behavior_hits, not this turn's observations).
        await state_store.commit(
            1,
            next_state_id="state-testing",
            observed_behavior_ids=["beh-open-questions"],
            score_delta=6,
        )
        await _advance_to_turn(state_store, 3)  # minTurnsInState=2

        # This turn observes ONLY beh-validation (the any-of behavior); the
        # all-of behavior (beh-open-questions) is NOT re-observed this turn.
        verdict = _verdict(
            observed=["beh-validation"],
            satisfied_guards=["t-testing-opening"],
            next_state_id="state-opening",
        )
        service = _service(sample_spec, state_store, [verdict])
        applied = await service.run_turn(3, "trainee", "client")
        assert applied is not None
        snap = await state_store.snapshot()
        assert snap.current_state_id == "state-opening"

    async def test_all_of_guard_rejected_when_never_observed(
        self, sample_spec, state_store
    ):
        # Same setup but the all-of behavior was NEVER observed.
        await state_store.commit(
            1,
            next_state_id="state-testing",
            observed_behavior_ids=["beh-validation"],
            score_delta=6,
        )
        await _advance_to_turn(state_store, 3)
        verdict = _verdict(
            observed=["beh-validation"],
            satisfied_guards=["t-testing-opening"],
            next_state_id="state-opening",
        )
        service = _service(sample_spec, state_store, [verdict])
        await service.run_turn(3, "trainee", "client")
        snap = await state_store.snapshot()
        assert snap.current_state_id == "state-testing"  # transition rejected

    async def test_unlock_condition_met_by_earlier_behavior(
        self, sample_spec, state_store
    ):
        # secret-parking unlocks on beh-validation (minStateIds includes
        # state-opening). Validation was shown earlier; this turn does not
        # repeat it, but the cumulative hit still satisfies the condition.
        await state_store.commit(
            1,
            next_state_id="state-opening",
            observed_behavior_ids=["beh-validation"],
            score_delta=4,
        )
        await _advance_to_turn(state_store, 2)
        verdict = _verdict(observed=[], unlock_ids=["secret-parking"])
        service = _service(sample_spec, state_store, [verdict])
        await service.run_turn(2, "trainee", "client")
        snap = await state_store.snapshot()
        assert snap.ledger["secret-parking"] in (LEDGER_UNLOCKED, LEDGER_REVEALED)


# ---------------------------------------------------------------------------
# O4 — confidence gate holds back transitions/unlocks, never scoring
# ---------------------------------------------------------------------------


class TestConfidenceGate:
    async def test_low_confidence_holds_transition_but_keeps_score(
        self, sample_spec, state_store, monkeypatch
    ):
        monkeypatch.setattr(settings, "DIRECTOR_MIN_CONFIDENCE", 0.8)
        await state_store.commit(
            1,
            next_state_id="state-testing",
            observed_behavior_ids=["beh-open-questions"],
            score_delta=6,
        )
        await _advance_to_turn(state_store, 3)
        verdict = _verdict(
            observed=["beh-validation"],
            satisfied_guards=["t-testing-opening"],
            next_state_id="state-opening",
            confidence=0.3,  # below the 0.8 gate
        )
        service = _service(sample_spec, state_store, [verdict])
        await service.run_turn(3, "trainee", "client")
        snap = await state_store.snapshot()
        # Transition held back...
        assert snap.current_state_id == "state-testing"
        # ...but the behavior score still landed.
        assert snap.behavior_hits["beh-validation"] == 1

    async def test_high_confidence_applies_transition(
        self, sample_spec, state_store, monkeypatch
    ):
        monkeypatch.setattr(settings, "DIRECTOR_MIN_CONFIDENCE", 0.8)
        await state_store.commit(
            1,
            next_state_id="state-testing",
            observed_behavior_ids=["beh-open-questions"],
            score_delta=6,
        )
        await _advance_to_turn(state_store, 3)
        verdict = _verdict(
            observed=["beh-validation"],
            satisfied_guards=["t-testing-opening"],
            next_state_id="state-opening",
            confidence=0.95,
        )
        service = _service(sample_spec, state_store, [verdict])
        await service.run_turn(3, "trainee", "client")
        snap = await state_store.snapshot()
        assert snap.current_state_id == "state-opening"


# ---------------------------------------------------------------------------
# O3 — live leak guard drops a Director direction that names a locked secret
# ---------------------------------------------------------------------------


class TestStageDirectionLeakGuard:
    async def test_leaking_direction_dropped(self, sample_spec, state_store):
        secret = sample_spec.get_secret("secret-parking")
        await state_store.begin_turn()  # turn 1
        verdict = _verdict(observed=[], stage_direction=secret.content)
        service = _service(sample_spec, state_store, [verdict])
        await service.run_turn(1, "trainee", "client")
        snap = await state_store.snapshot()
        # The leaking direction must not have been injected.
        assert snap.stage_direction is None

    async def test_clean_direction_kept(self, sample_spec, state_store):
        await state_store.begin_turn()
        verdict = _verdict(observed=[], stage_direction="Stay guarded and terse.")
        service = _service(sample_spec, state_store, [verdict])
        await service.run_turn(1, "trainee", "client")
        snap = await state_store.snapshot()
        assert snap.stage_direction == "Stay guarded and terse."


# ---------------------------------------------------------------------------
# O6 — ledger advances unlocked→revealed when the actor voices the secret
# ---------------------------------------------------------------------------


class TestMarkRevealed:
    async def test_actor_voicing_secret_marks_revealed(self, sample_spec, state_store):
        secret = sample_spec.get_secret("secret-parking")
        await state_store.commit(
            1,
            next_state_id="state-opening",
            observed_behavior_ids=["beh-validation"],
            score_delta=4,
        )
        await _advance_to_turn(state_store, 2)
        verdict = _verdict(observed=["beh-validation"], unlock_ids=["secret-parking"])
        service = _service(sample_spec, state_store, [verdict])
        # The actor's utterance this turn actually discloses the secret.
        await service.run_turn(2, "trainee", secret.content)
        snap = await state_store.snapshot()
        assert snap.ledger["secret-parking"] == LEDGER_REVEALED

    async def test_health_counters_in_summary(self, sample_spec, state_store):
        await state_store.begin_turn()
        verdict = _verdict(observed=["beh-validation"])
        emitter = DirectorEmitter("room-test", room=None, enable_sqs=False)
        service = DirectorService(
            sample_spec, state_store, FakeDirectorLLM([verdict]), emitter, timeout_s=5.0
        )
        await service.run_turn(1, "trainee", "client")
        snap = await state_store.snapshot()
        assert snap.director_commits == 1


# ---------------------------------------------------------------------------
# O9 — score-rise engineered events
# ---------------------------------------------------------------------------


class TestScoreRiseEvents:
    def _spec_with_score_event(self, sample_spec_dict, comparison):
        d = dict(sample_spec_dict)
        d["engineeredEvents"] = list(d.get("engineeredEvents", [])) + [
            {
                "id": "evt-praise",
                "name": "Positive beat",
                "trigger": "score",
                "scoreThreshold": 3,
                "scoreComparison": comparison,
                "direction": "Soften; let a little warmth show.",
                "once": True,
            }
        ]
        return ScenarioSpec.model_validate(d)

    async def test_at_or_above_fires_when_score_rises(self, sample_spec_dict):
        spec = self._spec_with_score_event(sample_spec_dict, "at_or_above")
        store = RuntimeStateStore(spec)
        await store.begin_turn()
        # beh-validation (+2) x ... actually observe two helpful behaviors → +4 >= 3
        verdict = _verdict(
            observed=["beh-validation", "beh-open-questions"],
            fire_event_ids=["evt-praise"],
        )
        service = _service(spec, store, [verdict])
        await service.run_turn(1, "trainee", "client")
        snap = await store.snapshot()
        assert "evt-praise" in snap.fired_events

    async def test_default_at_or_below_does_not_fire_on_rise(self, sample_spec_dict):
        spec = self._spec_with_score_event(sample_spec_dict, "at_or_below")
        store = RuntimeStateStore(spec)
        await store.begin_turn()
        verdict = _verdict(
            # +4 (2+2), strictly above the threshold of 3 → decline-event stays quiet.
            observed=["beh-validation", "beh-exploring-meaning"],
            fire_event_ids=["evt-praise"],
        )
        service = _service(spec, store, [verdict])
        await service.run_turn(1, "trainee", "client")
        snap = await store.snapshot()
        assert "evt-praise" not in snap.fired_events
