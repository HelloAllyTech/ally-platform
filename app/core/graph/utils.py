from typing import List

from langchain_core.messages import AIMessage, HumanMessage

from app.core.events.base import ChatMessage, BaseEvent


def convert_messages_to_chat_messages(messages) -> List[ChatMessage]:
    """Convert langchain messages to ChatMessage format"""


    chat_messages = []
    for msg in messages:
        if isinstance(msg, AIMessage):
            role = "client"
        elif isinstance(msg, HumanMessage):
            role = "counselor"
        else:
            continue  # Skip unknown message types

        chat_messages.append(ChatMessage(
            role=role,
            content=msg.content,
            start_time=None,
            end_time=None,
        ))

    return chat_messages

def serialize_event(event: BaseEvent) -> dict:
    """
    Converts a BaseEvent instance into the format required by CoreEventMessageType.
    """
    return {
        "id": event.event_id,
        "score": event.score or 0,
        "emoji": event.emoji or None,
        "visibilityType": event.visibility_type or None,
        "message": event.emoji_message or None,
        "branchInstruction": event.branching_instruction or None,
        "sentences": getattr(event, "sentences", []),
        "feedbackStatus": bool(getattr(event, "show_feedback", True))
    }