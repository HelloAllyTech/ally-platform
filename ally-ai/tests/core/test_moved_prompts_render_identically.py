"""Prompts moved from inline code into the Skills Store render today's text.

On first deploy, sync creates each of these prompts with its default file as
live v1, so production keeps running exactly what the inline code built. Each
test here keeps a verbatim copy of the code that was removed (`_legacy_*`) and
checks the new render against it for the same inputs, both from the local
default (no store text) and from the store's v1 (the file's text, as sync
uploads it).

The one difference is the planner prompt's trailing newline: the resolver
strips every template, so a template cannot end in one. Nothing follows it.
"""

from pathlib import Path
from typing import List, Optional

import pytest

from app.core.analytics_agent.prompt import (
    AgentTurn,
    build_answer_prompt,
    build_plan_prompt,
)
from app.core.helpline.prompt import nudge_instruction, risk_instruction
from app.prompts.resolver import load_and_format

PROMPTS_DIR = Path(__file__).resolve().parents[2] / "app" / "prompts"


def _store_v1(*paths: str) -> dict:
    """The request's prompts as ally-be sends them once sync has created each
    prompt from its file (sync uploads the file's text, stripped)."""
    return {
        f"ally_ai_{path.replace('/', '_')}": {
            "prompt": (PROMPTS_DIR / f"{path}.txt").read_text(encoding="utf-8").strip(),
            "version": 1,
        }
        for path in paths
    }


# --------------------------------------------------------------------------
# Analytics agent: verbatim copy of the removed builders.
# --------------------------------------------------------------------------

_LEGACY_PLANNER_RULES = """\
You translate an analytics question into ONE PostgreSQL query over the schema \
catalogue below. You never execute anything: your caller runs the query, \
rejects it if it breaks the rules, and shows the reader both the number and \
your rationale.

OUTPUT RULES
- intent="sql": you can answer the question from the catalogue. Put the query \
in `sql` and a one-sentence plain-English description of what it counts, over \
what period, with what filters, in `rationale`.
- intent="clarify": the question is ambiguous in a way that changes the answer \
(an unstated period, a metric with two defensible definitions, an entity name \
you cannot resolve to a column). Ask ONE short question in `message`. Prefer \
this over guessing — a confident number computed over the wrong definition is \
the worst possible output.
- intent="refuse": the data needed is not in the catalogue, or the question \
asks for something other than aggregate analytics (individual message content, \
credentials, personal contact details, or any change to the data). Say briefly \
in `message` what is missing. Do not invent a table or a column that is not \
listed.

SQL RULES (the caller enforces these; a violation is rejected, not repaired)
- Exactly ONE statement. A single SELECT, or WITH ... SELECT. No semicolons, no \
SQL comments, no CTE that writes.
- Read-only. No INSERT/UPDATE/DELETE/DDL, no SET, no function that touches the \
filesystem, the catalog, or sleeps.
- Only the tables and columns listed in the catalogue. Nothing from \
information_schema or pg_catalog.
- Always end with an explicit LIMIT. Aggregate first; never return raw rows \
when a GROUP BY answers the question.

QUERY CONVENTIONS FOR THIS DATABASE
- Soft deletes: where a table has `deleted_at`, add `deleted_at IS NULL` unless \
the question is explicitly about deleted rows.
- Multi-tenancy: `tenant_id` scopes tenant-owned rows. Join `tenants` when the \
reader asks about organisations by name.
- Time buckets: `date_trunc('day'|'week'|'month', <ts>)`, and alias the bucket \
column `bucket`. Order time series ascending by bucket.
- Relative windows are relative to TODAY (given below), e.g. \
`created_at >= CURRENT_DATE - INTERVAL '30 days'`.
- jsonb columns need `->>` and a cast: `(metrics->>'score')::numeric`.
- Name every output column with a readable snake_case alias — the aliases are \
what the reader sees as table headers and axis labels.

HONESTY RULES (these matter more than looking helpful)
- Return the sample size alongside any average, rate or score: add a \
`COUNT(*) AS n` to the same GROUP BY. A mean without its n cannot be judged.
- A rate is `SUM(x)::numeric / NULLIF(COUNT(*), 0)` — never divide by a \
possibly-zero denominator, and never report a rate over an empty denominator \
as zero.
- Do not gap-fill averages or rates for periods that had no observations. \
Gap-filling a COUNT with zero is fine.
- If the question implies a ranking of people, aggregate them; do not return \
contact details.
"""


