"""The PM agent's tools: every one is a call to ally-be's gateway (spec C1, D5).

The agent has no other way to act, so ally-be's rules hold whatever the model
decides: a refusal (`{"refused": "<reason>"}`) or a gateway error comes back to the
model as a tool error it can read and react to, never as a crash of the run.
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Literal, Optional

from langchain_core.tools import BaseTool, StructuredTool, ToolException
from pydantic import BaseModel, Field

from app.core.debrief_graph.gateway import Gateway, GatewayError
from app.core.pm_agent.ledger import RunLedger
from app.core.pm_agent.quotes import strip_quotes

#: Tools that only read; the investigator and reviewer subagents get these (and
#: `session_read` in a conversation) and nothing else. `change_read` is how the
#: reviewer sees one proposed change and its evidence.
READ_TOOLS = (
    "reporting_query",
    "comments_read",
    "metrics_view",
    "guidance_report",
    "questions_read",
    "change_read",
    "prompt_read",
)
#: Tools that propose or request an action; main agent only.
ACTION_TOOLS = (
    "idea_propose",
    "release_draft",
    "ladder_start_quick_test",
    "builder_handoff",
    "bug_hunter_report",
    "person_ask",
    "guidance_propose",
    "question_answer",
)
#: The conversation's own tools (V2_AUTONOMY C2): reading one session, and acting
#: on changes for the person who asked. ally-be keeps every rule; an approval, a
#: turn-down and an always-ask retry pause the turn for the person's yes
#: (LangGraph human-in-the-loop, `conversation.INTERRUPT_ON`).
CONVERSATION_READ_TOOLS = ("session_read",)
CONVERSATION_ACTION_TOOLS = (
    "change_approve",
    "change_turn_down",
    "change_stop",
    "change_undo",
    "change_retry",
    "change_hold_language",
    "changes_pause",
)
CONVERSATION_TOOLS = (
    ("change_read", "prompt_read") + CONVERSATION_READ_TOOLS + CONVERSATION_ACTION_TOOLS
)
#: Every read-only tool; the only tools a subagent is ever given.
SUBAGENT_READ_TOOLS = READ_TOOLS + CONVERSATION_READ_TOOLS
#: What a weekly, monthly or questions run may be given.
RUN_TOOLS = READ_TOOLS + ACTION_TOOLS
ALL_TOOLS = RUN_TOOLS + CONVERSATION_READ_TOOLS + CONVERSATION_ACTION_TOOLS

#: Longest tool answer handed back to the model, in characters.
MAX_ANSWER_CHARS = 20_000


class ReportingQueryArgs(BaseModel):
    sql: str = Field(
        description="One read-only SELECT over the debrief_reporting views in the "
        "catalogue. No comments, no writes; rows are capped."
    )


class CommentsReadArgs(BaseModel):
    since: Optional[str] = Field(
        None, description="ISO date; only comments created after it."
    )
    status: Optional[Literal["open", "resolved"]] = None
    ids: Optional[List[str]] = Field(None, description="Specific comment ids.")
    limit: int = Field(100, ge=1, le=200)


class MetricsViewArgs(BaseModel):
    weeks: int = Field(8, ge=4, le=52)
    language: Optional[str] = Field(None, description="e.g. 'hi'; narrows every rate.")
    recipe: Optional[str] = Field(
        None, description="standard | short | case | assessment"
    )


class GuidanceReportArgs(BaseModel):
    days: int = Field(30, ge=1, le=90, description="How many days back to read.")
    mode: Optional[Literal["all", "live", "shadow"]] = Field(
        None, description="all (default) | live runs only | shadow runs only"
    )


class MetricRef(BaseModel):
    name: str = Field(description="A metric name from the metric failure points.")
    value: Optional[float] = None
    segment: Optional[str] = Field(None, description="e.g. 'language=hi'")


class Problem(BaseModel):
    title: str = Field(description="At most 12 words.")
    summary: str = Field(
        description="What is going wrong, in your own words. Never paste learner "
        "words or comment text."
    )
    comment_ids: List[str] = Field(default_factory=list)
    metrics: List[MetricRef] = Field(default_factory=list)


class ExpectedEffect(BaseModel):
    metric: str = Field(
        description="The metric this should move (a failure-point name)."
    )
    direction: Literal["up", "down"]
    by: Optional[float] = Field(None, description="Roughly how much, in its own units.")
    note: Optional[str] = None


class Confidence(BaseModel):
    """How sure you are that the change helps (V2_AUTONOMY A2)."""

    level: Literal["high", "low"] = Field(
        description="high: the evidence is strong and the change is small and "
        "clear. low: thin evidence, a guess, or a change with wide effects."
    )
    why: str = Field(description="One line in plain words: why that level.")


class IdeaProposeArgs(BaseModel):
    problem: Problem
    route: Literal["A", "B", "C", "D"] = Field(
        description="A: you change it (prompt, setting, registry agent). B: Builder "
        "(needs code). C: Bug Hunter (a defect). D: a person (rubric, safety, "
        "budgets, data access, clinical)."
    )
    title: str = Field(description="The idea, at most 12 words.")
    hypothesis: str = Field(description="What will improve and why, two sentences.")
    expected_effect: ExpectedEffect
    confidence: Confidence


class RegistryAgentManifest(BaseModel):
    id: str = Field(description="snake_case, e.g. protocol_check")
    description: str
    use_when: str
    skip_when: str
    prompt: str = Field(description="The agent's whole prompt text.")
    tools: List[str] = Field(default_factory=list)
    scopes: List[str] = Field(default_factory=list)
    eval_cases: int = Field(0, description="How many eval cases back it (at least 10).")
    model: Optional[str] = None


class ReleaseDraftArgs(BaseModel):
    idea_id: str
    kind: Literal["prompt_edit", "setting", "registry_agent"]
    prompt_code: Optional[str] = None
    find: Optional[str] = Field(
        None, description="prompt_edit: an exact passage of the prompt's current text."
    )
    replace: Optional[str] = None
    setting_key: Optional[str] = None
    setting_value: Optional[float] = None
    agent: Optional[RegistryAgentManifest] = None
    run_ids: List[str] = Field(
        default_factory=list,
        description="prompt_edit and registry_agent: the debrief run ids behind the "
        "change. With the runs behind the idea's comments they must cover at least "
        "10 learners in at least 3 organisations.",
    )
    confidence: Optional[Confidence] = Field(
        None,
        description="How sure you are now that the change is drafted; replaces "
        "the confidence you gave in idea_propose.",
    )


class IdeaRef(BaseModel):
    idea_id: str


class BuilderHandoffArgs(BaseModel):
    idea_id: str
    problem: str
    evidence_summary: str = Field(
        description="Numbers and comment counts only: no learner words or comment text."
    )
    expected_effect: str
    acceptance_checks: List[str] = Field(min_length=1)


class BugHunterReportArgs(BaseModel):
    idea_id: str
    summary: str = Field(
        description="What is broken against existing intent, no quotes."
    )
    run_ids: List[str] = Field(default_factory=list)
    repo: Optional[Literal["ally-be", "ally-ai", "ally-web", "ally-mobile"]] = None


class QuestionsReadArgs(BaseModel):
    """No arguments: every open question on the agent's ideas."""


