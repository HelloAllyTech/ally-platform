"""Tests for LLM token-usage extraction and cache-hit visibility."""

from types import SimpleNamespace
from unittest.mock import patch

import pytest

from app.core.llm_usage.emitter import emit_ai_usage, emit_llm_usage
from app.core.llm_usage.extract import extract_usage_from_aimessage


class TestExtractUsageFromAimessage:
    @pytest.mark.unit
    def test_normalized_usage_metadata_with_cache_hit(self):
        response = SimpleNamespace(
            usage_metadata={
                "input_tokens": 1000,
                "output_tokens": 50,
                "total_tokens": 1050,
                "input_token_details": {"cache_read": 800},
            }
        )
        assert extract_usage_from_aimessage(response) == (1000, 50, 1050, 800)

    @pytest.mark.unit
    def test_normalized_usage_metadata_without_cache_details(self):
        response = SimpleNamespace(
            usage_metadata={
                "input_tokens": 1000,
                "output_tokens": 50,
                "total_tokens": 1050,
            }
        )
        assert extract_usage_from_aimessage(response) == (1000, 50, 1050, 0)

    @pytest.mark.unit
    def test_raw_openai_fallback_with_cached_tokens(self):
        response = SimpleNamespace(
            usage_metadata=None,
            response_metadata={
                "token_usage": {
                    "prompt_tokens": 500,
                    "completion_tokens": 20,
                    "total_tokens": 520,
                    "prompt_tokens_details": {"cached_tokens": 400},
                }
            },
        )
        assert extract_usage_from_aimessage(response) == (500, 20, 520, 400)

    @pytest.mark.unit
    def test_returns_none_when_no_usage_present(self):
        assert extract_usage_from_aimessage(SimpleNamespace()) is None

    @pytest.mark.unit
    def test_never_raises_on_malformed_input(self):
        response = SimpleNamespace(usage_metadata="not-a-dict")
        assert extract_usage_from_aimessage(response) is None


class TestEmitLlmUsage:
    @pytest.mark.unit
    def test_forwards_4tuple_cached_tokens(self):
        with patch("app.core.llm_usage.emitter.emit_ai_usage") as mock_emit:
            emit_llm_usage(
                "room-1", "openai", "gpt-4o-mini", usage=(1000, 50, 1050, 800)
            )
        mock_emit.assert_called_once()
        kwargs = mock_emit.call_args.kwargs
        assert kwargs["prompt_tokens"] == 1000
        assert kwargs["cached_tokens"] == 800

    @pytest.mark.unit
    def test_3tuple_defaults_cached_tokens_to_zero(self):
        """Back-compat: call sites not yet extracting cache_read still work."""
        with patch("app.core.llm_usage.emitter.emit_ai_usage") as mock_emit:
            emit_llm_usage("room-1", "openai", "gpt-4o-mini", usage=(1000, 50, 1050))
        kwargs = mock_emit.call_args.kwargs
        assert kwargs["cached_tokens"] == 0

    @pytest.mark.unit
    def test_no_usage_skips_emit(self):
        with patch("app.core.llm_usage.emitter.emit_ai_usage") as mock_emit:
            emit_llm_usage("room-1", "openai", "gpt-4o-mini", usage=None)
        mock_emit.assert_not_called()


class TestEmitAiUsage:
    @pytest.mark.unit
    def test_llm_usage_data_carries_cached_tokens(self, monkeypatch):
        captured = {}

        def fake_create_llm_usage(room_id, llm_usage):
            captured["llm_usage"] = llm_usage
            return SimpleNamespace(model_dump_json=lambda: "{}")

        monkeypatch.setattr(
            "app.core.llm_usage.emitter.CoreEventMessageType.create_llm_usage",
            fake_create_llm_usage,
        )
        monkeypatch.setattr(
            "app.core.llm_usage.emitter.asyncio.create_task", lambda c: c.close()
        )

        emit_ai_usage(
            "room-1",
            service="llm",
            provider="openai",
            model="gpt-4o-mini",
            task="agent_turn",
            prompt_tokens=1000,
            completion_tokens=50,
            total_tokens=1050,
            cached_tokens=800,
        )

        assert captured["llm_usage"].cached_tokens == 800
