"""Two prompts that were built inline now live in the Skills Store.

Production runs each prompt's live text from the store; the `.txt` default is a
minimal base a fresh clone runs on. These tests check the base keeps what the
code depends on (its placeholder and the JSON keys the judge's schema reads),
that each builder renders the default (or the store's text) with the block it
builds, and that the store's text, model and cache key are used.
"""

from pathlib import Path
from typing import Dict, List, Optional
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from langchain_core.messages import HumanMessage

from app.core.graph.knowledge_retrieval import (
    RelevantKeys,
    _build_selector_prompt,
    retrieve_relevant_knowledge,
)
from app.core.scenario_session_evaluation.evaluator import (
    ActorGoalEvaluationResult,
    build_actor_goal_system_prompt,
    evaluate_actor_goals,
)
from app.core.scenario_session_evaluation.schemas import (
    ActorEvaluationGoal,
    ActorEvaluationRequest,
    ActorEvaluationTurn,
)

PROMPTS_DIR = Path(__file__).resolve().parents[2] / "app" / "prompts"

ACTOR_CODE = "ally_ai_learn_evaluation_actor_goal_system"
MEMORY_CODE = "ally_ai_learn_retrieval_memory_selector_system"
GLOSSARY_CODE = "ally_ai_learn_retrieval_memory_glossary_selector_system"


def _shipped(code: str, rel_path: str) -> dict:
    """The store map ally-be sends on first deploy: the default, trimmed."""
    text = (PROMPTS_DIR / rel_path).read_text(encoding="utf-8").strip()
    return {
        "prompts": {
            code: {
                "prompt": text,
                "availableVariables": (
                    [{"name": "goals_block", "required": True}]
                    if code == ACTOR_CODE
                    else [{"name": "topics_block", "required": True}]
                ),
                "version": 1,
            }
        }
    }


def _default(rel_path: str) -> str:
    return (PROMPTS_DIR / rel_path).read_text(encoding="utf-8").strip()


@pytest.mark.parametrize(
    "rel_path, literals",
    [
        (
            "evaluation/actor_goal_system.txt",
            [
                "{goals_block}",
                '"metrics"',
                '"not_applicable"',
                '"report_markdown"',
                "EXACT title",
                "[assistant]",
            ],
        ),
        ("retrieval/memory_selector_system.txt", ["{topics_block}", "exact titles"]),
        (
            "retrieval/memory_glossary_selector_system.txt",
            ["{topics_block}", "[brackets]", "exact titles"],
        ),
    ],
)
def test_default_keeps_what_the_code_depends_on(rel_path, literals):
    default = _default(rel_path)
    missing = [literal for literal in literals if literal not in default]
    assert not missing, f"{rel_path}: the default lost {missing}"


# ---------------------------------------------------------------------------
# Actor-goal judge
# ---------------------------------------------------------------------------

GOAL_SETS = {
    "one_goal_no_description": [
        ActorEvaluationGoal(id="1", title="Build rapport", category="Engagement")
    ],
    "mixed_descriptions": [
        ActorEvaluationGoal(
            id="1",
            title="Stays in character",
            category="Persona, Consistency",
            description="Never reveals it is an AI.",
        ),
        ActorEvaluationGoal(id="2", title="Gradual disclosure", category=""),
        ActorEvaluationGoal(
            id="3",
            title='Uses "colloquial" {speech}',
            category="Language",
            description="Speaks like a {real} person — not a textbook.\nTwo lines.",
        ),
    ],
    "unicode_and_braces": [
        ActorEvaluationGoal(
            id="x",
            title="மனசு சரியில்ல {0}",
            category="ta",
            description="{goals_block} must stay literal",
        )
    ],
}


def _goals_block(goals: List[ActorEvaluationGoal]) -> str:
    return "\n".join(
        f'- "{g.title}" (category: {g.category})'
        + (f" — {g.description}" if g.description else "")
        for g in goals
    )


