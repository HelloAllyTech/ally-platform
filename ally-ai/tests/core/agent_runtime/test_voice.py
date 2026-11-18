"""Q3-fast Part 2 (17 Nov C2): no internal voice reaches a customer. Every phrase
the production tests saw, and what the person gets instead."""

import pytest

from app.core.agent_runtime.check import check_reply
from app.core.agent_runtime.check.organisation import Organisation
from app.core.agent_runtime.check.text import (
    in_a_persons_words,
    mentions_sources,
    without_source_phrases,
)
from tests.core.agent_runtime.test_list_tools import TestTheCheck, reply


@pytest.mark.parametrize(
    "said, heard",
    [
        (
            "The provided passages do not state whether cash on delivery is available.",
            "I don't know whether cash on delivery is available.",
        ),
        (
            "The provided material does not say whether you should size down.",
            "I don't know whether you should size down.",
        ),
        (
            "The provided Scripbox materials do not say whether any product is "
            "guaranteed.",
            "I don't know whether any product is guaranteed.",
        ),
        (
            "The provided materials don't say whether someone can call you.",
            "I don't know whether someone can call you.",
        ),
        (
            "The provided passages do not describe Scripbox's services.",
            "I don't have information on Scripbox's services.",
        ),
        (
            "If I don't know the answer, please contact the team.",
            "Please contact the team.",
        ),
    ],
)
def test_the_usual_openers_are_said_in_a_persons_words(said, heard):
    assert in_a_persons_words(said) == heard
    assert not mentions_sources(heard)


@pytest.mark.parametrize(
    "said, heard",
    [
        (
            "I don't have the shipping charges to Pune in the information I can see.",
            "I don't have the shipping charges to Pune.",
        ),
        (
            "I don't have information in our records about parking.",
            "I don't have information about parking.",
        ),
    ],
)
def test_phrases_about_sources_are_cut_in_place(said, heard):
    assert without_source_phrases(said) == heard


@pytest.mark.parametrize(
    "ordinary",
    [
        "Here's the information you asked for.",
        "Our materials are 100% cotton.",
        "You can find the details on the product page.",
    ],
)
def test_ordinary_words_are_left_alone(ordinary):
    assert not mentions_sources(ordinary)


def test_no_voice_phrase_survives_the_check():
    """A decline written in the internal voice reaches the person without it."""
    step = reply(
        "decline",
        "I don't have any passage that says we offer a vegetarian menu. "
        "The provided materials do not say whether you can bring a cake. "
        "If I don't know the answer, please contact the team.",
        citations=[],
    )
    result, _ = check_reply(
        step,
        {},
        [],
        turn_type="question",
        language="en",
        retrieval=TestTheCheck.RETRIEVAL,
        general=False,
        search_gate=None,
        question="can I bring a birthday cake?",
        searched=True,
        organisation=Organisation(terms=("Bombay Canteen",)),
        history=(),
    )
    assert not mentions_sources(result["answer"])
    assert "I don't know whether you can bring a cake." in result["answer"]
    assert "Please contact the team." in result["answer"]


@pytest.mark.parametrize(
    "offer",
    [
        "Would you like me to add it to your cart?",
        "I can also check a delivery estimate for your pincode.",
        "I can send you shipping updates once it ships.",
        "I can explain our guarantee policies if you like.",
    ],
)
def test_offers_no_tool_can_keep_are_trimmed(offer):
    """Q3-fast Part 2 (17 Nov S2, S10, S17, P5)."""
    step = reply("answer", f"The Orbit backpack is ₹3,299 [1]. {offer}", citations=[1])
    result, _ = check_reply(
        step,
        {},
        [{"chunk_id": "c1", "document_id": "d1", "text": "Orbit backpack ₹3,299"}],
        turn_type="question",
        language="en",
        retrieval=TestTheCheck.RETRIEVAL,
        general=False,
        search_gate=None,
        question="Price of the Orbit backpack?",
        searched=True,
        organisation=Organisation(terms=("The Souled Store",)),
        history=(),
    )
    assert result["answer"].startswith("The Orbit backpack is ₹3,299")
    assert offer not in result["answer"]


def _remember(answer, intent="decline", memory_on=False):
    step = reply(intent, answer, citations=[])
    result, _ = check_reply(
        step,
        {},
        [],
        turn_type="question",
        language="en",
        retrieval=TestTheCheck.RETRIEVAL,
        general=False,
        search_gate=None,
        question="Please remember for next time: I'm Rohan, size M, I love Spiderman",
        searched=False,
        organisation=Organisation(terms=("The Souled Store",)),
        history=(),
        memory_on=memory_on,
    )
    return result


def test_please_remember_with_memory_off_says_so_plainly():
    """Q3-fast Part 2 (17 Nov M2): not "I don't know that; please contact us"."""
    result = _remember("I'm sorry, I don't have that information; please contact us.")
    assert result["answer"] == (
        "I can't remember details between chats, but I'll use them for the rest of "
        "this one."
    )
    assert result["intent"] != "decline"


def test_a_promise_to_remember_next_time_is_corrected_with_memory_off():
    result = _remember(
        "Got it, Rohan. I'll remember your size for next time. Want Spiderman hoodies?",
        intent="answer",
    )
    assert result["answer"].startswith("I can't remember details between chats")
    assert "next time" not in result["answer"]


def test_with_memory_on_nothing_changes():
    result = _remember(
        "Got it, Rohan. I'll remember your size for next time.",
        intent="answer",
        memory_on=True,
    )
    assert "I can't remember" not in result["answer"]
