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
    RETRIEVAL = {
        "top_k": 5,
        "min_similarity": 0.3,
        "decline_similarity": 0.3,
        "hit_count": 0,
        "top_similarity": 0.0,
        "passages_used": 0,
    }

    def _check(self, answer, citations, passages, *, can_book, purpose=None):
        step = reply("answer", answer, citations=citations)
        result, rejection = check_reply(
            step,
            {},
            passages,
            turn_type="question",
            language="en",
            retrieval=self.RETRIEVAL,
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


def slot_record(record_id, title):
    return {
        "chunk_id": record_id,
        "record_id": record_id,
        "document_id": "",
        "document_title": "Slots",
        "section_path": title,
        "text": f"id: {record_id}\nStarts at: {title}\nPractitioner: Dr Rohan",
    }


MON_10 = "44444444-4444-4444-8444-444444444441"
MON_11 = "44444444-4444-4444-8444-444444444442"
MON_12 = "44444444-4444-4444-8444-444444444443"
SLOTS_SEEN = [
    slot_record(SLOT_1, "Thu 19 Nov 2026, 12:00"),
    slot_record(MON_10, "Mon 16 Nov 2026, 10:00"),
    slot_record(MON_11, "Mon 16 Nov 2026, 11:00"),
    slot_record(MON_12, "Mon 16 Nov 2026, 12:00"),
]
#: A real reply from the action cases: the right times, offered as a clarify, uncited.
OFFERED = (
    "I can't book Thursday 19 Nov 12:00 because that slot is already taken. Here "
    "are the available alternatives I can book for you, which one should I confirm?\n"
    "1) Mon 16 Nov 10:00 (Dr Rohan, 50 min)\n"
    "2) Mon 16 Nov 11:00 (Dr Rohan, 50 min)\n"
    "3) Mon 16 Nov 12:00 (Dr Rohan, 50 min)"
)


class TestOfferedTimes:
    def _check(self, intent, answer, citations, passages):
        step = reply(intent, answer, citations=citations)
        return check_reply(
            step,
            {},
            passages,
            turn_type="question",
            language="en",
            retrieval=TestTheCheck.RETRIEVAL,
            general=False,
            search_gate=None,
            question="book thursday 12",
            searched=False,
            organisation=Organisation(),
            history=(),
            can_book=True,
        )

    def test_offered_times_are_matched_to_the_records_and_cited(self):
        result, rejection = self._check("clarify", OFFERED, [], SLOTS_SEEN)
        assert rejection is None
        assert result["answer"] == OFFERED
        assert [c["record_id"] for c in result["citations"]] == [
            SLOT_1,
            MON_10,
            MON_11,
            MON_12,
        ]

    def test_a_time_no_record_backs_is_taken_out_and_sent_back(self):
        invented = OFFERED.replace("3) Mon 16 Nov 12:00", "3) Mon 16 Nov 15:00")
        result, rejection = self._check("clarify", invented, [], SLOTS_SEEN)
        assert rejection == Rejection.UNFOUND_SLOT
        assert "15:00" not in result["answer"]
        assert "Mon 16 Nov 11:00" in result["answer"]

    def test_the_day_must_match_too(self):
        # It cites Monday's 10:00 but offers Tuesday's: no record backs Tuesday.
        wrong_day = "You could book Tue 17 Nov 10:00 instead."
        _, rejection = self._check("answer", wrong_day, [2], SLOTS_SEEN)
        assert rejection == Rejection.UNFOUND_SLOT

    def test_a_day_named_once_holds_for_the_list_after_it(self):
        listed = "Free on Monday 16 Nov:\n- 10:00\n- 11:00"
        result, rejection = self._check("answer", listed, [], SLOTS_SEEN)
        assert rejection is None
        assert [c["record_id"] for c in result["citations"]] == [MON_10, MON_11]

    def test_opening_hours_and_times_not_offered_are_left_alone(self):
        hours = "We're open 9:00 to 18:00 on weekdays."
        document = {
            **TestTheCheck.RECORD,
            "record_id": None,
            "document_id": "doc-1",
            "text": "Open 9:00 to 18:00 on weekdays.",
        }
        result, rejection = self._check("answer", hours, [1], [document, *SLOTS_SEEN])
        assert rejection != Rejection.UNFOUND_SLOT
        assert result["answer"] == hours

    def test_a_clarify_keeps_record_citations_and_drops_document_ones(self):
        document = {**TestTheCheck.RECORD, "record_id": None, "document_id": "doc-1"}
        result, _ = self._check(
            "clarify", "Which day suits you?", [1, 2], [document, SLOTS_SEEN[1]]
        )
        assert [c.get("record_id") for c in result["citations"]] == [MON_10]


class TestRecordIds:
    REPLY = (
        "Done — I booked Thursday at 11:00. Appointment id "
        f"{BOOKING}; slot id {SLOT_1}. Citations: 1"
    )

    def test_ids_and_citation_talk_are_taken_out_of_a_run_with_records(self):
        result, _ = TestTheCheck()._check(
            self.REPLY, [1], [TestTheCheck.RECORD], can_book=True
        )
        assert result["answer"] == "Done — I booked Thursday at 11:00."

    def test_a_run_without_records_is_untouched(self):
        document = {
            **TestTheCheck.RECORD,
            "record_id": None,
            "document_id": "doc-1",
            "text": self.REPLY,
        }
        result, _ = TestTheCheck()._check(self.REPLY, [1], [document], can_book=False)
        assert BOOKING in result["answer"]

    def test_a_label_mid_sentence_stays_and_a_bracket_with_ids_goes(self):
        from app.core.agent_runtime.check.text import without_record_ids

        assert (
            without_record_ids(
                f"Booked at 12:00 (slot id: {SLOT_1}, appointment id: {BOOKING}). "
                f"Your appointment id {BOOKING} is confirmed."
            )
            == "Booked at 12:00. Your appointment is confirmed."
        )

    @pytest.mark.parametrize(
        "text, expected",
        [
            (
                "An open slot (50 min) (id e596c793). Book it?",
                "An open slot (50 min). Book it?",
            ),
            (
                "It's cancelled. (See record: 1) Anything else?",
                "It's cancelled. Anything else?",
            ),
            (
                "It's taken (slot id c8046d06. see 1). These are free:",
                "It's taken. These are free:",
            ),
            (
                "The slot was Thu, 12:00 (passage 1). Others:",
                "The slot was Thu, 12:00. Others:",
            ),
            (
                "Done, booked at 15:00. Citations: the slot is in the records I used.",
                "Done, booked at 15:00.",
            ),
            (
                "Opening hours (see our website) are 9 to 5.",
                "Opening hours (see our website) are 9 to 5.",
            ),
            (
                "We have 2 rooms; see 3 options below.",
                "We have 2 rooms; see 3 options below.",
            ),
        ],
    )
    def test_short_ids_and_see_record_go_and_ordinary_text_stays(self, text, expected):
        from app.core.agent_runtime.check.text import without_record_ids

        assert without_record_ids(text) == expected

    def test_lists_keep_their_lead_in_and_items(self):
        from app.core.agent_runtime.check.text import without_record_ids

        assert (
            without_record_ids(
                f"Free on Thursday (Dr Rohan, 50 min):\n- 10:00 (id: {SLOT_1}) [1]\n"
                f"- 12:00 (id: {SLOT_2}) [2]"
            )
            == "Free on Thursday (Dr Rohan, 50 min):\n- 10:00\n- 12:00"
        )


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
                gateway=FakeGateway(),
                bot=lists_bot(
                    persona={"purpose": "enquiries"},
                    gateway_today=(
                        "Saturday 14 Nov 2026, 11:58 (Asia/Kolkata, UTC+05:30)"
                    ),
                ),
            )
        prompt = llm.calls[0]["prompt"]
        assert "# Lists you can use" in prompt
        assert prompt.index("# What you're for") < prompt.index("# Lists you can use")
        assert "Today is Saturday 14 Nov 2026, 11:58 (Asia/Kolkata, UTC+05:30)." in (
            prompt
        )
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