class QuestionAnswerArgs(BaseModel):
    idea_id: str
    question_id: Optional[str] = Field(
        None, description="The question's id from questions_read."
    )
    answer: str = Field(
        description="Plain words, under 150 words: what you know, the numbers "
        "(with n) and ids behind it, and what you do not know yet. Never learner words."
    )


class PersonAskArgs(BaseModel):
    idea_id: str
    topic: Literal[
        "rubric", "safety", "budget", "data_access", "clinical", "product", "other"
    ]
    question: str
    context: str = ""


class GuidanceProposeArgs(BaseModel):
    """Route D: a Debrief Guidance entry drafted for the clinical advisor. Nothing
    is written to the Context Library; the advisor adds or edits it there."""

    idea_id: str
    action: Literal["new", "change"] = "new"
    existing_code: Optional[str] = Field(
        default=None, description="For a change: the entry's code, DG-…"
    )
    scope: Literal["platform", "organisation"] = "platform"
    title: str
    situation: str = Field(description="When it applies, in your own words.")
    guidance: str = Field(
        description="What a counsellor should do, written for a counsellor; never "
        "instructions to a model, never anyone's quoted words."
    )
    why: str = Field(default="", description="What the evidence shows.")
    run_ids: List[str] = Field(
        description="Debrief runs backing it: at least 10 learners (3 organisations "
        "when platform-wide)."
    )


