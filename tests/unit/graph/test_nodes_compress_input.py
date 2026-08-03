import asyncio

import pytest
from langchain_core.messages import AIMessage, HumanMessage

import app.core.graph.nodes as nodes
from app.core.config import settings
from app.core.graph.nodes import compress_input
from app.core.graph.state import SimulationState
from app.core.metrics import turn_metrics


class FakeCompletionMessage:
    def __init__(self, content):
        self.content = content


class FakeCompletionChoice:
    def __init__(self, content):
        self.message = FakeCompletionMessage(content)


class FakeCompletion:
    def __init__(self, content):
        self.choices = [FakeCompletionChoice(content)]


class FakeCompletions:
    def __init__(self, content="compressed text", delay=0.0, error=None):
        self.content = content
        self.delay = delay
        self.error = error
        self.calls = []

    async def create(self, **kwargs):
        self.calls.append(kwargs)
        if self.delay:
            await asyncio.sleep(self.delay)
        if self.error:
            raise self.error
        return FakeCompletion(self.content)


class FakeChat:
    def __init__(self, completions):
        self.completions = completions


class FakeCompressionClient:
    def __init__(self, content="compressed text", delay=0.0, error=None):
        self.completions = FakeCompletions(content=content, delay=delay, error=error)
        self.chat = FakeChat(self.completions)


def _make_state(**kwargs):
    defaults = dict(
        messages=[],
        permitted_events=[],
        events_accumulator=[],
        new_events=[],
        current_score=0,
        branching_and_feedback_data=[],
    )
    defaults.update(kwargs)
    return SimulationState(**defaults)


def _make_scenario(language_code="hi-IN", compression_enabled=True):
    prompt_data = type(
        "PD", (), {"input_compression_enabled": compression_enabled}
    )()
    language_config = type("LanguageConfig", (), {"language_code": language_code})()
    return type(
        "Scenario", (), {"prompt_data": prompt_data, "language_config": language_config}
    )()


# A long-enough Hindi sentence to exceed a low test token threshold.
LONG_HINDI_TEXT = (
    "यह एक बहुत लंबा वाक्य है जिसमें कई शब्द हैं ताकि टोकन गिनती सीमा से "
    "अधिक हो जाए और संपीड़न वास्तव में चल सके।"
)


