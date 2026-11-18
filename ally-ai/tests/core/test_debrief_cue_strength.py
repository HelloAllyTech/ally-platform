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


class TestSplitMissedCues:
    """Only a cue every signal reads as possible stops holding a debrief."""

    def _cue(self, quote, clear, turn=2, addressed=False):
        return {
            "turn_index": turn,
            "quote": quote,
            "addressed_by_debrief": addressed,
            "clear": clear,
        }

    def _safety(self, quote, category="hopelessness", turn=2):
        from app.core.debrief.cue_strength import with_strength

        return with_strength(
            [{"turn_index": turn, "quote": quote, "category": category}]
        )

    def test_possible_when_every_signal_says_so(self):
        from app.core.debrief.cue_strength import split_missed_cues

        q = "अभी कुछ करने का मन नहीं करता"
        clear, possible = split_missed_cues([self._cue(q, False)], self._safety(q))
        assert clear == [] and len(possible) == 1

    def test_the_evaluator_alone_can_make_it_clear(self):
        from app.core.debrief.cue_strength import split_missed_cues

        q = "ನಾನು ಇನ್ನು ಇರಬಾರದು ಅನ್ನಿಸುತ್ತೆ"  # Kannada; no words in the list
        clear, possible = split_missed_cues([self._cue(q, True)], self._safety(q))
        assert len(clear) == 1 and possible == []

    def test_words_raise_it_to_clear_whatever_the_evaluator_says(self):
        from app.core.debrief.cue_strength import split_missed_cues

        q = "sometimes I wish I could just disappear"
        clear, possible = split_missed_cues([self._cue(q, False)], self._safety(q))
        assert len(clear) == 1 and possible == []

    def test_an_unflagged_turn_follows_the_evaluator(self):
        from app.core.debrief.cue_strength import split_missed_cues

        # Tamil, a turn the Safety reader never flagged: the Evaluator's
        # reading of the meaning decides, either way.
        q = "எல்லாம் முடிந்துவிட்டது"
        clear, possible = split_missed_cues(
            [self._cue(q, False, turn=5)], self._safety("x")
        )
        assert clear == [] and len(possible) == 1
        clear, possible = split_missed_cues(
            [self._cue(q, True, turn=5)], self._safety("x")
        )
        assert len(clear) == 1 and possible == []

    def test_an_old_answer_without_clear_counts_as_clear(self):
        from app.core.debrief.cue_strength import split_missed_cues

        q = "I feel so tired of everything"
        cue = self._cue(q, False)
        del cue["clear"]
        clear, possible = split_missed_cues([cue], self._safety(q))
        assert len(clear) == 1 and possible == []

    def test_addressed_cues_are_neither(self):
        from app.core.debrief.cue_strength import split_missed_cues

        q = "grey"
        assert split_missed_cues(
            [self._cue(q, True, addressed=True)], self._safety(q)
        ) == (
            [],
            [],
        )


class TestDropPossibleImportantMoment:
    def _cards(self, turn, quote, others=()):
        return {
            "opening": "o",
            "important_moment": {
                "turn_index": turn,
                "quote": quote,
                "handled_well": True,
                "lead": "l",
                "body": "b",
                "others": list(others),
            },
        }

    def test_goes_when_no_signal_reads_it_as_clear(self):
        from app.core.debrief.cue_strength import (
            drop_possible_important_moment,
            with_strength,
        )

        q = "अभी कुछ करने का मन नहीं करता।"
        cards, dropped = drop_possible_important_moment(
            self._cards(4, q),
            [
                {
                    "turn_index": 4,
                    "quote": q,
                    "addressed_by_debrief": True,
                    "clear": False,
                }
            ],
            with_strength([]),
        )
        assert cards["important_moment"] is None
        assert dropped == {"turn_index": 4, "quote": q}

    def test_stays_when_the_evaluator_reads_it_as_clear(self):
        from app.core.debrief.cue_strength import drop_possible_important_moment

        q = "ನನಗೆ ಇನ್ನು ಇರಬೇಕು ಅನ್ನಿಸಲ್ಲ"  # Kannada, no words in the list
        cards, dropped = drop_possible_important_moment(
            self._cards(4, q),
            [
                {
                    "turn_index": 4,
                    "quote": q,
                    "addressed_by_debrief": True,
                    "clear": True,
                }
            ],
            [],
        )
        assert cards["important_moment"] is not None and dropped is None

    def test_stays_when_the_safety_reader_filed_it_as_clear(self):
        from app.core.debrief.cue_strength import (
            drop_possible_important_moment,
            with_strength,
        )

        q = "When he drinks he hits me."
        cards, dropped = drop_possible_important_moment(
            self._cards(3, q),
            [],
            with_strength(
                [{"turn_index": 3, "quote": q, "category": "abuse_disclosure"}]
            ),
        )
        assert dropped is None

    def test_stays_when_any_other_moment_on_it_is_clear(self):
        from app.core.debrief.cue_strength import drop_possible_important_moment

        cards, dropped = drop_possible_important_moment(
            self._cards(
                2, "so tired", others=[{"turn_index": 6, "quote": "I want to die"}]
            ),
            [{"turn_index": 2, "quote": "so tired", "clear": False}],
            [],
        )
        assert dropped is None


