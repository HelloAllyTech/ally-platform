"""Memory, light (chunk 8a): what a run sees of the person and what it asks to
remember, Bring in customers' booking variant, and the two after-reply endpoints."""

import json
from unittest.mock import AsyncMock, patch

import pytest

from app.core.agent_runtime import memory
from app.core.agent_runtime.prompt import build_agent_prompt
from app.core.agent_runtime.schemas import step_schema
from app.core.agent_runtime.tools import allowed_tools
from app.core.agent_runtime.tools.lists import takes_details
from app.core.memory_lines import service as memory_lines
from app.schemas.agent_runtime import AgentRunRequest, AgentRunResponse

from .conftest import BODY, URL, make_bot
from .steps import CONVERSATION, FakeLLM, reply
from .test_list_tools import FIND_SLOTS, lists_bot

LINES = "m1 (12 Nov): prefers evenings\nm2 (10 Nov): comes with her mother"
MEMORY = {"lines": LINES, "never_store": ["payment details", "passwords"]}


def remember(*ops, **kw):
    return {**reply(**kw), "remember": list(ops)}


def prompt_for(bot, **kw):
    """The first step's prompt, as conversation.agent_step builds it."""
    return build_agent_prompt(
        "hi",
        passages=[],
        tools=allowed_tools(bot),
        persona=bot.get("persona"),
        lists=bool(bot.get("gateway_definitions")),
        memory=memory.memory_section(bot),
        history_lead=memory.history_lead(bot),
        can_book=memory.offers_create(bot.get("gateway_definitions")),
        takes_details=takes_details(bot.get("gateway_definitions")),
        channel=bot.get("channel"),
        **kw,
    )


class TestRequest:
    def test_memory_summary_and_name_reach_the_bot_only_when_sent(self):
        plain = AgentRunRequest(**BODY).to_bot()
        assert not {"memory", "summary", "person_name"} & set(plain)
        bot = AgentRunRequest(
            **BODY,
            memory=MEMORY,
            summary=" They asked about fees. ",
            person_name="Rahul",
        ).to_bot()
        assert bot["memory"] == MEMORY
        assert bot["summary"] == "They asked about fees."
        assert bot["person_name"] == "Rahul"

    def test_memory_writes_are_sent_only_when_there_are_some(self):
        base = {
            "intent": "answer",
            "answer": "Hi",
            "citations": [],
            "retrieval": {
                "top_k": 0,
                "min_similarity": 0,
                "decline_similarity": 0,
                "hit_count": 0,
                "top_similarity": 0,
                "passages_used": 0,
            },
            "run_id": "r",
        }
        assert "memory_writes" not in AgentRunResponse(**base).model_dump()
        out = AgentRunResponse(
            **base, memory_writes=[{"op": "add", "section": "preferences", "text": "x"}]
        ).model_dump(exclude_none=True)
        assert out["memory_writes"] == [
            {"op": "add", "section": "preferences", "text": "x"}
        ]


class TestPrompt:
    def test_with_memory_off_no_summary_and_no_name_the_prompt_is_todays(self):
        bot = make_bot(persona={"purpose": "answer"})
        today = build_agent_prompt(
            "hi", passages=[], tools=allowed_tools(bot), persona=bot["persona"]
        )
        assert prompt_for(bot) == today
        assert memory.remember_mode(bot) is None
        schema = json.dumps(step_schema(allowed_tools(bot)).model_json_schema())
        assert "remember" not in schema

    def test_the_memory_section_follows_the_lists_and_precedes_the_safety_rules(self):
        bot = lists_bot(
            persona={"purpose": "answer", "safety_rules": "# Safety\nBe safe."},
            memory=MEMORY,
        )
        prompt = prompt_for(bot)
        at = prompt.index("# What you know about this person")
        assert prompt.index("# Lists you can use") < at < prompt.index("# Safety")
        assert "m1 (12 Nov): prefers evenings" in prompt
        assert "- payment details" in prompt

    def test_memory_on_with_no_lines_still_gives_the_rules(self):
        prompt = prompt_for(make_bot(memory={"lines": "", "never_store": []}))
        assert "# What you know about this person" in prompt
        assert memory.NO_LINES in prompt

    def test_the_summary_and_the_name_go_before_the_last_messages(self):
        bot = make_bot(summary="They asked about the group class.", person_name="Rahul")
        prompt = prompt_for(
            bot, history=[{"role": "user", "content": "and on Thursdays?"}]
        )
        name = prompt.index("The person's name: Rahul")
        summary = prompt.index(
            "Earlier in this chat (a summary): They asked about the group class."
        )
        assert name < summary < prompt.index("Worker: and on Thursdays?")

    def test_a_long_summary_isnt_cut_by_the_history_budget(self):
        summary = "x" * 790
        history = [{"role": "user", "content": "y" * 400}] * 10
        prompt = prompt_for(make_bot(summary=summary), history=history)
        assert summary in prompt


