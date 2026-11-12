"""Cue strength (cue_strength.py): only ever lowers what the learner's cards
must show, never what counts as a risk cue. Cases from the 2026-11-12 gold
sessions and the seeded sessions the reader filed under hopelessness."""

import pytest

from app.core.debrief.cue_strength import cue_strength, is_clear, with_strength


def cue(quote, category="hopelessness"):
    return {"turn_index": 1, "quote": quote, "category": category}


@pytest.mark.parametrize(
    "category",
    ["suicide_or_self_harm", "harm_to_others", "abuse_disclosure", "something_new"],
)
def test_every_category_but_hopelessness_is_clear(category):
    assert cue_strength(cue("Okay.", category)) == "clear"


@pytest.mark.parametrize(
    "quote",
    [
        # The reader filed this one under hopelessness (S-RISK-MISS).
        "Sometimes I think everyone would be better off if I just wasn't around "
        "anymore.",
        "Some nights I think it would be easier if I just didn't wake up.",
        "I sometimes wish I just wasn't here anymore.",
        "I can't go on like this.",
        "I want to die.",
        "Kabhi kabhi lagta hai main mar jaaun toh sab theek ho jaayega.",
        "कभी-कभी लगता है कि सबके लिए अच्छा होगा अगर मैं न रहूँ।",
        "अब जीने का मन नहीं करता।",
        "रात को पंखे की तरफ़ देखता रहता हूँ।",
        "Sab khatam kar dena chahta hoon.",
    ],
)
def test_hopelessness_naming_death_or_a_means_is_clear(quote):
    assert cue_strength(cue(quote)) == "clear"


@pytest.mark.parametrize(
    "quote",
    [
        "Everything just feels grey lately.",
        "Nothing feels like mine anymore.",
        "Office जाता हूँ, वापस आता हूँ, बस। सब कुछ बोझ जैसा लगता है।",
        "हर दिन। बस यही सोचता रहता हूँ।",
        "Nothing is fun.",
        "Honestly I feel like a failure. Like I let everyone down.",
        "My father died in June and the house feels empty.",
        "Board exams aa rahe hain aur sach mein ye exam mujhe maar dalega.",
    ],
)
def test_ordinary_low_mood_grief_and_guilt_are_possible(quote):
    assert cue_strength(cue(quote)) == "possible"


def test_strength_is_added_without_touching_the_reader_fields():
    cues = [cue("Nothing is fun."), cue("I'm saving my pills.", "suicide_or_self_harm")]
    out = with_strength(cues)
    assert [c["strength"] for c in out] == ["possible", "clear"]
    assert all(
        {k: v for k, v in o.items() if k != "strength"} == c for o, c in zip(out, cues)
    )
    assert "strength" not in cues[0]


def test_a_cue_without_a_strength_counts_as_clear():
    assert is_clear({"turn_index": 3})
    assert not is_clear({"turn_index": 3, "strength": "possible"})
