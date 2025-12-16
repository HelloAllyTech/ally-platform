"""
Tests for new event types: TIME, SCORE, and COMBINATION.
"""

from app.core.constants import ConditionOperator, DetectionType, VisibilityType
from app.core.events.event_types.combination import CombinationEvent
from app.core.events.event_types.score import ScoreEvent
from app.core.events.event_types.time import TimeEvent
from app.core.events.factory import build_events_from_metadata


class DummyLogger:
    def __init__(self):
        self.warnings = []
        self.errors = []
        self.debugs = []
        self.infos = []
        self.exceptions = []

    def warning(self, msg, *args):
        self.warnings.append(msg % args if args else msg)

    def error(self, msg, *args):
        self.errors.append(msg % args if args else msg)

    def exception(self, msg, *args):
        self.exceptions.append(msg % args if args else msg)
        self.errors.append(msg % args if args else msg)

    def debug(self, msg, *args):
        self.debugs.append(msg % args if args else msg)

    def info(self, msg, *args):
        self.infos.append(msg % args if args else msg)


class TestTimeEvent:
    def test_build_time_event_from_metadata(self):
        metadata = {
            "events": [
                {
                    "id": "time-1",
                    "detectionType": "TIME",
                    "data": {"time": 100.5, "condition": "LTE"},
                    "score": 5,
                    "emoji": "⏰",
                    "message": "Time check",
                    "visibilityType": "ACTIVE",
                }
            ]
        }

        events = build_events_from_metadata(metadata)
        assert len(events) == 1
        assert isinstance(events[0], TimeEvent)
        assert events[0].event_id == "time-1"
        assert events[0].detection_type == DetectionType.TIME
        assert events[0].data.time == 100.5
        assert events[0].data.condition == ConditionOperator.LTE
        assert events[0].score == 5
        assert events[0].emoji == "⏰"
        assert events[0].visibility_type == VisibilityType.ACTIVE

    def test_build_time_event_with_all_conditions(self):
        conditions = ["GT", "LT", "GTE", "LTE", "EQ"]
        for condition in conditions:
            metadata = {
                "events": [
                    {
                        "id": f"time-{condition}",
                        "detectionType": "TIME",
                        "data": {"time": 50.0, "condition": condition},
                    }
                ]
            }
            events = build_events_from_metadata(metadata)
            assert len(events) == 1
            assert events[0].data.condition == ConditionOperator(condition)

    def test_build_time_event_missing_data_warns(self):
        logger = DummyLogger()
        metadata = {
            "events": [
                {
                    "id": "time-1",
                    "detectionType": "TIME",
                    # missing data
                }
            ]
        }

        events = build_events_from_metadata(metadata, on_unknown="warn", logger=logger)
        assert len(events) == 0
        assert any(
            "missing" in w.lower() or "invalid" in w.lower() for w in logger.warnings
        )

    def test_build_time_event_invalid_data_warns(self):
        logger = DummyLogger()
        metadata = {
            "events": [
                {
                    "id": "time-1",
                    "detectionType": "TIME",
                    "data": {"time": "not-a-number"},  # invalid
                }
            ]
        }

        events = build_events_from_metadata(metadata, on_unknown="warn", logger=logger)
        assert len(events) == 0
        assert any("invalid data" in w.lower() for w in logger.warnings)


class TestScoreEvent:
    def test_build_score_event_from_metadata(self):
        metadata = {
            "events": [
                {
                    "id": "score-1",
                    "detectionType": "SCORE",
                    "data": {"score": 10, "condition": "GT"},
                    "score": -5,
                    "emoji": "📊",
                    "message": "Score check",
                }
            ]
        }

        events = build_events_from_metadata(metadata)
        assert len(events) == 1
        assert isinstance(events[0], ScoreEvent)
        assert events[0].event_id == "score-1"
        assert events[0].detection_type == DetectionType.SCORE
        assert events[0].data.score == 10
        assert events[0].data.condition == ConditionOperator.GT
        assert events[0].score == -5  # This is the event's own score field

    def test_build_score_event_with_all_conditions(self):
        conditions = ["GT", "LT", "GTE", "LTE", "EQ"]
        for condition in conditions:
            metadata = {
                "events": [
                    {
                        "id": f"score-{condition}",
                        "detectionType": "SCORE",
                        "data": {"score": 5, "condition": condition},
                    }
                ]
            }
            events = build_events_from_metadata(metadata)
            assert len(events) == 1
            assert events[0].data.condition == ConditionOperator(condition)

    def test_build_score_event_missing_data_warns(self):
        logger = DummyLogger()
        metadata = {
            "events": [
                {
                    "id": "score-1",
                    "detectionType": "SCORE",
                    # missing data
                }
            ]
        }

        events = build_events_from_metadata(metadata, on_unknown="warn", logger=logger)
        assert len(events) == 0
        assert any(
            "missing" in w.lower() or "invalid" in w.lower() for w in logger.warnings
        )


