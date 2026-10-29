"""The Improver's analysis step: read a window of aggregate signals about the
Debrief agent and propose what to change.

It sees aggregates, the live prompt texts it may propose edits to, and its own
idea history — never a transcript, and never the judge's or Evaluator's
instructions (ally-be does not send them). Every idea it returns is only a
proposal: ally-be screens it on the test sets and a person approves anything
that would reach learners.
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Literal, Optional, Tuple

from pydantic import BaseModel, Field

IdeaKind = Literal[
    # A. things it can try itself, through the experiment ladder
    "prompt_edit",
    "setting",
    # B. needs a code change: goes to Builder, a person merges
    "needs_code",
    # C. a defect: goes to Bug Hunter
    "defect",
    # D. needs a person's judgement (clinical, product)
    "needs_person",
]


class ImproverIdea(BaseModel):
    kind: IdeaKind
    title: str = Field(description="At most 12 words.")
    hypothesis: str = Field(description="What will improve, and why, in two sentences.")
    evidence: str = Field(
        description="Which signals, with their numbers, point to this."
    )
    prompt_code: Optional[str] = Field(
        default=None, description="prompt_edit only: the prompt to change."
    )
    find: Optional[str] = Field(
        default=None,
        description="prompt_edit only: an exact passage of that prompt's current text.",
    )
    replace: Optional[str] = Field(
        default=None, description="prompt_edit only: what replaces it."
    )
    setting_key: Optional[str] = Field(
        default=None, description="setting only: e.g. max_revision_rounds."
    )
    setting_value: Optional[str] = None
    expected_effect: str = Field(
        description="The measure it should move and roughly by how much."
    )


class ImproverAnalysis(BaseModel):
    report: str = Field(
        description="The weekly report for people: plain words, at most 300 words."
    )
    ideas: List[ImproverIdea] = Field(default_factory=list)


DEFAULT_IMPROVER_SYSTEM = """\
You are the Improver. Your job is to make the debriefs Ally writes after \
practice roleplays better over time, measured by the independent judge's \
score (bar: 8 out of 10 with no hard fail), safety, cost and speed.

You get aggregate SIGNALS from recent debrief runs, the CURRENT PROMPTS you \
may propose edits to, the SETTINGS you may propose changes to, and your IDEA \
HISTORY with what happened to each idea. You never see transcripts.

Write a short report for the team: what changed since last time, what is \
holding scores down, and what you are trying next. Then propose at most 5 \
ideas, the most valuable first. Each idea must be backed by a number in the \
signals. Do not repeat an idea that was rejected or failed unless the \
signals have changed, and say what changed.

Kinds:
- prompt_edit: replace one exact passage of one current prompt. The find \
text must appear in that prompt exactly.
- setting: change one of the listed settings.
- needs_code: something only a code change can fix.
- defect: something looks broken.
- needs_person: a clinical or product question for a person.

Never propose weakening a safety rule, the quote checks, the evaluation, or \
the risk-cue path.\
"""


def build_prompt(
    signals: Dict[str, Any],
    prompts: Dict[str, str],
    settings_: Dict[str, Any],
    history: List[Dict[str, Any]],
    system: Optional[str] = None,
) -> str:
    def block(tag: str, value: Any) -> str:
        return f"<{tag}>\n{json.dumps(value, ensure_ascii=False, indent=1)}\n</{tag}>"

    return "\n\n".join(
        [
            system or DEFAULT_IMPROVER_SYSTEM,
            block("signals", signals),
            block("current_prompts", prompts),
            block("settings", settings_),
            block("idea_history", history),
        ]
    )


async def analyse_signals(
    signals: Dict[str, Any],
    prompts: Dict[str, str],
    settings_: Dict[str, Any],
    history: List[Dict[str, Any]],
    model: str,
    system: Optional[str] = None,
) -> Tuple[Optional[ImproverAnalysis], str]:
    from app.core.llm.dispatch import PROVIDER_GEMINI, generate_structured
    from app.core.llm_usage.tasks import LLMTask

    output, meta = await generate_structured(
        schema=ImproverAnalysis,
        prompt=build_prompt(signals, prompts, settings_, history, system),
        task=LLMTask.DEBRIEF_IMPROVER.value,
        provider=PROVIDER_GEMINI,
        never_fallback=True,
        model=model,
        temperature=0,
        max_tokens=None,
    )
    if output is None:
        return None, meta["model"]
    # An edit whose passage is not in the prompt cannot be applied; keep the
    # idea visible to people but turn it into a question rather than drop it.
    for idea in output.ideas:
        if idea.kind == "prompt_edit" and (
            not idea.prompt_code
            or idea.prompt_code not in prompts
            or not idea.find
            or idea.find not in prompts[idea.prompt_code]
            or idea.replace is None
        ):
            idea.kind = "needs_person"
    output.ideas = output.ideas[:5]
    return output, meta["model"]
