"""The roleplay contract helpers: skill framework, risk cue handling, speaker
labels. An absent contract is today's behaviour exactly."""

from app.core.debrief import framework as fw
from app.core.debrief.render import NONE


def test_absent_framework_is_the_foundational_default():
    f = fw.framework_of({})
    assert f["foundational"] is True and f["id"] is None
    assert [s["key"] for s in f["skills"]] == list(fw.DEFAULT_FOUNDATIONAL_SKILLS)
    assert len(f["skills"]) == 14
    assert [a["name"] for a in f["areas"]] == [
        "Listening Engagement",
        "Emotional Attunement",
        "Supportive Engagement",
    ]
    assert fw.framework_of({"framework": None}) == f


def test_default_names_match_progress_constant():
    from app.core.debrief_graph.progress_vetoes import FOUNDATIONAL_SKILLS

    assert FOUNDATIONAL_SKILLS == fw.DEFAULT_FOUNDATIONAL_SKILLS
    assert fw.skill_names(fw.framework_of({})) == FOUNDATIONAL_SKILLS


def test_a_custom_framework_is_normalised():
    f = fw.framework_of(
        {
            "framework": {
                "id": "f1",
                "name": " Triage ",
                "foundational": False,
                "skills": [
                    {"key": "a", "name": "Ask", "words": ["why", "", 3]},
                    {"key": "a", "name": "dup"},
                    {"key": "", "name": "nokey"},
                    "junk",
                ],
                "areas": [{"name": "Listening"}, {"name": ""}],
            }
        }
    )
    assert f["name"] == "Triage" and f["foundational"] is False
    assert f["skills"] == [{"key": "a", "name": "Ask", "words": ["why"]}]
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
    text = fw.skill_framework_text(fw.framework_of({}))
    for name in fw.DEFAULT_FOUNDATIONAL_SKILLS.values():
        assert f"- {name}" in text
    assert "named exactly as written" in text


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
