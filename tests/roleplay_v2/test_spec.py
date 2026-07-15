"""Spec-model validation tests for roleplay v2."""

import pytest
from pydantic import ValidationError

from app.roleplay_v2.spec.models import (
    RoleplaySpecEnvelope,
    ScenarioSpec,
    SpecLanguage,
    SpecSessionInfo,
    StateMachine,
)
from app.roleplay_v2.spec.parse import parse_spec_metadata


class TestSampleSpec:
    def test_sample_spec_validates(self, sample_spec):
        assert sample_spec.title.startswith("Maya")
        assert sample_spec.competency_id == "active-listening"
        assert len(sample_spec.state_machine.states) == 5
        assert len(sample_spec.disclosure_ledger.secrets) == 3
        assert len(sample_spec.rubric.behaviors) >= 6
        assert len(sample_spec.engineered_events) == 2

    def test_camel_case_aliases_populate_snake_fields(self, sample_spec):
        state = sample_spec.state_machine.initial_state
        assert state.id == "state-guarded"
        assert state.default_stage_direction
        t = state.transitions[0]
        assert t.to_state_id == "state-testing"
        assert t.min_turns_in_state == 2
        secret = sample_spec.disclosure_ledger.secrets[0]
        assert secret.locked_deflection
        assert secret.min_state_ids == ["state-opening", "state-disclosing"]

    def test_snake_case_input_also_accepted(self):
        lang = SpecLanguage.model_validate(
            {"language_id": "l1", "language_code": "hi-IN"}
        )
        assert lang.language_code == "hi-IN"

    def test_model_specs_and_helpers(self, sample_spec):
        assert sample_spec.actor_model.to_llm_config()["provider"] == "openai"
        assert sample_spec.get_state("state-shutdown") is not None
        assert sample_spec.get_secret("secret-shame") is not None
        assert sample_spec.get_event("evt-phone-buzz") is not None
        assert sample_spec.language_code == "en-IN"
        helpful = sample_spec.rubric.get_behavior("beh-validation")
        assert helpful.signed_weight == 2
        unhelpful = sample_spec.rubric.get_behavior("beh-judgment")
        assert unhelpful.signed_weight == -3


class TestValidators:
    def _minimal_states(self, n):
        return [
            {"id": f"s{i}", "name": f"State {i}", "transitions": []} for i in range(n)
        ]

    def test_too_few_states_rejected(self):
        with pytest.raises(ValidationError, match="3-6 states"):
            StateMachine.model_validate(
                {"initialStateId": "s0", "states": self._minimal_states(2)}
            )

    def test_too_many_states_rejected(self):
        with pytest.raises(ValidationError, match="3-6 states"):
            StateMachine.model_validate(
                {"initialStateId": "s0", "states": self._minimal_states(7)}
            )

    def test_unknown_initial_state_rejected(self):
        with pytest.raises(ValidationError, match="exactly one"):
            StateMachine.model_validate(
                {"initialStateId": "nope", "states": self._minimal_states(3)}
            )

    def test_dangling_transition_target_rejected(self):
        states = self._minimal_states(3)
        states[0]["transitions"] = [{"id": "t1", "toStateId": "ghost"}]
        with pytest.raises(ValidationError, match="unknown state"):
            StateMachine.model_validate({"initialStateId": "s0", "states": states})

    def test_dangling_behavior_in_transition_rejected(self, sample_spec_dict):
        sample_spec_dict["stateMachine"]["states"][0]["transitions"][0][
            "whenBehaviorsAny"
        ] = ["beh-ghost"]
        with pytest.raises(ValidationError, match="unknown behavior"):
            ScenarioSpec.model_validate(sample_spec_dict)

    def test_dangling_state_in_secret_rejected(self, sample_spec_dict):
        sample_spec_dict["disclosureLedger"]["secrets"][0]["minStateIds"] = [
            "state-ghost"
        ]
        with pytest.raises(ValidationError, match="unknown state"):
            ScenarioSpec.model_validate(sample_spec_dict)

    def test_dangling_behavior_in_event_rejected(self, sample_spec_dict):
        sample_spec_dict["engineeredEvents"][1]["behaviorIds"] = ["beh-ghost"]
        with pytest.raises(ValidationError, match="unknown behavior"):
            ScenarioSpec.model_validate(sample_spec_dict)

    def test_time_event_requires_at_seconds(self, sample_spec_dict):
        sample_spec_dict["engineeredEvents"][0].pop("atSeconds")
        with pytest.raises(ValidationError, match="atSeconds"):
            ScenarioSpec.model_validate(sample_spec_dict)


class TestEnvelope:
    def test_envelope_parses_sample(self, sample_envelope):
        assert sample_envelope.is_roleplay_v2
        assert sample_envelope.spec_schema_version == "1.0"
        assert sample_envelope.session.spec_id == "spec-maya-burnout"
        assert sample_envelope.resolve_language().language_code == "en-IN"

    def test_envelope_voice_resolution_falls_back_to_spec(self, sample_envelope):
        voice = sample_envelope.resolve_voice()
        assert voice is not None
        assert voice.provider == "elevenlabs"
        assert voice.config.voice_id == "EXAVITQu4vr4xnSDxMaL"

    # Regression: ally-be sends languageId / session.userId as JSON *numbers*,
    # but we model them as strings. Before coerce_numbers_to_str these raised a
    # ValidationError inside the v2 entrypoint's configure(), so the agent never
    # joined the room ("Waiting for the agent to join" / director hang).
    def test_integer_id_fields_coerced_to_str(self):
        assert SpecLanguage.model_validate({"languageId": 1}).language_id == "1"
        assert SpecSessionInfo.model_validate({"userId": 1}).user_id == "1"

    def test_envelope_with_integer_ids_validates(self, sample_envelope_dict):
        d = sample_envelope_dict
        # Integers at the envelope paths ally-be actually sends as numbers
        # (spec.language coercion is covered by test_integer_id_fields_coerced_to_str).
        d["language"]["languageId"] = 1
        d["session"]["userId"] = 1
        env = RoleplaySpecEnvelope.model_validate(d)
        assert env.language.language_id == "1"
        assert env.session.user_id == "1"

    async def test_ensure_spec_returns_inline_spec(self, sample_envelope):
        spec = await sample_envelope.ensure_spec()
        assert spec.title.startswith("Maya")

    async def test_ensure_spec_without_spec_or_fetch_raises(self):
        envelope = RoleplaySpecEnvelope.model_validate({"engine": "roleplay_v2"})
        with pytest.raises(ValueError, match="neither"):
            await envelope.ensure_spec()

    def test_parse_spec_metadata_json_roundtrip(self, sample_envelope_dict):
        import json

        env = parse_spec_metadata(json.dumps(sample_envelope_dict))
        assert env.is_roleplay_v2
        assert env.spec is not None

    def test_parse_spec_metadata_local_fallback(self, monkeypatch):
        from app.core.config import settings
        from app.core.constants import Environment

        monkeypatch.setattr(settings, "ENV", Environment.LOCAL)
        env = parse_spec_metadata(None)
        assert env.is_roleplay_v2
        assert env.spec is not None

    def test_parse_spec_metadata_strict_outside_local(self, monkeypatch):
        from app.core.config import settings
        from app.core.constants import Environment

        monkeypatch.setattr(settings, "ENV", Environment.DEV)
        with pytest.raises(ValueError, match="missing or invalid"):
            parse_spec_metadata(None)