VARIANT = "you book it for them in the organisation's lists"
TAKES = "offer to take their details so the team can get back to them"
CREATE_LEADS = {
    "name": "create_leads",
    "description": "Add an entry to Leads for the person in this chat.",
    "kind": "create",
    "input_schema": {"type": "object", "properties": {}},
    "takes_details": True,
}


class TestPlaybooksReplaceThePurposeVariants:
    """Q3-fast Part 2b: the purpose sets the goal and tone; what a list's tools add
    comes from its playbook, whatever the purpose. The `can_book` and
    `takes_details` variants are no longer used."""

    def test_bring_in_customers_with_a_create_tool_gets_its_base_section(self):
        prompt = prompt_for(lists_bot(persona={"purpose": "enquiries"}, channel="web"))
        assert VARIANT not in prompt
        # The booking rules are the lists section's, for every purpose (6b).
        assert "book it yourself straight away" in prompt

    def test_answer_with_a_list_that_takes_details_gets_no_variant(self):
        prompt = prompt_for(lists_bot(CREATE_LEADS, persona={"purpose": "answer"}))
        assert TAKES not in prompt
        assert "You answer questions about this organisation" in prompt

    def test_without_tools_the_purpose_section_is_byte_identical(self):
        from app.core.knowledge_agent.prompt import format_purpose

        for purpose in ("answer", "enquiries", "training", "guide"):
            plain = format_purpose({"purpose": purpose})
            assert plain in prompt_for(make_bot(persona={"purpose": purpose}))


class TestRememberMode:
    @pytest.mark.parametrize(
        "bot, mode",
        [
            (make_bot(), None),
            (make_bot(memory=MEMORY), "memory"),
            (lists_bot(), "name"),
            (lists_bot(FIND_SLOTS), None),
            (lists_bot(memory=MEMORY), "memory_and_name"),
        ],
    )
    def test_what_remember_may_do(self, bot, mode):
        assert memory.remember_mode(bot) == mode

    def test_name_only_offers_just_the_name(self):
        schema = step_schema([], remember="name").model_json_schema()
        op = schema["$defs"]["RememberOpKind"]["enum"]
        assert op == ["name"]

    def test_collect_keeps_well_formed_ops_only(self):
        step = {
            "remember": [
                {"op": "add", "section": "preferences", "text": "prefers  evenings"},
                {"op": "add", "section": "health", "text": "x"},
                {"op": "forget", "id": ""},
                {"op": "name", "text": "Rahul"},
            ]
        }
        assert memory.collect([], step, "memory") == [
            {"op": "add", "section": "preferences", "text": "prefers evenings"}
        ]
        assert memory.collect([], step, "name") == []  # past the 3 a step
        assert memory.collect([], {"remember": [step["remember"][3]]}, "name") == [
            {"op": "name", "text": "Rahul"}
        ]
        assert memory.collect([], step, None) == []

    def test_collect_drops_repeats_and_caps_the_run(self):
        op = {"op": "add", "section": "context", "text": "a"}
        writes = memory.collect([], {"remember": [op]}, "memory")
        assert memory.collect(writes, {"remember": [op]}, "memory") == writes
        many = [{"op": "add", "section": "context", "text": str(i)} for i in range(3)]
        so_far = [{"op": "done", "id": f"m{i}"} for i in range(5)]
        assert len(memory.collect(so_far, {"remember": many}, "memory")) == 6


