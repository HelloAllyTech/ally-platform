""" "Practise this next" never loses its button: the graph names a fallback
(this same roleplay, else the first option) and ally-be's `finalise_cards`
maps a missing or unoffered id to it."""

import pytest

from app.core.debrief_graph import circuit
from tests.core.debrief_graph.fakes import CONTEXT, FakeGateway, FakeSteps, run

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
def closed_circuits():
    circuit.reset_model_circuits()
    yield
    circuit.reset_model_circuits()


@pytest.fixture
def steps():
    return FakeSteps()


@pytest.fixture
def gateway():
    return FakeGateway()


async def test_this_roleplay_inside_a_course(steps, gateway):
    options = [
        {"id": 2, "title": "Earlier", "skills": [], "course": "Basics"},
        {
            "id": 3,
            "title": "This one",
            "skills": [],
            "course": "Basics",
            "this_roleplay": True,
        },
    ]
    await run(steps, gateway, inputs={**CONTEXT, "practice_options": options})
    body = gateway.tools("finalise_cards")[-1]
    assert body["offered"] == [2, 3]
    assert body["fallback"] == 3


async def test_the_first_option_otherwise(steps, gateway):
    await run(steps, gateway)
    assert gateway.tools("finalise_cards")[-1]["fallback"] == 41


async def test_none_without_options(steps, gateway):
    await run(steps, gateway, inputs={**CONTEXT, "practice_options": []})
    assert gateway.tools("finalise_cards")[-1]["fallback"] is None
