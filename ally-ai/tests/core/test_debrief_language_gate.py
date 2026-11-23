# flake8: noqa: E501
"""The language gate's own machinery: planting is deterministic and does what it
says, and the statistics are right. (The gate itself needs live models.)"""

import importlib.util
from pathlib import Path

_spec = importlib.util.spec_from_file_location(
    "gate",
    Path(__file__).resolve().parents[2] / "scripts/debrief_language_perturbations.py",
)
gate = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(gate)

TRANSCRIPT = [
    {"turn_index": 1, "role": "counselor", "text": "आप कैसा महसूस कर रही हैं आज"},
    {"turn_index": 2, "role": "client", "text": "मुझे बहुत डर लगता है परीक्षा से"},
    {
        "turn_index": 3,
        "role": "counselor",
        "text": "यह सुनकर लगता है कि आप बहुत थकी हुई हैं",
    },
]
CARDS = {
    "opening": "आपने बातचीत की शुरुआत गर्मजोशी से की। आपने उसकी बात ध्यान से सुनी और शांत रहे।",
    "important_moment": None,
    "what_worked": [
        {
            "skill": "s",
            "turn_index": 3,
            "quote": "यह सुनकर लगता है कि आप बहुत थकी हुई हैं",
            "lead": "भावना को नाम दिया",
            "body": "इससे उसे लगा कि उसे सुना गया है। उसने खुलकर अपनी चिंता बताई।",
        }
    ],
    "work_on_this": [
        {
            "skill": "s",
            "turn_index": 1,
            "quote": "आप कैसा महसूस कर रही हैं आज",
            "lead": "खुला सवाल",
            "why": "अगली बार उसकी बात पूरी होने दें और फिर आगे बढ़ें।",
            "try_saying": "मुझे और बताइए",
        }
    ],
    "practise_next": None,
    "skill_labels": [{"skill": "s", "label": "सक्रिय श्रवण"}],
    "reflective_question": "आपने इस बातचीत में क्या महसूस किया?",
}
FX = {"language": "hi-IN", "cards": CARDS, "transcript": TRANSCRIPT}


def test_wilson_and_kappa():
    lo, hi = gate.wilson(10, 10)
    assert 0.72 < lo < 0.73 and hi == 1.0  # the detection floor the docstring states
    assert gate.wilson(0, 0) == (None, None)
    assert gate.kappa([True, False, True, False], [True, False, True, False]) == 1.0
    assert gate.kappa([True, True], [True, True]) is None


def test_planting_is_deterministic():
    for kind in gate.GATED_FAULTS + gate.NON_FAULTS:
        a = gate.plant(kind, "hi-IN", FX, 0)
        b = gate.plant(kind, "hi-IN", FX, 0)
        assert a == b


def test_wrong_language_puts_an_english_sentence_in_the_text():
    p = gate.plant("wrong_language", "hi-IN", FX, 0)
    assert p["span"] in "\n".join(s["text"] for s in p["sections"])
    assert p["span"] in gate.EN_SENTENCES


def test_quote_altered_changes_only_the_quote_and_not_the_transcript():
    p = gate.plant("quote_altered", "hi-IN", FX, 0)
    text = "\n".join(s["text"] for s in p["sections"])
    assert CARDS["what_worked"][0]["quote"] not in text
    assert p["span"] in text
    assert p["quoted"] == gate.cited_turns(CARDS, TRANSCRIPT)


def test_english_quote_non_fault_makes_the_transcript_agree():
    p = gate.plant("english_quote", "hi-IN", FX, 0)
    assert any(t["text"] == gate.ENGLISH_QUOTE for t in p["quoted"])
    assert gate.ENGLISH_QUOTE in "\n".join(s["text"] for s in p["sections"])


def test_script_mix_puts_latin_in_a_native_word():
    p = gate.plant("script_mix", "hi-IN", FX, 0)
    assert any("a" <= c.lower() <= "z" for c in p["span"])


def test_does_not_apply_returns_none():
    assert gate.plant("untranslated_chunk", "en-IN", FX, 0) is None
    assert gate.plant("code_mix", "en-IN", FX, 0) is None


def test_overlap():
    assert gate.overlaps("ध्यान से सुनी", "आपने उसकी बात ध्यान से सुनी और शांत रहे")
    assert not gate.overlaps("कुछ और", "आपने उसकी बात ध्यान से सुनी")


def test_rule_checks_catch_a_bad_quote_and_pass_a_good_one():
    assert gate.rule_checks(CARDS, TRANSCRIPT, "hi-IN") == []
    bad = {**CARDS, "what_worked": [{**CARDS["what_worked"][0], "quote": "कुछ और"}]}
    assert any(
        "quote_mismatch" in f for f in gate.rule_checks(bad, TRANSCRIPT, "hi-IN")
    )


def test_verdict_refuses_an_underpowered_gate_and_a_low_catch_rate():
    from collections import defaultdict

    s = dict(
        by_type=defaultdict(lambda: [0, 0]),
        by_lang=defaultdict(lambda: [0, 0]),
        ff=[0, 0],
        flips=[0, 0],
    )
    assert any("underpowered" in f for f in gate.verdict(s))
    for t in gate.GATED_FAULTS:
        s["by_type"][t] = [15, 15]
    s["by_type"]["script_mix"] = [9, 15]
    s["ff"] = [6, 40]
    f = gate.verdict(s)
    assert any("script_mix" in x for x in f) and any("false-flag" in x for x in f)


def test_not_measurably_worse():
    ok, z = gate.not_measurably_worse((58, 60), (59, 60))
    assert ok
    ok, z = gate.not_measurably_worse((30, 60), (58, 60))
    assert not ok
