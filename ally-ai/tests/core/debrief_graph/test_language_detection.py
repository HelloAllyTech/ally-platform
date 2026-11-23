"""The session's language when it recorded none (v9 FR-39): ported from
ally-be's `detect-language.spec.ts` (deleted with `detect-language.ts`), plus
the languages Ally runs sessions in. Every case's expected answer is what the
TypeScript function gave for the same input (parity run, 2026-11-11)."""

import pytest

from app.core.debrief_graph import circuit
from app.core.debrief_graph.registry.profile import detect_language, resolve_language
from tests.core.debrief_graph.fakes import SESSION, FakeGateway, FakeSteps, run

# --- the TypeScript spec's cases ------------------------------------------------


def test_reads_tamil_kannada_and_english_by_script():
    assert detect_language(["உங்களுக்கு என்ன கவலை இருக்கிறது என்று சொல்லுங்கள்"]) == (
        "ta",
        "detected",
    )
    assert detect_language(["ನಿಮಗೆ ಏನು ಚಿಂತೆ ಇದೆ ಎಂದು ಹೇಳಿ ದಯವಿಟ್ಟು"]) == (
        "kn",
        "detected",
    )
    assert detect_language(["What brings you in today? Tell me more about it."]) == (
        "en",
        "detected",
    )


def test_tells_marathi_from_hindi_by_their_common_words():
    mr = "तुम्ही काय करत आहात? मला सांगा, मी ऐकत आहे आणि काळजी करू नका"
    hi = "आप क्या कर रहे हैं? मुझे बताइए, मैं सुन रहा हूँ और चिंता मत करो"
    assert detect_language([mr])[0] == "mr"
    assert detect_language([hi])[0] == "hi"


def test_flags_a_close_or_thin_call_as_low_confidence():
    assert detect_language(["ok"])[1] == "detected_low_confidence"
    assert detect_language(["नमस्ते, सब ठीक"]) == ("hi", "detected_low_confidence")


# --- more languages and mixes ----------------------------------------------------

CASES = [
    # Hindi, Devanagari: clear.
    (
        [
            "मुझे बताइए आप कैसा महसूस कर रहे हैं",
            "क्या आप घर पर ठीक हैं? मैं सुन रहा हूँ",
        ],
        ("hi", "detected"),
    ),
    # Marathi, Devanagari: clear.
    (
        ["तुम्ही कसे आहात? मला सांगा", "मी ऐकते आहे, काळजी करू नका आणि बोला"],
        ("mr", "detected"),
    ),
    # Tamil, more than one turn.
    (
        ["நீங்கள் எப்படி இருக்கிறீர்கள்?", "உங்கள் வீட்டில் எல்லாம் சரியா?"],
        ("ta", "detected"),
    ),
    # Kannada, more than one turn.
    (["ನೀವು ಹೇಗಿದ್ದೀರಿ?", "ನಿಮ್ಮ ಮನೆಯಲ್ಲಿ ಎಲ್ಲವೂ ಸರಿಯೇ?"], ("kn", "detected")),
    # English, several turns.
    (
        ["How have you been sleeping lately?", "That sounds really hard for you."],
        ("en", "detected"),
    ),
    # Hinglish, romanised: Latin script reads as English, as it always has.
    (
        ["aap kaise ho? mujhe batao kya hua", "main sun raha hoon, tension mat lo"],
        ("en", "detected"),
    ),
    # Hinglish, Devanagari with more English words: the Latin letters lead.
    (
        [
            "मुझे लगता है you are feeling very stressed about the exams",
            "क्या आप okay हैं?",
        ],
        ("en", "detected"),
    ),
    # Hinglish, Devanagari leading but under the confident share.
    (
        ["मुझे लगता है कि आप exams को लेकर stressed हैं okay"],
        ("hi", "detected_low_confidence"),
    ),
    # Hinglish, Devanagari mostly, with a little English: clear Hindi.
    (
        ["मैं समझ सकता हूँ कि आप परेशान हैं, क्या आप मुझे और बताएंगे? sorry"],
        ("hi", "detected"),
    ),
    # Devanagari with no common words either way: Hindi, low confidence.
    (
        ["परीक्षा के दिनों में नींद कम होती जाती है शायद"],
        ("hi", "detected_low_confidence"),
    ),
    # One common word apart: not clear enough.
    (["मला वाटते कि आप ठीक हैं सब कुछ ठीक होगा"], ("hi", "detected_low_confidence")),
    # Tamil in an otherwise English session: below the confident share.
    (["Hello, how are you today? சரி"], ("en", "detected")),
    (["சரி ok fine"], ("en", "detected_low_confidence")),
    # Numbers and punctuation only: nothing to read.
    (["123 ... ?? !!"], ("en", "detected_low_confidence")),
    ([], ("en", "detected_low_confidence")),
    (["", None], ("en", "detected_low_confidence")),
    # Word at the very end, and before punctuation.
    (["मैं ठीक हूँ और आप क्या करते हैं"], ("hi", "detected")),
    (["तुम्ही काय करता आहात, मला सांगा मी आहे."], ("mr", "detected")),
]


