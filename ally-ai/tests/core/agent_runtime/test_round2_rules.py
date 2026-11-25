"""TF1 round 2 rules checked in code on every reply (Sahyog N-1, N-2)."""

import pytest

from app.core.agent_runtime.check.organisation import Organisation
from tests.core.agent_runtime.test_agent_check import review

SAHYOG = Organisation(terms=("Sahyog Disability Services", "Sahyog"))


def test_a_national_number_is_never_the_organisations_own():
    result, _ = review(
        intent="answer",
        answer=(
            "That sounds hard. You can reach Sahyog Disability Services on Tele-MANAS "
            "14416 any time. If you're in danger, call 112."
        ),
        citations=[1],
        organisation=SAHYOG,
        upset=True,
    )
    assert "reach Sahyog" not in result["answer"]
    assert "112" in result["answer"]


@pytest.mark.parametrize(
    "question, verdict",
    [
        ("I have 35%", "With 35% you do not meet the 40% threshold."),
        ("I earn ₹30,000 a month", "At ₹30,000 a month you qualify for the scheme."),
        ("I'm 17", "At 17 you are not eligible yet."),
    ],
)
def test_no_eligibility_verdict_on_the_services_template(question, verdict):
    criteria = "The certificate needs 40% disability; the medical board decides."
    result, rejection = review(
        intent="answer",
        answer=f"{verdict} {criteria}",
        citations=[1],
        question=question,
        template="services",
    )
    assert rejection == "eligibility_verdict"
    assert result["answer"] == criteria


def test_other_assistants_are_not_checked_for_it():
    _, rejection = review(
        intent="answer",
        answer="You are eligible for the student discount.",
        citations=[1],
        template="supporters",
    )
    assert rejection != "eligibility_verdict"


def test_an_upset_turn_gets_no_pitch_email_or_tips():
    result, _ = review(
        intent="answer",
        answer=(
            "I'm sorry you're feeling this way; that sounds really hard. If you like, "
            "I can start an application so a caseworker calls you. You can also email "
            "feedback@sahyog-jaipur.example. Here are some quick tips to cope."
        ),
        citations=[1],
        upset=True,
    )
    assert result["answer"].startswith("I'm sorry you're feeling this way")
    assert "application" not in result["answer"]
    assert "@" not in result["answer"]
    assert "tips" not in result["answer"]
    assert "14416" in result["answer"]


def test_no_offer_to_change_what_the_list_cannot_change():
    answer = (
        "You applied for aids and appliances at Malviya Nagar. If you need anything "
        "changed or want to withdraw it, tell me and I can help."
    )
    result, _ = review(intent="answer", answer=answer, citations=[1], can_change=False)
    assert result["answer"] == "You applied for aids and appliances at Malviya Nagar."
    result, _ = review(intent="answer", answer=answer, citations=[1], can_change=True)
    assert "withdraw" in result["answer"]


@pytest.mark.parametrize(
    "debris",
    [
        " (cite: 11, 12, 13, 14, 1, 3, 4, 5)",
        "\nSources:\n— 2-sahyog-disability-services",
        " (see citations)",
        " []",
        " [Our policies: services are free]",
    ],
)
def test_no_citation_debris_in_the_reply(debris):
    from app.core.agent_runtime.check.text import without_citation_marks

    assert without_citation_marks(f"All our services are free.{debris}") == (
        "All our services are free."
    )


def test_eligibility_verdict_without_you():
    from app.core.agent_runtime.check.eligibility import says_eligibility

    assert says_eligibility("so 35% does not meet the listed percentage threshold.")
    assert says_eligibility("That doesn't qualify for the pension.")
    assert not says_eligibility("The pension is for 40% or more disability.")


