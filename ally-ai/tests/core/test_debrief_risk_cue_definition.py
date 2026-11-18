"""One editable definition of a clear and a possible risk cue (2026-11-16):
the pinned prompt `debrief_risk_cue_definition`, sent as one labelled block to
the Safety reader, the Writer, the Reviser, the Evaluator and the judge."""

from pathlib import Path

import pytest

from app.core.debrief.cue_strength import (
    cue_strength,
    drop_possible_important_moment,
    quote_names_clear_risk,
)
from app.core.debrief.risk_cue_definition import DEFAULT_RISK_CUE_DEFINITION, LABEL
from app.core.debrief.safety_reader import TranscriptTurn
from app.core.debrief_quality.schemas import (
    DebriefQualityOutput,
    DimensionScore,
    HardFailFinding,
    RiskCue,
)

SEED = Path(__file__).resolve().parents[3] / "ally-be/src/prompts"
TRANSCRIPT = [
    TranscriptTurn(turn_index=1, role="counselor", text="What brings you in?"),
    TranscriptTurn(turn_index=2, role="client", text="I feel stuck in this job."),
]
DIMS = [
    "evidence_specificity",
    "accuracy",
    "actionability",
    "prioritisation",
    "personalisation_progress",
    "practice_alignment",
    "tone",
    "clarity",
]


@pytest.fixture
def prompts(monkeypatch):
    from app.core.llm import dispatch

    sent = []

    async def _fake(**kwargs):
        sent.append(kwargs["prompt"])
        return None, {"provider": "gemini", "model": "m"}

    monkeypatch.setattr(dispatch, "generate_structured", _fake)
    return sent


@pytest.mark.parametrize(
    "module,name,seed",
    [
        (
            "app.core.debrief.risk_cue_definition",
            "DEFAULT_RISK_CUE_DEFINITION",
            "debrief/risk_cue_definition.txt",
        ),
        (
            "app.core.debrief.safety_reader",
            "DEFAULT_SAFETY_READER_SYSTEM",
            "debrief/safety_reader_system.txt",
        ),
        (
            "app.core.debrief_quality.prompt",
            "DEFAULT_JUDGE_RUBRIC",
            "debrief_quality/rubric.txt",
        ),
    ],
)
def test_the_fallback_matches_the_seed(module, name, seed):
    import importlib

    path = SEED / seed
    if not path.exists():
        pytest.skip("ally-be is not checked out beside ally-ai")
    text = getattr(importlib.import_module(module), name)
    assert text.strip() == path.read_text().strip()


@pytest.mark.asyncio
async def test_the_block_appears_once_in_each_of_the_five_calls(prompts):
    from app.core.debrief.safety_reader import read_safety
    from app.core.debrief.steps import evaluate, revise, write
    from app.core.debrief_quality.judge import judge_debrief

    live = "LIVE DEFINITION TEXT"
    await read_safety(TRANSCRIPT, "en", model="m", risk_cue_definition=live)
    await write({}, {}, "en", "m", TRANSCRIPT, risk_cue_definition=live)
    await revise({}, [], {}, TRANSCRIPT, "en", "m", risk_cue_definition=live)
    await evaluate(TRANSCRIPT, "A debrief.", "en", "m", risk_cue_definition=live)
    await judge_debrief(
        [t.model_dump() for t in TRANSCRIPT],
        "A debrief.",
        "en",
        risk_cue_definition=live,
    )
    assert len(prompts) == 5
    for p in prompts:
        assert p.count(LABEL) == 1
        assert p.count(live) == 1
        # The default is not also sent.
        assert DEFAULT_RISK_CUE_DEFINITION[:60] not in p


@pytest.mark.asyncio
async def test_without_a_live_text_the_default_is_sent(prompts):
    from app.core.debrief.steps import write

    await write({}, {}, "en", "m", TRANSCRIPT)
    assert prompts[-1].count(LABEL) == 1
    assert prompts[-1].count(DEFAULT_RISK_CUE_DEFINITION) == 1


def test_the_definition_is_not_duplicated_in_the_prompts_that_read_it():
    from app.core.debrief.schemas import EvaluatorRiskCue
    from app.core.debrief.steps import DEFAULT_REVISER_SYSTEM, DEFAULT_WRITER_SYSTEM
    from app.core.debrief_quality.prompt import DEFAULT_JUDGE_RUBRIC

    for text in (DEFAULT_WRITER_SYSTEM, DEFAULT_JUDGE_RUBRIC, DEFAULT_REVISER_SYSTEM):
        assert "wishing they could disappear" not in text
        assert "RISK CUE DEFINITION" in text
    desc = EvaluatorRiskCue.model_fields["clear"].description
    assert "RISK CUE DEFINITION" in desc and "self-harm" not in desc
    assert "a clear risk cue, as defined in RISK CUE DEFINITION" in (
        DEFAULT_JUDGE_RUBRIC.replace("\n", " ")
    )


def _judged(cues, hard_fails=()):
    return DebriefQualityOutput(
        risk_cues=cues,
        dimensions=[DimensionScore(dimension=d, score=8, reasoning="ok") for d in DIMS],
        hard_fails=list(hard_fails),
    )


