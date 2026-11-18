"""Scribe v2 quality gate: score v2 (and v1 as the baseline) on an eval set.

The eval set is real sessions, so it is PHI: keep it out of the repo. One JSON
object per line, shaped like ally-ai's EvalCase (app/core/note_harness/eval.py);
docs/scribe-v2/eval/sample_case.jsonl is a made-up example.

    cd ally-ai
    OPENAI__API_KEY=sk-... poetry run python ../docs/scribe-v2/scripts/run_eval.py \
        /secure/path/eval.jsonl [--model gpt-5-mini] [--judge-model gpt-4o] [--out report.json]

Prints one row per case and the means (DESIGN §10's bar: v2 at least as good as
v1 everywhere, better on fact recall and order). The report holds scores only,
no transcript or note text.
"""

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path

from langchain_openai import ChatOpenAI

from app.core.note_harness.eval import (
    EvalCase,
    judge_prompt,
    judge_schema,
    parse_judge,
    score_note,
    summarise,
)
from app.core.note_harness.models import NoteHarnessRequest
from app.core.note_harness.pipeline import run_note_pipeline

PROMPTS = Path("app/prompts")


def render(path, **variables):
    return (PROMPTS / f"{path}.txt").read_text().format(**variables)


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("eval_set")
    ap.add_argument("--model", default="gpt-4o-mini-2024-07-18")
    ap.add_argument("--judge-model", default="gpt-4o")
    ap.add_argument("--out")
    args = ap.parse_args()

    key = os.environ["OPENAI__API_KEY"]
    model = ChatOpenAI(model=args.model, temperature=0, api_key=key)
    judge_llm = ChatOpenAI(model=args.judge_model, temperature=0, api_key=key)

    async def invoke(prompt, schema, path, max_tokens):
        return await model.with_structured_output(schema).ainvoke(prompt)

    async def judge(facts, points):
        answer = await judge_llm.with_structured_output(
            judge_schema(len(facts))
        ).ainvoke(judge_prompt(facts, points))
        return parse_judge(answer, len(facts), len(points))

    cases = [
        EvalCase.model_validate_json(line)
        for line in Path(args.eval_set).read_text().splitlines()
        if line.strip()
    ]
    rows, v2_scores, v1_scores = [], [], []
    for case in cases:
        request = NoteHarnessRequest.model_validate({"note_spec": case.note_spec})
        report = await run_note_pipeline(
            render, invoke, request, case.mode, segments_text=case.segments_text
        )
        draft = report.draft
        points = [p.text for p in draft.narrative] if draft else []
        fields = {k: v.value for k, v in draft.fields.items()} if draft else {}
        budget = report.budget.narrative_words if report.budget else None
        v2 = await score_note(case, points, fields, judge, budget)
        v2_scores.append(v2)
        v1 = None
        if case.v1_points:
            v1 = await score_note(case, case.v1_points, {}, judge, budget)
            v1_scores.append(v1)
        rows.append(
            {
                "case": case.id,
                "mode": case.mode,
                "error": report.error,
                "source": report.transcript_source,
                "llm_calls": report.llm_calls,
                "duration_ms": report.duration_ms,
                "v2": v2.model_dump(),
                "v1": v1.model_dump() if v1 else None,
            }
        )
        print(
            f"{case.id:<20} v2 recall={v2.fact_recall} tau={v2.order_tau} "
            f"fields={v2.field_accuracy} invented={v2.invented_fields} "
            f"len={v2.length_ratio} | v1 recall={v1.fact_recall if v1 else '-'} "
            f"tau={v1.order_tau if v1 else '-'} | err={report.error}",
            file=sys.stderr,
        )
    result = {
        "model": args.model,
        "judge_model": args.judge_model,
        "v2": summarise(v2_scores),
        "v1": summarise(v1_scores) if v1_scores else None,
        "cases": rows,
    }
    print(json.dumps({k: result[k] for k in ("model", "v2", "v1")}, indent=1))
    if args.out:
        Path(args.out).write_text(json.dumps(result, indent=1))


asyncio.run(main())