def test_upset_extras_catch_the_softer_pitches():
    from app.core.agent_runtime.check.fixes import _UPSET_EXTRAS

    for pitch in (
        "I can listen and help with practical steps like arranging support from "
        "Sahyog (appointments, applying for services).",
        "Would you like help with an appointment, or someone from our team "
        "calling you back?",
    ):
        assert _UPSET_EXTRAS.search(pitch), pitch
    for warm in (
        "I'm sorry you're feeling so stressed, that sounds really hard.",
        "Would you like to talk about what's on your mind?",
    ):
        assert not _UPSET_EXTRAS.search(warm), warm


def test_what_they_said_in_this_chat_counts_as_theirs():
    from app.core.agent_runtime.check.personal import about_the_person
    from app.core.agent_runtime.nodes.agent_check import _personal

    state = {
        "bot": {},
        "history": [
            {"role": "user", "content": "Hi, I'm Asha"},
            {"role": "assistant", "content": "Hi Asha, welcome."},
        ],
    }
    personal = _personal(state)
    assert "Hi, I'm Asha" in personal and "welcome" not in personal
    assert about_the_person("Your name is Asha.", personal)


def test_a_bracket_left_open_by_a_fix_loses_only_the_bracket():
    from app.core.agent_runtime.check.text import without_unclosed_brackets

    assert (
        without_unclosed_brackets("HR is hr@akshar.example. (All from the handbook.")
        == "HR is hr@akshar.example. All from the handbook."
    )
    kept = "Call +91 80 4567 8800 (9 am–6 pm)."
    assert without_unclosed_brackets(kept) == kept


def test_more_eligibility_verdicts():
    from app.core.agent_runtime.check.eligibility import says_eligibility

    assert says_eligibility("₹30,000 is above the published limit of ₹25,000.")
    assert says_eligibility("At 17 you cannot apply yet.")
    assert not says_eligibility("The income limit is ₹25,000 a month.")
    assert not says_eligibility("You can't apply online; please visit a centre.")


def test_hindi_source_asides_go():
    from app.core.agent_runtime.check.text import without_citation_marks

    hindi = "सेवाएँ मुफ़्त हैं (सूत्र: सेवा सूची)।"
    assert without_citation_marks(hindi) == "सेवाएँ मुफ़्त हैं।"


def test_a_reply_pointing_to_crisis_help_always_names_the_lines():
    from tests.core.agent_runtime.test_agent_check import check

    result = check(
        answer=(
            "Main aisi sankat ki sthiti mein madad nahin kar sakta. Turant apne "
            "shetra ki emergency seva ya crisis line se sampark karein."
        ),
        citations=[],
        passages=[],
        intent="decline",
    )
    assert "14416" in result["answer"] and "112" in result["answer"]


def test_what_they_told_us_is_kept_and_the_uncited_rest_goes():
    from app.core.agent_runtime.check.personal import personal_part

    said = "Hi, I'm Asha"
    assert (
        personal_part("Your name is Asha. Our listeners are here to talk.", said)
        == "Your name is Asha."
    )
    assert personal_part(
        "You told me your name is Asha — I'll use it in our chats.", said
    ).startswith("You told me your name is Asha")
    # An answer that leads with an uncited claim is never cut down.
    assert personal_part("Our listeners work 10 to 10. Your name is Asha.", said) == ""
    assert personal_part("Sessions cost 500.", said) == ""


def test_curly_apostrophes_and_if_you_want():
    from app.core.agent_runtime.check.eligibility import says_eligibility
    from app.core.agent_runtime.check.fixes import _UPSET_EXTRAS

    assert says_eligibility("You have 35% so you don’t meet the 40% criterion.")
    assert _UPSET_EXTRAS.search(
        "If you want practical help from Sahyog (for example, applying for a "
        "certificate), tell me which you need."
    )


def test_a_bracket_closed_after_a_full_stop_keeps_its_close():
    from app.core.agent_runtime.check.text import without_citation_marks

    kept = "No address is given. (Handbook notes: no address is provided.) Ask on."
    assert without_citation_marks(kept) == kept
    assert without_citation_marks("Classes run daily.) Ask on.") == (
        "Classes run daily. Ask on."
    )