@pytest.mark.parametrize("name", sorted(GOAL_SETS))
@pytest.mark.parametrize("source", ["local_default", "store_v1"])
def test_actor_goal_prompt_renders_the_default_with_every_goal(name, source):
    goals = GOAL_SETS[name]
    prompts = (
        _shipped(ACTOR_CODE, "evaluation/actor_goal_system.txt")["prompts"]
        if source == "store_v1"
        else None
    )
    # Braces in goal titles and descriptions pass through untouched.
    assert build_actor_goal_system_prompt(goals, prompts) == _default(
        "evaluation/actor_goal_system.txt"
    ).replace("{goals_block}", _goals_block(goals))


def test_actor_goal_prompt_runs_the_store_text():
    goals = GOAL_SETS["one_goal_no_description"]
    prompts = {ACTOR_CODE: {"prompt": "STORE v2\n{goals_block}"}}
    assert (
        build_actor_goal_system_prompt(goals, prompts)
        == 'STORE v2\n- "Build rapport" (category: Engagement)'
    )


def test_actor_evaluation_request_carries_prompts():
    request = ActorEvaluationRequest(
        scenario_session_id="s",
        transcript=[],
        goals=[],
        prompts={ACTOR_CODE: {"prompt": "X {goals_block}"}},
    )
    assert request.prompts[ACTOR_CODE]["prompt"] == "X {goals_block}"
    assert (
        ActorEvaluationRequest(scenario_session_id="s", transcript=[], goals=[]).prompts
        is None
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "entry, expected_model, expected_temperature",
    [
        ({"prompt": "STORE {goals_block}"}, None, None),
        (
            {
                "prompt": "STORE {goals_block}",
                "model": "gpt-4.1-mini",
                "temperature": 0.2,
            },
            "gpt-4.1-mini",
            0.2,
        ),
        # The judge runs on OpenAI json_mode: a non-OpenAI model is ignored.
        (
            {
                "prompt": "STORE {goals_block}",
                "provider": "google",
                "model": "gemini-x",
            },
            None,
            None,
        ),
    ],
)
async def test_judge_runs_the_store_text_and_model(
    entry, expected_model, expected_temperature
):
    captured = {}

    class _Structured:
        async def ainvoke(self, messages):
            captured["messages"] = messages
            return ActorGoalEvaluationResult(metrics={"Build rapport": 80})

    llm = MagicMock()
    llm.with_structured_output.return_value = _Structured()
    with patch(
        "app.core.scenario_session_evaluation.evaluator._build_evaluator_llm",
        return_value=llm,
    ) as build:
        await evaluate_actor_goals(
            [ActorEvaluationTurn(role="assistant", content="hi")],
            GOAL_SETS["one_goal_no_description"],
            prompts={ACTOR_CODE: entry},
        )

    assert build.call_args.args == (expected_model, expected_temperature)
    assert captured["messages"][0]["content"] == (
        'STORE - "Build rapport" (category: Engagement)'
    )


@pytest.mark.asyncio
async def test_service_forwards_the_requests_prompts():
    from app.core.scenario_session_evaluation import service

    prompts = {ACTOR_CODE: {"prompt": "X {goals_block}"}}
    request = ActorEvaluationRequest(
        scenario_session_id="s", transcript=[], goals=[], prompts=prompts
    )
    judge = AsyncMock(
        return_value={"metrics": {}, "not_applicable": [], "report_markdown": ""}
    )
    with (
        patch.object(service, "evaluate_actor_goals", judge),
        patch.object(service, "_send_webhook", AsyncMock()),
    ):
        await service.run_actor_evaluation(request)
    assert judge.await_args.kwargs["prompts"] == prompts


# ---------------------------------------------------------------------------
# Knowledge (memory / glossary) selector
# ---------------------------------------------------------------------------

GLOSSARY_TITLE = "[Tamil (India) glossary] Clinical terms"

