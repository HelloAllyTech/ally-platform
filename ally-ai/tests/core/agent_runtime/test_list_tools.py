"""List tools (chunk 6): find_, create_ and update_ tools built from ally-be's
definitions at run time, their passages, the once-per-run rule for failures, the
lists prompt section and the booking checks.

The graph runs with FakeLLM and a fake gateway, as in test_gateway_tools.py.
"""

import json
from unittest.mock import patch

import pytest

from app.core.agent_runtime.check import check_reply
from app.core.agent_runtime.check.organisation import Organisation
from app.core.agent_runtime.check.rejections import Rejection
from app.core.agent_runtime.graph import run_agent
from app.core.agent_runtime.prompt import build_agent_prompt, format_searches
from app.core.agent_runtime.schemas import step_schema
from app.core.agent_runtime.tools import allowed_tools, gateway_tools
from app.core.agent_runtime.tools.lists import (
    _input_model,
    input_model_for,
    list_tools,
    offers_create,
)
from app.schemas.agent_runtime import AgentRunRequest
from tests.core.agent_runtime.conftest import BODY, make_bot
from tests.core.agent_runtime.steps import CONVERSATION, FakeLLM, reply
from tests.core.agent_runtime.test_gateway_tools import FakeGateway, offered

SLOT_1 = "11111111-1111-4111-8111-111111111111"
SLOT_2 = "22222222-2222-4222-8222-222222222222"
BOOKING = "33333333-3333-4333-8333-333333333333"

FIND_SLOTS = {
    "name": "find_slots",
    "description": "Look up entries in Slots. Filter by starts at and open.",
    "kind": "find",
    "input_schema": {
        "type": "object",
        "properties": {
            "starts_at_from": {
                "type": "string",
                "description": "Starts at from: a date and time",
                "default": "",
            },
            "starts_at_to": {
                "type": "string",
                "description": "Starts at up to: a date and time",
                "default": "",
            },
            "open": {
                "type": "string",
                "description": "Open; empty for any",
                "default": "",
                "enum": ["", "yes", "no"],
            },
            "limit": {
                "type": "integer",
                "description": "How many entries to return, 1 to 10",
                "default": 5,
                "minimum": 1,
                "maximum": 10,
            },
        },
    },
}
CREATE_APPOINTMENTS = {
    "name": "create_appointments",
    "description": "Add an entry to Appointments for the person in this chat.",
    "kind": "create",
    "input_schema": {
        "type": "object",
        "properties": {
            "slot": {
                "type": "string",
                "description": "Slot: the id of a slots entry from find_slots",
                "default": "",
            },
            "_2nd": {"type": "string", "description": "An odd key", "default": ""},
        },
    },
}


def slot_passage(record_id, title):
    return {
        "record_id": record_id,
        "list": "Slots",
        "title": f"Slots: {title}",
        "record_title": title,
        "text": f"id: {record_id}\nStarts at: {title}",
    }


FOUND = {
    "ok": True,
    "result": {
        "list": {"key": "slots", "name": "Slots"},
        "passages": [
            slot_passage(SLOT_1, "Thu 19 Nov 2026, 11:00"),
            slot_passage(SLOT_2, "Thu 19 Nov 2026, 12:00"),
        ],
        "total": 7,
    },
}
BOOKED = {
    "ok": True,
    "result": {
        "list": {"key": "appointments", "name": "Appointments"},
        "passages": [
            {
                "record_id": BOOKING,
                "list": "Appointments",
                "title": "Appointments: Thu 19 Nov 2026, 11:00",
                "record_title": "Thu 19 Nov 2026, 11:00",
                "text": f"id: {BOOKING}\nSlot: Thu 19 Nov 2026, 11:00\nStatus: booked",
            }
        ],
    },
}
TAKEN = {
    "ok": False,
    "error": "unique_taken",
    "result": {
        "message": "That slot is already taken.",
        "passages": [slot_passage(SLOT_2, "Thu 19 Nov 2026, 12:00")],
    },
}


def lists_bot(*definitions, **overrides):
    definitions = definitions or (FIND_SLOTS, CREATE_APPOINTMENTS)
    overrides.setdefault("gateway_tools", [d["name"] for d in definitions])
    return make_bot(gateway_definitions=list(definitions), **overrides)


