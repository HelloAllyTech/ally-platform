"""Checkup eval (Agents v2, chunk 20a-2): a question suite through ally-be's Checkup.

The suite is added to an assistant as checkup questions and run there, through the
assistant's own engine and the one grader, so this report, the Checkup screen and the
scorecard count the same way. Each question is asked `--attempts` times (default 3),
because the agent's search wording varies run to run.

    # The Sunrise suite, against an assistant set up from the Sunrise PDF:
    ALLY_TOKEN=… poetry run python scripts/checkup_eval.py \\
        --suite ../docs/agents-v2/evals/sunrise-mind-checkups.yaml --bot <chatbot id>

    # Set that assistant up first, through onboarding (upload, questions, publish):
    ALLY_TOKEN=… poetry run python scripts/checkup_eval.py \\
        --onboard-pdf ../fixtures/checkups/sunrise-mind-clinic.pdf

    # The fixture sites, against their published assistants (a JSON map of site key to
    # chatbot id; the fixture server must be the one their pages were read from):
    ALLY_TOKEN=… poetry run python scripts/checkup_eval.py \\
        --fixtures ../fixtures/checkups/fixture-questions.yaml --bots bots.json

Exit code 1 on any hard fail or wrong decline (the accuracy baseline's bar), or a
must_pass question that didn't pass (the Sunrise suite's release gate).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Tuple

import httpx
import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent))
from onboarding_eval import ANSWERS, Api  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "fixtures" / "onboarding-sites"))
from sites import SITES  # noqa: E402

POLL_SECONDS = 3
RUN_LIMIT_SECONDS = 1800


def import_suite(api: Api, bot: str, suite: str, cases: List[Dict[str, Any]]) -> None:
    fields = {
        "id",
        "send",
        "expect",
        "thread",
        "facts",
        "must_not",
        "also_ok",
        "source",
        "hard_fail",
        "tier",
    }
    body = [{k: v for k, v in case.items() if k in fields} for case in cases]
    api.post(f"/chatbots/{bot}/checkup/suites", {"suite": suite, "cases": body})


def run_suite(api: Api, bot: str, suite: str, attempts: int) -> Dict[str, Any]:
    run = api.post(
        f"/chatbots/{bot}/checkup/runs",
        {"trigger": "eval", "suite": suite, "attempts": attempts},
    )
    started = time.monotonic()
    while time.monotonic() - started < RUN_LIMIT_SECONDS:
        view = api.get(f"/chatbots/{bot}/checkup/runs/{run['id']}")
        if view["run"]["status"] != "running":
            return view
        time.sleep(POLL_SECONDS)
    raise TimeoutError(f"checkup run {run['id']} didn't finish")


def onboard_pdf(api: Api, pdf: Path) -> str:
    """Set an assistant up from a PDF the way an owner would; publish it invite-only."""
    draft = api.post("/bot-drafts", {"upload": True})
    bot = draft["chatbotId"]
    data = pdf.read_bytes()
    upload = api.post(
        f"/chatbots/{bot}/documents/upload-url",
        {"fileName": pdf.name, "fileSize": len(data), "contentType": "application/pdf"},
    )
    httpx.put(
        upload["presignedUrl"],
        content=data,
        headers={"Content-Type": "application/pdf"},
        timeout=60,
    ).raise_for_status()
    title = pdf.stem.replace("-", " ").title()
    documents = api.post(
        f"/chatbots/{bot}/documents/private",
        {
            "title": title,
            "sourceType": "pdf",
            "fileUrl": upload["fileUrl"],
            "fileName": pdf.name,
        },
    )
    # The route answers with the assistant's whole document list.
    document = next(d for d in documents if d["title"] == title)
    api.post(f"/bot-drafts/{draft['id']}/documents", {"documentId": document["id"]})
    started = time.monotonic()
    while time.monotonic() - started < 300:
        view = api.get(f"/bot-drafts/{draft['id']}")
        if view["learned"]["facts"] and view.get("readingDone", True):
            break
        time.sleep(3)
    time.sleep(10)  # let the last pages' details land
    final, _ = api.say(draft["id"], {"chip": "Looks right"})
    view = final["draft"]
    turns = 0
    while view["step"] == "gaps" and turns < 10:
        pending = view["conversation"]["pending"]
        final, _ = api.say(draft["id"], {"chip": ANSWERS.get(pending, "Skip for now")})
        view = final["draft"]
        turns += 1
    real = [d for d in view.get("designs") or [] if not d.get("coming_soon")]
    final, _ = api.say(draft["id"], {"chip": f"design:{real[0]['id']}"})
    published = api.post(
        f"/bot-drafts/{draft['id']}/publish",
        {"access": "invite", "emails": ["eval@example.com"]},
    )
    return published["chatbotId"]


def fixture_url(key: str, host: str, page: str) -> str:
    site = next(s for s in SITES if s["key"] == key)
    return f"http://{host}:{site['port']}{page}"


def summarise(label: str, view: Dict[str, Any]) -> Tuple[List[str], bool]:
    totals = view["totals"]
    t = totals

    def of(name: str) -> str:
        return f"{t[name]['passed']} of {t[name]['total']}"

    lines = [
        f"## {label}",
        "",
        f"- Questions graded: {t['questions']} ({view['run']['total']} asked)",
        f"- Answered well: {of('accuracy')}",
        f"- Answers with a source: {of('sources')}",
        f"- Said it didn't know, rightly: {of('honesty')}",
        f"- Safety: {of('safety')}",
        f"- **Hard fails: {t['hardFails']}** · **Wrong declines: {t['wrongDeclines']}**"
        f" · must_pass not passed: {t['mustPassFailed']} · not graded: {t['errors']}",
        f"- Reply time: median {t['ms']['median'] / 1000:.1f} s,"
        f" slowest {t['ms']['slowest'] / 1000:.1f} s",
        "",
        "| Question | Tier | Expect | Attempts | Reasons |",
        "|---|---|---|---|---|",
    ]
    by_case: Dict[str, List[Dict[str, Any]]] = {}
    for row in view["results"]:
        by_case.setdefault(row["caseId"], []).append(row)
    for rows in by_case.values():
        rows.sort(key=lambda r: r["attempt"])
        first = rows[0]
        marks = " ".join(
            {"pass": "✓", "needs_input": "◌", "fail": "✗", "error": "!"}[r["verdict"]]
            + ("H" if r["hardFail"] else "")
            + ("W" if r["wrongDecline"] else "")
            for r in rows
        )
        reasons = sorted({reason for r in rows for reason in r["reasons"]})
        question = first["question"].replace("|", "/")
        cells = [
            f"{first.get('externalId') or ''} {question}",
            first.get("tier") or "",
            first.get("expect") or "",
            marks,
            ", ".join(reasons),
        ]
        lines.append("| " + " | ".join(cells) + " |")
    failing = [
        f"### {label}: replies that failed",
        "",
    ]
    for row in view["results"]:
        if row["verdict"] in ("fail", "error"):
            reply = " ".join((row["reply"] or "").split())[:280]
            facts = (
                f"attempt {row['attempt']}, {row['outcome']}, {row['ms'] / 1000:.1f} s,"
                f" offered: {row['answerPageOffered']}, searches: {row['searches']}"
            )
            failing.append(
                f"- {row.get('externalId') or ''} ({facts}):"
                f" {', '.join(row['reasons'])}. “{reply}”"
            )
    lines += ["", *failing, ""]
    bad = (
        totals["hardFails"] > 0
        or totals["wrongDeclines"] > 0
        or totals["mustPassFailed"] > 0
    )
    return lines, bad


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--api", default="http://localhost:8001")
    parser.add_argument("--suite", type=Path)
    parser.add_argument("--bot")
    parser.add_argument("--fixtures", type=Path)
    parser.add_argument("--bots", type=Path, help="JSON: fixture site key → chatbot id")
    parser.add_argument("--host", default="host.docker.internal")
    parser.add_argument("--onboard-pdf", type=Path)
    parser.add_argument("--attempts", type=int, default=3)
    parser.add_argument("--title", default="Checkup eval")
    parser.add_argument("--out", type=Path, default=Path("checkup_eval_report.md"))
    args = parser.parse_args()

    token = os.environ.get("ALLY_TOKEN")
    if not token:
        print("Set ALLY_TOKEN to an admin's access token.", file=sys.stderr)
        return 2
    api = Api(args.api, token)

    if args.onboard_pdf:
        print(onboard_pdf(api, args.onboard_pdf))
        return 0

    lines = [f"# {args.title}", ""]
    failed = False
    if args.suite:
        if not args.bot:
            parser.error("--suite needs --bot")
        spec = yaml.safe_load(args.suite.read_text())
        suite = spec.get("bot") or args.suite.stem
        import_suite(api, args.bot, suite, spec["cases"])
        view = run_suite(api, args.bot, suite, args.attempts)
        section, bad = summarise(f"{suite} ({args.attempts}×)", view)
        lines += section
        failed = failed or bad
    if args.fixtures:
        if not args.bots:
            parser.error("--fixtures needs --bots")
        bots: Dict[str, str] = json.loads(args.bots.read_text())
        spec = yaml.safe_load(args.fixtures.read_text())
        totals = {"hardFails": 0, "wrongDeclines": 0, "questions": 0, "ms": []}
        for key, site in spec["sites"].items():
            bot = bots.get(key)
            if not bot:
                lines += [f"## {key}", "", "No assistant given; skipped.", ""]
                continue
            cases = [
                {**case, "source": fixture_url(key, args.host, case["page"])}
                for case in site["cases"]
            ]
            import_suite(api, bot, f"fixture-{key}", cases)
            view = run_suite(api, bot, f"fixture-{key}", args.attempts)
            section, bad = summarise(f"{key} ({args.attempts}×)", view)
            lines += section
            failed = failed or bad
            totals["hardFails"] += view["totals"]["hardFails"]
            totals["wrongDeclines"] += view["totals"]["wrongDeclines"]
            totals["questions"] += view["totals"]["questions"]
            totals["ms"] += [
                r["ms"] for r in view["results"] if r["verdict"] != "error"
            ]
            print(
                f"{key}: {view['totals']['wrongDeclines']} wrong declines,"
                f" {view['totals']['hardFails']} hard fails",
                flush=True,
            )
        times = sorted(totals["ms"]) or [0]
        lines[2:2] = [
            f"**Fixtures, all sites:** {totals['questions']} graded replies · "
            f"hard fails {totals['hardFails']} · "
            f"wrong declines {totals['wrongDeclines']} · "
            f"reply time median {times[len(times) // 2] / 1000:.1f} s, "
            f"slowest {times[-1] / 1000:.1f} s",
            "",
        ]
    args.out.write_text("\n".join(lines) + "\n")
    print(f"Report: {args.out}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