SELECTOR_CASES = {
    "memories_with_previews": (
        ["school memories", "family dynamics"],
        None,
        {"school memories": "Bullied in 8th grade", "family dynamics": "Parents…"},
    ),
    "memories_without_previews": (["only a title {x}"], None, None),
    "memories_some_previews": (
        ["a", "b", "c"],
        {},
        {"b": "gist of {b}"},
    ),
    "glossary_and_memories": (
        ["school memories", GLOSSARY_TITLE, "family dynamics"],
        {GLOSSARY_TITLE: "Retrieve when the reply turns toward diagnosis"},
        {"school memories": "Bullied in 8th grade"},
    ),
    "glossary_only": (
        [GLOSSARY_TITLE, "[Tamil (India) glossary] Emotions"],
        {
            GLOSSARY_TITLE: "diagnosis {topics_block}",
            "[Tamil (India) glossary] Emotions": "feelings",
        },
        None,
    ),
}


def _selector_store(glossary: bool) -> dict:
    if glossary:
        return _shipped(GLOSSARY_CODE, "retrieval/memory_glossary_selector_system.txt")
    return _shipped(MEMORY_CODE, "retrieval/memory_selector_system.txt")


def _topics_block(
    titles: List[str],
    hints: Optional[Dict[str, str]],
    previews: Optional[Dict[str, str]],
) -> str:
    lines: List[str] = []
    for title in titles:
        hint = (hints or {}).get(title)
        if hint:
            lines += [f"- {title}", f"  when to retrieve: {hint}"]
            continue
        gist = (previews or {}).get(title)
        lines.append(f"- {title}: {gist}" if gist else f"- {title}")
    return "\n".join(lines)


@pytest.mark.parametrize("name", sorted(SELECTOR_CASES))
@pytest.mark.parametrize("source", ["local_default", "store_v1", "session_object"])
def test_selector_prompt_renders_its_variants_default(name, source):
    titles, hints, previews = SELECTOR_CASES[name]
    prompt_data = None
    if source == "store_v1":
        prompt_data = _selector_store(bool(hints))
    elif source == "session_object":
        # Both prompts shipped, on an object with .prompts (scenario.prompt_data).
        prompt_data = MagicMock()
        prompt_data.prompts = {
            **_selector_store(False)["prompts"],
            **_selector_store(True)["prompts"],
        }
    rel_path = (
        "retrieval/memory_glossary_selector_system.txt"
        if hints
        else "retrieval/memory_selector_system.txt"
    )
    assert _build_selector_prompt(
        titles, hints, previews, prompt_data=prompt_data
    ) == _default(rel_path).replace(
        "{topics_block}", _topics_block(titles, hints, previews)
    )


def test_selector_runs_the_store_text_for_its_variant():
    data = {
        "prompts": {
            MEMORY_CODE: {"prompt": "MEM v2\n{topics_block}"},
            GLOSSARY_CODE: {"prompt": "GLOSS v2\n{topics_block}"},
        }
    }
    assert (
        _build_selector_prompt(["a"], None, {"a": "x"}, prompt_data=data)
        == "MEM v2\n- a: x"
    )
    assert (
        _build_selector_prompt(["g"], {"g": "h"}, None, prompt_data=data)
        == "GLOSS v2\n- g\n  when to retrieve: h"
    )


class _CapturingClient:
    def __init__(self):
        self.messages = []
        outer = self

        class _Structured:
            async def ainvoke(self, messages):
                outer.messages.append(messages)
                return RelevantKeys(titles=[])

        class _Instance:
            def with_structured_output(self, schema, **_kwargs):
                return _Structured()

        self.llm_instance = _Instance()


@pytest.mark.asyncio
async def test_retrieval_sends_the_sessions_store_text_and_keys_cache_on_it():
    knowledge_map = {"store probe memory": "content"}
    messages = [HumanMessage(content="store-text cache probe")]

    v1 = _CapturingClient()
    await retrieve_relevant_knowledge(
        v1,
        messages,
        knowledge_map,
        prompt_data={"prompts": {MEMORY_CODE: {"prompt": "V1 {topics_block}"}}},
    )
    assert v1.messages[0][0].content == "V1 - store probe memory: content"

    # Same conversation, a newer live version: not served from the cache.
    v2 = _CapturingClient()
    await retrieve_relevant_knowledge(
        v2,
        messages,
        knowledge_map,
        prompt_data={"prompts": {MEMORY_CODE: {"prompt": "V2 {topics_block}"}}},
    )
    assert v2.messages[0][0].content == "V2 - store probe memory: content"
