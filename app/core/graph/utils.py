from typing import List

from langchain_core.messages import AIMessage, HumanMessage

from app.core.events.base import ChatMessage

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