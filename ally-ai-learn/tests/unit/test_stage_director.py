"""Stage Director prompts: the opt-in, memories without retrieval, and the director.

The claims being defended (docs/stage-director-and-memories.md):

- declaring `{thoughts}` is the whole opt-in, and it turns working memory OFF;
- every unlocked memory is in the prompt every turn; a locked one shows its
  title only, with the rule to deflect rather than invent;
- unlocking is sticky, so a score dropping back never hides a memory again;
- a scenario switched before its memories were mapped keeps its Knowledge
  Sources rather than starting with none;
- the director's paragraph reaches the prompt as written, and a miss keeps the
  previous one;
- retrieval never picks Knowledge Sources for these prompts.
"""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from langchain_core.messages import AIMessage, HumanMessage

from app.core.graph.knowledge_locks import KnowledgeUnlockTracker
from app.core.graph.prompt import (
    _get_selected_prompt_has_states,
    generate_system_message,
    prompt_declares_client_working_memory,
    prompt_declares_stage_director,
)
from app.core.scenario.base import PromptData
from app.core.stage_director.director import (
    NO_THOUGHT_YET,
    StageDirectorStore,
    copies_client_words,
    near_repeat,
    schedule_thought,
)
from app.core.stage_director.memories import (
    AVAILABLE_HEADING,
    NO_MEMORIES,
    partition_for_turn,
    render_memory_block,
    session_memories,
)

pytestmark = pytest.mark.unit

CODE = "ally_ai_learn_system_main_agent_prompt_stage_director"
BODY = """You are {name}.
MEMORIES_START
{memories}
MEMORIES_END
STAGE: {state_x_guidelines}
THOUGHTS_START
{thoughts}
THOUGHTS_END
"""
STATES = [
    {"id": "s1", "name": "Guarded", "scoreLower": -100, "scoreUpper": 50},
    {"id": "s2", "name": "Opening up", "scoreLower": 50, "scoreUpper": 150},
]


def _prompt_data(**overrides):
    base = dict(
        name="Manoj",
        role_instructions="Act only as the client.",
        character_profile_text="Unmarried. Works in a factory.",
        opening_statements=["Hi"],
        custom_fields=[],
        states=STATES,
        selected_main_prompt_code=CODE,
        prompts={
            CODE: {
                "prompt": BODY,
                "availableVariables": [
                    "name",
                    "memories",
                    "state_x_guidelines",
                    "thoughts",
                ],
            }
        },
        memories=[
            {"id": "m1", "title": "Marriage", "content": "Family sends biodata."},
            {
                "id": "m2",
                "title": "My father",
                "content": "He drank every night.",
                "unlocksFromStateId": "s2",
            },
        ],
    )
    base.update(overrides)
    return PromptData(**base)


def _ns(*variables):
    return SimpleNamespace(
        selected_main_prompt_code="c",
        prompts={"c": {"availableVariables": list(variables)}},
    )


class TestOptIn:
    def test_thoughts_is_the_opt_in(self):
        assert prompt_declares_stage_director(_ns("thoughts"))
        assert not prompt_declares_stage_director(_ns("working_memory_stance"))

    def test_it_is_not_working_memory(self):
        # So the updater, its store and its interim stay off on their own.
        assert not prompt_declares_client_working_memory(_ns("thoughts", "memories"))

    def test_it_resolves_states(self):
        # Locks and state guidance both need the active state.
        assert _get_selected_prompt_has_states(_ns("thoughts"))


