"""Onboarding eval (Agents v2, chunk 20a): every fixture business from a website to a
published, invite-only assistant, through ally-be's real session API, the way an owner
would go.

Per case it creates a draft from the site, waits for reading, confirms What we learned,
answers the questions (gaps skipped; Clients or customers, English and Hindi, Our phone
number), chooses the recommended purpose, runs the checkup, publishes invite-only, and
asks the published assistant its own first three suggested questions through Preview
(the engine its page uses).

Recorded: time to publish and per step; facts learned, by section, and the share
dropped as unsourced; the industry, care topics and safety pack; the gaps asked against
the site's deliberate ones; the purposes offered; and whether the three answers came
with sources.

Hard fails (exit code 1):
- a learned fact with no source, or a source that isn't a page we read;
- the wrong business type or the wrong safety pack;
- a purpose card that says it will book, take orders or take payments, or a purpose
  ally-ai doesn't know;
- a checkup hard fail, or publishing held by a safety question or an unsourced answer;
- over 5 minutes to publish (over 4 is reported);
- the blocked and unreachable cases not ending as such.

    python3 fixtures/onboarding-sites/serve.py            # in another terminal
    ALLY_TOKEN=<an admin's access token> poetry run python scripts/onboarding_eval.py \\
        --api http://localhost:8001 --fixture-host host.docker.internal

ally-be must allow the fixture host (BOT_DRAFT_CRAWL_ALLOW_HOSTS, development only) and
a daily crawl cap above the number of cases (BOT_DRAFT_CRAWLS_PER_DAY). The report goes
to onboarding_eval_report.md unless --out names a file.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import httpx

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "fixtures" / "onboarding-sites"))
from sites import BLOCKED, LIVE_CASES, SITES, UNREACHABLE_PORT  # noqa: E402

#: Pack strength, as ally-be's SAFETY_PACKS orders them.
STRENGTH = {
    "standard": 1,
    "legal_financial": 2,
    "minors": 3,
    "medical": 4,
    "pharmacy": 4,
    "mental_health": 5,
}
#: The purposes ally-ai offers (`PurposeId`); "custom" (Something else) is never chosen.
PURPOSES = {"answer", "enquiries", "training", "guide", "custom"}
#: A will line claiming booking, orders or payments (not "steps in order").
CLAIMS_BOOKING = re.compile(
    r"\b(book(s|ing)?|reserv(e|es|ing|ation)s?|(take|place|accept)s? (an )?orders?"
    r"|pay(s|ment|ments)?|checkout)\b",
    re.IGNORECASE,
)
ANSWERS = {
    "audience": "Clients or customers",
    "languages": "English, Hindi",
    "decline": "Our phone number",
}
SOFT_SECONDS, HARD_SECONDS = 240, 300


class Api:
    def __init__(self, base: str, token: str):
        self.client = httpx.Client(
            base_url=f"{base.rstrip('/')}/api/v1",
            headers={"Authorization": f"Bearer {token}"},
            timeout=120,
        )

    def get(self, path: str) -> Any:
        response = self.client.get(path)
        response.raise_for_status()
        return response.json()

    def post(self, path: str, body: Optional[Dict[str, Any]] = None) -> Any:
        response = self.client.post(path, json=body or {})
        response.raise_for_status()
        return response.json()

    def say(self, draft_id: str, body: Dict[str, str]) -> Tuple[Dict[str, Any], float]:
        """One builder turn over SSE; returns its `final` and the seconds it took."""
        started = time.monotonic()
        events: List[Tuple[str, Any]] = []
        with self.client.stream(
            "POST", f"/bot-drafts/{draft_id}/messages/stream", json=body
        ) as response:
            response.raise_for_status()
            name = None
            for line in response.iter_lines():
                if line.startswith("event:"):
                    name = line[6:].strip()
                elif line.startswith("data:") and name:
                    events.append((name, json.loads(line[5:].strip())))
        final = next((data for name, data in events if name == "final"), None)
        if final is None:
            error = next((data for name, data in events if name == "error"), {})
            raise RuntimeError(f"builder turn ended without a reply: {error}")
        return final, time.monotonic() - started


def wait_for_reading(api: Api, draft_id: str, limit: float = 300) -> Dict[str, Any]:
    started = time.monotonic()
    while time.monotonic() - started < limit:
        view = api.get(f"/bot-drafts/{draft_id}")
        done = view["crawl"]["status"] in ("done", "partial", "failed")
        spoke = any(
            e["role"] == "builder" and e["text"] != view["transcript"][0]["text"]
            for e in view["transcript"]
        )
        if done and spoke:
            return view
        time.sleep(2)
    raise TimeoutError("reading never finished")


def wait_for_checkup(
    api: Api, chatbot_id: str, run_id: str, limit: float = 300
) -> Dict[str, Any]:
    started = time.monotonic()
    while time.monotonic() - started < limit:
        view = api.get(f"/chatbots/{chatbot_id}/checkup/runs/{run_id}")
        if view["run"]["status"] != "running":
            return view
        time.sleep(2)
    raise TimeoutError("the checkup never finished")


def publish(
    api: Api, draft_id: str, run_view: Dict[str, Any], result: Dict[str, Any]
) -> Optional[Dict[str, Any]]:
    """Publish invite-only, as an owner would. When an owner's own Must pass question
    failed, ally-be asks "Go live anyway?" (`must_pass_failed`); the eval says yes and
    reports it. Nothing else is confirmed: a held safety question (`safety_recheck`)
    or an unsourced answer (`checkup_unsourced`) stays a hard fail."""
    body: Dict[str, Any] = {"access": "invite", "emails": ["eval@example.com"]}
    path = f"/bot-drafts/{draft_id}/publish"
    try:
        return api.post(path, body)
    except httpx.HTTPStatusError as error:
        if error.response.status_code != 409:
            raise
        detail = error.response.json()
        code = detail.get("errorCode") or detail.get("message")
        questions = (detail.get("details") or {}).get("questions") or []
        safety = {
            r.get("caseId") for r in run_view.get("results") or [] if r.get("safety")
        }
        if code != "must_pass_failed" or any(q.get("id") in safety for q in questions):
            result["fails"].append(f"publish held: {code}")
            return None
        result["soft"].append(
            "owner Must pass failed, confirmed as an owner would: "
            + "; ".join(q.get("question", "") for q in questions)
        )
        return api.post(path, {**body, "confirmMustPass": True})


def run_case(api: Api, case: Dict[str, Any], url: str) -> Dict[str, Any]:
    result: Dict[str, Any] = {"key": case["key"], "url": url, "fails": [], "soft": []}
    timings: Dict[str, float] = {}
    started = time.monotonic()

    draft = api.post("/bot-drafts", {"website": url})
    draft_id = draft["id"]
    result["draft_id"] = draft_id
    t = time.monotonic()
    view = wait_for_reading(api, draft_id)
    timings["read"] = time.monotonic() - t
    crawl = view["crawl"]
    result["pages_read"] = crawl["pagesRead"]
    result["problem"] = crawl["problem"]

    expected_problem = case.get("expected", {}).get("problem")
    if expected_problem:
        if crawl["problem"] != expected_problem:
            result["fails"].append(
                f"expected the crawl to end as {expected_problem}, "
                f"got {crawl['problem']}"
            )
        result["timings"] = timings
        return result

    # What we learned: every fact sourced to a page we read.
    pages = {page["url"] for page in crawl["pages"]}
    facts = view["learned"]["facts"]
    unsourced = [
        f
        for f in facts
        if not f.get("sourceUrl")
        or (
            f["sourceUrl"] not in pages
            and f["sourceUrl"] != "owner"
            and not f["sourceUrl"].startswith("document:")
        )
    ]
    by_section: Dict[str, int] = {}
    for fact in facts:
        by_section[fact["section"]] = by_section.get(fact["section"], 0) + 1
    result["facts"] = len(facts)
    result["by_section"] = by_section
    result["dropped"] = view["learned"]["dropped"]
    result["sample_facts"] = [f"[{f['section']}] {f['text']}" for f in facts[:5]]
    if unsourced:
        result["fails"].append(
            f"{len(unsourced)} learned fact(s) without a page source"
        )

    # Looks right: the industry, the pack and the first question.
    final, seconds = api.say(draft_id, {"chip": "Looks right"})
    timings["classify_and_gaps"] = seconds
    view = final["draft"]
    result["industry"] = view["industry"]
    result["pack"] = (view.get("safety") or {}).get("id")
    expected = case["expected"]
    if result["pack"] != expected["pack"]:
        weaker = STRENGTH.get(result["pack"] or "", 0) < STRENGTH[expected["pack"]]
        result["fails"].append(
            f"pack {result['pack']} (expected {expected['pack']})"
            + (", weaker" if weaker else "")
        )
    if result["industry"] != expected["industry"]:
        result["fails"].append(
            f"business type {result['industry']} (expected {expected['industry']})"
        )
    gaps = [g["key"] for g in (view["conversation"]["gaps"] or [])]
    result["gaps"] = gaps
    result["gap_questions"] = [g["item"] for g in (view["conversation"]["gaps"] or [])]
    deliberate = case.get("gaps", [])
    result["deliberate_found"] = [g for g in deliberate if g in gaps]
    if deliberate and len(result["deliberate_found"]) < len(deliberate):
        result["soft"].append(
            "missed deliberate gaps: "
            + ", ".join(g for g in deliberate if g not in gaps)
        )

    # The questions.
    t = time.monotonic()
    turns = 0
    while view["step"] == "gaps" and turns < 10:
        pending = view["conversation"]["pending"]
        final, _ = api.say(draft_id, {"chip": ANSWERS.get(pending, "Skip for now")})
        view = final["draft"]
        turns += 1
    timings["questions"] = time.monotonic() - t

    # Purposes (chunk 20a-2), still sent as `designs`: none says it will book, take
    # orders or take payments. Their won't lines say exactly that, so they aren't read.
    designs = view.get("designs") or []
    result["designs"] = [
        f"{d['title']}{' (recommended)' if d.get('recommended') else ''}"
        for d in designs
    ]
    for design in designs:
        if design["id"] not in PURPOSES:
            result["fails"].append(f"unknown purpose '{design['id']}'")
        elif any(CLAIMS_BOOKING.search(item) for item in design["will"]):
            result["fails"].append(
                f"purpose '{design['title']}' says it will book or take orders"
            )
    real = [
        d
        for d in designs
        if d["id"] in PURPOSES and d["id"] != "custom" and not d.get("coming_soon")
    ]
    if not real:
        result["fails"].append("no purpose offered")
        result["timings"] = timings
        return result

    t = time.monotonic()
    final, _ = api.say(draft_id, {"chip": f"design:{real[0]['id']}"})
    timings["build"] = time.monotonic() - t
    view = final["draft"]
    result["assistant"] = {
        "name": view["draft"]["assistantName"],
        "introduction": view["draft"]["introduction"],
        "decline": view["draft"]["declineText"],
        "suggested": view["draft"]["suggestedQuestions"],
    }

    # The checkup gates publishing (chunk 20a-2): run it on the draft first.
    t = time.monotonic()
    checkup = api.post(f"/bot-drafts/{draft_id}/checkup")
    run_view = wait_for_checkup(api, checkup["chatbotId"], checkup["run"]["id"])
    timings["checkup"] = time.monotonic() - t
    totals = run_view.get("totals") or {}
    result["checkup"] = {
        "questions": totals.get("questions"),
        "accuracy": totals.get("accuracy"),
        "hard_fails": totals.get("hardFails"),
        "gaps": totals.get("gaps"),
    }
    if totals.get("hardFails"):
        result["fails"].append(f"{totals['hardFails']} checkup hard fail(s)")

    t = time.monotonic()
    published = publish(api, draft_id, run_view, result)
    timings["publish"] = time.monotonic() - t
    if published is None:
        result["timings"] = timings
        return result
    total = time.monotonic() - started
    timings["total_to_publish"] = total
    result["link"] = published["link"]
    if total > HARD_SECONDS:
        result["fails"].append(f"{total:.0f} s to publish (over 5 minutes)")
    elif total > SOFT_SECONDS:
        result["soft"].append(f"{total:.0f} s to publish (over 4 minutes)")

    # Three questions through Preview, the engine the page uses.
    answers = []
    for question in view["draft"]["suggestedQuestions"][:3]:
        reply = api.post(
            f"/chatbots/{published['chatbotId']}/test", {"message": question}
        )
        answers.append(
            {
                "question": question,
                "reply": reply.get("reply", "")[:300],
                "sources": len(reply.get("citations") or []),
            }
        )
    result["answers"] = answers
    result["timings"] = timings
    return result


def report(results: List[Dict[str, Any]], title: str) -> str:
    lines = [f"# {title}", ""]
    hard = sum(1 for r in results if r["fails"])
    lines.append(f"**Hard fails: {hard}** of {len(results)} cases.")
    lines.append("")
    lines.append(
        "| Case | Pages | Facts | Dropped | Industry | Pack | Gaps asked "
        "| Deliberate found | To publish | Result |"
    )
    lines.append("|---|---|---|---|---|---|---|---|---|---|")
    for r in results:
        total = r.get("timings", {}).get("total_to_publish")
        lines.append(
            (
                "| {key} | {pages} | {facts} | {dropped} | {industry} | {pack} "
                "| {gaps} | {found} | {total} | {status} |"
            ).format(
                key=r["key"],
                pages=r.get("pages_read", "–"),
                facts=r.get("facts", "–"),
                dropped=r.get("dropped", "–"),
                industry=r.get("industry", r.get("problem") or "–"),
                pack=r.get("pack", "–"),
                gaps=", ".join(r.get("gaps", [])) or "–",
                found=(
                    f"{len(r.get('deliberate_found', []))}/"
                    f"{len(r.get('expected_gaps', []))}"
                    if "expected_gaps" in r
                    else "–"
                ),
                total=f"{total:.0f} s" if total else "–",
                status="FAIL" if r["fails"] else ("soft" if r["soft"] else "pass"),
            )
        )
    for r in results:
        lines += ["", f"## {r['key']}", ""]
        for fail in r["fails"]:
            lines.append(f"- **Hard fail:** {fail}")
        for soft in r["soft"]:
            lines.append(f"- Soft: {soft}")
        if r.get("timings"):
            lines.append(
                "- Timings: "
                + ", ".join(f"{k} {v:.1f} s" for k, v in r["timings"].items())
            )
        if r.get("by_section"):
            lines.append(f"- Learned by section: {r['by_section']}")
        if r.get("gap_questions"):
            lines.append(f"- Gap questions: {'; '.join(r['gap_questions'])}")
        if r.get("designs"):
            lines.append(f"- Designs: {', '.join(r['designs'])}")
        for answer in r.get("answers", []):
            lines.append(
                f"- Q: {answer['question']} → {answer['sources']} source(s). "
                f"{answer['reply'][:160]}"
            )
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--api", default="http://localhost:8001")
    parser.add_argument("--token", default=os.getenv("ALLY_TOKEN"))
    parser.add_argument(
        "--fixture-host",
        default="host.docker.internal",
        help="The fixture server's host as ally-be sees it",
    )
    parser.add_argument("--only", help="Run only cases whose key starts with this")
    parser.add_argument("--no-live", action="store_true", help="Skip the live site")
    parser.add_argument("--out", type=Path, default=Path("onboarding_eval_report.md"))
    parser.add_argument("--title", default="Onboarding eval")
    args = parser.parse_args()
    if not args.token:
        parser.error("--token or ALLY_TOKEN is required (an admin's access token)")

    api = Api(args.api, args.token)
    cases: List[Tuple[Dict[str, Any], str]] = [
        (
            {**site, "expected_gaps": site["gaps"]},
            f"http://{args.fixture_host}:{site['port']}/",
        )
        for site in SITES
    ]
    cases.append(
        (
            {"key": BLOCKED["key"], "expected": {"problem": "blocked"}},
            f"http://{args.fixture_host}:{BLOCKED['port']}/",
        )
    )
    cases.append(
        (
            {"key": "unreachable", "expected": {"problem": "unreachable"}},
            f"http://{args.fixture_host}:{UNREACHABLE_PORT}/",
        )
    )
    if not args.no_live:
        cases += [(case, case["url"]) for case in LIVE_CASES]
    if args.only:
        cases = [c for c in cases if c[0]["key"].startswith(args.only)]

    results = []
    for case, url in cases:
        print(f"→ {case['key']} ({url})", flush=True)
        try:
            result = run_case(api, case, url)
        except Exception as error:  # a case that breaks is a hard fail, not a crash
            result = {
                "key": case["key"],
                "fails": [f"{type(error).__name__}: {error}"],
                "soft": [],
            }
        if "expected_gaps" in case:
            result["expected_gaps"] = case["expected_gaps"]
        results.append(result)
        print(
            f"  {'FAIL' if result['fails'] else 'ok'} "
            f"{result.get('timings', {}).get('total_to_publish', 0):.0f} s",
            flush=True,
        )

    args.out.write_text(report(results, args.title))
    print(f"Report: {args.out}")
    return 1 if any(r["fails"] for r in results) else 0


if __name__ == "__main__":
    sys.exit(main())
