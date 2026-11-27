"""The two in-code repairs, run through the real graph: an unsupported progress
claim is cut out of the draft without a revision, and a quote anchored to the
wrong turn is pointed at the turn it is really in before ally-be's checks read it."""

import copy

import pytest

from app.core.debrief_graph import circuit
from tests.core.debrief_graph.fakes import (
    CARDS,
    FakeGateway,
    FakeSteps,
    evaluation,
    run,
)

pytestmark = pytest.mark.asyncio

CLAIM = "You are consistently identifying the right moments to offer explanations."


@pytest.fixture(autouse=True)
def closed_circuits():
    circuit.reset_model_circuits()
    yield
    circuit.reset_model_circuits()


def _cards(**changes):
    cards = copy.deepcopy(CARDS)
    cards.update(changes)
    return cards


def _with_claim():
    cards = _cards()
    cards["what_worked"][0][
        "body"
    ] = f"It gave the client room to talk. {CLAIM} Keep it up."
    return cards


async def test_an_unsupported_progress_claim_is_cut_out_without_a_revision():
    steps, gateway = FakeSteps(), FakeGateway()
    steps.answers["writer"] = {"cards": _with_claim(), "reasoning": "w"}
    steps.answers["evaluator"] = {
        "evaluation": evaluation(
            9, hard_fails=[{"code": "unsupported_progress_claim", "evidence": CLAIM}]
        ),
        "reasoning": "e",
    }
    result = await run(steps, gateway)

    body = result["cards"]["what_worked"][0]["body"]
    assert CLAIM not in body
    assert body == "It gave the client room to talk. Keep it up."
    assert result["evaluator_hard_fails"] == []
    assert result["status"] == "published"
    assert steps.count("reviser") == 0  # no revision was needed or run


async def test_a_claim_the_cards_do_not_contain_stays_a_hard_fail():
    steps, gateway = FakeSteps(), FakeGateway()
    steps.answers["writer"] = {"cards": _cards(), "reasoning": "w"}
    steps.answers["evaluator"] = {
        "evaluation": evaluation(
            9,
            hard_fails=[
                {
                    "code": "unsupported_progress_claim",
                    "evidence": "A sentence that is nowhere in these cards at all.",
                }
            ],
        ),
        "reasoning": "e",
    }
    result = await run(steps, gateway)
    assert [h["code"] for h in result["evaluator_hard_fails"]] == [
        "unsupported_progress_claim"
    ]
    assert result["cards"]["what_worked"][0]["body"] == "b"


async def test_other_hard_fails_are_never_removed():
    steps, gateway = FakeSteps(), FakeGateway()
    steps.answers["writer"] = {"cards": _with_claim(), "reasoning": "w"}
    steps.answers["evaluator"] = {
        "evaluation": evaluation(
            9,
            hard_fails=[
                {"code": "unsupported_progress_claim", "evidence": CLAIM},
                {"code": "contradicts_protocol", "evidence": "x" * 30},
            ],
        ),
        "reasoning": "e",
    }
    result = await run(steps, gateway)
    assert [h["code"] for h in result["evaluator_hard_fails"]] == [
        "contradicts_protocol"
    ]
    assert CLAIM not in result["cards"]["what_worked"][0]["body"]


async def test_a_quote_on_the_wrong_turn_is_re_anchored_before_the_checks_run():
    steps, gateway = FakeSteps(), FakeGateway()
    cards = _cards()
    # "What brings you in today?" is the counsellor's turn 1; the Writer said turn 2.
    cards["what_worked"][0]["turn_index"] = 2
    steps.answers["writer"] = {"cards": cards, "reasoning": "w"}
    result = await run(steps, gateway)

    checked = gateway.tools("run_checks")[0]["cards"]
    assert checked["what_worked"][0]["turn_index"] == 1
    assert result["cards"]["what_worked"][0]["turn_index"] == 1


async def test_a_quote_that_is_not_in_the_transcript_is_left_for_the_checks():
    steps, gateway = FakeSteps(), FakeGateway()
    cards = _cards()
    cards["what_worked"][0].update(
        turn_index=2, quote="You are doing wonderfully, keep going"
    )
    steps.answers["writer"] = {"cards": cards, "reasoning": "w"}
    await run(steps, gateway)
    checked = gateway.tools("run_checks")[0]["cards"]
    assert checked["what_worked"][0]["turn_index"] == 2
    assert checked["what_worked"][0]["quote"] == "You are doing wonderfully, keep going"
