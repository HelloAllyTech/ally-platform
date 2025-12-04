"""
Tests for EventRegistry class.
"""
import pytest
from unittest.mock import MagicMock, patch

from app.core.events.event_registry.event_registry import EventRegistry
from app.core.events.factory import build_events_from_metadata
from app.core.events.event_types.combination.constants import ExpressionNode, CombinationData
from app.core.constants import DetectionType, ExpressionType
from app.core.scenario.base import Scenario
from app.utils.event_utils import evaluate_expression


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
    scenario.termination_event = None
    return scenario


class TestEventRegistry:

    def test_initialize_creates_registry_for_all_events(self, mock_room, thread_id):
        """Test that initialize creates entries for all events."""
        metadata = {
            "events": [
                {"id": "event-1", "sentences": ["hello"]},
                {"id": "event-2", "detectionType": "TIME", "data": {"time": 100, "condition": "LTE"}},
                {"id": "event-3", "detectionType": "SCORE", "data": {"score": 5, "condition": "GT"}},
            ]
        }
        
        scenario = create_test_scenario(metadata)
        registry = EventRegistry(scenario, mock_room, thread_id)
        
        # All events should be in registry
        assert len(registry.event_registry) == 3
        # All events start as False in setup_initial_state()
        # TIME and SCORE events are only evaluated in async initialize()
        assert registry.event_registry["event-1"]["happened"] is False
        assert registry.event_registry["event-2"]["happened"] is False
        assert registry.event_registry["event-3"]["happened"] is False
        assert len(registry.expression_list) == 0  # No combination events


    def test_initialize_adds_combination_events_to_expression_list(self, mock_room, thread_id):
        """Test that combination events are added to expression_list."""
        metadata = {
            "events": [
                {"id": "event-1", "sentences": ["hello"]},
                {
                    "id": "combo-1",
                    "detectionType": "COMBINATION",
                    "data": {
                        "expression": {
                            "type": "IDENTIFIER",
                            "id": "event-1"
                        }
                    }
                }
            ]
        }
        
        scenario = create_test_scenario(metadata)
        registry = EventRegistry(scenario, mock_room, thread_id)
        
        assert len(registry.expression_list) == 1
        assert registry.expression_list[0]["event_id"] == "combo-1"
        assert registry.expression_list[0]["type"] == DetectionType.COMBINATION
        assert isinstance(registry.expression_list[0]["expression"], ExpressionNode)

    def test_update_sets_detected_events_to_true(self, mock_room, thread_id):
        """Test that update() sets detected event states to True."""
        metadata = {
            "events": [
                {"id": "event-1", "sentences": ["hello"]},
                {"id": "event-2", "sentences": ["world"]},
            ]
        }
        
        scenario = create_test_scenario(metadata)
        registry = EventRegistry(scenario, mock_room, thread_id)
        
        # Initially all False
        assert registry.event_registry["event-1"]["happened"] is False
        assert registry.event_registry["event-2"]["happened"] is False
        
        # Update with detected events
        result = registry.update(detected_event_ids={"event-1"})
        
        assert registry.event_registry["event-1"]["happened"] is True
        assert registry.event_registry["event-2"]["happened"] is False
        assert result["event-1"]["happened"] is True
        assert result["event-2"]["happened"] is False

    def test_evaluate_expression_identifier_returns_event_state(self, mock_room, thread_id):
        """Test evaluating an IDENTIFIER expression."""
        metadata = {
            "events": [
                {"id": "event-1", "sentences": ["hello"]},
            ]
        }
        
        scenario = create_test_scenario(metadata)
        registry = EventRegistry(scenario, mock_room, thread_id)
        
        # Create an identifier expression
        expr = ExpressionNode(type=ExpressionType.IDENTIFIER, id="event-1")
        
        # Initially False
        assert evaluate_expression(expr, registry.event_registry) is False
        
        # After setting to True
        registry.set_event_state("event-1", True)
        assert evaluate_expression(expr, registry.event_registry) is True

    def test_evaluate_expression_identifier_unknown_event_returns_false(self, mock_room, thread_id):
        """Test that unknown event IDs return False."""
        metadata = {"events": []}
        scenario = create_test_scenario(metadata)
        registry = EventRegistry(scenario, mock_room, thread_id)
        
        expr = ExpressionNode(type=ExpressionType.IDENTIFIER, id="unknown-event")
        assert evaluate_expression(expr, registry.event_registry) is False

    def test_evaluate_expression_not_negates_operand(self, mock_room, thread_id):
        """Test evaluating a NOT expression."""
        metadata = {
            "events": [
                {"id": "event-1", "sentences": ["hello"]},
            ]
        }
        
        scenario = create_test_scenario(metadata)
        registry = EventRegistry(scenario, mock_room, thread_id)
        
        # NOT(False) = True
        expr = ExpressionNode(
            type=ExpressionType.NOT,
            operand=ExpressionNode(type=ExpressionType.IDENTIFIER, id="event-1")
        )
        assert evaluate_expression(expr, registry.event_registry) is True
        
        # NOT(True) = False
        registry.set_event_state("event-1", True)
        assert evaluate_expression(expr, registry.event_registry) is False

    def test_evaluate_expression_and_requires_both_true(self, mock_room, thread_id):
        """Test evaluating an AND expression."""
        metadata = {
            "events": [
                {"id": "event-1", "sentences": ["hello"]},
                {"id": "event-2", "sentences": ["world"]},
            ]
        }
        
        scenario = create_test_scenario(metadata)
        registry = EventRegistry(scenario, mock_room, thread_id)
        
        expr = ExpressionNode(
            type=ExpressionType.AND,
            left=ExpressionNode(type=ExpressionType.IDENTIFIER, id="event-1"),
            right=ExpressionNode(type=ExpressionType.IDENTIFIER, id="event-2")
        )
        
        # Both False -> False
        assert evaluate_expression(expr, registry.event_registry) is False
        
        # One True -> False
        registry.set_event_state("event-1", True)
        assert evaluate_expression(expr, registry.event_registry) is False
        
        # Both True -> True
        registry.set_event_state("event-2", True)
        assert evaluate_expression(expr, registry.event_registry) is True

    def test_evaluate_expression_or_requires_at_least_one_true(self, mock_room, thread_id):
        """Test evaluating an OR expression."""
        metadata = {
            "events": [
                {"id": "event-1", "sentences": ["hello"]},
                {"id": "event-2", "sentences": ["world"]},
            ]
        }
        
        scenario = create_test_scenario(metadata)
        registry = EventRegistry(scenario, mock_room, thread_id)
        
        expr = ExpressionNode(
            type=ExpressionType.OR,
            left=ExpressionNode(type=ExpressionType.IDENTIFIER, id="event-1"),
            right=ExpressionNode(type=ExpressionType.IDENTIFIER, id="event-2")
        )
        
        # Both False -> False
        assert evaluate_expression(expr, registry.event_registry) is False
        
        # One True -> True
        registry.set_event_state("event-1", True)
        assert evaluate_expression(expr, registry.event_registry) is True
        
        # Both True -> True
        registry.set_event_state("event-2", True)
        assert evaluate_expression(expr, registry.event_registry) is True

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
        registry = EventRegistry(scenario, mock_room, thread_id)
        
        # AND(NOT(event-a), OR(event-b, event-c))
        expr = ExpressionNode(
            type=ExpressionType.AND,
            left=ExpressionNode(
                type=ExpressionType.NOT,
                operand=ExpressionNode(type=ExpressionType.IDENTIFIER, id="event-a")
            ),
            right=ExpressionNode(
                type=ExpressionType.OR,
                left=ExpressionNode(type=ExpressionType.IDENTIFIER, id="event-b"),
                right=ExpressionNode(type=ExpressionType.IDENTIFIER, id="event-c")
            )
        )
        
        # event-a=False, event-b=False, event-c=False
        # NOT(False) AND OR(False, False) = True AND False = False
        assert evaluate_expression(expr, registry.event_registry) is False
        
        # event-a=False, event-b=True, event-c=False
        # NOT(False) AND OR(True, False) = True AND True = True
        registry.set_event_state("event-b", True)
        assert evaluate_expression(expr, registry.event_registry) is True
        
        # event-a=True, event-b=True, event-c=False
        # NOT(True) AND OR(True, False) = False AND True = False
        registry.set_event_state("event-a", True)
        assert evaluate_expression(expr, registry.event_registry) is False

    def test_update_evaluates_combination_expressions(self, mock_room, thread_id):
        """Test that update() evaluates combination expressions and updates their states."""
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
                            "left": {
                                "type": "IDENTIFIER",
                                "id": "event-1"
                            },
                            "right": {
                                "type": "IDENTIFIER",
                                "id": "event-2"
                            }
                        }
                    }
                }
            ]
        }
        
        scenario = create_test_scenario(metadata)
        registry = EventRegistry(scenario, mock_room, thread_id)
        
        # Initially combo-1 should be False (both events False)
        assert registry.get_event_state("combo-1") is False
        
        # Update with event-1 detected
        registry.update(detected_event_ids={"event-1"})
        # Still False because event-2 is False
        assert registry.get_event_state("combo-1") is False
        
        # Update with both events detected
        registry.update(detected_event_ids={"event-1", "event-2"})
        # Now True because both are True
        assert registry.get_event_state("combo-1") is True

    def test_get_event_state_returns_current_state(self, mock_room, thread_id):
        """Test get_event_state() method."""
        metadata = {
            "events": [
                {"id": "event-1", "sentences": ["hello"]},
            ]
        }
        
        scenario = create_test_scenario(metadata)
        registry = EventRegistry(scenario, mock_room, thread_id)
        
        assert registry.get_event_state("event-1") is False
        registry.set_event_state("event-1", True)
        assert registry.get_event_state("event-1") is True

    def test_set_event_state_updates_state(self, mock_room, thread_id):
        """Test set_event_state() method."""
        metadata = {
            "events": [
                {"id": "event-1", "sentences": ["hello"]},
            ]
        }
        
        scenario = create_test_scenario(metadata)
        registry = EventRegistry(scenario, mock_room, thread_id)
        
        registry.set_event_state("event-1", True)
        assert registry.event_registry["event-1"]["happened"] is True
        
        registry.set_event_state("event-1", False)
        assert registry.event_registry["event-1"]["happened"] is False



    def test_evaluate_expression_invalid_identifier_returns_false(self, mock_room, thread_id):
        """Test that invalid identifier (no name) returns False."""
        metadata = {"events": []}
        scenario = create_test_scenario(metadata)
        registry = EventRegistry(scenario, mock_room, thread_id)
        
        expr = ExpressionNode(type=ExpressionType.IDENTIFIER, id=None)
        assert evaluate_expression(expr, registry.event_registry) is False

    def test_evaluate_expression_invalid_not_returns_false(self, mock_room, thread_id):
        """Test that invalid NOT (no operand) returns False."""
        metadata = {"events": []}
        scenario = create_test_scenario(metadata)
        registry = EventRegistry(scenario, mock_room, thread_id)
        
        expr = ExpressionNode(type=ExpressionType.NOT, operand=None)
        assert evaluate_expression(expr, registry.event_registry) is False

    def test_evaluate_expression_invalid_and_returns_false(self, mock_room, thread_id):
        """Test that invalid AND (missing operands) returns False."""
        metadata = {"events": []}
        scenario = create_test_scenario(metadata)
        registry = EventRegistry(scenario, mock_room, thread_id)
        
        expr = ExpressionNode(type=ExpressionType.AND, left=None, right=None)
        assert evaluate_expression(expr, registry.event_registry) is False

    def test_evaluate_expression_invalid_or_returns_false(self, mock_room, thread_id):
        """Test that invalid OR (missing operands) returns False."""
        metadata = {"events": []}
        scenario = create_test_scenario(metadata)
        registry = EventRegistry(scenario, mock_room, thread_id)
        
        expr = ExpressionNode(type=ExpressionType.OR, left=None, right=None)
        assert evaluate_expression(expr, registry.event_registry) is False

    def test_initialize_sets_trigger_multiple_correctly(self, mock_room, thread_id):
        """Test that trigger_multiple is set correctly for different event types."""
        metadata = {
            "events": [
                {"id": "similarity-1", "sentences": ["hello"]},  # SENTENCE_SIMILARITY
                {"id": "time-1", "detectionType": "TIME", "data": {"time": 100, "condition": "LTE"}},
                {"id": "score-1", "detectionType": "SCORE", "data": {"score": 5, "condition": "GT"}},
                {
                    "id": "combo-1",
                    "detectionType": "COMBINATION",
                    "data": {
                        "expression": {"type": "IDENTIFIER", "id": "similarity-1"}
                    }
                }
            ]
        }
        
        scenario = create_test_scenario(metadata)
        registry = EventRegistry(scenario, mock_room, thread_id)
        
        # SENTENCE_SIMILARITY should have trigger_multiple=True
        assert registry.event_registry["similarity-1"]["trigger_multiple"] is True
        # TIME, SCORE, COMBINATION should have trigger_multiple=False
        assert registry.event_registry["time-1"]["trigger_multiple"] is False
        assert registry.event_registry["score-1"]["trigger_multiple"] is False
        assert registry.event_registry["combo-1"]["trigger_multiple"] is False

    def test_trigger_events_filtering(self, mock_room, thread_id):
        """Test that trigger_events list filters which events are sent."""
        metadata = {
            "events": [
                {"id": "event-1", "sentences": ["hello"]},
                {"id": "event-2", "sentences": ["world"]},
                {"id": "event-3", "sentences": ["test"]},
            ],
            "trigger_events": ["event-1", "event-3"]
        }
        
        scenario = create_test_scenario(metadata)
        # Only event-1 and event-3 should be sent
        registry = EventRegistry(scenario, mock_room, thread_id)
        
        assert registry.trigger_events == {"event-1", "event-3"}
        
        # All events should still be in registry
        assert len(registry.event_registry) == 3