def find(**args):
    return {"action": "find_slots", "turn_type": "question", "find_slots": args}


def create(slot):
    return {
        "action": "create_appointments",
        "turn_type": "question",
        "create_appointments": {"slot": slot},
    }


@pytest.fixture
def run_lists(graph):
    async def _run(question="what's free on thursday?", *, gateway, bot=None):
        return await run_agent(
            graph,
            run_id="run-6",
            conversation_id="conv-6",
            chatbot_id="bot-1",
            question=question,
            history=[],
            bot=bot or lists_bot(),
            gateway=gateway,
        )

    return _run


class TestDefinitionsBecomeTools:
    def test_the_request_carries_them_into_the_bot_only_when_sent(self):
        body = {
            **BODY,
            "gateway": {
                "url": "http://ally-be.test",
                "token": "t",
                "tools": ["find_slots"],
                "definitions": [FIND_SLOTS],
                "omitted": ["find_more"],
            },
        }
        bot = AgentRunRequest(**body).to_bot()
        assert bot["gateway_definitions"] == [FIND_SLOTS]
        assert bot["gateway_omitted"] == ["find_more"]
        plain = AgentRunRequest(
            **{**BODY, "gateway": {**body["gateway"], "definitions": [], "omitted": []}}
        ).to_bot()
        assert "gateway_definitions" not in plain
        assert "gateway_omitted" not in plain

    def test_each_definition_is_a_gateway_tool_with_its_enums_and_defaults(self):
        tools = gateway_tools(lists_bot())
        assert [t.name for t in tools] == ["find_slots", "create_appointments"]
        schema = tools[0].input_model.model_json_schema()
        assert list(schema["properties"]) == [
            "starts_at_from",
            "starts_at_to",
            "open",
            "limit",
        ]
        open_ = schema["$defs"][schema["properties"]["open"]["$ref"].split("/")[-1]]
        assert open_["enum"] == ["", "yes", "no"]
        assert schema["properties"]["limit"]["default"] == 5
        empty = tools[0].input_model()
        assert empty.model_dump(mode="json", by_alias=True) == {
            "starts_at_from": "",
            "starts_at_to": "",
            "open": "",
            "limit": 5,
        }

    def test_a_key_that_isnt_a_python_name_keeps_its_name(self):
        model = input_model_for(CREATE_APPOINTMENTS)
        assert "_2nd" in model.model_json_schema()["properties"]
        assert model.model_validate({"_2nd": "x"}).model_dump(by_alias=True)[
            "_2nd"
        ] == ("x")

    def test_only_tools_the_token_names_are_offered(self):
        bot = lists_bot(gateway_tools=["find_slots"])
        assert [t.name for t in gateway_tools(bot)] == ["find_slots"]

    def test_the_same_definition_gives_the_same_class_and_the_cache_is_bounded(self):
        assert input_model_for(FIND_SLOTS) is input_model_for(dict(FIND_SLOTS))
        assert list_tools([FIND_SLOTS])[0] is list_tools([FIND_SLOTS])[0]
        assert _input_model.cache_info().maxsize == 64
        step = step_schema(list_tools([FIND_SLOTS]))
        assert step is step_schema(list_tools([FIND_SLOTS]))

    def test_offers_create_only_with_a_create_tool(self):
        assert offers_create([FIND_SLOTS, CREATE_APPOINTMENTS])
        assert not offers_create([FIND_SLOTS])
        assert not offers_create(None)