class TestMemoryBlock:
    def test_unlocked_memories_render_in_full_and_locked_by_title(self):
        unlocked = [{"title": "Marriage", "content": "Family sends biodata."}]
        locked = [{"title": "My father", "content": "He drank every night."}]
        block = render_memory_block(unlocked, locked)
        assert AVAILABLE_HEADING in block
        assert "- Marriage: Family sends biodata." in block
        assert "My father" in block
        assert "Never make something up" in block
        assert "drank" not in block

    def test_no_memories_is_a_named_absence(self):
        assert NO_MEMORIES in render_memory_block([], [])

    def test_no_locked_rule_without_locked_memories(self):
        assert "aren't ready" not in render_memory_block([{"title": "A"}], [])

    def test_memories_win_over_knowledge_sources(self):
        pd = SimpleNamespace(
            memories=[{"title": "M"}], knowledge_sources=[{"title": "K"}]
        )
        assert [m["title"] for m in session_memories(pd)] == ["M"]

    def test_unmapped_scenario_falls_back_to_knowledge_sources(self):
        pd = SimpleNamespace(memories=None, knowledge_sources=[{"title": "K"}])
        assert [m["title"] for m in session_memories(pd)] == ["K"]

    def test_unlock_is_sticky(self):
        pd = _prompt_data()
        tracker = KnowledgeUnlockTracker()
        unlocked, locked = partition_for_turn(pd, STATES[0], tracker)
        assert [m["id"] for m in locked] == ["m2"]
        unlocked, locked = partition_for_turn(pd, STATES[1], tracker)
        assert {m["id"] for m in unlocked} == {"m1", "m2"}
        # Score drops back to the first state: the father memory stays.
        unlocked, locked = partition_for_turn(pd, STATES[0], tracker)
        assert {m["id"] for m in unlocked} == {"m1", "m2"} and not locked

    def test_a_memory_unlocks_at_any_of_its_states(self):
        three = STATES + [
            {"id": "s3", "name": "Trusting", "scoreLower": 150, "scoreUpper": 200}
        ]
        pd = _prompt_data(
            states=three,
            memories=[
                {"id": "a", "title": "A", "unlocksInStateIds": []},
                {"id": "b", "title": "B", "unlocksInStateIds": ["s1", "s3"]},
                {"id": "c", "title": "C", "unlocksInStateIds": ["s2"]},
                {"id": "d", "title": "D", "unlocksInStateIds": ["gone"]},
            ],
        )
        tracker = KnowledgeUnlockTracker()
        unlocked, locked = partition_for_turn(pd, three[0], tracker)
        assert [m["id"] for m in unlocked] == ["a", "b"]
        assert [m["id"] for m in locked] == ["c", "d"]
        # Jumping straight past s2 does not unlock a memory picked for s2 only.
        unlocked, _ = partition_for_turn(pd, three[2], tracker)
        assert "c" not in {m["id"] for m in unlocked}
        unlocked, locked = partition_for_turn(pd, three[1], tracker)
        assert [m["id"] for m in unlocked] == ["a", "b", "c"]
        assert [m["id"] for m in locked] == ["d"]

    def test_older_single_state_lock_still_means_that_state_and_above(self):
        three = STATES + [
            {"id": "s3", "name": "Trusting", "scoreLower": 150, "scoreUpper": 200}
        ]
        pd = _prompt_data(states=three)
        unlocked, _ = partition_for_turn(pd, three[2], KnowledgeUnlockTracker())
        assert {m["id"] for m in unlocked} == {"m1", "m2"}


class TestPromptRendering:
    def test_thoughts_and_memories_reach_the_prompt_and_the_sink(self):
        sink: dict = {}
        msg, _ = generate_system_message(
            prompt_data=_prompt_data(),
            behavior_instructions=[],
            current_score=0,
            thoughts="I am wary of this counsellor.",
            memories="BLOCK",
            prompt_kwargs_sink=sink,
        )
        text = msg.content
        assert "THOUGHTS_START\nI am wary of this counsellor.\nTHOUGHTS_END" in text
        assert "MEMORIES_START\nBLOCK\nMEMORIES_END" in text
        assert sink["thoughts"] == "I am wary of this counsellor."
        assert sink["role_instructions"] == "Act only as the client."

    def test_empty_stage_guidance_is_named(self):
        msg, _ = generate_system_message(
            prompt_data=_prompt_data(states=[]),
            behavior_instructions=[],
            current_score=0,
            thoughts=NO_THOUGHT_YET,
            memories="BLOCK",
        )
        assert "STAGE: \n" not in msg.content


class TestDirectorHelpers:
    def test_copy_check(self):
        msgs = [AIMessage(content="people say things everyone says at home")]
        assert copies_client_words(
            "I keep thinking people say things everyone says", msgs
        )
        assert not copies_client_words("I am tired and want to go home now", msgs)

    def test_near_repeat(self):
        assert near_repeat(
            "I am worried about my job", "I am worried about my job today"
        )
        assert not near_repeat("My job worry is settled now", "I am angry at my father")

    def test_store_turns_old(self):
        store = StageDirectorStore()
        assert store.turns_old() is None
        assert store.thought_for_prompt() == NO_THOUGHT_YET
        store.begin_turn()
        store.written_after_turn = 0
        store.begin_turn()
        assert store.turns_old() == 1