# --- word_list_raises (roleplay risk cue contract) ---------------------------


def test_word_list_off_means_the_readers_own_judgement_decides():
    from app.core.debrief.cue_strength import cue_strength

    # Default: today's behaviour exactly.
    assert cue_strength({"category": "hopelessness", "quote": "I want to die"}) == (
        "clear"
    )
    harmful = {"category": "suicide_or_self_harm", "strength": "possible"}
    assert cue_strength(harmful) == "clear"
    off = {"word_list_raises": False}
    # No word list, no always-clear categories: the reader's strength.
    assert (
        cue_strength({"category": "hopelessness", "quote": "I want to die"}, **off)
        == "clear"
    )  # the reader gave no strength: clear, as before
    assert (
        cue_strength(
            {
                "category": "hopelessness",
                "quote": "I want to die",
                "strength": "possible",
            },
            **off,
        )
        == "possible"
    )
    assert (
        cue_strength(
            {"category": "suicide_or_self_harm", "strength": "possible"}, **off
        )
        == "possible"
    )
    assert cue_strength({"category": "harm_to_others", "strength": "clear"}, **off) == (
        "clear"
    )
    assert cue_strength({"category": "something_new"}, **off) == "clear"


def test_with_strength_threads_the_flag():
    from app.core.debrief.cue_strength import with_strength

    cues = [
        {
            "category": "suicide_or_self_harm",
            "quote": "I want to die",
            "strength": "possible",
        }
    ]
    assert with_strength(cues)[0]["strength"] == "clear"
    assert with_strength(cues, False)[0]["strength"] == "possible"


def test_turn_is_clear_without_the_word_list_still_follows_other_signals():
    from app.core.debrief.cue_strength import split_missed_cues, turn_is_clear

    quote = "I want to die"
    assert turn_is_clear(2, quote, [], [])
    assert not turn_is_clear(2, quote, [], [], word_list_raises=False)
    # The Evaluator and the reader still decide.
    assert turn_is_clear(2, quote, [{"turn_index": 2}], [], word_list_raises=False)
    assert turn_is_clear(
        2, quote, [], [{"turn_index": 2, "strength": "clear"}], word_list_raises=False
    )
    cue = {"turn_index": 2, "quote": quote, "clear": False}
    clear, possible = split_missed_cues([cue], [], word_list_raises=False)
    assert not clear and possible == [cue]
    clear, possible = split_missed_cues([cue], [])
    assert clear == [cue]


def test_drop_possible_important_moment_respects_the_flag():
    from app.core.debrief.cue_strength import drop_possible_important_moment

    cards = {"important_moment": {"turn_index": 2, "quote": "I want to die"}}
    kept, dropped = drop_possible_important_moment(cards, [], [])
    assert kept is cards and dropped is None
    kept, dropped = drop_possible_important_moment(
        cards, [], [], word_list_raises=False
    )
    assert kept["important_moment"] is None and dropped["turn_index"] == 2
