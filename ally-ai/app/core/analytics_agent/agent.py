"""The analytics agent's two LLM calls.

Both are stateless transforms and neither touches a database: ally-be supplies
the schema catalogue, runs the planned SQL behind its own guard, and sends the
rows back for narration. Splitting planning from narration is deliberate — the
planner must not see result rows (it would start writing the answer instead of
the query), and the narrator must not be able to change the query that produced
the number it is describing.

The Gemini SDK and client are imported/constructed lazily so this module can be
imported without the ``google-genai`` dependency installed or a key configured
(mirrors ``app.core.language_quality.judge``).
"""

from __future__ import annotations

import csv
import io
from typing import Any, Dict, List, Optional, Tuple

from app.core.analytics_agent.prompt import (
    ANSWER_PROMPT_PATH,
    PLAN_PROMPT_PATH,
    AgentTurn,
    build_answer_prompt,
    build_plan_prompt,
)
from app.core.analytics_agent.schemas import (
    AnswerOutput,
    ChartType,
    PlanIntent,
    QueryPlan,
)
from app.core.config import settings
from app.core.llm_usage.tasks import LLMTask
from app.prompts.resolver import get_backend_llm_overrides
from app.utils.logger import get_logger

logger = get_logger(__name__)


# Result rows are stringified into the narration prompt; cap the per-cell length
# so one long text column cannot crowd out the rest of the sample.
MAX_CELL_CHARS = 200


def rows_to_csv(columns: List[str], rows: List[Dict[str, Any]]) -> str:
    """Render result rows as CSV for the narration prompt.

    CSV rather than JSON: one line per row keeps a 200-row sample legible to the
    model at roughly half the tokens, and the column header is stated once.
    """
    if not columns:
        return ""
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\n")
    writer.writerow(columns)
    for row in rows:
        writer.writerow(
            [_format_cell(row.get(col)) for col in columns],
        )
    return buf.getvalue().strip()


def _llm_settings(
    internal_path: str,
    prompts: Optional[Dict[str, Any]],
    default_model: str,
) -> Tuple[Optional[str], str, float]:
    """(provider, model, temperature) for one of the agent's calls.

    The Skills Store's choice for the prompt wins; without one, Gemini on the
    model from settings at temperature 0. A store model with no provider leaves
    the provider to be inferred from the model id.
    """
    from app.core.llm.dispatch import PROVIDER_GEMINI

    provider, model, temperature = get_backend_llm_overrides(internal_path, prompts)
    if not provider and not model:
        provider = PROVIDER_GEMINI
    # Zero temperature unless the store says otherwise: the same question over
    # the same schema should produce the same query, or a reader comparing two
    # answers a minute apart cannot tell a data change from a sampling wobble.
    return provider, model or default_model, 0 if temperature is None else temperature


def store_prompt_version(
    internal_path: str, prompts: Optional[Dict[str, Any]]
) -> Optional[str]:
    """The Skills Store version of the prompt this request rendered, as "v<n>",
    or None when the request carried no store text for it (the local default
    ran) or no version number."""
    entry = (prompts or {}).get(f"ally_ai_{internal_path.replace('/', '_')}")
    if not isinstance(entry, dict):
        return None
    text = entry.get("prompt")
    version = entry.get("version")
    if not isinstance(text, str) or not text.strip() or version in (None, ""):
        return None
    return f"v{version}"


def _format_cell(value: Any) -> str:
    if value is None:
        # Distinguishable from an empty string: a NULL average is "not measured",
        # which the narrator must not read as a zero.
        return "NULL"
    text = str(value)
    return text if len(text) <= MAX_CELL_CHARS else text[:MAX_CELL_CHARS] + "…"


