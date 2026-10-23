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


class TestExtractUsageFromOpenaiCompletion:
    @pytest.mark.unit
    def test_reads_usage_object_with_cached_tokens(self):
        from app.core.llm_usage.extract import extract_usage_from_openai_completion

        completion = SimpleNamespace(
            usage=SimpleNamespace(
                prompt_tokens=300,
                completion_tokens=12,
                total_tokens=312,
                prompt_tokens_details=SimpleNamespace(cached_tokens=256),
            )
        )
        assert extract_usage_from_openai_completion(completion) == (300, 12, 312, 256)

    @pytest.mark.unit
    def test_none_without_usage(self):
        from app.core.llm_usage.extract import extract_usage_from_openai_completion

        assert extract_usage_from_openai_completion(SimpleNamespace()) is None
        assert (
            extract_usage_from_openai_completion(
                SimpleNamespace(
                    usage=SimpleNamespace(
                        prompt_tokens=0, completion_tokens=0, total_tokens=0
                    )
                )
            )
            is None
        )


class TestEmitHelpers:
    """The shared helpers every newly-recorded call site goes through."""

    @staticmethod
    def _aimessage():
        return SimpleNamespace(
            usage_metadata={
                "input_tokens": 100,
                "output_tokens": 10,
                "total_tokens": 110,
            }
        )

    @pytest.mark.unit
    def test_langchain_usage_takes_provider_and_model_from_client(self, ai_usage_calls):
        from app.core.llm_usage.emitter import emit_langchain_usage

        client = SimpleNamespace(
            provider="openai",
            llm_instance=SimpleNamespace(model_name="gpt-4o-mini"),
        )
        emit_langchain_usage(
            self._aimessage(), task="interim_reply", llm_client=client, room_id="r-1"
        )
        assert len(ai_usage_calls) == 1
        call = ai_usage_calls[0]
        assert call["room_id"] == "r-1"
        assert call["task"] == "interim_reply"
        assert call["provider"] == "openai"
        assert call["model"] == "gpt-4o-mini"
        assert (call["prompt_tokens"], call["completion_tokens"]) == (100, 10)

    @pytest.mark.unit
    def test_room_falls_back_to_graph_context_var(self, ai_usage_calls, graph_room):
        from app.core.llm_usage.emitter import emit_langchain_usage

        emit_langchain_usage(self._aimessage(), task="knowledge_retrieval")
        assert ai_usage_calls[0]["room_id"] == "graph-room"

    @pytest.mark.unit
    def test_explicit_room_beats_context_var(self, ai_usage_calls, graph_room):
        from app.core.llm_usage.emitter import emit_langchain_usage

        emit_langchain_usage(self._aimessage(), task="x", room_id="explicit")
        assert ai_usage_calls[0]["room_id"] == "explicit"

    @pytest.mark.unit
    def test_no_usage_emits_nothing(self, ai_usage_calls):
        from app.core.llm_usage.emitter import emit_langchain_usage, emit_openai_usage

        emit_langchain_usage(SimpleNamespace(), task="x", room_id="r")
        emit_openai_usage(SimpleNamespace(), task="x", model="m", room_id="r")
        assert ai_usage_calls == []

    @pytest.mark.unit
    def test_openai_usage_uses_requested_model(self, ai_usage_calls):
        from app.core.llm_usage.emitter import emit_openai_usage

        completion = SimpleNamespace(
            model="gpt-4o-mini-2024-07-18",
            usage=SimpleNamespace(
                prompt_tokens=50, completion_tokens=5, total_tokens=55
            ),
        )
        emit_openai_usage(
            completion, task="binary_classifier", model="gpt-4o-mini", room_id="r"
        )
        call = ai_usage_calls[0]
        assert call["model"] == "gpt-4o-mini"
        assert call["provider"] == "openai"
        assert call["total_tokens"] == 55

    @pytest.mark.unit
    def test_embedding_usage_is_input_tokens_only(self, ai_usage_calls):
        from app.core.llm_usage.emitter import emit_embedding_usage

        emit_embedding_usage(
            task="event_embedding",
            model="text-embedding-3-small",
            input_tokens=42,
            room_id="r",
        )
        call = ai_usage_calls[0]
        assert call["service"] == "llm"
        assert (call["prompt_tokens"], call["completion_tokens"]) == (42, 0)
        assert call["total_tokens"] == 42

    @pytest.mark.unit
    def test_helpers_never_raise(self, monkeypatch):
        from app.core.llm_usage import emitter

        def _boom(*a, **k):
            raise RuntimeError("queue down")

        monkeypatch.setattr(emitter, "emit_ai_usage", _boom)
        emitter.emit_langchain_usage(self._aimessage(), task="x", room_id="r")
        emitter.emit_embedding_usage(task="x", model="m", input_tokens=1)

    @pytest.mark.unit
    def test_scenario_session_id_reaches_the_wire(self, monkeypatch):
        captured = {}

        def fake_create_llm_usage(room_id, llm_usage):
            captured["room_id"] = room_id
            captured["llm_usage"] = llm_usage
            return SimpleNamespace(model_dump_json=lambda: "{}")

        monkeypatch.setattr(
            "app.core.llm_usage.emitter.CoreEventMessageType.create_llm_usage",
            fake_create_llm_usage,
        )
        monkeypatch.setattr(
            "app.core.llm_usage.emitter.asyncio.create_task", lambda c: c.close()
        )
        emit_llm_usage(
            None,
            "openai",
            "gpt-4o-mini",
            task="actor_evaluation",
            usage=(10, 2, 12),
            scenario_session_id="sess-9",
        )
        assert captured["room_id"] == ""
        assert captured["llm_usage"].scenario_session_id == "sess-9"

    @pytest.mark.unit
    def test_metadata_reaches_the_wire(self, monkeypatch):
        captured = {}

        def fake_create_llm_usage(room_id, llm_usage):
            captured["room_id"] = room_id
            captured["llm_usage"] = llm_usage
            return SimpleNamespace(model_dump_json=lambda: "{}")

        monkeypatch.setattr(
            "app.core.llm_usage.emitter.CoreEventMessageType.create_llm_usage",
            fake_create_llm_usage,
        )
        monkeypatch.setattr(
            "app.core.llm_usage.emitter.asyncio.create_task", lambda c: c.close()
        )
        from app.core.llm_usage.emitter import emit_langchain_usage

        emit_langchain_usage(
            self._aimessage(),
            task="scenario_report_counselor",
            room_id="rep-1",
            metadata={"report_id": "rep-1"},
        )
        assert captured["room_id"] == "rep-1"
        assert captured["llm_usage"].metadata == {"report_id": "rep-1"}

    @pytest.mark.unit
    def test_openai_usage_carries_session_id_and_explicit_room(
        self, ai_usage_calls, graph_room
    ):
        from app.core.llm_usage.emitter import emit_openai_usage

        completion = SimpleNamespace(
            usage=SimpleNamespace(
                prompt_tokens=50, completion_tokens=5, total_tokens=55
            )
        )
        emit_openai_usage(
            completion,
            task="v2v_tester_reply",
            model="gpt-4o-mini",
            room_id="room-under-test",
            scenario_session_id="sess-1",
        )
        call = ai_usage_calls[0]
        assert call["room_id"] == "room-under-test"
        assert call["scenario_session_id"] == "sess-1"

    @pytest.mark.unit
    def test_openai_usage_by_session_does_not_borrow_the_context_room(
        self, ai_usage_calls, graph_room
    ):
        from app.core.llm_usage.emitter import emit_openai_usage

        completion = SimpleNamespace(
            usage=SimpleNamespace(prompt_tokens=5, completion_tokens=1, total_tokens=6)
        )
        emit_openai_usage(completion, task="x", model="m", scenario_session_id="sess-2")
        assert ai_usage_calls[0]["room_id"] is None


class TestNewTaskLabels:
    """String-for-string with ally-be's LlmTask: a mismatch lands in UNKNOWN."""

    @pytest.mark.unit
    def test_rehearsal_and_tester_labels(self):
        from app.core.llm_usage.tasks import LLMTask

        assert LLMTask.SCENARIO_REPORT_EVALUATION.value == "scenario_report_evaluation"
        assert LLMTask.SCENARIO_REPORT_COUNSELOR.value == "scenario_report_counselor"
        assert LLMTask.V2V_TESTER_REPLY.value == "v2v_tester_reply"
        assert LLMTask.V2V_ROLE_FIDELITY_JUDGE.value == "v2v_role_fidelity_judge"
