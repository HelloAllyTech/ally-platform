import random

from app.core.events.base import BaseEvent
from app.core.events.event_processor import EventProcessor
from app.core.events.schemas import CustomUIEventMessageType


class DummyEvent(BaseEvent):
    async def detect_event(self, conversations):  # pragma: no cover (not used here)
        return False


def make_event(event_id: str, score: int, emoji=":)", message="msg") -> DummyEvent:
    return DummyEvent(
        event_id=event_id, score=score, emoji=emoji, emoji_message=message
    )


class TestEventProcessor:
    def test_process_events_for_ui_positive_polarity(self, monkeypatch):
        # Two positives and one negative; cumulative positive
        events = [make_event("e1", 10), make_event("e2", -5), make_event("e3", 1)]

        chosen = []

        def fake_choice(seq):
            chosen.append(tuple(e.event_id for e in seq))
            return seq[0]

        monkeypatch.setattr(random, "choice", fake_choice)

        ui_msg = EventProcessor.process_events_for_ui(events)
        assert isinstance(ui_msg, CustomUIEventMessageType)
        assert ui_msg.data.score == sum(e.score for e in events)
        # Should have chosen from positive pool (contains e1 and e3)
        assert chosen and set(chosen[0]) == {"e1", "e3"}

    def test_process_events_for_ui_negative_polarity(self, monkeypatch):
        events = [make_event("e1", -1), make_event("e2", -2), make_event("e3", 1)]

        def fake_choice(seq):
            return seq[-1]

        monkeypatch.setattr(random, "choice", fake_choice)

        ui_msg = EventProcessor.process_events_for_ui(events)
        assert ui_msg.data.score == -2  # -1 + -2 + 1

    def test_process_events_for_ui_neutral_prefers_neutral(self, monkeypatch):
        events = [make_event("p", 2), make_event("n", -2), make_event("z", 0)]

        def fake_choice(seq):
            # Expect to choose from neutral list containing only 'z'
            assert len(seq) == 1 and seq[0].event_id == "z"
            return seq[0]

        monkeypatch.setattr(random, "choice", fake_choice)

        ui_msg = EventProcessor.process_events_for_ui(events)
        assert ui_msg.data.score == 0
        assert ui_msg.data.emoji == events[2].emoji

    def test_select_event_for_display_fallbacks_when_pool_missing(self):
        # Positive cumulative but no positive events -> fallback to max
        events = [make_event("n1", -1), make_event("n2", -5)]
        selected = EventProcessor._select_event_for_display(events, cumulative_score=1)
        assert selected.event_id == "n1"  # max by score

        # Negative cumulative but no negatives -> fallback to min
        events = [make_event("p1", 3), make_event("p2", 1)]
        selected = EventProcessor._select_event_for_display(events, cumulative_score=-1)
        assert selected.event_id == "p2"  # min by score

    def test_get_events_summary_counts_and_lists(self):
        events = [make_event("a", 2), make_event("b", -1), make_event("c", 0)]
        s = EventProcessor.get_events_summary(events)
        assert s["total_events"] == 3
        assert s["cumulative_score"] == 1
        assert s["positive_count"] == 1
        assert s["negative_count"] == 1
        assert s["neutral_count"] == 1
        assert s["event_scores"] == [2, -1, 0]
        assert s["event_ids"] == ["a", "b", "c"]

    def test_process_events_for_ui_none_when_no_events(self):
        assert EventProcessor.process_events_for_ui([]) is None
