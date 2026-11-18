#!/usr/bin/env python3
"""Score harness runs (scripts/stage_director_harness.py) against the tester issues.

Per client turn, an LLM judge (pinned model, temperature 0) answers four yes/no
questions with the scenario's facts in front of it:

- re_ask: the client asks something the counsellor has already answered;
- contradiction: the client states or accepts something about their own life
  that the role, backstory or memories contradict (the "your children" case);
- invented: the client gives a specific personal detail none of them support;
- volunteered: the client brings up new personal information nobody asked for.

Plus two counted directly: long repeats (an 8-word run the client already said)
and "thinking" phrases. Acknowledgement-only learner turns ("Okay.") also get
`ack_full`: the reply goes beyond a brief response.

    python scripts/stage_director_judge.py --scenario s.json run1.json run2.json
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

from openai import OpenAI

JUDGE_MODEL = "gpt-4o-2024-08-06"
ACKS = {"okay", "ok", "alright", "hmm", "got it", "right"} | {"अच्छा", "हम्म", "ठीक है"}
THINK = re.compile(r"let me think|just thinking|need to think|सोच", re.I)

SYSTEM = (
    "You audit a role-play where an AI plays a CLIENT talking to a COUNSELLOR "
    "(a trainee).\nFacts about the client (ground truth):\nROLE INSTRUCTIONS:\n"
    "{role}\nBACKSTORY:\n{backstory}\nMEMORIES:\n{memories}\n\n"
    "For EVERY client turn, answer with true/false:\n"
    "- re_ask: the client asks a question the counsellor already answered earlier "
    "in the conversation (same concern, not a genuinely new follow-up).\n"
    "- contradiction: the client states or accepts something about their own life "
    "that the facts above contradict, including going along with a counsellor's "
    "wrong assumption.\n"
    "- invented: the client gives a specific personal detail (people, events, "
    "numbers) that the facts above do not support.\n"
    "- volunteered: the client brings up NEW personal information about their "
    "life that the counsellor's latest turn did not ask about.\n"
    'Reply as JSON: {{"turns": [{{"turn": n, "re_ask": bool, "contradiction": '
    'bool, "invented": bool, "volunteered": bool, "note": "short reason when '
    'anything is true"}}]}}'
)


def _words(text: str):
    return re.findall(r"\w+", text.lower())


def long_repeats(turns) -> int:
    seen, count = set(), 0
    for t in turns:
        w = _words(t["client"])
        grams = {tuple(w[i : i + 8]) for i in range(len(w) - 7)}
        if grams & seen:
            count += 1
        seen |= grams
    return count


def judge(run: dict, scenario: dict, client: OpenAI) -> dict:
    m = scenario["metadata"]
    memories = "\n".join(
        f"- {k['title']}: {k.get('content', '')}"
        for k in m.get("knowledgeSources") or []
    )
    transcript = "\n".join(
        f"[{t['turn']}] COUNSELLOR: {t['learner']}\n[{t['turn']}] CLIENT: {t['client']}"
        for t in run["turns"]
    )
    resp = client.chat.completions.create(
        model=JUDGE_MODEL,
        temperature=0,
        response_format={"type": "json_object"},
        messages=[
            {
                "role": "system",
                "content": SYSTEM.format(
                    role=scenario.get("prompt") or "",
                    backstory=m.get("characterProfileText") or "",
                    memories=memories,
                ),
            },
            {"role": "user", "content": transcript},
        ],
    )
    verdicts = json.loads(resp.choices[0].message.content)["turns"]
    by_turn = {v["turn"]: v for v in verdicts}
    totals = {k: 0 for k in ("re_ask", "contradiction", "invented", "volunteered")}
    notes = []
    for v in verdicts:
        for k in totals:
            totals[k] += bool(v.get(k))
        if any(v.get(k) for k in totals):
            notes.append(f"t{v['turn']}: {v.get('note', '')}")
    acks = [t for t in run["turns"] if t["learner"].strip(" .।").lower() in ACKS]
    ack_full = sum(
        1
        for t in acks
        if len(_words(t["client"])) > 20
        or by_turn.get(t["turn"], {}).get("volunteered")
    )
    return {
        "mode": run["mode"],
        "language": run["language"],
        **totals,
        "long_repeats": long_repeats(run["turns"]),
        "thinking_lines": sum(bool(THINK.search(t["client"])) for t in run["turns"]),
        "ack_turns": len(acks),
        "ack_full": ack_full,
        "avg_words": round(
            sum(len(_words(t["client"])) for t in run["turns"]) / len(run["turns"]), 1
        ),
        "notes": notes,
    }


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--scenario", required=True)
    p.add_argument("runs", nargs="+")
    args = p.parse_args()
    scenario = json.loads(Path(args.scenario).read_text())
    client = OpenAI()
    for path in args.runs:
        result = judge(json.loads(Path(path).read_text()), scenario, client)
        print(json.dumps({"run": Path(path).name, **result}, ensure_ascii=False))


if __name__ == "__main__":
    main()
