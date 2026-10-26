"""Prompt builders for the analytics agent.

The **schema catalogue is supplied by the caller** (ally-be), never hard-coded
here: ally-be owns Postgres, decides which tables the agent may read, and
enforces that decision on the SQL that comes back. If this file carried its own
copy of the table list, the list the model sees and the list the guard permits
would drift apart, and the visible symptom would be the agent writing queries
that are always rejected.

The instructions themselves are Skills Store prompts (`ally_ai_analytics_planner`
and `ally_ai_analytics_answer`); this module only builds the parts that loop or
branch (earlier turns, the result block) and hands them in as variables.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel

from app.prompts.resolver import load_and_format


class AgentTurn(BaseModel):
    """One prior exchange, so a follow-up ("and by language?") can be resolved
    against what was actually asked and run before it."""

    question: str = ""
    sql: str = ""
    answer: str = ""


PLAN_PROMPT_PATH = "analytics/planner"
ANSWER_PROMPT_PATH = "analytics/answer"


def _plan_history_block(history: Optional[List[AgentTurn]]) -> str:
    """The earlier turns, for the planner to resolve a follow-up against.

    Built here rather than in the template: it is a loop over the turns, and
    each turn's layout is what the planner is told to read.
    """
    if not history:
        return ""
    parts = [
        "\n=== CONVERSATION SO FAR (oldest first) ===\n"
        "The reader may be following up on any of these. Resolve pronouns "
        '("those orgs", "that period") against them, and keep the same '
        "definitions and filters as the earlier query unless the reader "
        "asks to change them.\n"
    ]
    for i, turn in enumerate(history, start=1):
        parts.append(
            f"[turn {i}]\n"
            f"Q: {turn.question}\n"
            f"SQL: {turn.sql or '(none)'}\n"
            f"A: {turn.answer or '(none)'}\n"
        )
    return "\n" + "\n".join(parts)


def build_plan_prompt(
    question: str,
    schema_catalog: str,
    today: str,
    row_limit: int,
    history: Optional[List[AgentTurn]] = None,
    prompts: Optional[Dict[str, Any]] = None,
) -> str:
    """Prompt for step 1: question (+ conversation so far) -> one SELECT.

    The text is the Skills Store's `ally_ai_analytics_planner`
    (`app/prompts/analytics/planner.txt` is its default).
    """
    return load_and_format(
        PLAN_PROMPT_PATH,
        prompts=prompts,
        today=today,
        row_limit=row_limit,
        schema_catalog=schema_catalog,
        history_block=_plan_history_block(history),
        question=question,
    )


def _answer_history_block(history: Optional[List[AgentTurn]]) -> str:
    if not history:
        return ""
    parts = ["\n=== EARLIER IN THIS CONVERSATION ==="]
    for i, turn in enumerate(history, start=1):
        parts.append(f"[turn {i}] Q: {turn.question}\nA: {turn.answer}")
    return "\n" + "\n".join(parts)


def _result_block(
    columns: List[str], rows_csv: str, row_count: int, truncated: bool
) -> str:
    """The result the narrator describes: columns, row count (with the
    truncation note when the rows are a sample) and the rows themselves."""
    return (
        f"columns: {', '.join(columns) if columns else '(none)'}\n"
        f"rows returned: {row_count}"
        + (
            " (TRUNCATED — the full result has more rows than this sample)"
            if truncated
            else ""
        )
        + f"\n{rows_csv if rows_csv else '(no rows)'}\n"
    )


def build_answer_prompt(
    question: str,
    sql: str,
    columns: List[str],
    rows_csv: str,
    row_count: int,
    truncated: bool,
    history: Optional[List[AgentTurn]] = None,
    prompts: Optional[Dict[str, Any]] = None,
) -> str:
    """Prompt for step 2: result set -> prose + chart specification.

    The text is the Skills Store's `ally_ai_analytics_answer`
    (`app/prompts/analytics/answer.txt` is its default).
    """
    return load_and_format(
        ANSWER_PROMPT_PATH,
        prompts=prompts,
        history_block=_answer_history_block(history),
        question=question,
        sql=sql,
        result_block=_result_block(columns, rows_csv, row_count, truncated),
    )
