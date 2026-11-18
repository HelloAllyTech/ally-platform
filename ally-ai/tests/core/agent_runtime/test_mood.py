"""How the person feels (Q3-fast Part 1): an upset person's run opens warmly."""

from app.core.agent_runtime.mood import mood_section
from app.schemas.agent_runtime import AgentRunRequest
from tests.core.agent_runtime.conftest import BODY


def test_no_section_unless_upset():
    assert mood_section({"persona": {"safety_pack": "mental_health"}}) == ""


def test_upset_opens_warmly_with_no_crisis_template():
    text = mood_section({"mood": "upset", "persona": {"safety_pack": "standard"}})
    assert text.startswith("# How they feel")
    assert "no crisis numbers" in text
    assert "support them" not in text


def test_health_assistants_add_the_support_line_with_their_helplines():
    text = mood_section(
        {
            "mood": "upset",
            "support_helplines": "1800-120-820050",
            "persona": {"safety_pack": "mental_health", "display_name": "Mpower"},
        }
    )
    assert "they can reach Mpower on 1800-120-820050." in text
    # Not marked round the clock: no "any time".
    assert "any time" not in text


def test_any_time_only_for_a_24x7_number():
    text = mood_section(
        {
            "mood": "upset",
            "support_helplines": "99724 99724 (24x7)",
            "persona": {"safety_pack": "medical", "display_name": "Cloudnine"},
        }
    )
    assert "reach Cloudnine on 99724 99724 (24x7) any time." in text


def test_tele_manas_only_on_mental_health_assistants():
    mental = mood_section(
        {
            "mood": "upset",
            "persona": {"safety_pack": "mental_health", "display_name": "Mpower"},
        }
    )
    assert "Tele-MANAS on 14416" in mental and "any time" in mental
    eye_hospital = mood_section(
        {
            "mood": "upset",
            "persona": {"safety_pack": "medical", "display_name": "Eye Care"},
        }
    )
    assert "Tele-MANAS" not in eye_hospital
    assert "support them" not in eye_hospital


def test_a_joke_keeps_the_acknowledgement_light():
    text = mood_section({"mood": "upset", "persona": {}})
    assert "keep the acknowledgement light or skip it" in text


def test_the_request_carries_mood_only_when_set():
    plain = AgentRunRequest(**BODY).to_bot()
    assert "mood" not in plain
    upset = AgentRunRequest(
        **{**BODY, "mood": "upset", "support_helplines": "14416"}
    ).to_bot()
    assert upset["mood"] == "upset" and upset["support_helplines"] == "14416"
