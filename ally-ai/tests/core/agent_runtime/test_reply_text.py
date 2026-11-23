"""Chunk H1 Part D: a sent reply has no citation numbers or source lists."""

import pytest

from app.core.agent_runtime.check.text import without_citation_marks


@pytest.mark.parametrize(
    "said, sent",
    [
        (
            "Open Monday–Saturday, 9:00 AM to 7:00 PM.) Would you like the contact?",
            "Open Monday–Saturday, 9:00 AM to 7:00 PM. Would you like the contact?",
        ),
        (
            "Open on Sunday from 9:00 AM to 1:00 PM [3]. Book online [5].",
            "Open on Sunday from 9:00 AM to 1:00 PM. Book online.",
        ),
        (
            "Yes, LASIK and SMILE. Sources: [1], [2], [3], [7], [8]. Shall I help?",
            "Yes, LASIK and SMILE. Shall I help?",
        ),
        ("It costs ₹600. (Sources:) Anything else?", "It costs ₹600. Anything else?"),
        ("Closed at 7:00 PM. (Source: [1])", "Closed at 7:00 PM."),
        ("Call 95949 04015 [2][5].", "Call 95949 04015."),
        ("See our Sources page for more.", "See our Sources page for more."),
        ("Mon–Sat [1, 4]\nSun closed", "Mon–Sat\nSun closed"),
    ],
)
def test_citation_leftovers_are_removed(said, sent):
    assert without_citation_marks(said) == sent


@pytest.mark.parametrize(
    "reply, sent",
    [
        (
            "Free of charge. For details, call our helpline (see source).",
            "Free of charge. For details, call our helpline.",
        ),
        ("Returns within 15 days (see policy).", "Returns within 15 days."),
        (
            "The exact rate isn't listed (citation 7). Kya main dhoondun?",
            "The exact rate isn't listed. Kya main dhoondun?",
        ),
        (
            "Men High Top Sneakers — ₹3999 (entries 4, 5, 6) and ₹3199 (entry 7).",
            "Men High Top Sneakers — ₹3999 and ₹3199.",
        ),
        (
            "It is listed at ₹3999.product listings cited below.",
            "It is listed at ₹3999.",
        ),
        (
            "Day pass prices vary (देखें:. Which hub?",
            "Day pass prices vary. Which hub?",
        ),
        ("BHIVE day pass ₹150 [cite 9] [cite 10].", "BHIVE day pass ₹150."),
        # A real count stays.
        ("We have 3 entries in May.", "We have 3 entries in May."),
    ],
)
def test_stray_citation_talk_is_removed(reply, sent):
    """Q4 C16: the forms the use-case suite and BHIVE's live page showed."""
    assert without_citation_marks(reply) == sent
