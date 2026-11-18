"""Live steps for the bot page and the bubble (chunk 6b, section E): each tool step
as a kind, the list's name and a record's title, never a tool or field name, an id,
a query or memory text. Opt-in per request; off, a run is exactly as before."""

import json
from unittest.mock import patch

import pytest

from app.core.agent_runtime import activity
from app.core.agent_runtime.graph import run_agent
from app.schemas.agent_runtime import AgentRunRequest
from tests.core.agent_runtime.conftest import BODY
from tests.core.agent_runtime.steps import CONVERSATION, FakeLLM, reply, search
from tests.core.agent_runtime.test_gateway_tools import FakeGateway
from tests.core.agent_runtime.test_list_tools import (
    ASKED_11,
    BOOK_SLOT,
    BOOKED,
    BOOKING,
    CHANGE_APPOINTMENT,
    FIND_SLOTS,
    THU_11,
    TODAY,
    create,
    find,
    found,
    lists_bot,
    slot_record,
)

NAMED = [
    {**FIND_SLOTS, "list_name": "Free times"},
    {**BOOK_SLOT, "list_name": "Appointments"},
    {**CHANGE_APPOINTMENT, "list_name": "Appointments"},
]


def bot(on=True):
    return lists_bot(*NAMED, gateway_today=TODAY, **({"activity": True} if on else {}))


class TestDescribe:
    def test_a_find_names_the_list_as_the_owner_wrote_it(self):
        assert activity.describe("find_slots", "gateway", {}, bot(), []) == {
            "kind": "find",
            "list": "Free times",
        }

    def test_a_booking_names_the_time_from_the_slot_it_points_at(self):
        passages = [slot_record(THU_11, "Thu 19 Nov 2026, 11:00")]
        assert activity.describe(
            "create_appointments", "gateway", {"slot": THU_11}, bot(), passages
        ) == {
            "kind": "create",
            "list": "Appointments",
            "title": "Thu 19 Nov 2026, 11:00",
        }

    def test_an_update_to_cancelled_is_a_cancel(self):
        passages = [slot_record(BOOKING, "Thu 19 Nov 2026, 11:00")]
        doing = activity.describe(
            "update_appointments",
            "gateway",
            {"id": BOOKING, "status": "cancelled"},
            bot(),
            passages,
        )
        assert doing == {
            "kind": "cancel",
            "list": "Appointments",
            "title": "Thu 19 Nov 2026, 11:00",
        }

    def test_search_and_hand_over(self):
        assert activity.describe("search_knowledge", "search", {}, bot(), []) == {
            "kind": "search"
        }
        assert activity.describe("hand_over", "gateway", {}, bot(), []) == {
            "kind": "hand_over"
        }

    def test_never_an_id_tool_name_or_input(self):
        weird = [{**FIND_SLOTS, "list_name": "11111111-1111-4111-8111-111111111111"}]
        doing = activity.describe(
            "find_slots",
            "gateway",
            {"starts_at_from": "2026-11-19T17:00"},
            lists_bot(*weird, activity=True),
            [],
        )
        assert doing == {"kind": "find"}
        # A write whose target wasn't looked up has no title, never the id.
        doing = activity.describe(
            "create_appointments", "gateway", {"slot": THU_11}, bot(), []
        )
        assert THU_11 not in json.dumps(doing)
        assert "create_appointments" not in json.dumps(doing)

    def test_off_unless_asked_for(self):
        assert activity.describe("find_slots", "gateway", {}, bot(on=False), []) is None
        assert activity.describe("search_knowledge", "search", {}, {}, []) is None


class TestTheRun:
    @pytest.mark.asyncio
    async def test_a_booking_streams_its_steps_and_returns_what_it_did(self, graph):
        gateway = FakeGateway(found((THU_11, "Thu 19 Nov 2026, 11:00")), BOOKED)
        llm = FakeLLM(
            find(starts_at_from="2026-11-19T11:00:00+05:30"),
            create(THU_11),
            reply("answer", "Booked: Thursday 19 Nov at 11:00.", citations=[2]),
        )
        events = []
        with patch(f"{CONVERSATION}.generate_structured", llm):
            state = await run_agent(
                graph,
                run_id="run-e",
                conversation_id="conv-e",
                chatbot_id="bot-1",
                question="yes, please book it",
                history=ASKED_11,
                bot=bot(),
                gateway=gateway,
                on_event=lambda event, data: events.append((event, data)),
            )
        live = [data for event, data in events if event == "activity"]
        assert live == [
            {"kind": "find", "list": "Free times"},
            {
                "kind": "create",
                "list": "Appointments",
                "title": "Thu 19 Nov 2026, 11:00",
            },
            {"kind": "writing"},
        ]
        assert activity.done(state["activity"]) == [
            {"kind": "find", "list": "Free times"},
            {
                "kind": "create",
                "list": "Appointments",
                "title": "Thu 19 Nov 2026, 11:00",
                "record_id": BOOKING,
            },
        ]
        # Nothing a visitor mustn't see: no tool or field names, no query.
        text = json.dumps(live)
        for secret in ("find_slots", "create_appointments", "starts_at", THU_11):
            assert secret not in text

    @pytest.mark.asyncio
    async def test_without_the_flag_nothing_is_emitted(self, graph, chunk_service):
        from tests.core.knowledge_agent.test_agent import CHUNK_A, passage

        chunk_service.search.return_value = [passage(CHUNK_A, 0.7)]
        llm = FakeLLM(search("hours"), reply(citations=[1]))
        events = []
        with patch(f"{CONVERSATION}.generate_structured", llm):
            state = await run_agent(
                graph,
                run_id="run-f",
                conversation_id="conv-f",
                chatbot_id="bot-1",
                question="hours?",
                history=[],
                bot=lists_bot(*NAMED),
                on_event=lambda event, data: events.append((event, data)),
            )
        assert not [e for e, _ in events if e == "activity"]
        assert not state.get("activity")


def test_the_request_flag_reaches_the_bot_and_the_response_omits_it_when_empty():
    assert AgentRunRequest(**BODY).to_bot().get("activity") is None
    assert AgentRunRequest(**BODY, activity=True).to_bot()["activity"] is True


@pytest.mark.asyncio
async def test_a_second_message_starts_with_no_activity(graph):
    """The state is checkpointed per conversation: one run's steps never reach the
    next run's "what I did"."""
    gateway = FakeGateway(
        found((THU_11, "Thu 19 Nov 2026, 11:00")),
        found((THU_11, "Thu 19 Nov 2026, 11:00")),
    )
    args = dict(
        run_id="run-g",
        conversation_id="conv-g",
        chatbot_id="bot-1",
        history=[],
        bot=bot(),
        gateway=gateway,
    )
    llm = FakeLLM(
        find(starts_at_from="2026-11-19T11:00:00+05:30"),
        reply("answer", "Thursday 11:00 is free.", citations=[1]),
        reply("smalltalk", "You're welcome!", turn_type="smalltalk"),
    )
    with patch(f"{CONVERSATION}.generate_structured", llm):
        first = await run_agent(graph, question="thursday?", **args)
        second = await run_agent(
            graph, question="thanks", **{**args, "run_id": "run-h"}
        )
    assert len(first["activity"]) == 1
    assert not second.get("activity")
