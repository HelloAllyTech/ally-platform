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

#: Tools that only read; the investigator subagents get these and nothing else.
READ_TOOLS = (
    "reporting_query",
    "comments_read",
    "metrics_view",
    "questions_read",
)
#: Tools that propose or request an action; main agent only.
ACTION_TOOLS = (
    "idea_propose",
    "release_draft",
    "ladder_start_quick_test",
    "builder_handoff",
    "bug_hunter_report",
    "person_ask",
    "question_answer",
)
ALL_TOOLS = READ_TOOLS + ACTION_TOOLS

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

    async def questions_read(**a: Any) -> str:
        return await call("questions_read", {})

    async def question_answer(**a: Any) -> str:
        body = QuestionAnswerArgs(**a).model_dump(exclude_none=True)
        # People read it in the Console; still, no learner words.
        body["answer"] = strip_quotes(body["answer"])[0]
        return await call("question_answer", body)

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
            "Route B: brief Builder on code that is needed. A person approves the "
            "hand-off in the Console. No quotes: they are removed.",
        ),
        (
            bug_hunter_report,
            BugHunterReportArgs,
            "Route C: report a defect to Bug Hunter with the run ids. A person "
            "approves the filing in the Console. No quotes: they are removed.",
        ),
        (
            person_ask,
            PersonAskArgs,
            "Route D: put a question to the owner or clinical advisor (rubric, "
            "safety rules, budgets, data access, clinical content).",
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