class TestCompressInputNode:
    @pytest.mark.asyncio
    async def test_no_scenario_returns_none(self):
        result = await compress_input(_make_state(), {"configurable": {}})
        assert result == {"compressed_input": None}

    @pytest.mark.asyncio
    async def test_english_language_skips_without_calling_client(self, monkeypatch):
        fake_client = FakeCompressionClient()
        monkeypatch.setattr(nodes, "_get_compression_client", lambda: fake_client)
        monkeypatch.setattr(settings, "INPUT_COMPRESSION_ENABLED", True)

        scenario = _make_scenario(language_code="en-IN", compression_enabled=True)
        state = _make_state(messages=[HumanMessage(content=LONG_HINDI_TEXT)])
        result = await compress_input(state, {"configurable": {"scenario": scenario}})

        assert result == {"compressed_input": None}
        assert fake_client.completions.calls == []

    @pytest.mark.asyncio
    async def test_global_kill_switch_off_skips(self, monkeypatch):
        fake_client = FakeCompressionClient()
        monkeypatch.setattr(nodes, "_get_compression_client", lambda: fake_client)
        monkeypatch.setattr(settings, "INPUT_COMPRESSION_ENABLED", False)

        scenario = _make_scenario(language_code="hi-IN", compression_enabled=True)
        state = _make_state(messages=[HumanMessage(content=LONG_HINDI_TEXT)])
        result = await compress_input(state, {"configurable": {"scenario": scenario}})

        assert result == {"compressed_input": None}
        assert fake_client.completions.calls == []

    @pytest.mark.asyncio
    async def test_scenario_opt_out_skips(self, monkeypatch):
        fake_client = FakeCompressionClient()
        monkeypatch.setattr(nodes, "_get_compression_client", lambda: fake_client)
        monkeypatch.setattr(settings, "INPUT_COMPRESSION_ENABLED", True)

        scenario = _make_scenario(language_code="hi-IN", compression_enabled=False)
        state = _make_state(messages=[HumanMessage(content=LONG_HINDI_TEXT)])
        result = await compress_input(state, {"configurable": {"scenario": scenario}})

        assert result == {"compressed_input": None}
        assert fake_client.completions.calls == []

    @pytest.mark.asyncio
    async def test_short_input_skips_without_calling_client(self, monkeypatch):
        fake_client = FakeCompressionClient()
        monkeypatch.setattr(nodes, "_get_compression_client", lambda: fake_client)
        monkeypatch.setattr(settings, "INPUT_COMPRESSION_ENABLED", True)
        # Default INPUT_COMPRESSION_MIN_TOKENS (50) comfortably exceeds a
        # one-word message's token count.
        scenario = _make_scenario(language_code="hi-IN", compression_enabled=True)
        state = _make_state(messages=[HumanMessage(content="नमस्ते")])
        result = await compress_input(state, {"configurable": {"scenario": scenario}})

        assert result == {"compressed_input": None}
        assert fake_client.completions.calls == []

    @pytest.mark.asyncio
    async def test_no_human_message_returns_none(self, monkeypatch):
        fake_client = FakeCompressionClient()
        monkeypatch.setattr(nodes, "_get_compression_client", lambda: fake_client)
        monkeypatch.setattr(settings, "INPUT_COMPRESSION_ENABLED", True)
        monkeypatch.setattr(settings, "INPUT_COMPRESSION_MIN_TOKENS", 1)

        scenario = _make_scenario(language_code="hi-IN", compression_enabled=True)
        state = _make_state(messages=[AIMessage(content=LONG_HINDI_TEXT)])
        result = await compress_input(state, {"configurable": {"scenario": scenario}})

        assert result == {"compressed_input": None}
        assert fake_client.completions.calls == []

    @pytest.mark.asyncio
    async def test_compression_fires_and_records_metrics(self, monkeypatch):
        fake_client = FakeCompressionClient(content="  compressed text  ")
        monkeypatch.setattr(nodes, "_get_compression_client", lambda: fake_client)
        monkeypatch.setattr(settings, "INPUT_COMPRESSION_ENABLED", True)
        monkeypatch.setattr(settings, "INPUT_COMPRESSION_MIN_TOKENS", 3)
        monkeypatch.setattr(settings, "INPUT_COMPRESSION_MODEL", "gpt-4o-mini")

        recorded = {}

        def fake_record(room_id, **fields):
            recorded.update(fields)

        monkeypatch.setattr(turn_metrics, "record", fake_record)

        scenario = _make_scenario(language_code="hi-IN", compression_enabled=True)
        state = _make_state(messages=[HumanMessage(content=LONG_HINDI_TEXT)])
        result = await compress_input(state, {"configurable": {"scenario": scenario}})

        assert result == {"compressed_input": "compressed text"}
        assert len(fake_client.completions.calls) == 1
        assert fake_client.completions.calls[0]["model"] == "gpt-4o-mini"

        assert recorded.get("input_compression_fired") is True
        assert recorded.get("input_compression_tokens_pre", 0) > 0
        assert recorded.get("input_compression_tokens_post", 0) > 0

    @pytest.mark.asyncio
    async def test_timeout_falls_back_to_none(self, monkeypatch):
        fake_client = FakeCompressionClient(delay=0.2)
        monkeypatch.setattr(nodes, "_get_compression_client", lambda: fake_client)
        monkeypatch.setattr(settings, "INPUT_COMPRESSION_ENABLED", True)
        monkeypatch.setattr(settings, "INPUT_COMPRESSION_MIN_TOKENS", 3)
        monkeypatch.setattr(settings, "INPUT_COMPRESSION_TIMEOUT", 0.01)

        scenario = _make_scenario(language_code="hi-IN", compression_enabled=True)
        state = _make_state(messages=[HumanMessage(content=LONG_HINDI_TEXT)])
        result = await compress_input(state, {"configurable": {"scenario": scenario}})

        assert result == {"compressed_input": None}

    @pytest.mark.asyncio
    async def test_exception_falls_back_to_none(self, monkeypatch):
        fake_client = FakeCompressionClient(error=RuntimeError("boom"))
        monkeypatch.setattr(nodes, "_get_compression_client", lambda: fake_client)
        monkeypatch.setattr(settings, "INPUT_COMPRESSION_ENABLED", True)
        monkeypatch.setattr(settings, "INPUT_COMPRESSION_MIN_TOKENS", 3)

        scenario = _make_scenario(language_code="hi-IN", compression_enabled=True)
        state = _make_state(messages=[HumanMessage(content=LONG_HINDI_TEXT)])
        result = await compress_input(state, {"configurable": {"scenario": scenario}})

        assert result == {"compressed_input": None}

    @pytest.mark.asyncio
    async def test_empty_compressed_result_returns_none(self, monkeypatch):
        fake_client = FakeCompressionClient(content="   ")
        monkeypatch.setattr(nodes, "_get_compression_client", lambda: fake_client)
        monkeypatch.setattr(settings, "INPUT_COMPRESSION_ENABLED", True)
        monkeypatch.setattr(settings, "INPUT_COMPRESSION_MIN_TOKENS", 3)

        scenario = _make_scenario(language_code="hi-IN", compression_enabled=True)
        state = _make_state(messages=[HumanMessage(content=LONG_HINDI_TEXT)])
        result = await compress_input(state, {"configurable": {"scenario": scenario}})

        assert result == {"compressed_input": None}
