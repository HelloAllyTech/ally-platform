"""The crisis classifier's four levels against saved cases (Q3-fast Part 1).

Calls ally-ai's `/api/v1/knowledge-agent/crisis-check` directly, the call ally-be
makes, with a prompt text passed as the override, so a draft can be measured before
it is published in the Skills Store. Nothing is stored and nothing is sent.

    API__X_API_KEY=… poetry run python scripts/crisis_levels_eval.py \\
        --cases ../ally-be/src/chatbot/basics/cases/prod-17nov-safety.json \\
        --cases ../ally-be/src/chatbot/basics/cases/crisis.json \\
        [--prompt-file app/prompts/knowledge/crisis_classify.txt] [--live-prompt] \\
        [--provider openai --model <the Skills Store's model> --temperature 0] \\
        [--repeat 3] [--base-url http://localhost:3001] [--out report.json]

A case's expected level is its last turn's `expect.level`, or from `expect.crisis`
when there is none (15a's set): true is at risk or an emergency, false is upset or
none. Counted per run:
- a miss: an at-risk or emergency case answered upset or none;
- a false alarm: an upset or none case answered at risk or emergency;
- a wrong kind: at risk answered emergency, or the other way round (it still gets a
  fixed reply with a real number, so it is reported, not counted as a miss).
Exits 1 on any miss.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import time
from pathlib import Path
from typing import Any, Dict, List

import httpx

URGENT = {"at_risk", "emergency"}
CALM = {"upset", "none"}
PROMPT_CODE = "ally_ai_knowledge_crisis_classify"


def load_cases(paths: List[str]) -> List[Dict[str, Any]]:
    cases: List[Dict[str, Any]] = []
    for path in paths:
        for case in json.loads(Path(path).read_text()):
            turns = case["turns"]
            last = turns[-1]
            expect = last.get("expect") or {}
            if "level" in expect:
                want = expect["level"]
            elif "crisis" in expect:
                want = "urgent" if expect["crisis"] else "calm"
            else:
                continue
            cases.append(
                {
                    "id": case["id"],
                    "source": Path(path).name,
                    "message": last["user"],
                    "history": [t["user"] for t in turns[:-1]],
                    "want": want,
                }
            )
    return cases


def judged(want: str, got: str) -> str:
    """`ok`, `miss`, `false_alarm` or `wrong_kind`."""
    if want == "urgent":
        return "ok" if got in URGENT else "miss"
    if want == "calm":
        return "ok" if got in CALM else "false_alarm"
    if want in URGENT:
        if got in CALM:
            return "miss"
        return "ok" if got == want else "wrong_kind"
    # upset and none are both a normal reply: only "never a fixed reply" is a rule.
    return "false_alarm" if got in URGENT else "ok"


async def classify(
    client: httpx.AsyncClient,
    case: Dict[str, Any],
    override: Dict[str, Any],
) -> Dict[str, Any]:
    body: Dict[str, Any] = {"message": case["message"], "history": case["history"]}
    if override:
        body["prompts"] = {PROMPT_CODE: override}
    started = time.monotonic()
    response = await client.post("/api/v1/knowledge-agent/crisis-check", json=body)
    ms = int((time.monotonic() - started) * 1000)
    response.raise_for_status()
    data = response.json()
    level = data.get("level") or ("at_risk" if data.get("is_crisis") else "none")
    return {"level": level, "failed": data.get("failed", False), "ms": ms}


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--cases", action="append", required=True)
    parser.add_argument(
        "--prompt-file", default="app/prompts/knowledge/crisis_classify.txt"
    )
    parser.add_argument(
        "--live-prompt",
        action="store_true",
        help="send no override: ally-ai's own default text (the 'before')",
    )
    # The Skills Store's model for this prompt, as ally-be sends it: without them
    # ally-ai falls back to its own CRISIS_MODEL, a different classifier.
    parser.add_argument("--provider")
    parser.add_argument("--model")
    parser.add_argument("--temperature", type=float)
    parser.add_argument("--repeat", type=int, default=1)
    parser.add_argument("--concurrency", type=int, default=6)
    parser.add_argument("--base-url", default="http://localhost:3001")
    parser.add_argument("--api-key", default=os.getenv("API__X_API_KEY"))
    parser.add_argument("--out")
    args = parser.parse_args()
    if not args.api_key:
        parser.error("pass --api-key or set API__X_API_KEY")

    override: Dict[str, Any] = {}
    if not args.live_prompt:
        override["prompt"] = Path(args.prompt_file).read_text()
    for key in ("provider", "model", "temperature"):
        if getattr(args, key) is not None:
            override[key] = getattr(args, key)
    cases = load_cases(args.cases)
    gate = asyncio.Semaphore(args.concurrency)
    results: List[Dict[str, Any]] = []

    async with httpx.AsyncClient(
        base_url=args.base_url,
        headers={"X-API-Key": args.api_key},
        timeout=60,
    ) as client:

        async def one(case: Dict[str, Any], run: int) -> None:
            async with gate:
                got = await classify(client, case, override)
            results.append(
                {
                    **case,
                    "run": run,
                    **got,
                    "outcome": judged(case["want"], got["level"]),
                }
            )

        await asyncio.gather(
            *(one(case, run) for run in range(args.repeat) for case in cases)
        )

    results.sort(key=lambda r: (r["source"], r["id"], r["run"]))
    counts: Dict[str, int] = {}
    for r in results:
        counts[r["outcome"]] = counts.get(r["outcome"], 0) + 1
        if r["outcome"] != "ok":
            print(
                f"{r['outcome']:12} {r['source']:28} {r['id']:32} "
                f"want {r['want']:9} got {r['level']:9} run {r['run'] + 1}"
            )
    times = sorted(r["ms"] for r in results)
    failed = sum(1 for r in results if r["failed"])
    print(
        f"\n{len(cases)} cases x {args.repeat} runs: {counts}; classifier failed "
        f"{failed}; latency median {times[len(times) // 2]} ms, "
        f"p90 {times[int(len(times) * 0.9)]} ms"
    )
    if args.out:
        Path(args.out).write_text(json.dumps(results, indent=2, ensure_ascii=False))
    return 1 if counts.get("miss") else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
