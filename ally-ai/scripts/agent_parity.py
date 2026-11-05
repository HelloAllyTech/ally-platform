"""Parity harness: /knowledge-agent/answer (v1) against /agent/run (v2).

Every case is sent to both endpoints with the same payload (plus a fresh
conversation_id for /agent/run), and the two results are compared:

- MUST match, when both paths searched the same translated query: intent,
  decline_reason, retrieval.hit_count, retrieval.top_similarity (3 dp),
  retrieval.passages_used.
- If the translation differs, retrieval is not comparable, so the case is
  reported as "translation differs" and not failed.
- Should match: the set of cited chunk ids, reported as overlap %. Not a failure:
  the answer model samples (dispatch sends no temperature to gpt-5 models), so v1
  alone cites different chunks from the same passages run to run. Exact citations
  are asserted in the mocked golden test (tests/core/agent_runtime/test_golden.py).
- Report only: answer text similarity (difflib) and latency.

`--record-baseline FILE` runs only the v1 endpoint and saves its results; take
one on master before touching knowledge_agent. `--baseline FILE` then also
compares today's v1 endpoint against that file on the same must-match fields,
which is what shows a refactor changed nothing.

    python scripts/agent_parity.py --cases tests/fixtures/agent_parity_cases.yaml \
        --base-url http://localhost:3001 [--baseline FILE] [--out parity_report.md]

The API key comes from --api-key or API__X_API_KEY. Exit code 1 when any
must-match check fails.
"""

import argparse
import difflib
import json
import os
import statistics
import sys
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import httpx
import yaml

V1_PATH = "/api/v1/knowledge-agent/answer"
V2_PATH = "/api/v1/agent/run"
TIMEOUT_SECONDS = 60.0


def load_cases(path: Path) -> List[Dict[str, Any]]:
    data = yaml.safe_load(path.read_text())
    defaults = data.get("defaults") or {}
    cases = []
    for case in data["cases"]:
        cases.append({**case, "request": {**defaults, **case["request"]}})
    return cases


def call(
    client: httpx.Client, path: str, payload: Dict[str, Any]
) -> Tuple[Optional[Dict[str, Any]], float, Optional[str]]:
    started = time.monotonic()
    try:
        response = client.post(path, json=payload)
    except httpx.HTTPError as e:
        return None, (time.monotonic() - started) * 1000, type(e).__name__
    ms = (time.monotonic() - started) * 1000
    if response.status_code != 200:
        return None, ms, f"HTTP {response.status_code}: {response.text[:200]}"
    return response.json(), ms, None


def must_match_fields(result: Dict[str, Any]) -> Dict[str, Any]:
    retrieval = result.get("retrieval") or {}
    return {
        "intent": result.get("intent"),
        "decline_reason": result.get("decline_reason"),
        "hit_count": retrieval.get("hit_count"),
        "top_similarity": round(float(retrieval.get("top_similarity") or 0.0), 3),
        "passages_used": retrieval.get("passages_used"),
    }


def compare(a: Dict[str, Any], b: Dict[str, Any]) -> Dict[str, Any]:
    """Compare two results. `status` is match, mismatch or translation_differs."""
    ta = (a.get("retrieval") or {}).get("translated_query")
    tb = (b.get("retrieval") or {}).get("translated_query")
    if ta != tb:
        return {"status": "translation_differs", "diffs": []}
    fa, fb = must_match_fields(a), must_match_fields(b)
    diffs = [key for key in fa if fa[key] != fb[key]]
    return {"status": "mismatch" if diffs else "match", "diffs": diffs}


def citation_overlap(a: Dict[str, Any], b: Dict[str, Any]) -> Optional[float]:
    ca = {str(c.get("chunk_id")) for c in a.get("citations") or []}
    cb = {str(c.get("chunk_id")) for c in b.get("citations") or []}
    if not ca and not cb:
        return None
    return 100.0 * len(ca & cb) / len(ca | cb)


def answer_similarity(a: Dict[str, Any], b: Dict[str, Any]) -> float:
    return difflib.SequenceMatcher(
        None, a.get("answer") or "", b.get("answer") or ""
    ).ratio()


def p50(values: List[float]) -> float:
    return statistics.median(values) if values else 0.0


def record_baseline(client: httpx.Client, cases, out: Path) -> int:
    results = {}
    for case in cases:
        result, ms, error = call(client, V1_PATH, case["request"])
        print(f"{case['id']:<26} {error or result['intent']:<12} {ms:7.0f} ms")
        results[case["id"]] = {"result": result, "error": error, "ms": round(ms)}
    out.write_text(json.dumps(results, indent=2, ensure_ascii=False) + "\n")
    print(f"\nBaseline of {len(results)} cases written to {out}")
    return 0 if all(r["error"] is None for r in results.values()) else 1