def _legacy_build_plan_prompt(
    question: str,
    schema_catalog: str,
    today: str,
    row_limit: int,
    history: Optional[List[AgentTurn]] = None,
) -> str:
    parts = [
        _LEGACY_PLANNER_RULES,
        f"\nTODAY: {today}",
        f"MAXIMUM ROWS THE CALLER WILL ACCEPT: {row_limit} "
        "(your LIMIT must not exceed this)",
        "\n=== SCHEMA CATALOGUE (the only tables and columns you may use) ===\n"
        f"{schema_catalog}",
    ]
    if history:
        parts.append(
            "\n=== CONVERSATION SO FAR (oldest first) ===\n"
            "The reader may be following up on any of these. Resolve pronouns "
            '("those orgs", "that period") against them, and keep the same '
            "definitions and filters as the earlier query unless the reader "
            "asks to change them.\n"
        )
        for i, turn in enumerate(history, start=1):
            parts.append(
                f"[turn {i}]\n"
                f"Q: {turn.question}\n"
                f"SQL: {turn.sql or '(none)'}\n"
                f"A: {turn.answer or '(none)'}\n"
            )
    parts.append(f"\n=== QUESTION ===\n{question}\n")
    return "\n".join(parts)


_LEGACY_ANSWER_RULES = """\
You are writing the answer a platform administrator reads after their question \
was turned into SQL and run. You are given the question, the query, and its \
result rows (possibly a truncated sample of a larger result).

ANSWER
- First sentence: the answer to the question, with the number in it. No \
preamble, no restating the question.
- Then at most two sentences on what stands out — a trend, an outlier, a \
concentration. Only what the rows support. Never explain what you would need \
"more data" to say.
- Markdown, no headings. Bold at most one figure. Never invent a number that \
is not derivable from the rows.
- If the result is empty, say so plainly and say what that means (no matching \
rows in the period is a finding, not an error).

CAVEATS — one short line each, only when true of THIS result:
- a mean, rate or score computed over a small sample (say the n)
- the rows are a truncated sample, so any total you state is a lower bound
- a metric with more than one defensible definition, naming the one used
- an in-progress period (the current day/week/month is still accruing, so its \
figure can only rise)
- a period with no observations, where a missing point is not a zero

CHART — pick the form from the question, not from what is plottable:
- change over time -> line (x = the time/bucket column)
- comparison across a handful of categories -> bar
- part-to-whole across a time axis -> stacked_bar
- relationship between two measures -> scatter
- a single number, or rows that are already a short readable list -> none
Use exact column names from the result for x, y and group. If no single column \
is a clean numeric measure, or there are fewer than 3 rows to plot, or the \
rows are a truncated sample of a larger set (a partial plot misreads as the \
whole), use type "none" and let the table carry the detail. Label both axes \
with units.

FOLLOW-UPS — up to three questions this result actually raises and these tables \
can answer (a breakdown, a period comparison, a drill into the outlier). Phrase \
them as the reader would type them.
"""


def _legacy_build_answer_prompt(
    question: str,
    sql: str,
    columns: List[str],
    rows_csv: str,
    row_count: int,
    truncated: bool,
    history: Optional[List[AgentTurn]] = None,
) -> str:
    parts = [_LEGACY_ANSWER_RULES]
    if history:
        parts.append("\n=== EARLIER IN THIS CONVERSATION ===")
        for i, turn in enumerate(history, start=1):
            parts.append(f"[turn {i}] Q: {turn.question}\nA: {turn.answer}")
    parts.append(f"\n=== QUESTION ===\n{question}")
    parts.append(f"\n=== QUERY RUN ===\n{sql}")
    parts.append(
        "\n=== RESULT ===\n"
        f"columns: {', '.join(columns) if columns else '(none)'}\n"
        f"rows returned: {row_count}"
        + (
            " (TRUNCATED — the full result has more rows than this sample)"
            if truncated
            else ""
        )
        + f"\n{rows_csv if rows_csv else '(no rows)'}\n"
    )
    return "\n".join(parts)


