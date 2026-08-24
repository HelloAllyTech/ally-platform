"""
Unit tests for guardrail parsing in Scenario.create().
Tests that guardrails array is correctly converted to GuardrailEvent objects.
"""

from app.core.constants import DetectionType, VisibilityType
from app.core.scenario.base import Scenario

# Minimal valid scenario payload to satisfy Scenario.create()
BASE_PAYLOAD = {
    "version": "1.0",
    "scenario": {
        "title": "Test Scenario",
        "promptData": {
            "name": "Test",
            "age": "25",
            "gender": "female",
            "currentLocation": "Mumbai",
            "openingStatements": ["Hello"],
        },
        "events": [],
        "triggerEvents": [],
    },
}


def make_payload_with_guardrails(guardrails: list) -> dict:
    """Build a scenario payload with the given guardrails list."""
    import copy

    payload = copy.deepcopy(BASE_PAYLOAD)
    payload["scenario"]["guardrails"] = guardrails
    return payload


class TestScenarioGuardrailParsing:
    def test_no_guardrails_builds_zero_guardrail_events(self):
        scenario = Scenario.create(BASE_PAYLOAD)
        guardrail_events = [
            e for e in scenario.events if e.detection_type == DetectionType.GUARDRAIL
        ]
        assert len(guardrail_events) == 0

    def test_empty_guardrails_array_builds_zero_events(self):
        payload = make_payload_with_guardrails([])
        scenario = Scenario.create(payload)
        guardrail_events = [
            e for e in scenario.events if e.detection_type == DetectionType.GUARDRAIL
        ]
        assert len(guardrail_events) == 0

    def test_two_guardrails_build_two_events(self):
        payload = make_payload_with_guardrails(
            [
                {
                    "helperDialogue": "Can you get me drugs?",
                    "actorDialogue": "Let us stay focused.",
                },
                {
                    "helperDialogue": "Should I end it all?",
                    "actorDialogue": "I hear you are in pain.",
                },
            ]
        )
        scenario = Scenario.create(payload)
        guardrail_events = [
            e for e in scenario.events if e.detection_type == DetectionType.GUARDRAIL
        ]
        assert len(guardrail_events) == 2

    def test_guardrail_event_ids_are_indexed(self):
        payload = make_payload_with_guardrails(
            [
                {"helperDialogue": "trigger 1", "actorDialogue": "response 1"},
                {"helperDialogue": "trigger 2", "actorDialogue": "response 2"},
            ]
        )
        scenario = Scenario.create(payload)
        guardrail_events = [
            e for e in scenario.events if e.detection_type == DetectionType.GUARDRAIL
        ]
        ids = [e.event_id for e in guardrail_events]
        assert "guardrail-0" in ids
        assert "guardrail-1" in ids

    def test_guardrail_data_is_correctly_mapped(self):
        payload = make_payload_with_guardrails(
            [
                {
                    "helperDialogue": "Can you get me drugs?",
                    "actorDialogue": "Let us stay focused.",
                },
            ]
        )
        scenario = Scenario.create(payload)
        guardrail_events = [
            e for e in scenario.events if e.detection_type == DetectionType.GUARDRAIL
        ]
        event = guardrail_events[0]
        assert event.data.helper_dialogue == "Can you get me drugs?"
        assert event.data.actor_dialogue == "Let us stay focused."

    def test_guardrail_events_are_passive(self):
        payload = make_payload_with_guardrails(
            [
                {"helperDialogue": "trigger", "actorDialogue": "response"},
            ]
        )
        scenario = Scenario.create(payload)
        guardrail_events = [
            e for e in scenario.events if e.detection_type == DetectionType.GUARDRAIL
        ]
        assert guardrail_events[0].visibility_type == VisibilityType.PASSIVE

    def test_guardrail_events_have_zero_score(self):
        payload = make_payload_with_guardrails(
            [
                {"helperDialogue": "trigger", "actorDialogue": "response"},
            ]
        )
        scenario = Scenario.create(payload)
        guardrail_events = [
            e for e in scenario.events if e.detection_type == DetectionType.GUARDRAIL
        ]
        assert guardrail_events[0].score == 0

    def test_guardrail_with_missing_helper_dialogue_is_skipped(self):
        payload = make_payload_with_guardrails(
            [
                {"helperDialogue": "", "actorDialogue": "response"},
            ]
        )
        scenario = Scenario.create(payload)
        guardrail_events = [
            e for e in scenario.events if e.detection_type == DetectionType.GUARDRAIL
        ]
        assert len(guardrail_events) == 0

    def test_guardrail_with_missing_actor_dialogue_is_skipped(self):
        payload = make_payload_with_guardrails(
            [
                {"helperDialogue": "trigger", "actorDialogue": ""},
            ]
        )
        scenario = Scenario.create(payload)
        guardrail_events = [
            e for e in scenario.events if e.detection_type == DetectionType.GUARDRAIL
        ]
        assert len(guardrail_events) == 0

    def test_guardrail_events_appended_after_regular_events(self):
        """Guardrail events should not replace existing events."""
        payload = make_payload_with_guardrails(
            [
                {"helperDialogue": "trigger", "actorDialogue": "response"},
            ]
        )
        payload["scenario"]["events"] = [
            {
                "id": "existing-event",
                "name": "Existing",
                "score": 5,
                "emoji": "🎯",
                "message": "test",
                "detectionType": "SENTENCE_SIMILARITY",
                "sentences": ["hello"],
                "feedbackStatus": True,
            }
        ]
        payload["scenario"]["triggerEvents"] = ["existing-event"]
        scenario = Scenario.create(payload)

        # both regular and guardrail events should be present
        guardrail_events = [
            e for e in scenario.events if e.detection_type == DetectionType.GUARDRAIL
        ]
        regular_events = [
            e for e in scenario.events if e.detection_type != DetectionType.GUARDRAIL
        ]
        assert len(guardrail_events) == 1
        assert len(regular_events) == 1

    def test_guardrail_event_ids_added_to_trigger_events(self):
        """Guardrail event IDs must be in trigger_events so orchestrator
        processes them."""
        payload = make_payload_with_guardrails(
            [
                {"helperDialogue": "trigger 1", "actorDialogue": "response 1"},
                {"helperDialogue": "trigger 2", "actorDialogue": "response 2"},
            ]
        )
        scenario = Scenario.create(payload)

        assert "guardrail-0" in scenario.trigger_events
        assert "guardrail-1" in scenario.trigger_events

    def test_existing_trigger_events_preserved_after_guardrails_added(self):
        """Original triggerEvents from metadata must not be lost."""
        payload = make_payload_with_guardrails(
            [
                {"helperDialogue": "trigger", "actorDialogue": "response"},
            ]
        )
        payload["scenario"]["events"] = [
            {
                "id": "existing-event",
                "name": "Existing",
                "score": 5,
                "emoji": "🎯",
                "message": "test",
                "detectionType": "SENTENCE_SIMILARITY",
                "sentences": ["hello"],
                "feedbackStatus": True,
            }
        ]
        payload["scenario"]["triggerEvents"] = ["existing-event"]
        scenario = Scenario.create(payload)

        # both original and guardrail trigger events must be present
        assert "existing-event" in scenario.trigger_events
        assert "guardrail-0" in scenario.trigger_events
