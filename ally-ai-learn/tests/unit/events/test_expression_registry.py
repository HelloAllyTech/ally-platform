"""
Tests for EventOrchestrator class.
"""

from unittest.mock import MagicMock

import pytest

from app.core.constants import DetectionType, ExpressionType
from app.core.events.event_orchestrator.event_orchestrator import EventOrchestrator
from app.core.events.event_types.combination.constants import ExpressionNode
from app.core.events.factory import build_events_from_metadata
from app.core.events.utils import evaluate_expression, extract_event_ids_from_expression
from app.core.scenario.base import Scenario


@pytest.fixture
def mock_room():
    """Create a mock LiveKit room."""
    room = MagicMock()
    room.name = "test-room"
    return room


@pytest.fixture
def thread_id():
    """Return a test thread ID."""
    return "test-thread-123"


def create_test_scenario(metadata):
    """Helper to create a Scenario object from metadata for testing."""
    events = build_events_from_metadata(metadata)
    scenario = MagicMock(spec=Scenario)
    scenario.events = events
    scenario.trigger_events = metadata.get("trigger_events", [])
    scenario.termination_events = []
    return scenario


class TestEventOrchestrator:

    def test_initialize_creates_orchestrator_for_all_events(self, mock_room, thread_id):
        """Test that initialize creates entries for all events."""
        metadata = {
            "events": [
                {"id": "event-1", "sentences": ["hello"]},
                {
                    "id": "event-2",
                    "detectionType": "TIME",
                    "data": {"time": 100, "condition": "LTE"},
                },
                {
                    "id": "event-3",
                    "detectionType": "SCORE",
                    "data": {"score": 5, "condition": "GT"},
                },
            ]
        }

        scenario = create_test_scenario(metadata)
        orchestrator = EventOrchestrator(scenario, mock_room, thread_id)

        # All events should be in registry
        assert len(orchestrator.event_registry) == 3
        # All events start as False in setup_initial_state()
        # TIME and SCORE events are only evaluated in async initialize()
        assert orchestrator.event_registry["event-1"].happened is False
        assert orchestrator.event_registry["event-2"].happened is False
        assert orchestrator.event_registry["event-3"].happened is False
        assert len(orchestrator.expression_list) == 0  # No combination events

    def test_initialize_adds_combination_events_to_expression_list(
        self, mock_room, thread_id
    ):
        """Test that combination events are added to expression_list."""
        metadata = {
            "events": [
                {"id": "event-1", "sentences": ["hello"]},
                {
                    "id": "combo-1",
                    "detectionType": "COMBINATION",
                    "data": {"expression": {"type": "IDENTIFIER", "id": "event-1"}},
                },
            ]
        }

        scenario = create_test_scenario(metadata)
        orchestrator = EventOrchestrator(scenario, mock_room, thread_id)

        assert len(orchestrator.expression_list) == 1
        assert orchestrator.expression_list[0]["event_id"] == "combo-1"
        assert orchestrator.expression_list[0]["type"] == DetectionType.COMBINATION
        assert isinstance(orchestrator.expression_list[0]["expression"], ExpressionNode)

    def test_update_sets_detected_events_to_true(self, mock_room, thread_id):
        """Test that update() sets detected event states to True."""
        metadata = {
            "events": [
                {"id": "event-1", "sentences": ["hello"]},
                {"id": "event-2", "sentences": ["world"]},
            ]
        }

        scenario = create_test_scenario(metadata)
        orchestrator = EventOrchestrator(scenario, mock_room, thread_id)

        # Initially all False
        assert orchestrator.event_registry["event-1"].happened is False
        assert orchestrator.event_registry["event-2"].happened is False

        # Update with detected events
        result = orchestrator.update(detected_event_ids={"event-1"})

        assert orchestrator.event_registry["event-1"].happened is True
        assert orchestrator.event_registry["event-2"].happened is False
        assert result["event-1"].happened is True
        assert result["event-2"].happened is False

    def test_evaluate_expression_identifier_returns_event_state(
        self, mock_room, thread_id
    ):
        """Test evaluating an IDENTIFIER expression."""
        metadata = {
            "events": [
                {"id": "event-1", "sentences": ["hello"]},
            ]
        }

        scenario = create_test_scenario(metadata)
        orchestrator = EventOrchestrator(scenario, mock_room, thread_id)

        # Create an identifier expression
        expr = ExpressionNode(type=ExpressionType.IDENTIFIER, id="event-1")

        # Initially False
        assert evaluate_expression(expr, orchestrator.event_registry) is False

        # After setting to True
        orchestrator.set_event_state("event-1", True)
        assert evaluate_expression(expr, orchestrator.event_registry) is True

    def test_evaluate_expression_identifier_unknown_event_returns_false(
        self, mock_room, thread_id
    ):
        """Test that unknown event IDs return False."""
        metadata = {"events": []}
        scenario = create_test_scenario(metadata)
        orchestrator = EventOrchestrator(scenario, mock_room, thread_id)

        expr = ExpressionNode(type=ExpressionType.IDENTIFIER, id="unknown-event")
        assert evaluate_expression(expr, orchestrator.event_registry) is False

    def test_evaluate_expression_not_negates_operand(self, mock_room, thread_id):
        """Test evaluating a NOT expression."""
        metadata = {
            "events": [
                {"id": "event-1", "sentences": ["hello"]},
            ]
        }

        scenario = create_test_scenario(metadata)
        orchestrator = EventOrchestrator(scenario, mock_room, thread_id)

        # NOT(False) = True
        expr = ExpressionNode(
            type=ExpressionType.NOT,
            operand=ExpressionNode(type=ExpressionType.IDENTIFIER, id="event-1"),
        )
        assert evaluate_expression(expr, orchestrator.event_registry) is True

        # NOT(True) = False
        orchestrator.set_event_state("event-1", True)
        assert evaluate_expression(expr, orchestrator.event_registry) is False

    def test_evaluate_expression_and_requires_both_true(self, mock_room, thread_id):
        """Test evaluating an AND expression."""
        metadata = {
            "events": [
                {"id": "event-1", "sentences": ["hello"]},
                {"id": "event-2", "sentences": ["world"]},
            ]
        }

        scenario = create_test_scenario(metadata)
        orchestrator = EventOrchestrator(scenario, mock_room, thread_id)

        expr = ExpressionNode(
            type=ExpressionType.AND,
            left=ExpressionNode(type=ExpressionType.IDENTIFIER, id="event-1"),
            right=ExpressionNode(type=ExpressionType.IDENTIFIER, id="event-2"),
        )

        # Both False -> False
        assert evaluate_expression(expr, orchestrator.event_registry) is False

        # One True -> False
        orchestrator.set_event_state("event-1", True)
        assert evaluate_expression(expr, orchestrator.event_registry) is False

        # Both True -> True
        orchestrator.set_event_state("event-2", True)
        assert evaluate_expression(expr, orchestrator.event_registry) is True

    def test_evaluate_expression_or_requires_at_least_one_true(
        self, mock_room, thread_id
    ):
        """Test evaluating an OR expression."""
        metadata = {
            "events": [
                {"id": "event-1", "sentences": ["hello"]},
                {"id": "event-2", "sentences": ["world"]},
            ]
        }

        scenario = create_test_scenario(metadata)
        orchestrator = EventOrchestrator(scenario, mock_room, thread_id)

        expr = ExpressionNode(
            type=ExpressionType.OR,
            left=ExpressionNode(type=ExpressionType.IDENTIFIER, id="event-1"),
            right=ExpressionNode(type=ExpressionType.IDENTIFIER, id="event-2"),
        )

        # Both False -> False
        assert evaluate_expression(expr, orchestrator.event_registry) is False

        # One True -> True
        orchestrator.set_event_state("event-1", True)
        assert evaluate_expression(expr, orchestrator.event_registry) is True

        # Both True -> True
        orchestrator.set_event_state("event-2", True)
        assert evaluate_expression(expr, orchestrator.event_registry) is True

    def test_evaluate_expression_nested_expression(self, mock_room, thread_id):
        """Test evaluating a nested expression: AND(NOT(A), OR(B, C))"""
        metadata = {
            "events": [
                {"id": "event-a", "sentences": ["hello"]},
                {"id": "event-b", "sentences": ["world"]},
                {"id": "event-c", "sentences": ["test"]},
            ]
        }

        scenario = create_test_scenario(metadata)
        orchestrator = EventOrchestrator(scenario, mock_room, thread_id)

        # AND(NOT(event-a), OR(event-b, event-c))
        expr = ExpressionNode(
            type=ExpressionType.AND,
            left=ExpressionNode(
                type=ExpressionType.NOT,
                operand=ExpressionNode(type=ExpressionType.IDENTIFIER, id="event-a"),
            ),
            right=ExpressionNode(
                type=ExpressionType.OR,
                left=ExpressionNode(type=ExpressionType.IDENTIFIER, id="event-b"),
                right=ExpressionNode(type=ExpressionType.IDENTIFIER, id="event-c"),
            ),
        )

        # event-a=False, event-b=False, event-c=False
        # NOT(False) AND OR(False, False) = True AND False = False
        assert evaluate_expression(expr, orchestrator.event_registry) is False

        # event-a=False, event-b=True, event-c=False
        # NOT(False) AND OR(True, False) = True AND True = True
        orchestrator.set_event_state("event-b", True)
        assert evaluate_expression(expr, orchestrator.event_registry) is True

        # event-a=True, event-b=True, event-c=False
        # NOT(True) AND OR(True, False) = False AND True = False
        orchestrator.set_event_state("event-a", True)
        assert evaluate_expression(expr, orchestrator.event_registry) is False

    def test_update_evaluates_combination_expressions(self, mock_room, thread_id):
        """Test that update() evaluates combination expressions and
        updates their states."""
        metadata = {
            "events": [
                {"id": "event-1", "sentences": ["hello"]},
                {"id": "event-2", "sentences": ["world"]},
                {
                    "id": "combo-1",
                    "detectionType": "COMBINATION",
                    "data": {
                        "expression": {
                            "type": "AND",
                            "left": {"type": "IDENTIFIER", "id": "event-1"},
                            "right": {"type": "IDENTIFIER", "id": "event-2"},
                        }
                    },
                },
            ]
        }

        scenario = create_test_scenario(metadata)
        orchestrator = EventOrchestrator(scenario, mock_room, thread_id)

        # Initially combo-1 should be False (both events False)
        assert orchestrator.get_event_state("combo-1") is False

        # Update with event-1 detected
        orchestrator.update(detected_event_ids={"event-1"})
        # Still False because event-2 is False
        assert orchestrator.get_event_state("combo-1") is False

        # Update with both events detected
        orchestrator.update(detected_event_ids={"event-1", "event-2"})
        # Now True because both are True
        assert orchestrator.get_event_state("combo-1") is True

    def test_get_event_state_returns_current_state(self, mock_room, thread_id):
        """Test get_event_state() method."""
        metadata = {
            "events": [
                {"id": "event-1", "sentences": ["hello"]},
            ]
        }

        scenario = create_test_scenario(metadata)
        orchestrator = EventOrchestrator(scenario, mock_room, thread_id)

        assert orchestrator.get_event_state("event-1") is False
        orchestrator.set_event_state("event-1", True)
        assert orchestrator.get_event_state("event-1") is True

    def test_set_event_state_updates_state(self, mock_room, thread_id):
        """Test set_event_state() method."""
        metadata = {
            "events": [
                {"id": "event-1", "sentences": ["hello"]},
            ]
        }

        scenario = create_test_scenario(metadata)
        orchestrator = EventOrchestrator(scenario, mock_room, thread_id)

        orchestrator.set_event_state("event-1", True)
        assert orchestrator.event_registry["event-1"].happened is True

        orchestrator.set_event_state("event-1", False)
        assert orchestrator.event_registry["event-1"].happened is False

    def test_evaluate_expression_invalid_identifier_returns_false(
        self, mock_room, thread_id
    ):
        """Test that invalid identifier (no name) returns False."""
        metadata = {"events": []}
        scenario = create_test_scenario(metadata)
        orchestrator = EventOrchestrator(scenario, mock_room, thread_id)

        expr = ExpressionNode(type=ExpressionType.IDENTIFIER, id=None)
        assert evaluate_expression(expr, orchestrator.event_registry) is False

    def test_evaluate_expression_invalid_not_returns_false(self, mock_room, thread_id):
        """Test that invalid NOT (no operand) returns False."""
        metadata = {"events": []}
        scenario = create_test_scenario(metadata)
        orchestrator = EventOrchestrator(scenario, mock_room, thread_id)

        expr = ExpressionNode(type=ExpressionType.NOT, operand=None)
        assert evaluate_expression(expr, orchestrator.event_registry) is False

    def test_evaluate_expression_invalid_and_returns_false(self, mock_room, thread_id):
        """Test that invalid AND (missing operands) returns False."""
        metadata = {"events": []}
        scenario = create_test_scenario(metadata)
        orchestrator = EventOrchestrator(scenario, mock_room, thread_id)

        expr = ExpressionNode(type=ExpressionType.AND, left=None, right=None)
        assert evaluate_expression(expr, orchestrator.event_registry) is False

    def test_evaluate_expression_invalid_or_returns_false(self, mock_room, thread_id):
        """Test that invalid OR (missing operands) returns False."""
        metadata = {"events": []}
        scenario = create_test_scenario(metadata)
        orchestrator = EventOrchestrator(scenario, mock_room, thread_id)

        expr = ExpressionNode(type=ExpressionType.OR, left=None, right=None)
        assert evaluate_expression(expr, orchestrator.event_registry) is False

    def test_initialize_sets_trigger_multiple_correctly(self, mock_room, thread_id):
        """Test that trigger_multiple is set correctly for different event types."""
        metadata = {
            "events": [
                {"id": "similarity-1", "sentences": ["hello"]},  # SENTENCE_SIMILARITY
                {
                    "id": "interruption-1",
                    "detectionType": "HELPER_INTERRUPTED",
                    "data": {},
                },
                {
                    "id": "paraphrased-1",
                    "detectionType": "HELPER_PARAPHRASED",
                    "data": {},
                },
                {
                    "id": "time-1",
                    "detectionType": "TIME",
                    "data": {"time": 100, "condition": "LTE"},
                },
                {
                    "id": "score-1",
                    "detectionType": "SCORE",
                    "data": {"score": 5, "condition": "GT"},
                },
                {
                    "id": "combo-1",
                    "detectionType": "COMBINATION",
                    "data": {
                        "expression": {"type": "IDENTIFIER", "id": "similarity-1"}
                    },
                },
            ]
        }

        scenario = create_test_scenario(metadata)
        orchestrator = EventOrchestrator(scenario, mock_room, thread_id)

        # SENTENCE_SIMILARITY, HELPER_INTERRUPTED, and HELPER_PARAPHRASED
        # should have trigger_multiple=True
        assert orchestrator.event_registry["similarity-1"].trigger_multiple is True
        assert orchestrator.event_registry["interruption-1"].trigger_multiple is True
        assert orchestrator.event_registry["paraphrased-1"].trigger_multiple is True
        # TIME, SCORE, COMBINATION should have trigger_multiple=False
        assert orchestrator.event_registry["time-1"].trigger_multiple is False
        assert orchestrator.event_registry["score-1"].trigger_multiple is False
        assert orchestrator.event_registry["combo-1"].trigger_multiple is False

    def test_trigger_events_filtering(self, mock_room, thread_id):
        """Test that trigger_events list filters which events are sent."""
        metadata = {
            "events": [
                {"id": "event-1", "sentences": ["hello"]},
                {"id": "event-2", "sentences": ["world"]},
                {"id": "event-3", "sentences": ["test"]},
            ],
            "trigger_events": ["event-1", "event-3"],
        }

        scenario = create_test_scenario(metadata)
        # Only event-1 and event-3 should be sent
        orchestrator = EventOrchestrator(scenario, mock_room, thread_id)

        assert orchestrator.trigger_events == {"event-1", "event-3"}

        # All events should still be in registry
        assert len(orchestrator.event_registry) == 3

    def test_circular_dependency_direct_self_reference_ignored(
        self, mock_room, thread_id
    ):
        """Test that combination events with direct self-reference are
        completely ignored."""
        metadata = {
            "events": [
                {"id": "event-1", "sentences": ["hello"]},
                {
                    "id": "circular-event",
                    "detectionType": "COMBINATION",
                    "data": {
                        "expression": {
                            "type": "IDENTIFIER",
                            "id": "circular-event",  # References itself
                        }
                    },
                },
            ]
        }

        scenario = create_test_scenario(metadata)
        orchestrator = EventOrchestrator(scenario, mock_room, thread_id)

        # Circular event should NOT be in event_registry
        assert "circular-event" not in orchestrator.event_registry
        # Circular event should NOT be in expression_list
        assert len(orchestrator.expression_list) == 0
        # Regular event should still be in registry
        assert "event-1" in orchestrator.event_registry
        assert len(orchestrator.event_registry) == 1

    def test_circular_dependency_indirect_self_reference_ignored(
        self, mock_room, thread_id
    ):
        """Test that combination events with indirect self-reference are
        completely ignored."""
        metadata = {
            "events": [
                {"id": "event-1", "sentences": ["hello"]},
                {
                    "id": "circular-event-a",
                    "detectionType": "COMBINATION",
                    "data": {
                        "expression": {
                            "type": "AND",
                            "left": {"type": "IDENTIFIER", "id": "event-1"},
                            "right": {
                                "type": "IDENTIFIER",
                                "id": "circular-event-a",  # References
                                # itself indirectly
                            },
                        }
                    },
                },
            ]
        }

        scenario = create_test_scenario(metadata)
        orchestrator = EventOrchestrator(scenario, mock_room, thread_id)

        # Circular event should NOT be in event_registry
        assert "circular-event-a" not in orchestrator.event_registry
        # Circular event should NOT be in expression_list
        assert len(orchestrator.expression_list) == 0
        # Regular event should still be in registry
        assert "event-1" in orchestrator.event_registry

    def test_circular_dependency_nested_self_reference_ignored(
        self, mock_room, thread_id
    ):
        """Test that combination events with nested self-reference are
        completely ignored."""
        metadata = {
            "events": [
                {"id": "event-1", "sentences": ["hello"]},
                {
                    "id": "circular-event",
                    "detectionType": "COMBINATION",
                    "data": {
                        "expression": {
                            "type": "AND",
                            "left": {"type": "IDENTIFIER", "id": "event-1"},
                            "right": {
                                "type": "NOT",
                                "operand": {
                                    "type": "IDENTIFIER",
                                    "id": "circular-event",  # References
                                    # itself in nested NOT
                                },
                            },
                        }
                    },
                },
            ]
        }

        scenario = create_test_scenario(metadata)
        orchestrator = EventOrchestrator(scenario, mock_room, thread_id)

        # Circular event should NOT be in event_registry
        assert "circular-event" not in orchestrator.event_registry
        # Circular event should NOT be in expression_list
        assert len(orchestrator.expression_list) == 0

    def test_circular_dependency_warning_logged(self, mock_room, thread_id, caplog):
        """Test that a warning is logged when circular dependency is detected."""
        import logging

        caplog.set_level(logging.WARNING)

        metadata = {
            "events": [
                {
                    "id": "circular-event",
                    "detectionType": "COMBINATION",
                    "data": {
                        "expression": {"type": "IDENTIFIER", "id": "circular-event"}
                    },
                }
            ]
        }

        scenario = create_test_scenario(metadata)
        EventOrchestrator(scenario, mock_room, thread_id)

        # Check that warning was logged
        assert any(
            "Circular dependency detected" in record.message
            for record in caplog.records
        )
        assert any("circular-event" in record.message for record in caplog.records)

    def test_non_circular_combination_events_are_added(self, mock_room, thread_id):
        """Test that non-circular combination events are still added normally."""
        metadata = {
            "events": [
                {"id": "event-1", "sentences": ["hello"]},
                {"id": "event-2", "sentences": ["world"]},
                {
                    "id": "combo-1",
                    "detectionType": "COMBINATION",
                    "data": {
                        "expression": {
                            "type": "AND",
                            "left": {"type": "IDENTIFIER", "id": "event-1"},
                            "right": {"type": "IDENTIFIER", "id": "event-2"},
                        }
                    },
                },
                {
                    "id": "circular-combo",
                    "detectionType": "COMBINATION",
                    "data": {
                        "expression": {
                            "type": "IDENTIFIER",
                            "id": "circular-combo",  # Circular
                        }
                    },
                },
            ]
        }

        scenario = create_test_scenario(metadata)
        orchestrator = EventOrchestrator(scenario, mock_room, thread_id)

        # Non-circular combo should be in registry
        assert "combo-1" in orchestrator.event_registry
        # Non-circular combo should be in expression_list
        assert len(orchestrator.expression_list) == 1
        assert orchestrator.expression_list[0]["event_id"] == "combo-1"

        # Circular combo should NOT be in registry
        assert "circular-combo" not in orchestrator.event_registry
        # Circular combo should NOT be in expression_list
        assert all(
            expr["event_id"] != "circular-combo"
            for expr in orchestrator.expression_list
        )

        # Regular events should be in registry
        assert "event-1" in orchestrator.event_registry
        assert "event-2" in orchestrator.event_registry
        assert len(orchestrator.event_registry) == 3  # event-1, event-2, combo-1

    def test_extract_event_ids_from_expression(self, mock_room, thread_id):
        """Test the extract_event_ids_from_expression utility function."""
        # Simple identifier
        expr1 = ExpressionNode(type=ExpressionType.IDENTIFIER, id="event-1")
        assert extract_event_ids_from_expression(expr1) == {"event-1"}

        # AND expression
        expr2 = ExpressionNode(
            type=ExpressionType.AND,
            left=ExpressionNode(type=ExpressionType.IDENTIFIER, id="event-1"),
            right=ExpressionNode(type=ExpressionType.IDENTIFIER, id="event-2"),
        )
        assert extract_event_ids_from_expression(expr2) == {"event-1", "event-2"}

        # Nested expression
        expr3 = ExpressionNode(
            type=ExpressionType.AND,
            left=ExpressionNode(
                type=ExpressionType.NOT,
                operand=ExpressionNode(type=ExpressionType.IDENTIFIER, id="event-1"),
            ),
            right=ExpressionNode(
                type=ExpressionType.OR,
                left=ExpressionNode(type=ExpressionType.IDENTIFIER, id="event-2"),
                right=ExpressionNode(type=ExpressionType.IDENTIFIER, id="event-3"),
            ),
        )
        assert extract_event_ids_from_expression(expr3) == {
            "event-1",
            "event-2",
            "event-3",
        }