class TestRun:
    @pytest.mark.asyncio
    async def test_writes_come_back_in_the_result_and_the_trace_has_no_text(self, run):
        llm = FakeLLM(
            remember(
                {"op": "add", "section": "preferences", "text": "prefers evenings"},
                intent="smalltalk",
                answer="Noted, evenings it is.",
                turn_type="smalltalk",
            )
        )
        with patch(f"{CONVERSATION}.generate_structured", llm):
            state = await run("evenings work better for me", memory=MEMORY)
        assert state["memory_writes"] == [
            {"op": "add", "section": "preferences", "text": "prefers evenings"}
        ]
        steps = [s for s in state["trace"] if s["node"] == "remember"]
        assert steps and "evenings" not in steps[0]["summary"]
        assert "remember" in json.dumps(llm.calls[0]["schema"].model_json_schema())

    @pytest.mark.asyncio
    async def test_with_memory_off_nothing_is_offered_or_returned(self, run):
        llm = FakeLLM(reply("smalltalk", "Hi!", turn_type="smalltalk"))
        with patch(f"{CONVERSATION}.generate_structured", llm):
            state = await run("hi")
        assert not state.get("memory_writes")
        assert "remember" not in json.dumps(llm.calls[0]["schema"].model_json_schema())

    def test_the_endpoint_returns_memory_writes(self, client, enabled):
        llm = FakeLLM(
            remember(
                {"op": "forget", "id": "m1"},
                intent="smalltalk",
                answer="Done, I've forgotten that.",
                turn_type="smalltalk",
            )
        )
        with patch(f"{CONVERSATION}.generate_structured", llm):
            response = client.post(URL, json={**BODY, "memory": MEMORY})
        assert response.status_code == 200
        assert response.json()["memory_writes"] == [{"op": "forget", "id": "m1"}]


class TestEndpoints:
    def test_memory_check_keeps_what_the_model_keeps(self, client):
        with patch.object(
            memory_lines,
            "generate_structured",
            AsyncMock(return_value=(memory_lines.CheckVerdict(keep=[True, False]), {})),
        ) as llm:
            response = client.post(
                "/api/v1/agent/memory-check",
                json={
                    "lines": ["prefers evenings", "takes sertraline"],
                    "never_store": ["diagnoses"],
                    "prompts": {
                        "ally_ai_memory_check": {
                            "prompt": "Store text {lines} / {never_store}"
                        }
                    },
                },
            )
        assert response.json() == {"keep": [True, False], "failed": False}
        prompt = llm.await_args.kwargs["prompt"]
        assert (
            prompt == "Store text 1. prefers evenings\n2. takes sertraline / diagnoses"
        )

    @pytest.mark.parametrize(
        "outcome",
        [
            AsyncMock(side_effect=TimeoutError()),
            AsyncMock(return_value=(memory_lines.CheckVerdict(keep=[True]), {})),
        ],
    )
    def test_memory_check_fails_closed(self, client, outcome):
        with patch.object(memory_lines, "generate_structured", outcome):
            response = client.post(
                "/api/v1/agent/memory-check", json={"lines": ["a", "b"]}
            )
        assert response.json() == {"keep": [False, False], "failed": True}

    def test_summary_folds_messages_in(self, client):
        with patch.object(
            memory_lines,
            "generate_structured",
            AsyncMock(
                return_value=(memory_lines.SummaryOut(summary="They asked x."), {})
            ),
        ) as llm:
            response = client.post(
                "/api/v1/agent/conversation-summary",
                json={
                    "summary": "",
                    "messages": [
                        {"role": "user", "content": "hello"},
                        {"role": "assistant", "content": "hi"},
                    ],
                    "health": True,
                },
            )
        assert response.json() == {"summary": "They asked x.", "failed": False}
        prompt = llm.await_args.kwargs["prompt"]
        assert "Person: hello\nAssistant: hi" in prompt
        assert "# A health or mental-health service: yes" in prompt
        assert memory_lines.NO_SUMMARY in prompt

    def test_summary_failure_keeps_the_old_one(self, client):
        with patch.object(
            memory_lines, "generate_structured", AsyncMock(side_effect=RuntimeError())
        ):
            response = client.post(
                "/api/v1/agent/conversation-summary",
                json={"summary": "old", "messages": [{"role": "user", "content": "x"}]},
            )
        assert response.json() == {"summary": "", "failed": True}