async def plan_query(
    question: str,
    schema_catalog: str,
    today: str,
    row_limit: int,
    history: Optional[List[AgentTurn]] = None,
    prompts: Optional[Dict[str, Any]] = None,
) -> Tuple[QueryPlan, str]:
    """Step 1: turn the question into one read-only SELECT (or ask/refuse)."""
    prompt = build_plan_prompt(
        question,
        schema_catalog=schema_catalog,
        today=today,
        row_limit=row_limit,
        history=history,
        prompts=prompts,
    )

    from app.core.llm.dispatch import generate_structured

    provider, model, temperature = _llm_settings(
        PLAN_PROMPT_PATH, prompts, settings.ANALYTICS_AGENT.PLANNER_MODEL
    )
    plan, meta = await generate_structured(
        schema=QueryPlan,
        prompt=prompt,
        task=LLMTask.ANALYTICS_AGENT_PLAN.value,
        provider=provider,
        model=model,
        temperature=temperature,
        max_tokens=None,
    )
    if meta.get("fell_back_from"):
        logger.warning(
            "analytics planner fell back from %s to %s/%s",
            meta["fell_back_from"],
            meta["provider"],
            meta["model"],
        )
    if plan is None:
        raise RuntimeError("analytics agent planner returned no parsable output")
    if plan.intent == PlanIntent.SQL and not plan.sql.strip():
        # An empty query with a "yes I can answer this" intent would surface to
        # the reader as a silent nothing; make it a clarification instead.
        logger.warning("analytics agent planner returned intent=sql with empty sql")
        return (
            QueryPlan(
                intent=PlanIntent.CLARIFY,
                message=(
                    "I could not turn that into a query. Could you rephrase it, "
                    "naming the metric and the period you want?"
                ),
            ),
            meta["model"],
        )
    return plan, meta["model"]


async def compose_answer(
    question: str,
    sql: str,
    columns: List[str],
    rows: List[Dict[str, Any]],
    row_count: int,
    truncated: bool,
    history: Optional[List[AgentTurn]] = None,
    prompts: Optional[Dict[str, Any]] = None,
) -> Tuple[AnswerOutput, str]:
    """Step 2: turn the result set into prose, caveats and a chart spec."""
    prompt = build_answer_prompt(
        question,
        sql=sql,
        columns=columns,
        rows_csv=rows_to_csv(columns, rows),
        row_count=row_count,
        truncated=truncated,
        history=history,
        prompts=prompts,
    )

    from app.core.llm.dispatch import generate_structured

    provider, model, temperature = _llm_settings(
        ANSWER_PROMPT_PATH, prompts, settings.ANALYTICS_AGENT.ANSWER_MODEL
    )
    output, meta = await generate_structured(
        schema=AnswerOutput,
        prompt=prompt,
        task=LLMTask.ANALYTICS_AGENT_ANSWER.value,
        provider=provider,
        model=model,
        temperature=temperature,
        max_tokens=None,
    )
    if meta.get("fell_back_from"):
        logger.warning(
            "analytics narrator fell back from %s to %s/%s",
            meta["fell_back_from"],
            meta["provider"],
            meta["model"],
        )
    if output is None or not output.answer.strip():
        raise RuntimeError("analytics agent narrator returned no parsable output")
    return validate_chart(output, columns, row_count, truncated), meta["model"]


def validate_chart(
    output: AnswerOutput,
    columns: List[str],
    row_count: int,
    truncated: bool,
) -> Tuple[AnswerOutput, str]:
    """Drop a chart specification that the result cannot honestly support.

    Deterministic code, not a prompt instruction: a chart naming a column that
    is not in the result renders as an empty plot, and a plot of a truncated
    sample reads as the whole population. Both are silent failures, so they are
    checked here rather than trusted to the model.
    """
    chart = output.chart
    if chart.type.value == "none":
        return output

    reason = None
    if chart.x not in columns or chart.y not in columns:
        reason = "chart references a column not in the result"
    elif chart.group and chart.group not in columns:
        reason = "chart group references a column not in the result"
    elif row_count < 3:
        reason = "too few rows to plot"
    elif truncated:
        reason = "result is a truncated sample"

    if reason:
        logger.info(f"analytics agent: dropping chart — {reason}")
        chart.type = ChartType.NONE
    return output
