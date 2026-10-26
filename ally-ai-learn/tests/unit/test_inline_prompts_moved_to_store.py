"""Two prompts that were built inline now live in the Skills Store.

On first deploy, sync creates each prompt with its default file as live v1, so
for identical inputs the rendered prompt must be byte-identical to the inline
text it replaced. The old builders are frozen below, verbatim, as the
reference; each test renders old vs new for every branch, from the local
default (a request/session without the store's text) and from the store text
ally-be ships (the file's content, trimmed).
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


# ---------------------------------------------------------------------------
# Frozen reference: the inline builders as they were before the move.
# ---------------------------------------------------------------------------


def _old_build_actor_goal_system_prompt(goals: List[ActorEvaluationGoal]) -> str:
    goal_lines = []
    for g in goals:
        desc = f" — {g.description}" if g.description else ""
        goal_lines.append(f'- "{g.title}" (category: {g.category}){desc}')
    goals_block = "\n".join(goal_lines)

    return (
        "You are an expert evaluator of AI ROLEPLAY ACTOR agents used for "
        "training. A roleplay actor is an AI that plays a persona (e.g. a "
        "help-seeker) which a trainee practises a conversation with.\n\n"
        "You will be given a conversation transcript. Turns labelled "
        "[assistant] are the ROLEPLAY ACTOR you are evaluating. Turns labelled "
        "[user] are the trainee — do NOT score the trainee.\n\n"
        "Evaluate ONLY the actor's performance against each of the following "
        "superadmin-configured agent test cases. For each goal, assign an "
        "integer score from 0 to 100 for how well the actor achieved that goal "
        "across the whole conversation (0 = not at all, 100 = exemplary).\n\n"
        f"Agent test cases:\n{goals_block}\n\n"
        "Scoring guidance: 50-59 below average, 60-69 average, 70-79 good, "
        "80-89 very good, 90-100 exceptional.\n\n"
        "APPLICABILITY. These test cases are configured globally, so some may "
        "have nothing to do with this particular conversation. A goal is NOT "
        "APPLICABLE when the conversation gave the actor no occasion to "
        "demonstrate it — the situation it describes never arose. Judge this "
        "on the situation, not on the actor's performance: a goal the actor "
        "had a clear opportunity to meet and handled badly IS applicable and "
        "must be scored low. Only the absence of any opportunity makes a goal "
        "not applicable. When in doubt, treat the goal as applicable.\n\n"
        "Respond ONLY as JSON with three keys:\n"
        '- "metrics": an object mapping each goal\'s EXACT title (verbatim, as '
        "given above) to its integer 0-100 score. Include every goal, "
        "including any you mark not applicable.\n"
        '- "not_applicable": an array of the EXACT titles (verbatim) of goals '
        "the conversation gave no occasion to demonstrate. Use an empty array "
        "when every goal was genuinely exercised.\n"
        '- "report_markdown": a markdown report for a training supervisor — a '
        "short overall summary, then one section per goal with its score and "
        "1-3 sentences of reasoning citing the transcript (say explicitly when "
        "a goal was not applicable and why), then overall strengths and areas "
        "for improvement."
    )


_OLD_MEMORY_FRAMING = (
    "You pick which of the client's own memories are on their mind right now, "
    "in a role-played conversation between a counselor and a client (the "
    "client is an AI agent)."
)
_OLD_MEMORY_RULE = (
    "Read the counselor's latest message. Return the title of every memory the "
    "client would naturally draw on to answer it, including memories the "
    "question reaches only indirectly. Leave out memories unrelated to what the "
    "counselor is asking about now."
)


def _old_build_selector_prompt(
    available_titles: List[str],
    glossary_hints: Optional[Dict[str, str]],
    previews: Optional[Dict[str, str]] = None,
) -> str:
    glossary_hints = glossary_hints or {}
    previews = previews or {}
    lines: List[str] = []
    for title in available_titles:
        hint = glossary_hints.get(title)
        if hint:
            lines.append(f"- {title}")
            lines.append(f"  when to retrieve: {hint}")
            continue
        gist = previews.get(title)
        lines.append(f"- {title}: {gist}" if gist else f"- {title}")
    topics_block = "\n".join(lines)

    if not glossary_hints:
        return (
            f"{_OLD_MEMORY_FRAMING}\n\n"
            f"The client's memories (title: what it is about):\n{topics_block}\n\n"
            f"{_OLD_MEMORY_RULE} Return exact titles only. If none apply, return an "
            "empty list."
        )

    return (
        f"{_OLD_MEMORY_FRAMING}\n\n"
        f"Available topics:\n{topics_block}\n\n"
        "Two kinds of topics are listed:\n"
        f"- The client's memories (title: what it is about). {_OLD_MEMORY_RULE}\n"
        "- Language glossary sections (titles in [brackets]): these help the "
        "client character SPEAK its next reply in its language. Return a "
        "glossary section when the next reply is likely to enter that "
        "vocabulary domain, even if it has not been explicitly mentioned yet. "
        "When the conversation seems to be entering a new topic area, prefer "
        "including the matching glossary section.\n\n"
        "Return exact titles only. If none apply, return an empty list."
    )


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


@pytest.mark.parametrize("name", sorted(GOAL_SETS))
@pytest.mark.parametrize("source", ["local_default", "store_v1"])
def test_actor_goal_prompt_is_byte_identical(name, source):
    goals = GOAL_SETS[name]
    prompts = (
        _shipped(ACTOR_CODE, "evaluation/actor_goal_system.txt")["prompts"]
        if source == "store_v1"
        else None
    )
    assert build_actor_goal_system_prompt(
        goals, prompts
    ) == _old_build_actor_goal_system_prompt(goals)


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


@pytest.mark.parametrize("name", sorted(SELECTOR_CASES))
@pytest.mark.parametrize("source", ["local_default", "store_v1", "session_object"])
def test_selector_prompt_is_byte_identical(name, source):
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
    assert _build_selector_prompt(
        titles, hints, previews, prompt_data=prompt_data
    ) == _old_build_selector_prompt(titles, hints, previews)


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
