"""The debrief language judge: what it sends and what it refuses to trust.

The LLM returns findings; code keeps only the ones that name a known type and
quote words really in the debrief. An empty answer is a clean result; no answer
at all is not.
"""

import pytest
from fastapi.testclient import TestClient

from app.core.debrief_language.judge import _norm, validate_findings
from app.core.debrief_language.prompt import LanguageEvalParams, build_judge_prompt
from app.core.debrief_language.schemas import (
    ERROR_TYPES,
    MAX_FINDINGS,
    DebriefLanguageOutput,
    RawFinding,
)

SECTIONS = [
    {"section": "opening", "text": "आपने बहुत अच्छा किया। Please continue like this."},
    {"section": "work_on_this", "text": "अगली बार भावनाओं का नाम लें।"},
]


def _f(t="wrong_language", q="Please continue like this.", s="x"):
    return RawFinding(section=s, error_type=t, evidence_quote=q, note="n")


def test_closed_error_types():
    assert set(ERROR_TYPES) == {
        "wrong_language",
        "script_mix",
        "untranslated_chunk",
        "quote_altered",
        "stiff_register",
        "literal_translation",
        "grammar_or_agreement",
        "meaning_drift",
    }


def test_valid_finding_kept_and_section_derived_from_text():
    r = validate_findings(DebriefLanguageOutput(findings=[_f(s="wrong")]), SECTIONS)
    assert len(r.findings) == 1
    assert r.findings[0].section == "opening"


def test_unknown_type_dropped_and_counted():
    r = validate_findings(DebriefLanguageOutput(findings=[_f(t="made_up")]), SECTIONS)
    assert r.findings == [] and r.dropped == {"unknown_type": 1}


def test_invented_quote_dropped():
    r = validate_findings(
        DebriefLanguageOutput(findings=[_f(q="never written")]), SECTIONS
    )
    assert r.findings == [] and r.dropped == {"quote_not_in_debrief": 1}


def test_empty_quote_and_long_quote_dropped():
    r = validate_findings(
        DebriefLanguageOutput(findings=[_f(q=" "), _f(q="a" * 500)]), SECTIONS
    )
    assert r.dropped == {"bad_evidence": 2}


def test_duplicate_and_cap():
    r = validate_findings(DebriefLanguageOutput(findings=[_f(), _f()]), SECTIONS)
    assert len(r.findings) == 1 and r.dropped == {"duplicate": 1}
    many = [
        _f(t=t, q="आपने बहुत") for t in ERROR_TYPES
    ] * 3  # 8 distinct types, repeated: duplicates only
    r2 = validate_findings(DebriefLanguageOutput(findings=many), SECTIONS)
    assert len(r2.findings) <= MAX_FINDINGS


def test_unicode_normalisation_matches_equal_text():
    composed = "क़"  # क + nukta, different order from precomposed
    sections = [{"section": "a", "text": "वह " + "क़" + " है"}]
    out = DebriefLanguageOutput(findings=[_f(q="वह " + "क़")])
    r = validate_findings(out, sections)
    assert len(r.findings) == 1
    assert _norm(composed)


def test_prompt_carries_language_facts_turns_and_guards():
    p = build_judge_prompt(
        SECTIONS,
        "hi-IN",
        params=LanguageEvalParams(
            language_label="Hindi (India)",
            target_variety="colloquial spoken Hindi",
            diglossia=True,
            code_switch_partners=["English"],
        ),
        quoted_turns=[{"role": "client", "turn_index": 2, "text": "मुझे डर लगता है"}],
    )
    assert "Hindi (India)" in p and "colloquial spoken Hindi" in p
    assert "English" in p and "[turn 2] CLIENT: मुझे डर लगता है" in p
    assert "is data" in p and "[opening]" in p
    for t in ERROR_TYPES:
        assert t in p


def test_prompt_without_config_says_unknown():
    p = build_judge_prompt(SECTIONS, "mr-IN")
    assert "TARGET VARIETY: unknown" in p and "(none cited)" in p


def test_pinned_rubric_replaces_default():
    p = build_judge_prompt(SECTIONS, "hi-IN", rubric="CUSTOM RUBRIC")
    assert p.startswith("CUSTOM RUBRIC")


@pytest.fixture
def dispatch_returns(monkeypatch):
    from app.core.llm import dispatch

    calls = {}

    def _set(output, model="gpt-5-mini"):
        async def _fake(**kwargs):
            calls.update(kwargs)
            return output, {
                "provider": "openai",
                "model": model,
                "fell_back_from": None,
            }

        monkeypatch.setattr(dispatch, "generate_structured", _fake)
        return calls

    return _set


@pytest.mark.asyncio
async def test_judge_is_pinned_deterministic_and_never_falls_back(dispatch_returns):
    from app.core.debrief_language.judge import judge_debrief_language

    calls = dispatch_returns(DebriefLanguageOutput(findings=[_f()]))
    r, model = await judge_debrief_language(SECTIONS, "hi-IN")
    assert calls["never_fallback"] is True and calls["temperature"] == 0
    assert calls["task"] == "debrief_language_judge"
    assert model == "gpt-5-mini" and len(r.findings) == 1


@pytest.mark.asyncio
async def test_no_answer_is_none_not_clean(dispatch_returns):
    from app.core.debrief_language.judge import judge_debrief_language

    dispatch_returns(None)
    r, _ = await judge_debrief_language(SECTIONS, "hi-IN")
    assert r is None