class ChangeRef(BaseModel):
    idea_id: str = Field(description="The change's id (the idea id).")


class PromptRef(BaseModel):
    code: str = Field(
        description=(
            "A Debrief prompt code, e.g. debrief_risk_cue_definition, "
            "debrief_safety_reader_system, debrief_writer_system, "
            "debrief_quality_rubric, debrief_evaluator_system."
        )
    )


class SessionRef(BaseModel):
    run_id: str = Field(description="The debrief run id of the session.")


class ChangeApproveArgs(BaseModel):
    idea_id: str
    plan: str = Field(
        description="Exactly what will happen, in one or two plain sentences, as "
        "you will repeat it back to the person."
    )


class ChangeTurnDownArgs(BaseModel):
    idea_id: str
    reason: str = Field(description="Why, in the person's own terms.")
    plan: str = Field(description="Exactly what will happen, as you repeat it back.")


class ChangeLanguagesArgs(BaseModel):
    idea_id: str
    languages: Optional[List[str]] = Field(
        None,
        description="Language codes (e.g. ['hi']) when the person named some; "
        "leave out for every language.",
    )
    reason: str = Field("", description="Why, in the person's words.")
    plan: Optional[str] = Field(
        None,
        description="For a retry of a change that always asks a person: exactly "
        "what will happen, in one or two plain sentences, as you repeat it back.",
    )


class ChangeHoldLanguageArgs(BaseModel):
    idea_id: str
    language: str = Field(description="One language code, e.g. 'ta'.")
    reason: str = ""


class ChangesPauseArgs(BaseModel):
    kind: Literal["prompts", "settings", "code"] = Field(
        description="prompts: prompt and agent changes. settings: non-budget "
        "settings. code: Builder and Bug Hunter hand-offs."
    )
    until: str = Field(description="ISO date the pause ends (at most 90 days).")
    reason: str = ""


def text_leaves(value: Any, out: Optional[List[str]] = None) -> List[str]:
    """Every string in a tool's answer: what the turn's tools returned, for
    ally-be's quote check (a quote in the reply must be one of these, verbatim)."""
    out = [] if out is None else out
    if isinstance(value, str):
        if value.strip():
            out.append(value)
    elif isinstance(value, dict):
        for v in value.values():
            text_leaves(v, out)
    elif isinstance(value, (list, tuple)):
        for v in value:
            text_leaves(v, out)
    return out


def _answer(res: Dict[str, Any]) -> str:
    text = json.dumps(res, ensure_ascii=False, default=str)
    if len(text) > MAX_ANSWER_CHARS:
        text = text[:MAX_ANSWER_CHARS] + "… (truncated)"
    return text


