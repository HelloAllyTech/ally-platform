"""A decline after one search is sent back once to search with other words
(chunk 20a-2, the wrong declines in CHUNK-20A-EVAL.md)."""

from unittest.mock import patch

import pytest

from app.core.agent_runtime.check import REJECTIONS
from tests.core.agent_runtime.steps import CONVERSATION, FakeLLM, reply, search
from tests.core.knowledge_agent.test_agent import CHUNK_A, CHUNK_B, passage

pytestmark = pytest.mark.asyncio


@pytest.fixture
def agent_run(run):
    async def _run(question, llm, **bot):
        with patch(f"{CONVERSATION}.generate_structured", llm):
            return await run(question, **bot)

    return _run


async def test_a_decline_after_one_search_searches_again_and_answers(
    agent_run, chunk_service
):
    # The first query lands on a heading; the second finds the class times.
    chunk_service.search.side_effect = [
        [passage(CHUNK_A, 0.7)],
        [passage(CHUNK_B, 0.66)],
    ]
    llm = FakeLLM(
        search("beginners series Prana Yoga Studio"),
        reply("decline", "I don't have the beginners' series times."),
        search("beginners series Sunday time"),
        reply(citations=[2], answer="It runs on four Sundays each month at 8 am."),
    )
    state = await agent_run("When is the beginners' series?", llm)

    assert REJECTIONS["search_again"] in llm.calls[2]["prompt"]
    assert state["result"]["intent"] == "answer"
    assert [c["chunk_id"] for c in state["result"]["citations"]] == [CHUNK_B]


async def test_the_retry_must_search(agent_run, chunk_service):
    chunk_service.search.return_value = [passage(CHUNK_A, 0.7)]
    llm = FakeLLM(
        search("parking"),
        reply("decline", "I don't have parking details."),
        search("car park"),
        reply("decline", "I don't have parking details, sorry."),
    )
    state = await agent_run("Is there parking?", llm)

    # The step after the refusal is asked to search again, not forced: a reply
    # still fits its schema, so a step that replies can't fail the run.
    llm.calls[2]["schema"].model_validate(reply("decline", "No."))
    assert REJECTIONS["search_again"] in llm.calls[2]["prompt"]
    # Still nothing: the honest decline stands, in its own words, after one retry.
    assert state["result"]["intent"] == "decline"
    assert state["result"]["answer"] == "I don't have parking details, sorry."
    assert len(llm.calls) == 4


async def test_no_retry_when_the_first_search_found_nothing(agent_run, chunk_service):
    chunk_service.search.return_value = []
    llm = FakeLLM(
        search("weather in Pune"),
        reply("decline", "I can't help with the weather."),
    )
    state = await agent_run("What's the weather in Pune?", llm)

    assert len(llm.calls) == 2
    assert state["result"]["intent"] == "decline"


async def test_a_retry_that_replies_instead_of_searching_ends_the_run(
    agent_run, chunk_service
):
    chunk_service.search.return_value = [passage(CHUNK_A, 0.7)]
    llm = FakeLLM(
        search("parking"),
        reply("decline", "I don't have parking details."),
        reply("decline", "I don't have parking details, sorry."),
    )
    state = await agent_run("Is there parking?", llm)

    assert state["result"]["intent"] == "decline"
    assert len(llm.calls) == 3


async def test_no_retry_after_two_searches(agent_run, chunk_service):
    chunk_service.search.side_effect = [
        [passage(CHUNK_A, 0.7)],
        [passage(CHUNK_B, 0.66)],
    ]
    llm = FakeLLM(
        search("parking"),
        search("car park basement"),
        reply("decline", "I don't have parking details."),
    )
    state = await agent_run("Is there parking?", llm)

    assert len(llm.calls) == 3
    assert state["result"]["intent"] == "decline"


class TestTimeReserve:
    """A send-back needs time for a model step (a rewrite) or a search and a step
    (search again) before the 20 s cap; otherwise the checked draft is final and v1
    never has to answer (chunk 20a-2)."""

    @staticmethod
    def state(elapsed, revisions=0):
        import time

        return {"started_at": time.time() - elapsed, "revisions": revisions}

    def test_a_rewrite_needs_its_reserve(self):
        from app.core.agent_runtime.budget import can_send_back
        from app.core.agent_runtime.check import Rejection

        assert can_send_back(self.state(5), Rejection.UNCITED)
        assert not can_send_back(self.state(13), Rejection.UNCITED)
        assert not can_send_back(self.state(1, revisions=1), Rejection.UNCITED)

    def test_searching_again_needs_more(self):
        from app.core.agent_runtime.budget import can_send_back
        from app.core.agent_runtime.check import Rejection

        assert can_send_back(self.state(5), Rejection.SEARCH_AGAIN)
        assert not can_send_back(self.state(10), Rejection.SEARCH_AGAIN)
        assert can_send_back(self.state(10), Rejection.UNCITED)


class DispatchLikeLLM(FakeLLM):
    """Like generate_structured: a reply that misfits the schema is a failed call."""

    async def __call__(self, *, schema, prompt, **kwargs):
        from pydantic import ValidationError

        from app.exceptions.custom_exceptions import LLMInvocationFailedException

        try:
            return await super().__call__(schema=schema, prompt=prompt, **kwargs)
        except ValidationError as e:
            raise LLMInvocationFailedException("invalid response") from e


async def test_a_forced_search_that_replies_is_asked_again_unforced(
    agent_run, chunk_service
):
    """F2 in the checkup: forced to search, the model replied; the run failed and v1
    answered. Now the step is asked again without forcing."""
    chunk_service.search.return_value = [passage(CHUNK_A, 0.7)]
    llm = DispatchLikeLLM(
        reply("answer", "Call 112 now."),  # uncited: sent back to search
        reply("decline", "Please call 112 or Tele-MANAS 14416 now."),  # forced: fails
        reply("decline", "Please call 112 or Tele-MANAS 14416 now."),  # unforced
    )
    state = await agent_run("my friend might hurt herself tonight", llm)

    assert state["result"]["intent"] == "decline"
    assert len(llm.calls) == 3


def test_no_second_search_without_time_for_the_reply():
    import time

    from app.core.agent_runtime.budget import tool_budget

    one_search = [{"tool": "search_knowledge", "added": [1]}]
    early = {"started_at": time.time() - 3, "tool_calls": one_search}
    late = {"started_at": time.time() - 10, "tool_calls": one_search}
    assert tool_budget(early) == 1
    assert tool_budget(late) == 0


async def test_a_malformed_step_is_asked_again(agent_run, chunk_service):
    """lab-hours in the checkup: a search with no query failed the schema and the
    run fell back to v1."""
    chunk_service.search.return_value = [passage(CHUNK_A, 0.7)]
    bad = {
        "action": "search_knowledge",
        "search_knowledge": None,
        "turn_type": "question",
        "language": "en",
    }
    llm = DispatchLikeLLM(
        bad,
        search("opening hours"),
        reply(citations=[1], answer="We open at 7 am."),
    )
    state = await agent_run("What are your opening hours?", llm)

    assert state["result"]["intent"] == "answer"
    assert len(llm.calls) == 3