# ---- the time the person confirmed (chunk 6 follow-up) --------------------------

TODAY = "Saturday 14 Nov 2026, 11:58 (Asia/Kolkata, UTC+05:30)"
THU_10 = "55555555-5555-4555-8555-555555555510"
THU_11 = "55555555-5555-4555-8555-555555555511"
SUN_16 = "55555555-5555-4555-8555-555555555516"
MON_16 = "55555555-5555-4555-8555-555555555517"
APPOINTMENT = "66666666-6666-4666-8666-666666666666"

BOOK_SLOT = {
    **CREATE_APPOINTMENTS,
    "input_schema": {
        "type": "object",
        "properties": {
            "slot": {
                "type": "string",
                "description": "Slot: the id of a slots entry from find_slots",
                "default": "",
                "relation": "slots",
                "dated": "datetime",
            },
        },
    },
}
CHANGE_APPOINTMENT = {
    "name": "update_appointments",
    "description": "Change an entry in Appointments.",
    "kind": "update",
    "input_schema": {
        "type": "object",
        "properties": {
            "id": {"type": "string", "description": "The id", "default": ""},
            **BOOK_SLOT["input_schema"]["properties"],
            "status": {
                "type": "string",
                "description": "Status",
                "default": "",
                "enum": ["", "booked", "cancelled"],
            },
        },
    },
}