HISTORY = [
    AgentTurn(question="sessions last month?", sql="SELECT 1 LIMIT 1", answer="12"),
    # A turn with no SQL or answer renders "(none)" in the planner.
    AgentTurn(question="and the month before?", sql="", answer=""),
    # Braces in user data must pass through untouched.
    AgentTurn(
        question="by {language}?",
        sql="SELECT metrics->>'{x}' AS v FROM t LIMIT 5",
        answer="REJECTED by the query guard: {bad}.",
    ),
]

PLAN_CASES = [
    dict(
        question="How many sessions ran last week?",
        schema_catalog="TABLE scenario_sessions — runs\n  COLUMNS: id uuid, "
        "started_at timestamptz, metrics jsonb {score}",
        today="2026-10-26",
        row_limit=500,
        history=None,
    ),
    dict(
        question="and by language?",
        schema_catalog="TABLE t\n  COLUMNS: a int",
        today="2026-10-26",
        row_limit=50,
        history=HISTORY,
    ),
    dict(question="q", schema_catalog="t", today="d", row_limit=10, history=[]),
]

ANSWER_CASES = [
    # Ordinary result, no history.
    dict(
        question="How many sessions per week?",
        sql="SELECT date_trunc('week', started_at) AS bucket, COUNT(*) AS n "
        "FROM scenario_sessions GROUP BY 1 ORDER BY 1 LIMIT 500",
        columns=["bucket", "n"],
        rows_csv="bucket,n\n2026-10-05,12\n2026-10-12,30",
        row_count=2,
        truncated=False,
        history=None,
    ),
    # Truncated sample, with history.
    dict(
        question="and by language?",
        sql="SELECT language, COUNT(*) AS n FROM t GROUP BY 1 LIMIT 500",
        columns=["language", "n"],
        rows_csv="language,n\nen,400\n{hi},100",
        row_count=500,
        truncated=True,
        history=HISTORY,
    ),
    # Empty result, no columns.
    dict(
        question="q",
        sql="s",
        columns=[],
        rows_csv="",
        row_count=0,
        truncated=False,
        history=[],
    ),
]

STORE_SOURCES = {
    "local default": lambda *paths: {},
    "store v1": _store_v1,
}


@pytest.mark.parametrize("source", sorted(STORE_SOURCES))
@pytest.mark.parametrize("case", PLAN_CASES)
def test_planner_prompt_matches_the_removed_builder(source, case):
    prompts = STORE_SOURCES[source]("analytics/planner")
    new = build_plan_prompt(**case, prompts=prompts)
    old = _legacy_build_plan_prompt(**case)
    # Identical but for the trailing newline a stripped template cannot keep.
    assert old == new + "\n"


@pytest.mark.parametrize("source", sorted(STORE_SOURCES))
@pytest.mark.parametrize("case", ANSWER_CASES)
def test_answer_prompt_matches_the_removed_builder(source, case):
    prompts = STORE_SOURCES[source]("analytics/answer")
    new = build_answer_prompt(**case, prompts=prompts)
    assert new == _legacy_build_answer_prompt(**case)


# --------------------------------------------------------------------------
# Summary condense step: verbatim copy of the removed inline prompt.
# --------------------------------------------------------------------------


def _legacy_condense_prompt(chunk: str, index: int, total: int) -> str:
    return (
        "Condense the following part of a counselling session "
        "transcript into a concise summary. Preserve who said what, "
        "key topics, decisions, risks, emotional shifts, and any "
        "clinically relevant details. Do not add information that is "
        "not present. Output plain text only.\n\n"
        f"TRANSCRIPT PART {index + 1}/{total}:\n{chunk}"
    )


@pytest.mark.parametrize("source", sorted(STORE_SOURCES))
@pytest.mark.parametrize(
    "chunk, index, total",
    [
        ("Counselor: Hello.\nClient: Hi {there}.", 0, 3),
        ("word " * 50, 2, 3),
        ("Client: last part\n", 9, 10),
    ],
)
def test_condense_prompt_matches_the_removed_inline_prompt(source, chunk, index, total):
    prompts = STORE_SOURCES[source]("summary/condense_chunk")
    new = load_and_format(
        "summary/condense_chunk",
        prompts=prompts,
        part_number=index + 1,
        part_count=total,
        chunk=chunk,
    )
    assert new == _legacy_condense_prompt(chunk, index, total)


