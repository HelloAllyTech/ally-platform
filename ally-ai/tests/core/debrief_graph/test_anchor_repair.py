from app.core.debrief_graph.anchor_repair import describe, normalise, reanchor_quotes

TRANSCRIPT = [
    {"turn_index": 1, "role": "client", "text": "I just feel so tired of everything."},
    {"turn_index": 2, "role": "counselor", "text": "That sounds really hard to carry."},
    {"turn_index": 3, "role": "client", "text": "Nobody listens to me at home."},
    {"turn_index": 4, "role": "counselor", "text": "Tell me more about home."},
    {"turn_index": 5, "role": "counselor", "text": "What happens when you speak up?"},
    {"turn_index": 6, "role": "client", "text": "They shout, so I stop talking."},
]


def _cards(**over):
    cards = {
        "opening": "A caring session.",
        "important_moment": None,
        "what_worked": [
            {
                "skill": "reflecting",
                "turn_index": 2,
                "quote": "That sounds really hard to carry",
                "lead": "l",
                "body": "b",
            }
        ],
        "work_on_this": [],
    }
    cards.update(over)
    return cards


def test_correct_anchor_is_left_alone_and_same_object_returned():
    cards = _cards()
    out, n = reanchor_quotes(cards, TRANSCRIPT)
    assert out is cards and n == 0


def test_fixes_a_wrong_speaker_turn_number():
    cards = _cards()
    cards["what_worked"][0]["turn_index"] = 1  # the client's turn
    out, n = reanchor_quotes(cards, TRANSCRIPT)
    assert n == 1
    assert out["what_worked"][0]["turn_index"] == 2
    assert cards["what_worked"][0]["turn_index"] == 1  # input untouched


def test_fixes_a_quote_in_a_neighbouring_turn():
    cards = _cards()
    cards["what_worked"][0]["turn_index"] = 4
    cards["what_worked"][0]["quote"] = "That sounds really hard to carry"
    out, n = reanchor_quotes(cards, TRANSCRIPT)
    assert n == 1 and out["what_worked"][0]["turn_index"] == 2


def test_quote_may_span_consecutive_turns_by_the_same_speaker():
    cards = _cards()
    cards["what_worked"][0].update(
        turn_index=4, quote="Tell me more about home. What happens when you speak up"
    )
    out, n = reanchor_quotes(cards, TRANSCRIPT)
    assert n == 0  # already valid across turns 4 and 5


def test_never_repairs_a_quote_that_is_not_in_the_transcript():
    cards = _cards()
    cards["what_worked"][0].update(turn_index=4, quote="You are doing wonderfully well")
    out, n = reanchor_quotes(cards, TRANSCRIPT)
    assert out is cards and n == 0


def test_never_moves_a_quote_to_the_other_speaker():
    cards = _cards()
    # The learner card quotes the client's words: no learner turn has them.
    cards["what_worked"][0].update(turn_index=2, quote="Nobody listens to me at home")
    out, n = reanchor_quotes(cards, TRANSCRIPT)
    assert out is cards and n == 0


def test_important_moment_is_the_clients_words():
    moment = {
        "turn_index": 2,  # a learner turn
        "quote": "Nobody listens to me at home",
        "handled_well": True,
        "lead": "l",
        "body": "b",
        "others": [
            {"turn_index": 4, "quote": "They shout, so I stop talking", "note": "n"}
        ],
    }
    out, n = reanchor_quotes(_cards(important_moment=moment), TRANSCRIPT)
    assert n == 2
    assert out["important_moment"]["turn_index"] == 3
    assert out["important_moment"]["others"][0]["turn_index"] == 6


def test_a_quote_found_in_two_turns_is_left_alone():
    transcript = TRANSCRIPT + [
        {"turn_index": 7, "role": "client", "text": "Nobody listens to me at home."},
    ]
    cards = _cards(
        important_moment={
            "turn_index": 2,
            "quote": "Nobody listens to me at home",
            "handled_well": True,
            "lead": "l",
            "body": "b",
            "others": [],
        }
    )
    out, n = reanchor_quotes(cards, transcript)
    assert out is cards and n == 0


def test_short_quotes_are_never_re_anchored():
    cards = _cards()
    cards["what_worked"][0].update(turn_index=1, quote="hard")
    out, n = reanchor_quotes(cards, TRANSCRIPT)
    assert n == 0


def test_normalise_keeps_indic_combining_marks_and_strips_edge_punctuation():
    assert normalise("“मुझे  बहुत थकान है.”") == "मुझे बहुत थकान है"
    assert normalise("  Hello, ") == "hello"


def test_no_transcript_is_a_no_op():
    cards = _cards()
    out, n = reanchor_quotes(cards, [])
    assert out is cards and n == 0


def test_describe():
    assert describe(0) is None
    assert describe(1) == "Corrected the turn number of 1 quote in code."
    assert describe(3) == "Corrected the turn number of 3 quotes in code."