def found(*slots):
    return {
        "ok": True,
        "result": {
            "list": {"key": "slots", "name": "Slots"},
            "passages": [slot_passage(record_id, title) for record_id, title in slots],
            "total": len(slots),
        },
    }


def booking_bot():
    return lists_bot(FIND_SLOTS, BOOK_SLOT, CHANGE_APPOINTMENT, gateway_today=TODAY)


@pytest.fixture
def run_booking(graph):
    async def _run(question, *, history, gateway):
        return await run_agent(
            graph,
            run_id="run-6c",
            conversation_id="conv-6c",
            chatbot_id="bot-1",
            question=question,
            history=history,
            bot=booking_bot(),
            gateway=gateway,
        )

    return _run


ASKED_11 = [
    {"role": "user", "content": "can I book Thursday at 11:00?"},
    {"role": "assistant", "content": "Thursday 19 Nov at 11:00 is free. Book it?"},
]


class TestConfirmedTime:
    @pytest.mark.asyncio
    async def test_run_6_a_different_time_is_not_booked_and_the_agent_asks(
        self, run_booking
    ):
        # The person confirmed 11:00; find returned only 10:00, and the model books it.
        gateway = FakeGateway(found((THU_10, "Thu 19 Nov 2026, 10:00")), BOOKED)
        llm = FakeLLM(
            find(starts_at_from="2026-11-19T10:00:00+05:30"),
            create(THU_10),
            reply("clarify", "Did you mean 10:00 or 11:00 on Thursday?"),
        )
        with patch(f"{CONVERSATION}.generate_structured", llm):
            state = await run_booking(
                "yes, please book it", history=ASKED_11, gateway=gateway
            )
        assert [c["name"] for c in gateway.calls] == ["find_slots"]
        record = state["tool_calls"][1]
        assert record["error"] == "unconfirmed_time"
        prompt = llm.calls[2]["prompt"]
        assert (
            "- `create_appointments`: refused (Not done: the person hasn't confirmed "
            "this exact day and time (Thu 19 Nov 2026, 10:00). Ask them to confirm "
            "the day and time before you book it.), not done"
        ) in prompt
        # A failed call: not offered again this run.
        assert "create_appointments" not in offered(llm.calls[2])

    @pytest.mark.asyncio
    async def test_the_time_they_confirmed_is_booked(self, run_booking):
        gateway = FakeGateway(found((THU_11, "Thu 19 Nov 2026, 11:00")), BOOKED)
        llm = FakeLLM(
            find(starts_at_from="2026-11-19T11:00:00+05:30"),
            create(THU_11),
            reply("answer", "Booked: Thursday 19 Nov at 11:00.", citations=[2]),
        )
        with patch(f"{CONVERSATION}.generate_structured", llm):
            await run_booking("yes, please book it", history=ASKED_11, gateway=gateway)
        assert [c["name"] for c in gateway.calls] == [
            "find_slots",
            "create_appointments",
        ]
        assert gateway.calls[1]["input"] == {"slot": THU_11}

    @pytest.mark.asyncio
    async def test_tomorrow_at_4_pm_is_worked_out_from_today(self, run_booking):
        # Today is Saturday 14 Nov: tomorrow is Sunday 15 Nov.
        gateway = FakeGateway(
            found(
                (MON_16, "Mon 16 Nov 2026, 16:00"),
                (SUN_16, "Sun 15 Nov 2026, 16:00"),
            ),
            BOOKED,
        )
        llm = FakeLLM(
            find(),
            create(MON_16),
            reply("clarify", "Did you mean Sunday 15 Nov at 4 pm?"),
        )
        with patch(f"{CONVERSATION}.generate_structured", llm):
            state = await run_booking(
                "book me tomorrow at 4 pm please, yes", history=[], gateway=gateway
            )
        # Monday is refused without a call; the create is then not offered again.
        assert [c["name"] for c in gateway.calls] == ["find_slots"]
        assert state["tool_calls"][1]["error"] == "unconfirmed_time"

    @pytest.mark.asyncio
    async def test_tomorrow_at_4_pm_books_sunday(self, run_booking):
        gateway = FakeGateway(found((SUN_16, "Sun 15 Nov 2026, 16:00")), BOOKED)
        llm = FakeLLM(
            find(),
            create(SUN_16),
            reply("answer", "Booked for tomorrow at 4 pm.", citations=[2]),
        )
        with patch(f"{CONVERSATION}.generate_structured", llm):
            await run_booking(
                "book me tomorrow at 4 pm please, yes", history=[], gateway=gateway
            )
        assert [c["name"] for c in gateway.calls] == [
            "find_slots",
            "create_appointments",
        ]

    @pytest.mark.asyncio
    async def test_no_time_named_is_not_booked(self, run_booking):
        gateway = FakeGateway(found((THU_11, "Thu 19 Nov 2026, 11:00")), BOOKED)
        llm = FakeLLM(
            find(),
            create(THU_11),
            reply("clarify", "Which time on Thursday?"),
        )
        with patch(f"{CONVERSATION}.generate_structured", llm):
            await run_booking("book me on Thursday", history=[], gateway=gateway)
        assert [c["name"] for c in gateway.calls] == ["find_slots"]

    @pytest.mark.asyncio
    async def test_a_cancel_that_keeps_its_slot_needs_no_time(self, run_booking):
        appointment = {
            "ok": True,
            "result": {
                "list": {"key": "appointments", "name": "Appointments"},
                "passages": [
                    {
                        "record_id": APPOINTMENT,
                        "list": "Appointments",
                        "title": "Appointments: Thu 19 Nov 2026, 11:00",
                        "record_title": "Thu 19 Nov 2026, 11:00",
                        "text": "id: x\nSlot: Thu 19 Nov 2026, 11:00\nStatus: booked",
                    },
                    slot_passage(THU_11, "Thu 19 Nov 2026, 11:00"),
                ],
                "total": 1,
            },
        }
        gateway = FakeGateway(appointment, BOOKED)
        llm = FakeLLM(
            find(),
            {
                "action": "update_appointments",
                "turn_type": "question",
                "update_appointments": {
                    "id": APPOINTMENT,
                    "slot": THU_11,
                    "status": "cancelled",
                },
            },
            reply("answer", "Cancelled.", citations=[1]),
        )
        with patch(f"{CONVERSATION}.generate_structured", llm):
            await run_booking("cancel my booking", history=[], gateway=gateway)
        assert [c["name"] for c in gateway.calls] == [
            "find_slots",
            "update_appointments",
        ]


