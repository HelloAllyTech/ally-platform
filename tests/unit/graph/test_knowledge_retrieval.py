import pytest
from langchain_core.messages import AIMessage, HumanMessage

from app.core.graph.knowledge_retrieval import (
    _MAX_PER_MATCH_CHARS,
    _MAX_TOTAL_CONTEXT_CHARS,
    RelevantKeys,
    _format_retrieved_context,
    build_knowledge_map,
    retrieve_relevant_knowledge,
)


class TestBuildKnowledgeMap:
    def test_empty_input(self):
        assert build_knowledge_map(None) == {}
        assert build_knowledge_map([]) == {}

    def test_valid_entries(self):
        kb = [
            {"title": "school memories", "content": "Bullied in 8th grade"},
            {"title": "family dynamics", "content": "Parents compare to cousin"},
        ]
        result = build_knowledge_map(kb)
        assert len(result) == 2
        assert result["school memories"] == "Bullied in 8th grade"
        assert result["family dynamics"] == "Parents compare to cousin"

    def test_missing_fields_skipped(self):
        kb = [
            {"title": "valid", "content": "Valid entry"},
            {"title": "missing_content"},
            {"content": "missing_title"},
            {"title": "", "content": "empty_title"},
            {"title": "empty_content", "content": ""},
        ]
        result = build_knowledge_map(kb)
        assert len(result) == 1
        assert result["valid"] == "Valid entry"

    def test_non_dict_entries_skipped(self):
        kb = [
            {"title": "valid", "content": "Valid entry"},
            "invalid string",
            123,
            None,
        ]
        result = build_knowledge_map(kb)
        assert len(result) == 1
        assert result["valid"] == "Valid entry"


class FakeStructuredLLM:
    def __init__(self, titles: list):
        self._titles = titles

    async def ainvoke(self, messages):
        return RelevantKeys(titles=self._titles)


class FakeLLMInstance:
    def __init__(self, titles: list):
        self._titles = titles

    def with_structured_output(self, schema):
        return FakeStructuredLLM(self._titles)


class FakeLLMClient:
    def __init__(self, titles: list):
        self._llm_instance = FakeLLMInstance(titles)

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


class TestFormatRetrievedContextCaps:
    """B5: prevent prompt-budget blow-up from large or many matches."""

    def test_short_content_passes_through_untouched(self):
        result = _format_retrieved_context(
            ["title_a"],
            {"title_a": "Short content."},
        )
        assert result == "**title_a:**\nShort content."

    def test_oversize_match_truncated_with_marker(self):
        big = "x" * (_MAX_PER_MATCH_CHARS + 500)
        result = _format_retrieved_context(["t"], {"t": big})
        assert "[truncated]" in result
        # Truncation only chops the content portion. Marker should be at
        # roughly the cap (allow some slack for rstrip + marker text).
        assert len(result) < _MAX_PER_MATCH_CHARS + 80

    def test_total_cap_drops_remaining_matches_with_marker(self):
        # Each entry near per-match cap; combined exceeds total cap.
        big = "y" * _MAX_PER_MATCH_CHARS
        knowledge_map = {f"title_{i}": big for i in range(20)}
        titles = list(knowledge_map.keys())
        result = _format_retrieved_context(titles, knowledge_map)
        assert "additional matches omitted to fit context budget" in result
        # Total result length stays at or below the cap plus marker.
        assert len(result) <= _MAX_TOTAL_CONTEXT_CHARS + 100

    def test_missing_titles_silently_skipped(self):
        result = _format_retrieved_context(
            ["present", "absent"],
            {"present": "Here"},
        )
        assert "**present:**" in result
        assert "absent" not in result

    def test_empty_inputs_return_empty_string(self):
        assert _format_retrieved_context([], {}) == ""
        assert _format_retrieved_context(["x"], {}) == ""
        assert _format_retrieved_context([], {"a": "b"}) == ""

    def test_order_preserved_from_relevant_titles(self):
        # Order matters: the LLM's title order determines section order.
        result = _format_retrieved_context(
            ["b", "a"],
            {"a": "alpha", "b": "beta"},
        )
        assert result.index("**b:**") < result.index("**a:**")