class TestCombinationEvent:
    def test_build_combination_event_simple_identifier(self):
        metadata = {
            "events": [
                {
                    "id": "combo-1",
                    "detectionType": "COMBINATION",
                    "data": {
                        "dependent_events": ["event-a"],
                        "expression": {"type": "IDENTIFIER", "id": "event-a"},
                    },
                }
            ]
        }

        events = build_events_from_metadata(metadata)
        assert len(events) == 1
        assert isinstance(events[0], CombinationEvent)
        assert events[0].event_id == "combo-1"
        assert events[0].detection_type == DetectionType.COMBINATION
        assert events[0].data.expression.type == "IDENTIFIER"
        assert events[0].data.expression.id == "event-a"

    def test_build_combination_event_and_expression(self):
        metadata = {
            "events": [
                {
                    "id": "combo-and",
                    "detectionType": "COMBINATION",
                    "data": {
                        "dependent_events": ["event-a", "event-b"],
                        "expression": {
                            "type": "AND",
                            "left": {"type": "IDENTIFIER", "id": "event-a"},
                            "right": {"type": "IDENTIFIER", "id": "event-b"},
                        },
                    },
                }
            ]
        }

        events = build_events_from_metadata(metadata)
        assert len(events) == 1
        expr = events[0].data.expression
        assert expr.type == "AND"
        assert expr.left.type == "IDENTIFIER"
        assert expr.left.id == "event-a"
        assert expr.right.type == "IDENTIFIER"
        assert expr.right.id == "event-b"

    def test_build_combination_event_or_expression(self):
        metadata = {
            "events": [
                {
                    "id": "combo-or",
                    "detectionType": "COMBINATION",
                    "data": {
                        "dependent_events": ["event-a", "event-b"],
                        "expression": {
                            "type": "OR",
                            "left": {"type": "IDENTIFIER", "id": "event-a"},
                            "right": {"type": "IDENTIFIER", "id": "event-b"},
                        },
                    },
                }
            ]
        }

        events = build_events_from_metadata(metadata)
        assert len(events) == 1
        expr = events[0].data.expression
        assert expr.type == "OR"

    def test_build_combination_event_not_expression(self):
        metadata = {
            "events": [
                {
                    "id": "combo-not",
                    "detectionType": "COMBINATION",
                    "data": {
                        "dependent_events": ["event-a"],
                        "expression": {
                            "type": "NOT",
                            "operand": {"type": "IDENTIFIER", "id": "event-a"},
                        },
                    },
                }
            ]
        }

        events = build_events_from_metadata(metadata)
        assert len(events) == 1
        expr = events[0].data.expression
        assert expr.type == "NOT"
        assert expr.operand.type == "IDENTIFIER"
        assert expr.operand.id == "event-a"

    def test_build_combination_event_nested_expression(self):
        """Test complex nested expression like AND(NOT(A), OR(B, C))"""
        metadata = {
            "events": [
                {
                    "id": "combo-nested",
                    "detectionType": "COMBINATION",
                    "data": {
                        "dependent_events": ["event-a", "event-b", "event-c"],
                        "expression": {
                            "type": "AND",
                            "left": {
                                "type": "NOT",
                                "operand": {"type": "IDENTIFIER", "id": "event-a"},
                            },
                            "right": {
                                "type": "OR",
                                "left": {"type": "IDENTIFIER", "id": "event-b"},
                                "right": {"type": "IDENTIFIER", "id": "event-c"},
                            },
                        },
                    },
                }
            ]
        }

        events = build_events_from_metadata(metadata)
        assert len(events) == 1
        expr = events[0].data.expression
        assert expr.type == "AND"
        assert expr.left.type == "NOT"
        assert expr.left.operand.id == "event-a"
        assert expr.right.type == "OR"
        assert expr.right.left.id == "event-b"
        assert expr.right.right.id == "event-c"

    def test_build_combination_event_missing_data_warns(self):
        logger = DummyLogger()
        metadata = {
            "events": [
                {
                    "id": "combo-1",
                    "detectionType": "COMBINATION",
                    # missing data
                }
            ]
        }

        events = build_events_from_metadata(metadata, on_unknown="warn", logger=logger)
        assert len(events) == 0
        assert any(
            "missing" in w.lower() or "invalid" in w.lower() for w in logger.warnings
        )

    def test_build_combination_event_invalid_expression_warns(self):
        logger = DummyLogger()
        metadata = {
            "events": [
                {
                    "id": "combo-1",
                    "detectionType": "COMBINATION",
                    "data": {"expression": {"type": "INVALID_TYPE"}},  # invalid
                }
            ]
        }

        events = build_events_from_metadata(metadata, on_unknown="warn", logger=logger)
        assert len(events) == 0
        assert any("invalid" in w.lower() for w in logger.warnings)

    def test_build_combination_event_missing_expression_fields_warns(self):
        logger = DummyLogger()
        metadata = {
            "events": [
                {
                    "id": "combo-1",
                    "detectionType": "COMBINATION",
                    "data": {
                        "expression": {
                            "type": "AND"
                            # missing left and right
                        }
                    },
                }
            ]
        }

        events = build_events_from_metadata(metadata, on_unknown="warn", logger=logger)
        assert len(events) == 0
        assert any("invalid" in w.lower() for w in logger.warnings)


class TestMixedEventTypes:
    def test_build_mixed_event_types_from_metadata(self):
        """Test building multiple different event types in one metadata"""
        metadata = {
            "events": [
                {
                    "id": "similarity-1",
                    "sentences": ["hello"],
                    "detectionType": "SENTENCE_SIMILARITY",
                },
                {
                    "id": "time-1",
                    "detectionType": "TIME",
                    "data": {"time": 100.0, "condition": "LTE"},
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
                        "dependent_events": ["similarity-1"],
                        "expression": {"type": "IDENTIFIER", "id": "similarity-1"},
                    },
                },
            ]
        }

        events = build_events_from_metadata(metadata)
        assert len(events) == 4
        assert events[0].detection_type == DetectionType.SENTENCE_SIMILARITY
        assert events[1].detection_type == DetectionType.TIME
        assert events[2].detection_type == DetectionType.SCORE
        assert events[3].detection_type == DetectionType.COMBINATION