def run(client: httpx.Client, cases, baseline: Optional[Dict], out: Path) -> int:
    rows: List[Dict[str, Any]] = []
    v1_ms: List[float] = []
    v2_ms: List[float] = []

    for case in cases:
        v1, ms1, err1 = call(client, V1_PATH, case["request"])
        payload = {**case["request"], "conversation_id": f"parity-{uuid.uuid4()}"}
        v2, ms2, err2 = call(client, V2_PATH, payload)
        row: Dict[str, Any] = {"id": case["id"], "kind": case.get("kind", "")}

        if err1 or err2:
            row.update(status="error", detail=err1 or err2)
        else:
            v1_ms.append(ms1)
            v2_ms.append(ms2)
            verdict = compare(v1, v2)
            overlap = citation_overlap(v1, v2)
            row.update(
                status=verdict["status"],
                detail=", ".join(verdict["diffs"]),
                intents=f"{v1['intent']} / {v2['intent']}",
                overlap="n/a" if overlap is None else f"{overlap:.0f}%",
                similarity=f"{answer_similarity(v1, v2):.2f}",
                ms=f"{ms1:.0f} / {ms2:.0f}",
                steps=len(v2.get("trace") or []),
            )

        if baseline is not None:
            base = (baseline.get(case["id"]) or {}).get("result")
            if base is None or v1 is None:
                row["baseline"] = "missing"
            else:
                b = compare(base, v1)
                row["baseline"] = b["status"] + (
                    f" ({', '.join(b['diffs'])})" if b["diffs"] else ""
                )
        rows.append(row)
        print(
            f"{row['id']:<26} {row['status']:<20} {row.get('detail', '')}"
            + (f"  baseline: {row['baseline']}" if "baseline" in row else "")
        )

    failures = [r for r in rows if r["status"] in ("mismatch", "error")]
    baseline_failures = [
        r
        for r in rows
        if str(r.get("baseline", "")).startswith(("mismatch", "missing"))
    ]
    p50_v1, p50_v2 = p50(v1_ms), p50(v2_ms)
    delta = 100.0 * (p50_v2 - p50_v1) / p50_v1 if p50_v1 else 0.0
    translation_differs = sum(r["status"] == "translation_differs" for r in rows)

    lines = [
        "# Agent runtime parity report",
        "",
        f"Cases: {len(rows)} · must-match failures: {len(failures)} · "
        f"translation differs: {translation_differs}"
        + (
            f" · baseline failures: {len(baseline_failures)}"
            if baseline is not None
            else ""
        ),
        "",
        f"p50 latency: v1 {p50_v1:.0f} ms · v2 {p50_v2:.0f} ms · delta {delta:+.1f}% "
        "(budget +15%)",
        "",
        "| Case | Kind | Status | Diffs | Intent v1 / v2 "
        "| Citation overlap (should match) | Answer similarity "
        "| ms v1 / v2 | Trace steps"
        + (" | v1 vs master baseline" if baseline is not None else "")
        + " |",
        "|---|---|---|---|---|---|---|---|---|"
        + ("---|" if baseline is not None else ""),
    ]
    for r in rows:
        cells = [
            r["id"],
            r["kind"],
            r["status"],
            r.get("detail", "") or "",
            r.get("intents", ""),
            r.get("overlap", ""),
            r.get("similarity", ""),
            r.get("ms", ""),
            str(r.get("steps", "")),
        ]
        if baseline is not None:
            cells.append(r.get("baseline", ""))
        lines.append("| " + " | ".join(c.replace("|", "/") for c in cells) + " |")
    out.write_text("\n".join(lines) + "\n")

    print(f"\n{lines[2]}\n{lines[4]}\nReport written to {out}")
    return 1 if failures or baseline_failures else 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--cases", required=True, type=Path)
    parser.add_argument("--base-url", default="http://localhost:3001")
    parser.add_argument("--api-key", default=os.getenv("API__X_API_KEY"))
    parser.add_argument("--out", type=Path, default=Path("parity_report.md"))
    parser.add_argument("--baseline", type=Path, help="Compare v1 against this file")
    parser.add_argument(
        "--record-baseline", type=Path, help="Run v1 only and save results here"
    )
    parser.add_argument(
        "--prompts", type=Path, help="JSON file sent as `prompts` on every request"
    )
    args = parser.parse_args()

    if not args.api_key:
        parser.error("pass --api-key or set API__X_API_KEY")

    cases = load_cases(args.cases)
    if args.prompts:
        prompts = json.loads(args.prompts.read_text())
        for case in cases:
            case["request"]["prompts"] = prompts

    with httpx.Client(
        base_url=args.base_url,
        headers={"x-api-key": args.api_key},
        timeout=TIMEOUT_SECONDS,
    ) as client:
        if args.record_baseline:
            return record_baseline(client, cases, args.record_baseline)
        baseline = json.loads(args.baseline.read_text()) if args.baseline else None
        return run(client, cases, baseline, args.out)


if __name__ == "__main__":
    sys.exit(main())
