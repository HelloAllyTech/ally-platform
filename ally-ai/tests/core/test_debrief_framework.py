"""The roleplay contract helpers: skill framework, risk cue handling, speaker
labels. An absent contract is today's behaviour exactly."""

from app.core.debrief import framework as fw
from app.core.debrief.render import NONE


def test_absent_framework_is_empty():
    empty = {"id": None, "name": "", "foundational": False, "skills": [], "areas": []}
    assert fw.framework_of({}) == empty
    assert fw.framework_of({"framework": None}) == empty
    assert fw.framework_of({"framework": "junk"}) == empty
    assert fw.framework_of(None) == empty
    assert fw.default_framework() == empty
    assert fw.is_none_framework(fw.framework_of({}))
    assert fw.skill_names(fw.framework_of({})) == {}
    assert fw.skill_framework_text(fw.framework_of({})) == NONE


def test_empty_names_trend_nothing_as_framework_skill():
    from app.core.debrief_graph.progress_vetoes import skill_key

    assert skill_key("empathy") == "other"
    assert skill_key("competency:x", {"competency:x": "Calm"}) == "competency:x"


def test_a_custom_framework_is_normalised():
    f = fw.framework_of(
        {
            "framework": {
                "id": "f1",
                "name": " Triage ",
                "foundational": False,
                "skills": [
                    {"key": "a", "name": "Ask", "words": ["why"]},
                    {"key": "a", "name": "dup"},
                    {"key": "", "name": "nokey"},
                    "junk",
                ],
                "areas": [{"name": "Listening"}, {"name": ""}],
            }
        }
    )
    assert f["name"] == "Triage" and f["foundational"] is False
    assert f["skills"] == [{"key": "a", "name": "Ask"}]
    assert f["areas"] == [{"name": "Listening", "description": ""}]
    assert fw.area_names(f) == ["Listening"]


def test_none_framework_has_no_skills_or_areas():
    f = fw.framework_of({"framework": {"id": None, "name": "None", "skills": []}})
    assert fw.is_none_framework(f)
    assert fw.areas_of(f) == [] and fw.skill_names(f) == {}
    assert fw.skill_framework_text(f) == NONE


def test_skill_names_adds_extra_competencies_framework_wins():
    f = fw.framework_of({"framework": {"skills": [{"key": "a", "name": "Ask"}]}})
    names = fw.skill_names(f, {"competency:x": "Calm", "a": "Other", "": "x"})
    assert names == {"a": "Ask", "competency:x": "Calm"}


def test_skill_framework_text_lists_names_exactly():
    text = fw.skill_framework_text(
        fw.framework_of({"framework": {"skills": [{"key": "k", "name": "Kind"}]}})
    )
    assert "- k — Kind" in text
    assert "exact key" in text


def test_risk_cue_defaults_and_values():
    assert fw.risk_cue_of({}) == {
        "key": None,
        "name": None,
        "handling": "alarm",
        "word_list_raises": True,
    }
    rc = fw.risk_cue_of(
        {"risk_cue": {"key": "k", "handling": "assessed", "word_list_raises": False}}
    )
    assert rc["handling"] == "assessed" and rc["word_list_raises"] is False
    assert fw.risk_cue_of({"risk_cue": {"handling": "weird"}})["handling"] == "alarm"
    assert fw.risk_cue_of({"riskCue": {"handling": "assessed"}})["handling"] == (
        "assessed"
    )


def test_speaker_labels():
    assert fw.speaker_labels_of({}) == "legacy"
    assert fw.speaker_labels_of({"speaker_labels": "neutral"}) == "neutral"
    assert fw.speaker_labels_of({"speaker_labels": "x"}) == "legacy"
    assert fw.speaker("client") == "CLIENT"
    assert fw.speaker("counselor") == "COUNSELLOR"
    assert fw.speaker("client", judge=True) == "AI_CLIENT"
    assert fw.speaker("client", "neutral", judge=True) == "CHARACTER"
    assert fw.speaker("counselor", "neutral") == "LEARNER"