@pytest.mark.parametrize("texts,expected", CASES)
def test_languages_ally_runs_sessions_in(texts, expected):
    assert detect_language(texts) == expected


# --- the run's inputs ----------------------------------------------------------


TRANSCRIPT = [
    {"turn_index": 1, "role": "counselor", "text": "உங்களுக்கு என்ன கவலை இருக்கிறது"},
    {"turn_index": 2, "role": "client", "text": "I can't sleep and my parents shout."},
    {"turn_index": 3, "role": "counselor", "text": "என்று சொல்லுங்கள் தயவுசெய்து"},
]


def test_an_unrecorded_language_is_read_from_the_learners_turns_only():
    session = {"language": "en", "language_source": None, "language_recorded": False}
    out = resolve_language(session, TRANSCRIPT)
    assert out["language"] == "ta"
    assert out["language_source"] == "detected"
    # The input is left as it came.
    assert session["language"] == "en"


def test_a_recorded_language_is_kept():
    session = {
        "language": "hi-IN",
        "language_source": "recorded",
        "language_recorded": True,
    }
    out = resolve_language(session, TRANSCRIPT)
    assert (out["language"], out["language_source"]) == ("hi-IN", "recorded")
    # Without the flag (an older caller), the language is taken as recorded.
    out = resolve_language({"language": "kn"}, TRANSCRIPT)
    assert (out["language"], out["language_source"]) == ("kn", "recorded")


# --- through a whole run ---------------------------------------------------------


@pytest.fixture
def closed_circuits():
    circuit.reset_model_circuits()
    yield
    circuit.reset_model_circuits()


@pytest.mark.asyncio
async def test_a_run_reads_an_unrecorded_language_before_any_step(closed_circuits):
    steps = FakeSteps()
    transcript = [
        {
            "turn_index": 1,
            "role": "counselor",
            "text": "आप कैसा महसूस कर रहे हैं? मुझे बताइए",
        },
        {"turn_index": 2, "role": "client", "text": "मैं बहुत थका हुआ हूँ।"},
        {
            "turn_index": 3,
            "role": "counselor",
            "text": "क्या आप घर पर ठीक हैं? मैं सुन रहा हूँ",
        },
    ]
    session = {
        **SESSION,
        "language": "en",
        "language_source": None,
        "language_recorded": False,
    }
    result = await run(steps, FakeGateway(), session=session, transcript=transcript)

    # ally-be fills `debrief_runs.language` and `workspace.languageSource` from these.
    assert result["language"] == "hi"
    assert result["workspace"]["languageSource"] == "detected"
    # The safety reader, the first step, already reads it.
    safety = next(c for c in steps.calls if c["path"] == "safety-reader")
    assert safety["body"]["language"] == "hi"


@pytest.mark.asyncio
async def test_a_run_keeps_a_recorded_language(closed_circuits):
    result = await run(FakeSteps(), FakeGateway())
    assert result["language"] == "en"
    assert result["workspace"]["languageSource"] == "recorded"