class TestFind:
    @pytest.mark.asyncio
    async def test_its_passages_are_appended_numbered_and_citable(self, run_lists):
        gateway = FakeGateway(FOUND)
        llm = FakeLLM(
            find(starts_at_from="2026-11-19T00:00:00+05:30", open="yes"),
            reply("answer", "11:00 and 12:00 are free on Thursday.", citations=[1, 2]),
        )
        with patch(f"{CONVERSATION}.generate_structured", llm):
            state = await run_lists(gateway=gateway)
        assert gateway.calls[0]["input"] == {
            "starts_at_from": "2026-11-19T00:00:00+05:30",
            "open": "yes",
            "limit": 5,
        }
        prompt = llm.calls[1]["prompt"]
        assert "[1] Slots · Thu 19 Nov 2026, 11:00" in prompt
        assert f"id: {SLOT_1}" in prompt
        assert "- `find_slots`: 7 found → passages 1–2" in prompt
        result = state["result"]
        assert result["intent"] == "answer"
        assert [c["record_id"] for c in result["citations"]] == [SLOT_1, SLOT_2]
        assert result["citations"][0]["document_title"] == "Slots"
        assert result["citations"][0]["section_path"] == "Thu 19 Nov 2026, 11:00"
        assert result["citations"][0]["source_url"] == ""

    @pytest.mark.asyncio
    async def test_a_successful_find_can_run_twice(self, run_lists):
        gateway = FakeGateway(FOUND)
        llm = FakeLLM(
            find(starts_at_from="2026-11-19T00:00:00+05:30"),
            find(starts_at_from="2026-11-20T00:00:00+05:30"),
            reply("answer", "Thursday 11:00 is free.", citations=[1]),
        )
        with patch(f"{CONVERSATION}.generate_structured", llm):
            await run_lists(gateway=gateway)
        assert [c["step"] for c in gateway.calls] == [0, 1]
        assert "find_slots" in offered(llm.calls[1])
        # The second find's passages are new numbers; the same records come back.
        assert "- `find_slots`: 7 found → passages 3–4" in llm.calls[2]["prompt"]

    @pytest.mark.asyncio
    async def test_finds_are_not_searches(self, run_lists):
        gateway = FakeGateway({"ok": True, "result": {"passages": [], "total": 0}})
        llm = FakeLLM(find(), reply("decline", "Nothing is free then."))
        with patch(f"{CONVERSATION}.generate_structured", llm):
            state = await run_lists(gateway=gateway)
        assert "search_knowledge" in offered(llm.calls[1])
        assert "- `find_slots`: none found" in llm.calls[1]["prompt"]
        assert state["tool_calls"][0]["kind"] == "gateway"


class TestWrites:
    @pytest.mark.asyncio
    async def test_a_create_is_cited_and_the_booking_checks_let_it_through(
        self, run_lists
    ):
        gateway = FakeGateway(BOOKED)
        llm = FakeLLM(
            create(SLOT_1),
            reply(
                "answer",
                "You're booked for Thursday at 11:00 am. Would you like me to book "
                "anything else?",
                citations=[1],
            ),
        )
        with patch(f"{CONVERSATION}.generate_structured", llm):
            state = await run_lists(
                "yes please",
                gateway=gateway,
                bot=lists_bot(persona={"purpose": "enquiries"}),
            )
        assert gateway.calls[0]["input"] == {"slot": SLOT_1}
        assert "- `create_appointments`: done → passage 1" in llm.calls[1]["prompt"]
        result = state["result"]
        assert "You're booked for Thursday at 11:00 am." in result["answer"]
        assert "book anything else" in result["answer"]
        assert result["citations"][0]["record_id"] == BOOKING

    @pytest.mark.asyncio
    async def test_a_refusal_shows_its_reason_and_alternatives_and_isnt_offered_again(
        self, run_lists
    ):
        gateway = FakeGateway(TAKEN)
        llm = FakeLLM(
            create(SLOT_1),
            reply("answer", "That one's gone, but 12:00 is free.", citations=[1]),
        )
        with patch(f"{CONVERSATION}.generate_structured", llm):
            await run_lists("book 11", gateway=gateway)
        second = llm.calls[1]
        assert (
            "- `create_appointments`: refused (That slot is already taken.), not "
            "done; alternatives → passage 1"
        ) in second["prompt"]
        assert "[1] Slots · Thu 19 Nov 2026, 12:00" in second["prompt"]
        assert "create_appointments" not in offered(second)
        assert "find_slots" in offered(second)