def _llm(reply):
    llm = SimpleNamespace(llm_instance=MagicMock(), provider="openai")
    if isinstance(reply, Exception):
        llm.llm_instance.ainvoke = AsyncMock(side_effect=reply)
    else:
        llm.llm_instance.ainvoke = AsyncMock(return_value=AIMessage(content=reply))
    return llm


class TestScheduleThought:
    async def _run(self, store, llm, record=None):
        msgs = [
            HumanMessage(content="Will my employer know?"),
            AIMessage(content="I worry."),
        ]
        assert schedule_thought(
            store,
            prompt_data=_prompt_data(),
            messages=msgs,
            llm_client=llm,
            timeout=5,
            current_state="Guarded",
            record_store=record,
        )
        await store._task

    async def test_a_thought_is_stored_as_written_and_recorded(self):
        store = StageDirectorStore()
        store.begin_turn()
        record = SimpleNamespace(monologue=[])
        await self._run(
            store,
            _llm('  "They said my employer won\'t know. That can rest."  '),
            record,
        )
        assert store.thought == "They said my employer won't know. That can rest."
        assert store.written_after_turn == 0
        assert record.monologue[-1]["mode"] == "stage_director"
        assert record.monologue[-1]["thought"] == store.thought

    async def test_a_miss_keeps_the_previous_thought(self):
        store = StageDirectorStore()
        store.thought = "Earlier thought."
        store.begin_turn()
        record = SimpleNamespace(monologue=[])
        await self._run(store, _llm(RuntimeError("boom")), record)
        assert store.thought == "Earlier thought."
        assert store.thoughts_missed == 1
        assert record.monologue[-1]["missed"] is True

    async def test_the_prompt_offers_main_prompt_variables(self):
        store = StageDirectorStore()
        store.begin_turn()
        store.prompt_kwargs = {"character_backstory": "BACKSTORY_X", "thoughts": "x"}
        llm = _llm("Fine.")
        await self._run(store, llm)
        system = llm.llm_instance.ainvoke.call_args.args[0][0].content
        assert "BACKSTORY_X" in system
        assert "Will my employer know?" in system

    async def test_one_in_flight_at_a_time(self):
        store = StageDirectorStore()
        store.begin_turn()
        store._task = asyncio.get_running_loop().create_future()
        assert not schedule_thought(
            store,
            prompt_data=_prompt_data(),
            messages=[],
            llm_client=_llm("x"),
            timeout=1,
        )
        store._task.cancel()


class TestRetrievalSkipsKnowledgeSources:
    async def test_no_picker_call_for_stage_director_prompts(self):
        from app.core.graph.nodes import retrieve_knowledge

        pd = _prompt_data(
            knowledge_sources=[{"id": "k", "title": "Job", "content": "x"}]
        )
        config = {
            "configurable": {
                "scenario": SimpleNamespace(prompt_data=pd),
                "llm_client": _llm("x"),
            }
        }
        with patch(
            "app.core.graph.nodes.retrieve_relevant_knowledge", new=AsyncMock()
        ) as picker:
            state = SimpleNamespace(messages=[HumanMessage(content="hi")])
            result = await retrieve_knowledge(state, config)
        picker.assert_not_called()
        assert result.get("retrieved_context") in (None, "")


class TestInterimDefault:
    def _scenario(self, setting):
        pd = SimpleNamespace(
            selected_main_prompt_code="c",
            prompts={"c": {"availableVariables": ["thoughts"]}},
            interim_reply_setting=setting,
            interim_reply_enabled=bool(setting),
        )
        return SimpleNamespace(prompt_data=pd)

    def test_on_unless_switched_off(self, monkeypatch):
        from app.core.config import settings
        from app.core.livekit.interim_reply import is_interim_reply_enabled

        monkeypatch.setattr(settings, "INTERIM_REPLY_GLOBALLY_ENABLED", True)
        assert is_interim_reply_enabled(self._scenario(None))
        assert is_interim_reply_enabled(self._scenario(True))
        assert not is_interim_reply_enabled(self._scenario(False))
