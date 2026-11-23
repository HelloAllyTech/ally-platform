"""The quote eval's scorer (scripts/eval_pm_conversation_quotes.py) on replies
whose right answer is known: invented wording fails, verbatim text passes, and a
missing-text answer must say it doesn't have the text. Mirrors ally-be's
`pmReplyUnmatched` cases."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

_PATH = Path(__file__).parents[3] / "scripts" / "eval_pm_conversation_quotes.py"
_spec = importlib.util.spec_from_file_location("eval_pm_quotes", _PATH)
ev = importlib.util.module_from_spec(_spec)
sys.modules["eval_pm_quotes"] = ev  # dataclasses look their module up
_spec.loader.exec_module(ev)  # type: ignore[union-attr]

SRC = ["Keep each card under 40 words for Tamil learners."]


def test_invented_wording_is_caught_quoted_or_presented():
    assert ev.unmatched("It shortens the Tamil cards (n=40).", SRC) == []
    assert (
        ev.unmatched("After: “Keep each card under 40 words for Tamil learners.”", SRC)
        == []
    )
    assert ev.unmatched("After: Keep each card under 30 words for Tamil.", SRC) == [
        "Keep each card under 30 words for Tamil."
    ]
    assert ev.unmatched('It now says "Always open with praise for the learner."', SRC)
    assert ev.unmatched("> Cards must open with praise for the learner", SRC)


def test_a_missing_text_answer_says_so():
    assert ev.NO_TEXT.search("I don't have the wording for this change.")
    assert ev.NO_TEXT.search("change_read returned no wording, so I can't quote it.")
    assert not ev.NO_TEXT.search("It says to keep cards short.")


def test_the_set_has_both_kinds():
    kinds = {c.missing for c in ev.CASES}
    assert kinds == {True, False}
    assert all(c.truth for c in ev.CASES if not c.missing)