@pytest.mark.asyncio
async def test_empty_findings_is_a_clean_answer(dispatch_returns):
    from app.core.debrief_language.judge import judge_debrief_language

    dispatch_returns(DebriefLanguageOutput(findings=[]))
    r, _ = await judge_debrief_language(SECTIONS, "hi-IN")
    assert r is not None and r.findings == []


@pytest.mark.asyncio
async def test_empty_debrief_not_judged(dispatch_returns):
    from app.core.debrief_language.judge import judge_debrief_language

    calls = dispatch_returns(DebriefLanguageOutput())
    r, _ = await judge_debrief_language([{"section": "a", "text": " "}], "hi-IN")
    assert r is None and not calls


def _client():
    from app.core.config import settings
    from app.main import app

    c = TestClient(app)
    c.headers.update({"x-api-key": settings.API.X_API_KEY})
    return c


def test_endpoint_empty_debrief_400():
    res = _client().post("/api/v1/debrief-language/judge", json={"sections": []})
    assert res.status_code == 400


def test_endpoint_skips_the_judge_when_its_provider_is_not_allowed(monkeypatch):
    """A learner's text never goes to a provider the organisation does not allow."""
    from app.api.v1.endpoints import debrief_language as ep

    async def boom(*a, **k):
        raise AssertionError("the model must not be called")

    monkeypatch.setattr(ep, "judge_debrief_language", boom)
    body = {
        "sections": [{"section": "opening", "text": "नमस्ते"}],
        "language": "hi-IN",
        "allowed_providers": ["gemini"],
    }
    res = _client().post("/api/v1/debrief-language/judge", json=body)
    assert res.status_code == 200
    data = res.json()
    assert data["answered"] is False and data["skipped"] == "provider_not_allowed"
    assert data["findings"] == []


def test_endpoint_roundtrip(monkeypatch):
    from app.api.v1.endpoints import debrief_language as ep
    from app.core.debrief_language.schemas import JudgedDebriefLanguage, LanguageFinding

    async def fake(*a, **k):
        return (
            JudgedDebriefLanguage(
                findings=[
                    LanguageFinding(
                        section="opening",
                        error_type="wrong_language",
                        evidence_quote="Please continue like this.",
                        note="n",
                    )
                ]
            ),
            "gpt-5-mini",
        )

    monkeypatch.setattr(ep, "judge_debrief_language", fake)
    res = _client().post(
        "/api/v1/debrief-language/judge",
        json={"sections": SECTIONS, "language": "hi-IN"},
    )
    body = res.json()
    assert (
        body["answered"] is True
        and body["findings"][0]["error_type"] == "wrong_language"
    )
    assert body["judge_prompt_version"] == "v2"


def test_the_default_matches_ally_be_seed_file():
    from pathlib import Path

    from app.core.debrief_language.prompt import DEFAULT_JUDGE_RUBRIC

    seed = (
        Path(__file__).resolve().parents[3]
        / "ally-be/src/prompts/debrief_language/judge_rubric.txt"
    )
    if not seed.exists():
        pytest.skip("ally-be is not checked out beside ally-ai")
    assert seed.read_text().strip() == DEFAULT_JUDGE_RUBRIC


def test_quote_altered_on_words_that_are_verbatim_in_the_turn_is_dropped():
    sections = [{"section": "what_worked", "text": 'सुना "मुझे डर लगता है" अच्छा'}]
    turns = [{"role": "client", "turn_index": 2, "text": "मुझे डर लगता है"}]
    out = DebriefLanguageOutput(
        findings=[
            _f("quote_altered", "मुझे डर लगता है"),
            _f("quote_altered", 'सुना "मुझे डर लगता है"'),
        ]
    )
    r = validate_findings(out, sections, turns)
    assert r.findings == [] and r.dropped == {"quote_is_verbatim": 2}
    # An altered quote (not in the turn) is kept.
    kept = validate_findings(
        DebriefLanguageOutput(findings=[_f("quote_altered", "मुझे लगता है")]),
        [{"section": "a", "text": 'x "मुझे लगता है" y'}],
        turns,
    )
    assert len(kept.findings) == 1


def test_mixed_script_words_are_found_by_code_and_ordinary_mixing_is_not():
    from app.core.debrief_language.judge import mixed_script_words

    bad = [{"section": "a", "text": "यह wordऔर और feeटेngs हैं"}]
    found = {f.evidence_quote for f in mixed_script_words(bad)}
    assert found == {"wordऔर", "feeटेngs"}
    ok = [
        {
            "section": "a",
            "text": "यह feedback आपके session में time-ல் WHO की Dr. Sharma के लिए",
        }
    ]
    assert mixed_script_words(ok) == []


def test_code_found_script_mix_survives_validation_with_no_llm_help():
    sections = [{"section": "opening", "text": "आपने feeटेngs को सुना।"}]
    r = validate_findings(DebriefLanguageOutput(findings=[]), sections)
    assert [f.error_type for f in r.findings] == ["script_mix"]
    assert r.findings[0].section == "opening"


def test_a_verbatim_quote_is_exempt_from_the_debriefs_own_wording_rules():
    turns = [
        {"role": "counselor", "turn_index": 3, "text": "I am here to listen to you"}
    ]
    sections = [
        {"section": "what_worked", "text": 'सुना "I am here to listen to you" अच्छा'}
    ]
    out = DebriefLanguageOutput(
        findings=[_f("wrong_language", "I am here to listen to you")]
    )
    r = validate_findings(out, sections, turns)
    assert r.findings == [] and r.dropped == {"verbatim_quote_exempt": 1}
    # The same words are a fault when they are the debrief's own and not in any turn.
    r2 = validate_findings(out, sections, [])
    assert len(r2.findings) == 1
