from langchain_core.messages import AIMessage, HumanMessage

from app.core.branching_instructions.base import BranchingInstruction
from app.core.constants import VisibilityType
from app.core.events.base import BaseEvent
from app.core.graph.utils import convert_messages_to_chat_messages, serialize_event


class TestUtils:
    def test_convert_messages_to_chat_messages_roles_and_content(self):
        msgs = [
            HumanMessage(content="How are you?"),
            AIMessage(content="I'm fine."),
        ]
        chat = convert_messages_to_chat_messages(msgs)
        assert [m.role for m in chat] == ["counselor", "client"]
        assert [m.content for m in chat] == ["How are you?", "I'm fine."]

    def test_serialize_event_with_all_fields(self):
        class DummyEvent(BaseEvent):
            sentences: list[str] | None = None

            async def detect_event(self, conversations):
                return True

        branching_inst = BranchingInstruction.create("ask_about_progress")
        event = DummyEvent(
            event_id="evt-123",
            score=10,
            emoji=":)",
            emoji_message="Great job",
            branching_instruction=branching_inst,
            visibility_type=VisibilityType.PASSIVE,
            show_feedback=False,
            sentences=["one", "two"],
        )

        data = serialize_event(event)

        assert data == {
            "id": "evt-123",
            "score": 10,
            "emoji": ":)",
            "visibilityType": VisibilityType.PASSIVE,
            "message": "Great job",
            "branchInstruction": "ask_about_progress",
            "sentences": ["one", "two"],
            "feedbackStatus": False,
            "autoTerminationStatus": None,
            "terminationMessage": None,
        }

    def test_serialize_event_with_defaults_and_nones(self):
        class DummyEvent(BaseEvent):
            async def detect_event(self, conversations):
                return False

        # Provide only the required field; others fall back to defaults/None
        event = DummyEvent(
            event_id="evt-xyz",
            score=None,
            emoji=None,
            emoji_message=None,
            branching_instruction=None,
            # visibility_type defaults to ACTIVE
            # show_feedback defaults to True
        )

        data = serialize_event(event)

        assert data["id"] == "evt-xyz"
        assert data["score"] == 0  # None -> 0
        assert data["emoji"] is None
        assert data["visibilityType"] == VisibilityType.ACTIVE
        assert data["message"] is None
        assert data["branchInstruction"] is None
        assert data["sentences"] == []  # attribute missing -> []
        assert data["feedbackStatus"] is True  # default True -> True
