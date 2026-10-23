from typing import List

import pytest

from app.core.events.base import ChatMessage
from app.core.events.event_types.similarity_based.base import SimilarityBaseEvent


@pytest.fixture
def reset_test_event():
    """Reset TestEvent class state before each test to prevent pollution."""
    TestEvent._built = False
    TestEvent._patterns = []
    yield
    # Cleanup after test
    TestEvent._built = False
    TestEvent._patterns = []


class TestEvent(SimilarityBaseEvent):
    # Define simple phrases for matching
    similar_sentences = [
        "Great explanation",
        "slow down please",
        "that's helpful",
    ]
    # Prevent pytest from collecting this helper as a test class
    __test__ = False


class TestSimilarityBaseEvent:
    @pytest.mark.asyncio
    async def test_detect_event_requires_counselor_role(self, reset_test_event):
        ev = TestEvent(event_id="e1")
        msgs: List[ChatMessage] = [
            ChatMessage(role="user", content="Great explanation!"),
            ChatMessage(role="assistant", content="Great explanation!"),
        ]
        # Not counselor → False even if content matches
        assert await ev.detect_event(msgs) is False

    @pytest.mark.asyncio
    async def test_detect_event_matches_last_message_only(self, reset_test_event):
        ev = TestEvent(event_id="e2")
        msgs: List[ChatMessage] = [
            ChatMessage(role="counselor", content="This is fine"),
            ChatMessage(role="counselor", content="Please slow down a bit."),
        ]
        assert await ev.detect_event(msgs) is True

    def test_match_by_substring_and_token_coverage(self, reset_test_event):
        ev = TestEvent(event_id="e3")

        # Direct substring match after normalization
        assert ev._match("That was a great explanation!!") is True

        # Token coverage: "slow down please" -> normalized "slow down please"
        # After stopword removal: informative_tokens = {"slow", "down", "please"}
        # Test partial match with good coverage: "please slow" has 2/3
        # tokens = 66% >= 60% threshold
        assert ev._match("please slow a bit") is True

        # Test that insufficient token coverage fails
        # "please" alone is only 1/3 = 33% < 60% threshold
        assert ev._match("please wait") is False

    def test_no_match_on_empty_or_non_informative_input(self, reset_test_event):
        ev = TestEvent(event_id="e4")
        assert ev._match("") is False
        assert ev._match("!!! ?? ..") is False

    def test_invalid_similar_sentences_raises(self):
        class BadEvent(SimilarityBaseEvent):
            similar_sentences = []  # invalid

        bad = BadEvent(event_id="e5")
        with pytest.raises(NotImplementedError):
            bad._match("anything")
