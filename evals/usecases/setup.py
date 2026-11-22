"""Set up the use-case suite's assistants (EVAL-USECASES.md §1, chunk Q4 §0).

Each assistant in assistants.json goes through ally-be's real setup API, as an invited
owner would: start from its T1 template on its site with the setup answers, wait for
reading, confirm What we learned, answer the builder's questions, take the recommended
purpose, run the checkup, publish. Then the extra lists and entries the sets need
(RHA's drive slots, the Updates, a staff handbook, the booking and callback abilities
the brief names).

Recorded per assistant (the owner side of §2): the pack and business type against the
expected pack (never weaker), the checkup's questions and score, the publish result and
its time, and the setup's step times. A publish held by the gate is a finding; with
--local-publish-held the draft is then published by the test-only, development-only
`usecases:local-publish` script so its replies can still be measured, and the result
says so.

    ALLY tokens are read from --token-file (default ~/.ally-local-token), never printed.
    cd ally-ai && poetry run python ../evals/usecases/setup.py --api http://localhost:8001

Writes evals/usecases/results/setup-<label>.json (ids, slugs, findings), which the
runner reads. Re-running with --only replaces those assistants' entries.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT / "ally-ai" / "scripts"))
from onboarding_eval import (  # noqa: E402
    STRENGTH,
    Api,
    publish,
    wait_for_checkup,
    wait_for_reading,
)

#: The builder's questions, answered as the suite's owners would. Per assistant
#: `gapAnswers` win; anything else is skipped.
GAP_ANSWERS = {
    "audience": "Clients or customers",
    "languages": "English, Hindi",
    "decline": "Our phone number",
}
#: Abilities each template's action needs at Do it (Q4 #10–#12: the wizard's switch
#: is set through the same route the Tools page uses, so a lost switch shows here).
ABILITIES = {
    "o5-rha": {"registrations": {"find": "do_it", "create": "do_it"}},
}


def token_from(path: str) -> str:
    text = Path(path).expanduser().read_text().strip()
    if not text:
        raise SystemExit(f"{path} is empty")
    return text


def day(rel: str, today: dt.date) -> dt.date:
    """'today', '+7d', '-20d', 'next Sunday'."""
    if rel == "today":
        return today
    if rel.startswith("next "):
        names = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
        want = names.index(rel.split()[1].lower())
        ahead = (want - today.weekday()) % 7 or 7
        return today + dt.timedelta(days=ahead)
    return today + dt.timedelta(days=int(rel.rstrip("d")))


def add_document(api: Api, draft_id: str, chatbot_id: str, path: Path) -> None:
    """A handbook goes in as pasted text (no upload needed), then is read into the draft."""
    doc = api.post(
        f"/chatbots/{chatbot_id}/documents/private",
        {"title": path.stem.replace("-", " ").title(), "sourceType": "paste", "text": path.read_text()},
    )
    documents = doc if isinstance(doc, list) else doc.get("documents", [doc])
    match = next((d for d in documents if d.get("title", "").lower().startswith(path.stem.split("-")[0])), documents[-1])
    api.post(f"/bot-drafts/{draft_id}/documents", {"documentId": match.get("documentId") or match["id"]})


def seed_events(api: Api, chatbot_id: str, spec: Dict[str, Any], today: dt.date) -> int:
    lists = {item["key"] for item in api.get(f"/chatbots/{chatbot_id}/lists")}
    if "events" not in lists:
        api.post(f"/chatbots/{chatbot_id}/lists/ready-made/{spec['readyMade']}", {})
    on = day(spec["date"], today)
    for time_ in spec["times"]:
        api.post(
            f"/chatbots/{chatbot_id}/lists/events/records",
            {
                "data": {
                    "name": spec["event"],
                    "starts_at": f"{on.isoformat()}T{time_}:00+05:30",
                    "venue": spec["venue"],
                    "seats": spec["seats"],
                    "registration_open": True,
                }
            },
        )
    return len(spec["times"])


def seed_updates(api: Api, chatbot_id: str, updates: List[Dict[str, Any]], today: dt.date) -> int:
    for update in updates:
        api.post(
            f"/chatbots/{chatbot_id}/lists/updates/records",
            {
                "data": {
                    "title": update["title"],
                    "date": day(update["from"], today).isoformat(),
                    "what_changed": update["text"],
                    "until": day(update["until"], today).isoformat(),
                }
            },
        )
    return len(updates)


def local_publish(draft_id: str, access: str, emails: List[str]) -> Dict[str, Any]:
    """The test-only route around a held publish (development stacks only)."""
    command = [
        "docker", "exec", "ally-be-app-1", "npm", "run", "-s", "usecases:local-publish", "--",
        "--draft", draft_id, "--access", access,
    ]
    if emails:
        command += ["--emails", ",".join(emails)]
    out = subprocess.run(command, capture_output=True, text=True, timeout=180)
    line = next((ln for ln in out.stdout.splitlines() if ln.startswith("{")), None)
    if out.returncode or not line:
        raise RuntimeError(f"local publish failed: {out.stderr.strip()[-300:]}")
    return json.loads(line)


def set_up(api: Api, a: Dict[str, Any], args: argparse.Namespace, today: dt.date) -> Dict[str, Any]:
    r: Dict[str, Any] = {"key": a["key"], "code": a["code"], "fails": [], "soft": [], "timings": {}}
    started = time.monotonic()

    draft = api.post(
        "/bot-drafts",
        {"website": a["site"], "template": a["template"], "answers": a.get("answers", {}), "name": a["name"]},
    )
    draft_id = draft["id"]
    r["draft_id"] = draft_id
    r["chatbot_id"] = draft.get("chatbotId")
    t = time.monotonic()
    view = wait_for_reading(api, draft_id)
    r["timings"]["read"] = round(time.monotonic() - t, 1)
    r["chatbot_id"] = r["chatbot_id"] or view.get("chatbotId")
    r["pages_read"] = view["crawl"]["pagesRead"]
    r["crawl_problem"] = view["crawl"]["problem"]
    r["facts"] = len(view["learned"]["facts"])

    for doc in a.get("documents", []):
        add_document(api, draft_id, r["chatbot_id"], HERE / doc)
        wait_for_reading(api, draft_id)

    final, seconds = api.say(draft_id, {"chip": "Looks right"})
    r["timings"]["classify_and_gaps"] = round(seconds, 1)
    view = final["draft"]
    r["industry"] = view["industry"]
    r["pack"] = (view.get("safety") or {}).get("id")
    if r["pack"] != a["pack"]:
        weaker = STRENGTH.get(r["pack"] or "", 0) < STRENGTH[a["pack"]]
        (r["fails"] if weaker else r["soft"]).append(
            f"pack {r['pack']} (expected {a['pack']}){', weaker' if weaker else ''}"
        )

    answers = {**GAP_ANSWERS, **a.get("gapAnswers", {})}
    t = time.monotonic()
    turns = 0
    while view["step"] == "gaps" and turns < 10:
        pending = view["conversation"]["pending"]
        final, _ = api.say(draft_id, {"chip": answers.get(pending, "Skip for now")})
        view = final["draft"]
        turns += 1
    r["timings"]["questions"] = round(time.monotonic() - t, 1)

    designs = [d for d in view.get("designs") or [] if d["id"] != "custom" and not d.get("coming_soon")]
    if not designs:
        r["fails"].append("no purpose offered")
        return r
    chosen = next((d for d in designs if d.get("recommended")), designs[0])
    r["purpose"] = chosen["id"]
    t = time.monotonic()
    final, _ = api.say(draft_id, {"chip": f"design:{chosen['id']}"})
    r["timings"]["build"] = round(time.monotonic() - t, 1)
    view = final["draft"]
    r["suggested"] = view["draft"].get("suggestedQuestions", [])

    t = time.monotonic()
    checkup = api.post(f"/bot-drafts/{draft_id}/checkup")
    run_view = wait_for_checkup(api, checkup["chatbotId"], checkup["run"]["id"])
    r["timings"]["checkup"] = round(time.monotonic() - t, 1)
    totals = run_view.get("totals") or {}
    r["checkup"] = {k: totals.get(k) for k in ("questions", "accuracy", "hardFails", "gaps")}

    # Publish as the owner would. Invite pages list the suite's visitors.
    emails = list(a.get("staff", [])) or ["eval@usecases.test"]
    t = time.monotonic()
    held: Dict[str, Any] = {"fails": [], "soft": []}
    body_access = a["access"]
    published = _publish(api, draft_id, run_view, held, body_access, emails)
    r["timings"]["publish"] = round(time.monotonic() - t, 1)
    r["soft"] += held["soft"]
    if published is None:
        r["fails"] += held["fails"]
        r["publish"] = "held: " + "; ".join(held["fails"])
        if args.local_publish_held:
            published = local_publish(draft_id, body_access, emails if body_access == "invite" else [])
            r["publish"] += " → published locally for measuring (test-only)"
    else:
        r["publish"] = "published"
    if published:
        r["slug"] = published.get("slug")
        r["link"] = published.get("link")
        r["chatbot_id"] = published.get("chatbotId", r["chatbot_id"])
    r["timings"]["total_to_publish"] = round(time.monotonic() - started, 1)

    cid = r["chatbot_id"]
    if a.get("lists", {}).get("events"):
        r["events_seeded"] = seed_events(api, cid, a["lists"]["events"], today)
    if a.get("updates"):
        r["updates_seeded"] = seed_updates(api, cid, a["updates"], today)
    for key, change in ABILITIES.get(a["key"], {}).items():
        api.client.put(f"/chatbots/{cid}/lists/{key}/abilities", json=change).raise_for_status()
    r["lists"] = {item["key"]: item.get("abilities") for item in api.get(f"/chatbots/{cid}/lists")}
    return r


def _publish(api: Api, draft_id: str, run_view: Dict[str, Any], result: Dict[str, Any],
             access: str, emails: List[str]) -> Optional[Dict[str, Any]]:
    """onboarding_eval's publish, with this assistant's access."""
    original = api.post

    def post(path: str, body: Optional[Dict[str, Any]] = None) -> Any:
        if path.endswith("/publish") and body is not None:
            body = {**body, "access": access, "emails": emails if access == "invite" else []}
            if access != "invite":
                body.pop("emails")
        return original(path, body)

    api.post = post  # type: ignore[method-assign]
    try:
        return publish(api, draft_id, run_view, result)
    finally:
        api.post = original  # type: ignore[method-assign]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--api", default="http://localhost:8001")
    parser.add_argument("--token-file", default="~/.ally-local-token")
    parser.add_argument("--only", default="", help="comma-separated keys")
    parser.add_argument("--label", default=dt.date.today().isoformat())
    parser.add_argument("--local-publish-held", action="store_true")
    args = parser.parse_args()

    spec = json.loads((HERE / "assistants.json").read_text())["assistants"]
    only = {k for k in args.only.split(",") if k}
    api = Api(args.api, token_from(args.token_file))
    api.client.timeout = httpx.Timeout(180)
    out_path = HERE / "results" / f"setup-{args.label}.json"
    results: Dict[str, Any] = json.loads(out_path.read_text()) if out_path.exists() else {}
    today = dt.date.today()

    for a in spec:
        if only and a["key"] not in only:
            continue
        print(f"→ {a['code']} {a['name']} ({a['template']}, {a['site']})", flush=True)
        try:
            results[a["key"]] = set_up(api, a, args, today)
        except Exception as error:  # noqa: BLE001 — one failed setup is a finding, not a stop
            results[a["key"]] = {"key": a["key"], "code": a["code"], "fails": [f"setup failed: {error}"]}
        r = results[a["key"]]
        print(f"   pack={r.get('pack')} publish={r.get('publish')} fails={r.get('fails')}", flush=True)
        out_path.write_text(json.dumps(results, indent=2, ensure_ascii=False))

    print(f"wrote {out_path.relative_to(ROOT)}")
    return 1 if any(r.get("fails") for r in results.values()) else 0


if __name__ == "__main__":
    sys.exit(main())
