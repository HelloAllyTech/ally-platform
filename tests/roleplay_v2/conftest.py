"""Shared fixtures for roleplay v2 tests (no network, no LiveKit)."""

import copy

import pytest

from scenario_spec_sample import SCENARIO_SPEC_SAMPLE

from app.roleplay_v2.spec.models import RoleplaySpecEnvelope, ScenarioSpec
from app.roleplay_v2.spec.runtime_state import RuntimeStateStore


@pytest.fixture
def sample_envelope_dict() -> dict:
    """Deep copy of the checked-in sample envelope (mutable per-test)."""
    return copy.deepcopy(SCENARIO_SPEC_SAMPLE)


@pytest.fixture
def sample_spec_dict(sample_envelope_dict) -> dict:
    return sample_envelope_dict["spec"]


@pytest.fixture
def sample_spec(sample_spec_dict) -> ScenarioSpec:
    return ScenarioSpec.model_validate(sample_spec_dict)


@pytest.fixture
def sample_envelope(sample_envelope_dict) -> RoleplaySpecEnvelope:
    return RoleplaySpecEnvelope.model_validate(sample_envelope_dict)


@pytest.fixture
def state_store(sample_spec) -> RuntimeStateStore:
    return RuntimeStateStore(sample_spec)