class TestNamedTimesAndDays:
    def test_times(self):
        from app.core.agent_runtime.tools.confirmed import named_times

        assert named_times(["book Thursday at 11:00"]) == {660}
        assert named_times(["tomorrow at 4 pm"]) == {960}
        assert named_times(["at 4 please"]) == {240, 960}
        assert named_times(["around noon"]) == {720}
        assert named_times(["yes please"]) == set()

    def test_days_from_today(self):
        from app.core.agent_runtime.tools.confirmed import named_days, today_of

        today = today_of(TODAY)
        assert today.isoformat() == "2026-11-14"
        assert named_days(["Thursday at 11"], today) == {(19, 11)}
        assert named_days(["tomorrow"], today) == {(15, 11)}
        assert named_days(["on 20 Nov"], today) == {(20, 11)}
        assert named_days(["Saturday"], today) == {(14, 11)}
        assert named_days(["at 11"], today) is None

    def test_only_the_persons_last_two_messages(self):
        from app.core.agent_runtime.tools.confirmed import person_messages

        history = [
            {"role": "user", "content": "first"},
            {"role": "assistant", "content": "11:00 is free"},
            {"role": "user", "content": "second"},
        ]
        assert person_messages(history, "third") == ["second", "third"]
        assert person_messages(history, "second") == ["first", "second"]
