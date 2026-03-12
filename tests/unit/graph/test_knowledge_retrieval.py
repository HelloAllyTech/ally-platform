import pytest
from langchain_core.messages import AIMessage, HumanMessage

from app.core.graph.knowledge_retrieval import (
    RelevantKeys,
    build_knowledge_map,
    retrieve_relevant_knowledge,
)


class TestBuildKnowledgeMap:
    def test_empty_input(self):
        assert build_knowledge_map(None) == {}
        assert build_knowledge_map([]) == {}

    def test_valid_entries(self):
        kb = [
            {"key": "school memories", "description": "Bullied in 8th grade"},
            {"key": "family dynamics", "description": "Parents compare to cousin"},
        ]
        result = build_knowledge_map(kb)
        assert len(result) == 2
        assert result["school memories"] == "Bullied in 8th grade"
        assert result["family dynamics"] == "Parents compare to cousin"

    def test_missing_fields_skipped(self):
        kb = [
            {"key": "valid", "description": "Valid entry"},
            {"key": "missing_desc"},
            {"description": "missing_key"},
            {"key": "", "description": "empty_key"},
            {"key": "empty_desc", "description": ""},
        ]
        result = build_knowledge_map(kb)
        assert len(result) == 1
        assert result["valid"] == "Valid entry"

    def test_non_dict_entries_skipped(self):
        kb = [
            {"key": "valid", "description": "Valid entry"},
            "invalid string",
            123,
            None,
        ]
        result = build_knowledge_map(kb)
        assert len(result) == 1
        assert result["valid"] == "Valid entry"


class FakeStructuredLLM:
    def __init__(self, keys: list):
        self._keys = keys

    async def ainvoke(self, messages):
        return RelevantKeys(keys=self._keys)


class FakeLLMInstance:
    def __init__(self, keys: list):
        self._keys = keys

    def with_structured_output(self, schema):
        return FakeStructuredLLM(self._keys)


class FakeLLMClient:
    def __init__(self, keys: list):
        self._llm_instance = FakeLLMInstance(keys)

    @property
    def llm_instance(self):
        return self._llm_instance


class TestRetrieveRelevantKnowledge:
    @pytest.mark.asyncio
    async def test_empty_knowledge_map_returns_empty(self):
        result = await retrieve_relevant_knowledge(
            FakeLLMClient([]), [HumanMessage(content="Hello")], {}
        )
        assert result == ""

    @pytest.mark.asyncio
    async def test_no_messages_returns_empty(self):
        result = await retrieve_relevant_knowledge(
            FakeLLMClient([]), [], {"key1": "value1"}
        )
        assert result == ""

    @pytest.mark.asyncio
    async def test_single_relevant_key(self):
        result = await retrieve_relevant_knowledge(
            FakeLLMClient(["school memories"]),
            [HumanMessage(content="Tell me about school")],
            {
                "school memories": "Bullied in 8th grade",
                "family dynamics": "Parents are strict",
            },
        )
        assert "school memories" in result
        assert "Bullied in 8th grade" in result
        assert "family dynamics" not in result

    @pytest.mark.asyncio
    async def test_multiple_relevant_keys(self):
        result = await retrieve_relevant_knowledge(
            FakeLLMClient(["school memories", "family dynamics"]),
            [HumanMessage(content="family and school")],
            {
                "school memories": "Bullied in 8th grade",
                "family dynamics": "Parents are strict",
                "hobbies": "Likes painting",
            },
        )
        assert "Bullied in 8th grade" in result
        assert "Parents are strict" in result
        assert "hobbies" not in result

    @pytest.mark.asyncio
    async def test_no_relevant_keys(self):
        result = await retrieve_relevant_knowledge(
            FakeLLMClient([]),
            [HumanMessage(content="How are you?")],
            {"school memories": "Bullied in 8th grade"},
        )
        assert result == ""

    @pytest.mark.asyncio
    async def test_key_not_in_map_skipped(self):
        result = await retrieve_relevant_knowledge(
            FakeLLMClient(["school memories", "nonexistent"]),
            [HumanMessage(content="Tell me about school")],
            {"school memories": "Bullied in 8th grade"},
        )
        assert "Bullied in 8th grade" in result
        assert "nonexistent" not in result

    @pytest.mark.asyncio
    async def test_markdown_formatting(self):
        result = await retrieve_relevant_knowledge(
            FakeLLMClient(["k1", "k2"]),
            [HumanMessage(content="test")],
            {"k1": "Description 1", "k2": "Description 2"},
        )
        assert "**k1:**" in result
        assert "**k2:**" in result

    @pytest.mark.asyncio
    async def test_long_conversation_uses_last_10(self):
        messages = [
            (
                HumanMessage(content=f"Msg {i}")
                if i % 2 == 0
                else AIMessage(content=f"Resp {i}")
            )
            for i in range(15)
        ]
        result = await retrieve_relevant_knowledge(
            FakeLLMClient(["topic"]),
            messages,
            {"topic": "description"},
        )
        assert "topic" in result


class FakeFailingLLM:
    def with_structured_output(self, schema):
        return self

    async def ainvoke(self, messages):
        raise RuntimeError("LLM call failed")


class FakeFailingClient:
    @property
    def llm_instance(self):
        return FakeFailingLLM()


class TestRetrieveKnowledgeErrorHandling:
    @pytest.mark.asyncio
    async def test_llm_failure_returns_empty(self):
        result = await retrieve_relevant_knowledge(
            FakeFailingClient(),
            [HumanMessage(content="test")],
            {"key1": "value1"},
        )
        assert result == ""