class TestAboutThePerson:
    """A reply that only tells the person what they said about themselves may go out
    uncited; anything about the organisation still needs a source (chunk 8a)."""

    from app.core.agent_runtime.check.personal import about_the_person as check

    @pytest.mark.parametrize(
        "answer",
        [
            "You said evenings suit you best.",
            "You told me you prefer evenings.",
            "Your team is called Lotus.",
        ],
    )
    def test_their_own_words_pass(self, answer):
        personal = LINES + "\nEarlier they said their team is called Lotus."
        assert TestAboutThePerson.check(answer, personal)

    @pytest.mark.parametrize(
        "answer",
        [
            "We offer evening sessions on Thursdays.",
            "Our evening classes suit you best.",
            "You can book evenings at 18:00.",
            "Evenings are popular.",
            "You can sign in at https://ally.example/evenings.",
        ],
    )
    def test_claims_for_the_organisation_dont(self, answer):
        assert not TestAboutThePerson.check(answer, LINES)

    def test_nothing_given_means_nothing_passes(self):
        assert not TestAboutThePerson.check("You said evenings suit you.", "")

    @pytest.mark.asyncio
    async def test_a_run_answers_from_memory_uncited(self, run):
        llm = FakeLLM(reply("answer", "You said evenings suit you best."))
        with patch(f"{CONVERSATION}.generate_structured", llm):
            state = await run("What time did I say suits me best?", memory=MEMORY)
        assert state["result"]["intent"] == "answer"
        assert state["result"]["answer"] == "You said evenings suit you best."
        assert len(llm.calls) == 1

    @pytest.mark.parametrize("personal, intent", [(LINES, "answer"), ("", "decline")])
    def test_the_check_needs_what_it_was_given(self, personal, intent):
        from app.core.agent_runtime.check.pipeline import check_reply

        result, _ = check_reply(
            reply("answer", "You said evenings suit you best."),
            {},
            [],
            turn_type="question",
            language="en",
            retrieval={},
            general=False,
            search_gate=None,
            question="What time did I say suits me best?",
            personal=personal,
        )
        assert result["intent"] == intent


class TestCrawledTitles:
    """Two misfires found testing on a crawled site (Amaha, chunk 8a): "About Amaha"
    made "about" a name of the organisation, and "Psychiatry" in three page titles
    made a booking confirmation look like a list of topics."""

    TITLES = [
        "About Amaha",
        "Contact Us for Help & Support",
        "Find Expert Online Therapy & Psychiatry Support | Amaha",
        "Trusted Psychiatry Services by Reputed Doctors near you",
        "Psychiatry - Amaha",
        "Quit Tobacco Addiction",
        "Couples Counselling - Amaha",
    ]

    def org(self):
        from app.core.agent_runtime.check.organisation import organisation_of

        return organisation_of(
            {
                "persona": {"display_name": "Amaha assistant"},
                "knowledge_topics": self.TITLES,
            }
        )

    def test_everyday_title_words_are_not_the_organisation(self):
        org = self.org()
        assert not org.named_in("what do you know about me?")
        assert not org.named_in("How do I contact you?")
        assert org.named_in("Does Amaha offer couples therapy?")

    def test_one_word_in_several_titles_is_not_a_list(self):
        org = self.org()
        confirmation = (
            "Your psychiatry appointment is booked for Mon 16 Nov 2026 at 15:00."
        )
        assert org.topics_named_in(confirmation) == 1
        assert (
            org.topics_named_in(
                "I can help with psychiatry, couples counselling or tobacco addiction."
            )
            >= 3
        )


class TestBeforeChat:
    """What they told the page before the chat reaches the run (chunk 8a)."""

    BOT = make_bot(
        person_name="Shehbaz",
        before_chat=[{"label": "What are you looking for?", "value": "Adult Therapy"}],
    )

    def test_it_goes_ahead_of_the_history_with_the_name(self):
        lead = memory.history_lead(self.BOT)
        assert lead == (
            "The person's name: Shehbaz\n"
            "Before the chat they told you: What are you looking for: Adult Therapy"
        )

    def test_a_reply_about_it_is_about_the_person(self):
        from app.core.agent_runtime.check.personal import about_the_person

        personal = memory.personal_context(self.BOT)
        assert about_the_person("You said you're looking for adult therapy.", personal)

    def test_the_request_carries_it_only_when_sent(self):
        assert "before_chat" not in AgentRunRequest(**BODY).to_bot()
        bot = AgentRunRequest(
            **BODY, before_chat=[{"label": "Looking for", "value": "Adult Therapy"}]
        ).to_bot()
        assert bot["before_chat"] == [
            {"label": "Looking for", "value": "Adult Therapy"}
        ]


