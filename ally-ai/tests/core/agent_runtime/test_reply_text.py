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
