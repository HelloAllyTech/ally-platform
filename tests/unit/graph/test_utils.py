from langchain_core.messages import AIMessage, HumanMessage

from app.core.graph.utils import convert_messages_to_chat_messages


class TestUtils:
    def test_convert_messages_to_chat_messages_roles_and_content(self):
        msgs = [
            HumanMessage(content="How are you?"),
            AIMessage(content="I'm fine."),
        ]
        chat = convert_messages_to_chat_messages(msgs)
        assert [m.role for m in chat] == ["counselor", "client"]
        assert [m.content for m in chat] == ["How are you?", "I'm fine."]
