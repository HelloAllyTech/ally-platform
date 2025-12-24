import pytest

from app.core.events.base import ChatMessage
from app.core.events.event_types.similarity_based.similarity_event import (
    SimilarityEvent,
)


class TestSimilarityEvent:
    @pytest.mark.asyncio
    async def test_generic_similarity_detects_on_counselor_last_message(self):
        ev = SimilarityEvent.create(
            event_id="g1",
            custom_sentences=["please slow down", "great explanation"],
            score=5,
            emoji=":)",
            emoji_message="Great!",
        )

        # Not counselor → no match even if content matches
        assert (
            await ev.detect_event(
                [ChatMessage(role="user", content="great explanation")]
            )
            is False
        )

        # Counselor with matching phrase
        assert (
            await ev.detect_event(
                [ChatMessage(role="counselor", content="That was a great explanation!")]
            )
            is True
        )

    @pytest.mark.asyncio
    async def test_generic_similarity_no_sentences_never_matches(self):
        ev = SimilarityEvent.create(event_id="g2", custom_sentences=[])
        # No sentences list is allowed but should never match
        assert (
            await ev.detect_event([ChatMessage(role="counselor", content="anything")])
            is False
        )

    def test_generic_similarity_cache_reuse_between_instances(self):
        ev1 = SimilarityEvent.create(
            event_id="g3",
            custom_sentences=["hello there", "hello there"],
            match_threshold=0.7,
        )
        ev2 = SimilarityEvent.create(
            event_id="g4", custom_sentences=["hello there"], match_threshold=0.7
        )

        # Build patterns for both
        assert ev1._instance_built is False
        assert ev2._instance_built is False

        # Trigger build
        assert ev1._match("hello there") is True
        assert ev1._instance_built is True

        # Before matching on ev2, cache should have an entry
        assert len(SimilarityEvent._PATTERN_CACHE) >= 1

        # After matching on ev2 with same config, patterns should reference cached list
        assert ev2._match("hello there") is True
        assert ev2._instance_built is True

        # Build the same cache key by reusing internal logic inputs
        # Ensure at least one cache entry list object is reused across instances
        # Find any cached value equal to ev2 patterns list and check
        # identity with ev2's patterns
        cached_lists = list(SimilarityEvent._PATTERN_CACHE.values())
        assert any(pl is ev2._instance_patterns for pl in cached_lists)