@pytest.mark.parametrize(
    "text, expected",
    [
        (
            "You can book with Amaha — see these details here: 1, 3, 4. Online?",
            "You can book with Amaha. Online?",
        ),
        ("Monday at 15:00 — booked. (source 1)", "Monday at 15:00 — booked."),
        ("The details: 3 sessions a week.", "The details: 3 sessions a week."),
        ("We have 2 centres in Mumbai.", "We have 2 centres in Mumbai."),
    ],
)
def test_passage_numbers_said_in_words_are_cut(text, expected):
    from app.core.agent_runtime.check.text import without_source_phrases

    assert without_source_phrases(text) == expected


class TestMoreTimeAfterAWrite:
    """A run that has booked or changed something gets 4 s more (chunk 8a): a
    reschedule is a cancel, a booking and a reply."""

    def test_the_cap_grows_only_after_a_write(self):
        import time

        from app.core.agent_runtime.budget import run_cap, time_left
        from app.core.config import settings

        base = settings.AGENT_RUNTIME.RUN_TIMEOUT_SECONDS
        extra = settings.AGENT_RUNTIME.RUN_WRITE_EXTRA_SECONDS
        found = {"tool_calls": [{"ok": True, "list_kind": "find"}]}
        booked = {"tool_calls": [{"ok": True, "list_kind": "create"}]}
        refused = {"tool_calls": [{"ok": False, "list_kind": "create"}]}
        assert run_cap(found) == base
        assert run_cap(refused) == base
        assert run_cap(booked) == base + extra
        assert base + extra < 25  # inside ally-be's wait for one attempt
        started = {"started_at": time.time() - 10, **booked}
        assert base + extra - 11 < time_left(started) <= base + extra - 10

    @pytest.mark.asyncio
    async def test_a_write_moves_the_deadline_later_never_earlier(self, monkeypatch):
        import asyncio
        import time

        from app.core.agent_runtime.budget import RUN_DEADLINE, extend_after_write
        from app.core.config import settings

        # 0 by default since chunk H1; the mechanism still works when configured.
        monkeypatch.setattr(settings.AGENT_RUNTIME, "RUN_WRITE_EXTRA_SECONDS", 4.0)

        async with asyncio.timeout(20) as cap:
            RUN_DEADLINE.set(cap)
            before = cap.when()
            extend_after_write(time.time())
            assert cap.when() > before
            later = cap.when()
            extend_after_write(time.time() - 100)  # would be earlier: ignored
            assert cap.when() == later


class TestSystemChannel:
    """Chunk 6b: the system prompt's first line names the run's channel; on WhatsApp
    it's exactly what it was, and nothing else in the prompt changes."""

    BEFORE = (
        "You are the assistant described above, chatting with someone over WhatsApp "
        "on behalf of the organisation that runs you."
    )

    def test_whatsapp_is_byte_identical_to_before(self):
        whatsapp = prompt_for(make_bot(channel="whatsapp"))
        assert self.BEFORE in whatsapp

    def test_other_channels_change_only_those_words(self):
        whatsapp = prompt_for(make_bot(channel="whatsapp"))
        web = prompt_for(make_bot(channel="web"))
        test = prompt_for(make_bot(channel="test"))
        assert "chatting with someone on the website on behalf" in web
        assert "chatting with someone in this chat on behalf" in test
        assert web.replace("on the website", "over WhatsApp", 1) == whatsapp
        assert test.replace("in this chat", "over WhatsApp", 1) == whatsapp

    def test_the_seed_differs_from_before_only_in_the_channel(self):
        from pathlib import Path

        seed = Path("app/prompts/agent/system.txt").read_text()
        assert seed.replace("{channel}", "over WhatsApp", 1).startswith(self.BEFORE)
        assert seed.count("{channel}") == 1