def make_tools(
    gateway: Gateway, ledger: RunLedger, allowed: Optional[List[str]] = None
) -> List[BaseTool]:
    """The run's tools, bound to its gateway; only those the agent token lists."""

    async def call(name: str, body: Dict[str, Any]) -> str:
        try:
            res = await gateway.call(name, body)
        except GatewayError as e:
            raise ToolException(f"{name} failed: {e}") from e
        if isinstance(res, dict) and res.get("refused"):
            reason = str(res["refused"])
            ledger.refusals.append({"tool": name, "reason": reason})
            raise ToolException(f"Refused by ally-be: {reason}")
        if name == "idea_propose" and isinstance(res, dict) and res.get("idea_id"):
            ledger.idea_ids.append(str(res["idea_id"]))
        text_leaves(res, ledger.tool_texts)
        return _answer(res)

    async def reporting_query(**a: Any) -> str:
        return await call("reporting_query", ReportingQueryArgs(**a).model_dump())

    async def comments_read(**a: Any) -> str:
        return await call(
            "comments_read", CommentsReadArgs(**a).model_dump(exclude_none=True)
        )

    async def metrics_view(**a: Any) -> str:
        return await call(
            "metrics_view", MetricsViewArgs(**a).model_dump(exclude_none=True)
        )

    async def guidance_report(**a: Any) -> str:
        return await call(
            "guidance_report", GuidanceReportArgs(**a).model_dump(exclude_none=True)
        )

    async def idea_propose(**a: Any) -> str:
        return await call("idea_propose", IdeaProposeArgs(**a).model_dump())

    async def release_draft(**a: Any) -> str:
        return await call(
            "release_draft", ReleaseDraftArgs(**a).model_dump(exclude_none=True)
        )

    async def ladder_start_quick_test(**a: Any) -> str:
        return await call("ladder_start_quick_test", IdeaRef(**a).model_dump())

    async def builder_handoff(**a: Any) -> str:
        args = BuilderHandoffArgs(**a)
        body = args.model_dump()
        for k in ("problem", "evidence_summary", "expected_effect"):
            body[k] = strip_quotes(body[k])[0]
        body["acceptance_checks"] = [strip_quotes(c)[0] for c in args.acceptance_checks]
        return await call("builder_handoff", body)

    async def bug_hunter_report(**a: Any) -> str:
        body = BugHunterReportArgs(**a).model_dump(exclude_none=True)
        body["summary"] = strip_quotes(body["summary"])[0]
        return await call("bug_hunter_report", body)

    async def person_ask(**a: Any) -> str:
        return await call("person_ask", PersonAskArgs(**a).model_dump())

    async def guidance_propose(**a: Any) -> str:
        body = GuidanceProposeArgs(**a).model_dump(exclude_none=True)
        for key in ("situation", "guidance", "why"):
            body[key] = strip_quotes(body.get(key, ""))[0]
        return await call("guidance_propose", body)

    async def questions_read(**a: Any) -> str:
        return await call("questions_read", {})

    async def question_answer(**a: Any) -> str:
        body = QuestionAnswerArgs(**a).model_dump(exclude_none=True)
        # People read it in the Console; still, no learner words.
        body["answer"] = strip_quotes(body["answer"])[0]
        return await call("question_answer", body)

    async def change_read(**a: Any) -> str:
        return await call("change_read", ChangeRef(**a).model_dump())

    async def prompt_read(**a: Any) -> str:
        return await call("prompt_read", PromptRef(**a).model_dump())

    async def session_read(**a: Any) -> str:
        return await call("session_read", SessionRef(**a).model_dump())

    async def change_approve(**a: Any) -> str:
        return await call("change_approve", ChangeApproveArgs(**a).model_dump())

    async def change_turn_down(**a: Any) -> str:
        return await call("change_turn_down", ChangeTurnDownArgs(**a).model_dump())

    async def change_stop(**a: Any) -> str:
        return await call(
            "change_stop", ChangeLanguagesArgs(**a).model_dump(exclude_none=True)
        )

    async def change_undo(**a: Any) -> str:
        return await call(
            "change_undo", ChangeLanguagesArgs(**a).model_dump(exclude_none=True)
        )

    async def change_retry(**a: Any) -> str:
        return await call(
            "change_retry", ChangeLanguagesArgs(**a).model_dump(exclude_none=True)
        )

    async def change_hold_language(**a: Any) -> str:
        return await call(
            "change_hold_language", ChangeHoldLanguageArgs(**a).model_dump()
        )

    async def changes_pause(**a: Any) -> str:
        return await call("changes_pause", ChangesPauseArgs(**a).model_dump())

    specs = [
        (
            reporting_query,
            ReportingQueryArgs,
            "Run one guarded read-only SQL query on the redacted debrief_reporting "
            "views (catalogue in your inputs). A refused query says why.",
        ),
        (
            comments_read,
            CommentsReadArgs,
            "Read expert review comments: tag, anchor, quoted span, body, replies, "
            "and the idea a comment already feeds.",
        ),
        (
            metrics_view,
            MetricsViewArgs,
            "Metric failure points: experience rates off target, guardrails breached, "
            "efficiency drift, steering falling, stages with more failures. Each has a "
            "name you can cite as evidence and as an expected effect.",
        ),
        (
            guidance_report,
            GuidanceReportArgs,
            "How the guidance lookup and the guidance agent are used: runs, "
            "planner choices and skip reasons, tool latency, which entries are "
            "fetched and given to the Writer, and score and cost with and "
            "without the agent.",
        ),
        (
            idea_propose,
            IdeaProposeArgs,
            "Record a problem with its evidence (comment ids, metric names and values) "
            "and the idea for it: route A-D, hypothesis, expected effect on a named "
            "metric. Returns the idea id that every follow-up tool needs.",
        ),
        (
            release_draft,
            ReleaseDraftArgs,
            "Route A only: draft the change for an idea (a prompt edit, a setting, or "
            "a prompt-only registry agent). Draft only; nothing reaches learners.",
        ),
        (
            ladder_start_quick_test,
            IdeaRef,
            "Ask ally-be to start the quick test for a drafted route-A idea. ally-be "
            "runs the rest of the ladder (gate, trials, canary) on its own.",
        ),
        (
            builder_handoff,
            BuilderHandoffArgs,
            "Route B: brief Builder on code that is needed. Builder starts on its "
            "own; its pull request waits for an engineer. No quotes: they are removed.",
        ),
        (
            bug_hunter_report,
            BugHunterReportArgs,
            "Route C: report a defect to Bug Hunter with the run ids. It is filed "
            "on its own. No quotes: they are removed.",
        ),
        (
            person_ask,
            PersonAskArgs,
            "Route D: put a question to the owner or clinical advisor (rubric, "
            "safety rules, budgets, data access, clinical content).",
        ),
        (
            guidance_propose,
            GuidanceProposeArgs,
            "Route D: propose a new or changed Debrief Guidance entry for the "
            "clinical advisor. You never write to the Context Library; this only "
            "puts your draft in front of a person. Needs run ids from at least 10 "
            "learners (3 organisations when platform-wide); no quotes.",
        ),
        (
            questions_read,
            QuestionsReadArgs,
            "The questions people asked on your ideas that you have not answered "
            "yet, each with its idea id and question id.",
        ),
        (
            question_answer,
            QuestionAnswerArgs,
            "Answer one question a person asked on one of your ideas. The answer "
            "appears in that idea's thread in the Console.",
        ),
        (
            change_read,
            ChangeRef,
            "One change in full: what it is, where it stands, its test results, "
            "confidence, languages, and what people said about it.",
        ),
        (
            prompt_read,
            PromptRef,
            "A Debrief prompt's live text, exactly as the next debrief reads it: "
            "the risk cue definition, a pinned rule, or a step's instructions. "
            "Read it before you quote or describe what a prompt says.",
        ),
        (
            session_read,
            SessionRef,
            "One session's run summary: status, language, recipe, cost, the "
            "judge's score, learner flags and the answers they got. No transcript.",
        ),
        (
            change_approve,
            ChangeApproveArgs,
            "Approve a change that waits for a person. The call pauses until the "
            "person says yes: in the same message, state the plan exactly and ask "
            "them to reply yes. If they say anything else, it is not carried out.",
        ),
        (
            change_turn_down,
            ChangeTurnDownArgs,
            "Turn down a change that waits for a person. Like change_approve it "
            "pauses for the person's yes; state the plan in the same message.",
        ),
        (
            change_stop,
            ChangeLanguagesArgs,
            "Stop a change being tried (checks, trials or the learner try-out). "
            "Acts at once.",
        ),
        (
            change_undo,
            ChangeLanguagesArgs,
            "Undo a live change: back to the release before it, for every language "
            "or only the languages named. Acts at once.",
        ),
        (
            change_retry,
            ChangeLanguagesArgs,
            "Try a stopped or undone change again, optionally only for some "
            "languages. A change of a kind that always asks a person pauses for "
            "their yes: give the plan and state it in the same message.",
        ),
        (
            change_hold_language,
            ChangeHoldLanguageArgs,
            "Keep one language on the release before this change (the others keep "
            "it). Acts at once; change_retry for that language lifts it.",
        ),
        (
            changes_pause,
            ChangesPauseArgs,
            "Pause a kind of change until a date: nothing of that kind is tried or "
            "handed over until then. Acts at once.",
        ),
    ]
    tools: List[BaseTool] = []
    for fn, schema, description in specs:
        if allowed is not None and fn.__name__ not in allowed:
            continue
        tools.append(
            StructuredTool.from_function(
                coroutine=fn,
                name=fn.__name__,
                description=description,
                args_schema=schema,
                handle_tool_error=True,
            )
        )
    return tools