# --------------------------------------------------------------------------
# Helpline copilot: verbatim copy of the removed policy sentences.
# --------------------------------------------------------------------------

_LEGACY_NUDGE_REQUESTED = (
    "Write one `nudge`: a single concrete coaching tip for the LISTENER about their "
    "next move, at most 240 characters, in English. It is advice to the listener, NOT "
    "something to send to the talker. Say what you noticed, then the tip — for example "
    '"They have said they feel alone twice; try reflecting that before asking about '
    'the exam." Keep it specific and kind, never a criticism. Never suggest promising '
    "confidentiality, diagnosing, or discussing medication. If there is nothing useful "
    "to say, leave `nudge` empty."
)
_LEGACY_NUDGE_NOT_REQUESTED = "Leave `nudge` as an empty string."
_LEGACY_RISK_NOT_FLAGGED = (
    "The platform's risk screen has not flagged this conversation. Still apply the "
    "safety rule above if you notice risk yourself."
)
_LEGACY_RISK_FLAGGED = (
    "The platform's risk screen HAS flagged this conversation ({level}{about}). Your "
    "FIRST suggestion must be tagged harm and ask directly about safety as described "
    "above. If the listener has already asked and the talker has answered in the last "
    "two messages, ask the next safety question instead (a plan, the means, when, "
    "whether they have tried before, who could be with them right now). If someone "
    "is harming them, ask whether they will be safe and what they could do if things "
    "get worse."
)


def _legacy_risk_instruction(risk_level, risk_subject) -> str:
    level = (risk_level or "NONE").upper()
    if level not in ("ELEVATED", "HIGH"):
        return _LEGACY_RISK_NOT_FLAGGED
    about = ", about someone else the talker knows" if risk_subject == "OTHER" else ""
    return _LEGACY_RISK_FLAGGED.format(level=level.lower(), about=about)


@pytest.mark.parametrize("source", sorted(STORE_SOURCES))
@pytest.mark.parametrize("include_nudge", [True, False])
def test_nudge_instruction_matches_the_removed_constants(source, include_nudge):
    prompts = STORE_SOURCES[source]("helpline/copilot_nudge_requested")
    expected = _LEGACY_NUDGE_REQUESTED if include_nudge else _LEGACY_NUDGE_NOT_REQUESTED
    assert nudge_instruction(include_nudge, prompts=prompts) == expected


@pytest.mark.parametrize("source", sorted(STORE_SOURCES))
@pytest.mark.parametrize(
    "level, subject",
    [
        ("HIGH", "SELF"),
        ("ELEVATED", "OTHER"),
        ("high", ""),
        ("NONE", "OTHER"),
        (None, None),
        ("LOW", "SELF"),
    ],
)
def test_risk_instruction_matches_the_removed_builder(source, level, subject):
    prompts = STORE_SOURCES[source]("helpline/copilot_risk_flagged")
    assert risk_instruction(level, subject, prompts=prompts) == (
        _legacy_risk_instruction(level, subject)
    )


def test_store_text_wins_over_the_default():
    prompts = {
        "ally_ai_helpline_copilot_risk_flagged": {"prompt": "FLAGGED {level}{about}"},
        "ally_ai_helpline_copilot_nudge_requested": {"prompt": "NUDGE NOW"},
        "ally_ai_analytics_answer": {"prompt": "A {question} | {result_block}"},
        "ally_ai_analytics_planner": {"prompt": "P {question} {row_limit}"},
    }
    assert risk_instruction("HIGH", "OTHER", prompts=prompts) == (
        "FLAGGED high, about someone else the talker knows"
    )
    assert nudge_instruction(True, prompts=prompts) == "NUDGE NOW"
    assert build_plan_prompt(
        "q?", schema_catalog="t", today="d", row_limit=7, prompts=prompts
    ) == ("P q? 7")
    assert build_answer_prompt(
        "q?",
        sql="s",
        columns=["n"],
        rows_csv="n\n1",
        row_count=1,
        truncated=False,
        prompts=prompts,
    ) == ("A q? | columns: n\nrows returned: 1\nn\n1\n")
