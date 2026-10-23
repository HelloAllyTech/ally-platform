"""Fixtures specifically for scenario testing."""

from typing import Any, Dict
from unittest.mock import Mock

import factory

from app.core.scenario.base import PromptData, Scenario, ScenarioVoice, VoiceConfig


class VoiceConfigFactory(factory.Factory):
    """Factory for creating VoiceConfig instances."""

    class Meta:
        model = VoiceConfig

    model = factory.Faker(
        "random_element", elements=["nova-2", "eleven_multilingual_v2", "tts-1"]
    )
    voice_id = factory.Faker("uuid4")
    speaker = factory.Faker("random_element", elements=["male", "female", "neutral"])


class ScenarioVoiceFactory(factory.Factory):
    """Factory for creating ScenarioVoice instances."""

    class Meta:
        model = ScenarioVoice

    name = factory.Faker("word")
    provider = factory.Faker(
        "random_element", elements=["deepgram", "elevenlabs", "openai"]
    )
    config = factory.SubFactory(VoiceConfigFactory)


class PromptDataFactory(factory.Factory):
    """Factory for creating PromptData instances."""

    class Meta:
        model = PromptData

    name = factory.Faker("name")
    age = factory.LazyFunction(
        lambda: str(
            factory.Faker("random_int", min=18, max=80).evaluate(None, None, {})
        )
    )
    gender = factory.Faker("random_element", elements=["male", "female", "non-binary"])
    gender_identity = factory.LazyAttribute(lambda obj: obj.gender)
    sexual_orientation = factory.Faker(
        "random_element",
        elements=["heterosexual", "homosexual", "bisexual", "pansexual"],
    )
    current_location = factory.Faker("city")
    profession = factory.Faker("job")
    context = factory.Faker("text", max_nb_chars=200)
    session_behavior_guidelines = factory.Faker("text", max_nb_chars=150)
    life_history_summary = factory.Faker("text", max_nb_chars=500)
    core_memories = factory.Faker("text", max_nb_chars=300)
    personality = factory.Faker("text", max_nb_chars=100)
    starting_state = factory.Faker(
        "random_element", elements=["calm", "anxious", "excited", "neutral"]
    )
    emotional_needs = factory.Faker("text", max_nb_chars=100)
    tone = factory.Faker(
        "random_element", elements=["professional", "casual", "warm", "formal"]
    )
    opening_statements = factory.LazyFunction(
        lambda: [factory.Faker("sentence").evaluate(None, None, {}) for _ in range(2)]
    )
    agent_goal = factory.Faker("text", max_nb_chars=100)


class ScenarioFactory(factory.Factory):
    """Factory for creating Scenario instances."""

    class Meta:
        model = Scenario

    name = factory.Faker("sentence", nb_words=3)
    events = factory.LazyFunction(list)  # Empty list by default
    metadata = factory.LazyFunction(dict)  # Empty dict by default
    voice = factory.SubFactory(ScenarioVoiceFactory)
    prompt_data = factory.SubFactory(PromptDataFactory)


def create_mock_scenario(**overrides) -> Mock:
    """Create a mock scenario with realistic data."""
    mock_scenario = Mock(spec=Scenario)

    # Default values
    defaults = {
        "name": "Mock Scenario",
        "events": [],
        "metadata": {},
        "voice": None,
        "prompt_data": None,
    }

    # Apply overrides
    defaults.update(overrides)

    # Set attributes on mock
    for key, value in defaults.items():
        setattr(mock_scenario, key, value)

    return mock_scenario


def create_scenario_payload(**overrides) -> Dict[str, Any]:
    """Create a scenario payload dictionary for testing."""
    base_payload = {
        "title": "Test Scenario",
        "description": "Test scenario description",
        "metadata": {},
        "voice": {
            "name": "test_voice",
            "provider": "deepgram",
            "config": {
                "model": "nova-2",
                "voice_id": "test_voice_id",
                "speaker": "test_speaker",
            },
        },
        "promptData": {
            "name": "Test Character",
            "age": 25,
            "gender": "female",
            "genderIdentity": "female",
            "sexualOrientation": "heterosexual",
            "currentLocation": "Test City",
            "profession": "Test Profession",
            "context": "Test context",
            "sessionBehaviorGuidelines": "Test guidelines",
            "lifeHistory": "Test life history",
            "coreMemories": "Test memories",
            "personality": "Test personality",
            "startingState": "Test state",
            "emotionalNeeds": "Test needs",
            "tone": "Test tone",
            "openingStatements": ["Hello!", "How are you?"],
            "agentGoal": "Test goal",
        },
        "events": [],
    }

    # Apply overrides recursively
    def deep_update(base_dict, update_dict):
        for key, value in update_dict.items():
            if (
                isinstance(value, dict)
                and key in base_dict
                and isinstance(base_dict[key], dict)
            ):
                deep_update(base_dict[key], value)
            else:
                base_dict[key] = value

    deep_update(base_payload, overrides)
    return base_payload


def create_room_metadata_envelope_payload(**overrides) -> Dict[str, Any]:
    """Create a complete room metadata envelope payload."""
    base_payload = {"version": "1.0", "scenario": create_scenario_payload()}

    # Apply overrides
    if "scenario" in overrides:
        scenario_overrides = overrides.pop("scenario")
        base_payload["scenario"] = create_scenario_payload(**scenario_overrides)

    base_payload.update(overrides)
    return base_payload


# Predefined test scenarios for common use cases
MINIMAL_SCENARIO_PAYLOAD = create_scenario_payload(
    title="Minimal Scenario",
    description="Minimal test scenario",
    voice={"name": "minimal_voice", "provider": "deepgram", "config": {}},
    promptData={
        "name": "Minimal Character",
        "age": 30,
        "gender": "male",
        "currentLocation": "Minimal City",
        "context": "Minimal context",
        "lifeHistory": "Minimal history",
        "openingStatements": ["Hi!"],
    },
)

COMPLEX_SCENARIO_PAYLOAD = create_scenario_payload(
    title="Complex Scenario",
    description="Complex test scenario with all features",
    metadata={"complexity": "high", "tags": ["advanced", "comprehensive"]},
    voice={
        "name": "complex_voice",
        "provider": "elevenlabs",
        "config": {
            "model": "eleven_multilingual_v2",
            "voice_id": "complex_voice_id",
            "speaker": "complex_speaker",
        },
    },
    events=[
        {"id": "event_1", "type": "test_event", "data": {"test": True}},
        {"id": "event_2", "type": "another_event", "data": {"value": 42}},
    ],
)

VOICE_VARIATIONS = [
    {"name": "deepgram_voice", "provider": "deepgram", "config": {"model": "nova-2"}},
    {
        "name": "elevenlabs_voice",
        "provider": "elevenlabs",
        "config": {"model": "eleven_multilingual_v2"},
    },
    {"name": "openai_voice", "provider": "openai", "config": {"model": "tts-1"}},
]

PROMPT_DATA_VARIATIONS = [
    {
        "name": "Young Professional",
        "age": 25,
        "gender": "female",
        "profession": "Software Engineer",
        "personality": "Ambitious and tech-savvy",
    },
    {
        "name": "Experienced Counselor",
        "age": 45,
        "gender": "non-binary",
        "profession": "Mental Health Counselor",
        "personality": "Empathetic and wise",
    },
    {
        "name": "Creative Artist",
        "age": 32,
        "gender": "male",
        "profession": "Graphic Designer",
        "personality": "Creative and expressive",
    },
]