class TestTheCheck:
    def _check(self, answer, citations, passages, *, can_book, purpose=None):
        step = reply("answer", answer, citations=citations)
        result, rejection = check_reply(
            step,
            {},
            passages,
            turn_type="question",
            language="en",
            retrieval={
                "top_k": 5,
                "min_similarity": 0.3,
                "decline_similarity": 0.3,
                "hit_count": 0,
                "top_similarity": 0.0,
                "passages_used": 0,
            },
            general=False,
            search_gate=None,
            question="book thursday 11",
            searched=False,
            organisation=Organisation(),
            history=(),
            purpose=purpose,
            can_book=can_book,
        )
        return result, rejection

    RECORD = {
        "chunk_id": SLOT_1,
        "record_id": SLOT_1,
        "document_id": "",
        "document_title": "Slots",
        "section_path": "Thu 19 Nov 2026, 11:00",
        "text": f"id: {SLOT_1}\nStarts at: Thu 19 Nov 2026, 11:00",
    }

    def test_without_a_create_tool_the_booking_slice_checks_stay(self):
        result, rejection = self._check(
            "Thursday 11 am is free. Would you like me to book it?",
            [1],
            [self.RECORD],
            can_book=False,
            purpose="enquiries",
        )
        assert rejection == Rejection.OFFERS_SLOT
        assert "book it" not in result["answer"]

    def test_with_a_create_tool_a_cited_free_time_goes_out(self):
        result, rejection = self._check(
            "Thursday 11 am is free. Would you like me to book it?",
            [1],
            [self.RECORD],
            can_book=True,
            purpose="enquiries",
        )
        assert rejection is None
        assert result["answer"] == (
            "Thursday 11 am is free. Would you like me to book it?"
        )

    def test_with_a_create_tool_an_uncited_free_time_is_sent_back(self):
        document = {**self.RECORD, "record_id": None, "document_id": "doc-1"}
        _, rejection = self._check(
            "Thursday 11 am is free.", [1], [document], can_book=True
        )
        assert rejection == Rejection.UNFOUND_SLOT


class TestPrompt:
    def test_with_no_list_tools_the_prompt_and_schema_are_todays(self):
        bot = make_bot()
        before = build_agent_prompt(
            "hi", passages=[], tools=allowed_tools(bot), persona={"purpose": "answer"}
        )
        after = build_agent_prompt(
            "hi",
            passages=[],
            tools=allowed_tools(bot),
            persona={"purpose": "answer"},
            lists=False,
        )
        assert before == after
        assert "# Lists you can use" not in before
        schema = json.dumps(step_schema(allowed_tools(bot)).model_json_schema())
        assert "find_" not in schema

    @pytest.mark.asyncio
    async def test_the_lists_section_follows_the_purpose_only_with_list_tools(
        self, run_lists
    ):
        llm = FakeLLM(reply("decline", "I can't help with that."))
        with patch(f"{CONVERSATION}.generate_structured", llm):
            await run_lists(
                gateway=FakeGateway(), bot=lists_bot(persona={"purpose": "enquiries"})
            )
        prompt = llm.calls[0]["prompt"]
        assert "# Lists you can use" in prompt
        assert prompt.index("# What you're for") < prompt.index("# Lists you can use")
        assert "- `find_slots`: Look up entries in Slots." in prompt
        assert "`starts_at_from`: Starts at from: a date and time" in prompt

    @pytest.mark.asyncio
    async def test_the_section_appears_without_a_persona_too(self, run_lists):
        llm = FakeLLM(reply("decline", "I can't help with that."))
        with patch(f"{CONVERSATION}.generate_structured", llm):
            await run_lists(gateway=FakeGateway(), bot=lists_bot(persona=None))
        assert "# Lists you can use" in llm.calls[0]["prompt"]


class TestTrace:
    @pytest.mark.asyncio
    async def test_tools_left_out_by_the_cap_are_named_once(self, run_lists):
        llm = FakeLLM(reply("decline", "I can't help with that."))
        with patch(f"{CONVERSATION}.generate_structured", llm):
            state = await run_lists(
                gateway=FakeGateway(),
                bot=lists_bot(gateway_omitted=["find_extra", "find_more"]),
            )
        summaries = [s["summary"] for s in state["trace"]]
        assert summaries[0] == "list tools left out (over 12): find_extra, find_more"
        assert sum("left out" in s for s in summaries) == 1


def test_format_searches_renders_each_list_outcome():
    assert format_searches(
        [
            {
                "tool": "find_slots",
                "kind": "gateway",
                "list_kind": "find",
                "ok": True,
                "aggregate": {"kind": "count", "value": 7},
                "added": [],
            },
            {
                "tool": "create_appointments",
                "kind": "gateway",
                "list_kind": "create",
                "ok": False,
                "error": "timeout",
                "added": [],
            },
        ]
    ) == (
        "- `find_slots`: count = 7\n"
        "- `create_appointments`: failed (timeout), not done"
    )
