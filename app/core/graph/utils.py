from typing import List

from langchain_core.messages import AIMessage, HumanMessage

from app.core.events.base import BaseEvent, ChatMessage


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

        chat_messages.append(
            ChatMessage(
                role=role,
                content=msg.content,
                start_time=None,
                end_time=None,
            )
        )

    return chat_messages


def serialize_event(
    event: BaseEvent, termination_event_id: str = None, termination_message: str = None
) -> dict:
    """
    Converts a BaseEvent instance into the format required by CoreEventMessageType.

    Args:
        event: The event to serialize
        termination_event_id: Optional ID of the event that triggers termination
        termination_message: Optional custom termination message
    """
    is_termination_event = (
        termination_event_id and event.event_id == termination_event_id
    )

    return {
        "id": event.event_id,
        "score": event.score or 0,
        "emoji": event.emoji or None,
        "visibilityType": event.visibility_type or None,
        "message": event.emoji_message or None,
        "branchInstruction": event.branching_instruction or None,
        "sentences": getattr(event, "sentences", []),
        "feedbackStatus": bool(getattr(event, "show_feedback", True)),
        "autoTerminationStatus": is_termination_event,
        "terminationMessage": termination_message if is_termination_event else None,
    }