def test_the_judge_no_longer_hard_fails_a_missed_possible_cue():
    from app.core.debrief_quality.judge import _enforce_missed_risk_cue

    possible = RiskCue(
        turn_index=2, quote="stuck", addressed_by_debrief=False, clear=False
    )
    out = _enforce_missed_risk_cue(_judged([possible]), clear_only=True)
    assert out.hard_fails == []
    # Even when the model raised it itself.
    out = _enforce_missed_risk_cue(
        _judged([possible], [HardFailFinding(code="missed_risk_cue", evidence="x")]),
        clear_only=True,
    )
    assert out.hard_fails == []
    clear = RiskCue(turn_index=2, quote="end it", addressed_by_debrief=False)
    out = _enforce_missed_risk_cue(_judged([clear]), clear_only=True)
    assert [h.code for h in out.hard_fails] == ["missed_risk_cue"]


def test_the_evaluator_still_lists_every_missed_cue_for_the_split():
    """The Evaluator's split into clear and possible stays in code
    (split_missed_cues), so its enforcement is unchanged."""
    from app.core.debrief_quality.judge import _enforce_missed_risk_cue

    possible = RiskCue(
        turn_index=2, quote="stuck", addressed_by_debrief=False, clear=False
    )
    out = _enforce_missed_risk_cue(_judged([possible]))
    assert [h.code for h in out.hard_fails] == ["missed_risk_cue"]


# --- strength: clear when any signal says so ------------------------------------


def test_the_readers_clear_raises_a_hopelessness_cue():
    cue = {"category": "hopelessness", "quote": "I feel stuck", "strength": "clear"}
    assert cue_strength(cue) == "clear"


def test_the_readers_possible_never_lowers_a_category_or_the_word_list():
    assert (
        cue_strength(
            {"category": "suicide_or_self_harm", "quote": "x", "strength": "possible"}
        )
        == "clear"
    )
    assert (
        cue_strength(
            {
                "category": "hopelessness",
                "quote": "I want to die",
                "strength": "possible",
            }
        )
        == "clear"
    )
    assert (
        cue_strength(
            {"category": "hopelessness", "quote": "stuck", "strength": "possible"}
        )
        == "possible"
    )


def test_a_cue_without_the_readers_strength_reads_as_before():
    assert cue_strength({"category": "hopelessness", "quote": "stuck"}) == "possible"
    assert cue_strength({"category": "abuse_disclosure", "quote": "x"}) == "clear"


def test_dropping_a_possible_important_moment_is_unchanged():
    cards = {"important_moment": {"turn_index": 2, "quote": "I feel stuck"}}
    safety = [{"turn_index": 2, "strength": "possible"}]
    evaluator = [{"turn_index": 2, "clear": False}]
    out, dropped = drop_possible_important_moment(cards, evaluator, safety)
    assert out["important_moment"] is None and dropped["turn_index"] == 2
    safety = [{"turn_index": 2, "strength": "clear"}]
    out, dropped = drop_possible_important_moment(cards, evaluator, safety)
    assert out is cards and dropped is None


# --- the word list in more languages (for native review) ------------------------


@pytest.mark.parametrize(
    "clear_phrase",
    [
        # Tamil
        "எனக்கு சாகணும் போல இருக்கு",
        "தற்கொலை பண்ணிக்கலாம்னு தோணுது",
        "enakku saaganum pola irukku",
        # Kannada
        "ನನಗೆ ಸಾಯಬೇಕು ಅನ್ನಿಸ್ತಿದೆ",
        "ಆತ್ಮಹತ್ಯೆ ಮಾಡ್ಕೋಬೇಕು ಅನ್ನಿಸುತ್ತೆ",
        "nanage saaybeku anistide",
        # Marathi
        "मला जगायचं नाही",
        "मला मरावंसं वाटतं",
        "mala jagaycha nahi",
        # Malayalam
        "എനിക്ക് മരിക്കണം",
        "എനിക്ക് ജീവിക്കണ്ട",
        "enikku marikkanam",
    ],
)
def test_a_clear_phrase_raises_a_hopelessness_cue(clear_phrase):
    assert quote_names_clear_risk(clear_phrase)
    assert cue_strength({"category": "hopelessness", "quote": clear_phrase}) == "clear"


@pytest.mark.parametrize(
    "grief_phrase",
    [
        # Tamil: my father died last year, it is very hard
        "என் அப்பா போன வருஷம் இறந்துட்டார், ரொம்ப கஷ்டமா இருக்கு",
        "en appa sethuttaar, romba kashtama irukku",
        # Tamil: a matter (விஷயம்) is not poison (விஷம்)
        "இந்த விஷயம் என்னை ரொம்ப பாதிக்குது",
        # Kannada: my father died, I feel very sad; a matter (ವಿಷಯ)
        "ನನ್ನ ಅಪ್ಪ ಸತ್ತು ಹೋದರು, ತುಂಬಾ ದುಃಖ ಆಗ್ತಿದೆ",
        "ಈ ವಿಷಯ ನನಗೆ ತುಂಬಾ ಬೇಜಾರು",
        # Marathi: my father passed away last year; a subject (विषय)
        "माझे बाबा गेल्या वर्षी वारले, खूप दुःख होतं",
        "हा विषय मला खूप त्रास देतो",
        # Malayalam: my father died last year, I am very sad (വിഷമം)
        "എന്റെ അച്ഛൻ കഴിഞ്ഞ വർഷം മരിച്ചു, എനിക്ക് വളരെ വിഷമം ആണ്",
        "achan marichu, enikku vishamam aanu",
    ],
)
def test_a_grief_phrase_stays_possible(grief_phrase):
    assert not quote_names_clear_risk(grief_phrase)
    assert cue_strength({"category": "hopelessness", "quote": grief_phrase}) == (
        "possible"
    )
