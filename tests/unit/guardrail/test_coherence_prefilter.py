"""
Unit tests for CoherencePrefilter — the shadow-mode, non-gating pre-filter
for the STT Coherence Guard. These never touch the real guard; see
test_guardrail_event.py for the shadow-mode wiring into detect_event().
"""

from unittest.mock import AsyncMock

import numpy as np
import pytest

from app.core.events.event_types.guardrail.coherence_prefilter import CoherencePrefilter


@pytest.fixture(autouse=True)
def reset_embedding_client():
    """Every test gets a clean class-level client, regardless of test order."""
    original = CoherencePrefilter._EMBEDDING_CLIENT
    CoherencePrefilter._EMBEDDING_CLIENT = None
    yield
    CoherencePrefilter._EMBEDDING_CLIENT = original


class TestIsLikelyGibberish:
    def test_empty_string_is_not_gibberish(self):
        assert CoherencePrefilter.is_likely_gibberish("") is False
        assert CoherencePrefilter.is_likely_gibberish("   ") is False

    def test_normal_sentence_is_not_gibberish(self):
        assert (
            CoherencePrefilter.is_likely_gibberish(
                "It is natural to feel overwhelmed by your workload."
            )
            is False
        )

    def test_hinglish_code_switching_is_not_gibberish(self):
        """Matches the guard's own prompt example — code-switching is valid."""
        assert (
            CoherencePrefilter.is_likely_gibberish(
                "Haan, thoda tension ho raha hai but I am managing it."
            )
            is False
        )

    def test_flags_repeated_character_runs(self):
        assert CoherencePrefilter.is_likely_gibberish("blarghhhhh fenton") is True

    def test_flags_repeated_runs_in_any_script(self):
        """Language-agnostic: repeated Devanagari characters also flag."""
        assert CoherencePrefilter.is_likely_gibberish("अअअअअ फिर से") is True

    def test_flags_runaway_single_token(self):
        assert CoherencePrefilter.is_likely_gibberish("a" * 41) is True

    def test_does_not_flag_a_token_at_the_sane_boundary(self):
        # 40 non-repeating characters — isolates the token-length check from
        # the repeated-run check above (a run of the same char would trip
        # that one first, which isn't what this test is checking).
        token = ("abcdefghijklmnopqrstuvwxyz" * 2)[:40]
        assert CoherencePrefilter.is_likely_gibberish(token) is False

    def test_three_repeats_does_not_flag(self):
        """Threshold is 4+ — three is common in ordinary text (e.g. "aaah")."""
        assert CoherencePrefilter.is_likely_gibberish("aaah that hurts") is False


class TestDriftScore:
    @pytest.mark.asyncio
    async def test_returns_none_with_no_embedding_client(self):
        score = await CoherencePrefilter.drift_score("hello", "recent context")
        assert score is None

    @pytest.mark.asyncio
    async def test_returns_none_for_empty_message(self):
        CoherencePrefilter._EMBEDDING_CLIENT = AsyncMock()
        score = await CoherencePrefilter.drift_score("   ", "recent context")
        assert score is None
        CoherencePrefilter._EMBEDDING_CLIENT.get_embeddings_batch.assert_not_called()

    @pytest.mark.asyncio
    async def test_returns_none_for_empty_context(self):
        CoherencePrefilter._EMBEDDING_CLIENT = AsyncMock()
        score = await CoherencePrefilter.drift_score("hello", "   ")
        assert score is None
        CoherencePrefilter._EMBEDDING_CLIENT.get_embeddings_batch.assert_not_called()

    @pytest.mark.asyncio
    async def test_computes_cosine_similarity_from_the_embedding_client(self):
        mock_client = AsyncMock()
        mock_client.get_embeddings_batch.return_value = [
            np.array([1.0, 0.0]),
            np.array([1.0, 0.0]),
        ]
        CoherencePrefilter._EMBEDDING_CLIENT = mock_client

        score = await CoherencePrefilter.drift_score("hello", "recent context")

        assert score == pytest.approx(1.0)
        mock_client.get_embeddings_batch.assert_awaited_once_with(
            ["hello", "recent context"]
        )

    @pytest.mark.asyncio
    async def test_orthogonal_embeddings_score_zero(self):
        mock_client = AsyncMock()
        mock_client.get_embeddings_batch.return_value = [
            np.array([1.0, 0.0]),
            np.array([0.0, 1.0]),
        ]
        CoherencePrefilter._EMBEDDING_CLIENT = mock_client

        score = await CoherencePrefilter.drift_score("hello", "unrelated")

        assert score == pytest.approx(0.0)

    @pytest.mark.asyncio
    async def test_returns_none_when_embedding_call_fails(self):
        """Best-effort — a failed embedding call is a missing signal, not a crash."""
        mock_client = AsyncMock()
        mock_client.get_embeddings_batch.side_effect = Exception("embedding API down")
        CoherencePrefilter._EMBEDDING_CLIENT = mock_client

        score = await CoherencePrefilter.drift_score("hello", "recent context")

        assert score is None


class TestWouldFlag:
    @pytest.mark.asyncio
    async def test_gibberish_flags_true_without_needing_an_embedding_client(self):
        would_flag, score = await CoherencePrefilter.would_flag(
            "blarghhhhh fenton", "recent context"
        )
        assert would_flag is True
        assert score is None

    @pytest.mark.asyncio
    async def test_falls_through_to_drift_score_when_not_gibberish(self):
        mock_client = AsyncMock()
        mock_client.get_embeddings_batch.return_value = [
            np.array([1.0, 0.0]),
            np.array([0.0, 1.0]),  # orthogonal -> similarity 0.0, below threshold
        ]
        CoherencePrefilter._EMBEDDING_CLIENT = mock_client

        would_flag, score = await CoherencePrefilter.would_flag(
            "The train to Mumbai leaves at midnight.", "client discussing grief"
        )

        assert would_flag is True
        assert score == pytest.approx(0.0)

    @pytest.mark.asyncio
    async def test_coherent_on_topic_message_does_not_flag(self):
        mock_client = AsyncMock()
        mock_client.get_embeddings_batch.return_value = [
            np.array([1.0, 0.0]),
            np.array([1.0, 0.0]),  # identical -> similarity 1.0, above threshold
        ]
        CoherencePrefilter._EMBEDDING_CLIENT = mock_client

        would_flag, score = await CoherencePrefilter.would_flag(
            "It is natural to feel overwhelmed.", "client discussing work stress"
        )

        assert would_flag is False
        assert score == pytest.approx(1.0)

    @pytest.mark.asyncio
    async def test_returns_false_with_no_signal_at_all(self):
        """Not gibberish, no embedding client configured — no verdict, so no flag."""
        would_flag, score = await CoherencePrefilter.would_flag(
            "How are you feeling today?", "recent context"
        )
        assert would_flag is False
        assert score is None
