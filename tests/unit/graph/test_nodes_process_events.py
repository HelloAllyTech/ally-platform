import asyncio
from datetime import datetime, timezone
from typing import List

import pytest
from langchain_core.messages import AIMessage, HumanMessage

from app.core.graph.nodes import process_events
from app.core.graph.state import SimulationState
from app.core.events.base import BaseEvent, ChatMessage
from app.core.graph.utils import convert_messages_to_chat_messages


class DetectingEvent(BaseEvent):
    score: int | None = 1
    match_text: str | None = None

    async def detect_event(self, conversations: List[ChatMessage]) -> bool:
        # Detect if any message contains match_text
        if not self.match_text:
            return False
        return any(self.match_text in m.content for m in conversations)


class TestProcessEvents:
    @pytest.mark.asyncio
    async def test_process_events_detects_and_updates_state(self):
        msgs = [HumanMessage(content="Hello there"), AIMessage(content="I feel anxious")]
        e1 = DetectingEvent(event_id="e1", match_text="anxious", score=3)
        e2 = DetectingEvent(event_id="e2", match_text="nothing", score=5)

        state = SimulationState(
            messages=msgs,
            permitted_events=[e1, e2],
            events_accumulator=[],
            new_events=[],
            current_score=10,
        )

        new_state = await process_events(state, config=None)

        # e1 should be detected, e2 not
        assert [e.event_id for e in new_state.new_events] == ["e1"]
        assert new_state.current_score == 13  # 10 + 3
        assert len(new_state.events_accumulator) == 1
        ts, ev = new_state.events_accumulator[0]
        assert ev.event_id == "e1"
        # timestamp is ISO-like string ending with 'Z'
        assert ts.endswith("Z")
