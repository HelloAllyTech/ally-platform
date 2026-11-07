#!/usr/bin/env python3
"""Scripted, text-only comparison of the old and new client prompts.

Plays a fixed list of learner turns against a scenario and records the client's
replies, so the same conversation can be run on:

- ``wm3``: Main Agent Prompt #3 with client working memory (its updater runs
  between turns, its backstory pool and the Knowledge Source picker as live);
- ``plain``: any other main prompt (e.g. ``_full``), Knowledge Sources via the
  picker;
- ``director``: Main Agent Prompt — Stage Director (memories every turn, the
  director's thought between turns).

It builds the system prompt with the same ``generate_system_message`` the live
graph uses and calls the model directly, so it tests what the prompts and
memory make the client say. It does not exercise audio, barge-in, events or
scoring: the learner's stage per turn is scripted instead. Use V2V for those.

Run inside the learn container (it needs OPENAI_API_KEY):

    python scripts/stage_director_harness.py --scenario s.json --script t.json \
        --mode director --prompts-dir .prompts/ally-ai-learn --out run.json
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from langchain_core.messages import AIMessage, HumanMessage  # noqa: E402
from langchain_openai import ChatOpenAI  # noqa: E402

from app.core.config import settings  # noqa: E402
from app.core.graph.knowledge_retrieval import RetrievedContextStore  # noqa: E402
from app.core.graph.prompt import generate_system_message  # noqa: E402
from app.core.scenario.base import Scenario  # noqa: E402

WM3 = "ally_ai_learn_system_main_agent_prompt_working_memory_split"
DIRECTOR = "ally_ai_learn_system_main_agent_prompt_stage_director"
UPDATER = "ally_ai_learn_system_client_working_memory_updater"
STAGE_DIRECTOR = "ally_ai_learn_system_stage_director"
DEFAULTS = Path(__file__).resolve().parent.parent / "app" / "prompts" / "system"


def _variables(text: str) -> list:
    return [{"name": v} for v in sorted(set(re.findall(r"\{(\w+)\}", text)))]


def _prompt_text(code: str, prompts_dir: Path) -> str:
    live = prompts_dir / f"{code}.txt"
    if live.exists():
        return live.read_text()
    default = DEFAULTS / (code.replace("ally_ai_learn_system_", "") + ".txt")
    return default.read_text()


def build_scenario(row: dict, mode: str, main_code: str, args) -> Scenario:
    metadata = dict(row["metadata"])
    prompts_dir = Path(args.prompts_dir)
    codes = {main_code}
    if mode == "wm3":
        codes.add(UPDATER)
    if mode == "director":
        codes.add(STAGE_DIRECTOR)
    prompts = {}
    for code in codes:
        text = _prompt_text(code, prompts_dir)
        prompts[code] = {
            "prompt": text,
            "availableVariables": _variables(text),
            "useDashboardOverride": True,
        }
    states = sorted(metadata.get("states") or [], key=lambda s: s.get("scoreLower", 0))
    prompt_data = {
        **metadata,
        "title": row.get("title"),
        "description": row.get("description"),
        "roleInstructions": row.get("prompt"),
        "states": states,
        "prompts": prompts,
        "selectedMainPromptCode": main_code,
        "languageLabel": args.language_label,
    }
    if args.memories:
        prompt_data["memories"] = json.loads(Path(args.memories).read_text())
    if args.samples_language_id and row.get("samples"):
        prompt_data["languageDialogueSamples"] = row["samples"].get(
            str(args.samples_language_id)
        )
    payload = {
        "scenario": {
            "id": str(row["id"]),
            "scenarioName": row.get("title"),
            "promptData": prompt_data,
            "language": {"code": args.language_code, "label": args.language_label},
        }
    }
    return Scenario.create(payload)


def _score_for_stage(states, stage: int):
    if not states:
        return 0
    st = states[min(stage, len(states) - 1)]
    lo = st.get("scoreLower", 0)
    hi = st.get("scoreUpper", lo + 1)
    return int((lo + hi) / 2)


async def run(args) -> dict:
    row = json.loads(Path(args.scenario).read_text())
    script = json.loads(Path(args.script).read_text())
    mode = args.mode
    main_code = {"wm3": WM3, "director": DIRECTOR}.get(mode) or args.main_code
    scenario = build_scenario(row, mode, main_code, args)
    pd = scenario.prompt_data
    states = list(getattr(pd, "states", None) or [])

    actor = SimpleNamespace(
        llm_instance=ChatOpenAI(model=args.model, temperature=args.temperature),
        provider="openai",
    )
    retrieved_store = RetrievedContextStore()
    wm_store = director_store = None
    if mode == "wm3":
        from app.core.working_memory import ClientWorkingMemoryStore, build_corpus

        ladder = tuple(s["name"] for s in states if s.get("name")) or None
        wm_store = ClientWorkingMemoryStore(ladder=ladder)
        wm_store.corpus = build_corpus(
            character_profile_text=getattr(pd, "character_profile_text", None)
        )
    if mode == "director":
        from app.core.stage_director import StageDirectorStore

        director_store = StageDirectorStore()

    opening = (getattr(pd, "opening_statements", None) or [""])[0]
    history = [AIMessage(content=opening)] if opening else []
    turns = []
    retrieved = None
    for i, step in enumerate(script["turns"]):
        learner = step["say"]
        score = _score_for_stage(states, step.get("stage", 0))
        history.append(HumanMessage(content=learner))
        config = {
            "configurable": {
                "scenario": scenario,
                "llm_client": actor,
                "retrieved_context_store": retrieved_store,
            }
        }

        # Retrieval, as the live graph runs it (director prompts skip
        # Knowledge Sources inside it).
        from app.core.graph.nodes import retrieve_knowledge

        state_ns = SimpleNamespace(messages=list(history), retrieved_context=retrieved)
        retrieved = (await retrieve_knowledge(state_ns, config)).get(
            "retrieved_context", retrieved
        )

        kwargs = {}
        memory_snapshot = None
        if mode == "wm3":
            memory_snapshot = await wm_store.begin_turn()
            kwargs["client_working_memory"] = memory_snapshot
            from app.core.graph.knowledge_locks import locked_topics, resolve_for_turn
            from app.core.graph.prompt import _resolve_simulation_state_by_score

            _, locked, _ = resolve_for_turn(
                getattr(pd, "knowledge_sources", None),
                states,
                _resolve_simulation_state_by_score(states, score),
                retrieved_store.unlocks,
            )
            kwargs["locked_memory_topics"] = locked_topics(locked)
        if mode == "director":
            from app.core.graph.prompt import _resolve_simulation_state_by_score
            from app.core.stage_director.memories import (
                partition_for_turn,
                render_memory_block,
            )

            unlocked, locked = partition_for_turn(
                pd,
                _resolve_simulation_state_by_score(states, score),
                retrieved_store.unlocks,
            )
            director_store.begin_turn()
            kwargs.update(
                memories=render_memory_block(unlocked, locked),
                thoughts=director_store.thought_for_prompt(),
                prompt_kwargs_sink=director_store.prompt_kwargs,
            )

        system, retrieved_msg = generate_system_message(
            prompt_data=pd,
            language_code=args.language_code,
            behavior_instructions=scenario.behavior_instructions,
            retrieved_context=retrieved,
            current_score=score,
            defer_retrieved_context=settings.RETRIEVED_CONTEXT_DEFER_TO_SUFFIX,
            **kwargs,
        )
        messages = [system, *history]
        if retrieved_msg is not None:
            messages.append(retrieved_msg)
        reply = (await actor.llm_instance.ainvoke(messages)).content
        history.append(AIMessage(content=reply))
        record = {
            "turn": i + 1,
            "stage": step.get("stage", 0),
            "learner": learner,
            "client": reply,
            "thought_used": kwargs.get("thoughts"),
            "retrieved": bool(retrieved),
        }

        window = list(history)[-max(2, settings.CLIENT_WORKING_MEMORY_WINDOW_TURNS) :]
        if mode == "wm3":
            from app.core.graph.prompt import _resolve_simulation_state_by_score
            from app.core.working_memory.consolidate import schedule_update

            authored = _resolve_simulation_state_by_score(states, score)
            schedule_update(
                wm_store,
                memory=memory_snapshot,
                new_messages=window,
                llm_client=actor,
                timeout=settings.CLIENT_WORKING_MEMORY_TIMEOUT,
                prompt_data=pd,
                authored_stance=(authored or {}).get("name"),
            )
            if wm_store._task is not None:
                await wm_store._task
            snap = await wm_store.snapshot()
            record["memory"] = {
                "disclosed": [f.text for f in snap.disclosed][-6:],
                "open_threads": [t.topic for t in snap.open_threads],
                "salient": [f.text for f in snap.salient_backstory],
            }
        if mode == "director":
            from app.core.graph.prompt import _resolve_simulation_state_by_score
            from app.core.stage_director.director import schedule_thought

            authored = _resolve_simulation_state_by_score(states, score)
            schedule_thought(
                director_store,
                prompt_data=pd,
                messages=window,
                llm_client=actor,
                timeout=settings.CLIENT_WORKING_MEMORY_TIMEOUT,
                current_state=(authored or {}).get("name"),
                record_store=SimpleNamespace(monologue=[]),
            )
            if director_store._task is not None:
                await director_store._task
            record["thought_written"] = director_store.thought
        turns.append(record)
        print(json.dumps(record, ensure_ascii=False), flush=True)
    return {
        "scenario": row["id"],
        "mode": mode,
        "main_code": main_code,
        "language": args.language_code,
        "turns": turns,
    }


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--scenario", required=True)
    p.add_argument("--script", required=True)
    p.add_argument("--mode", choices=["wm3", "plain", "director"], required=True)
    p.add_argument("--main-code", default="ally_ai_learn_system_main_agent_prompt_full")
    p.add_argument("--prompts-dir", default=".prompts/ally-ai-learn")
    p.add_argument("--memories", help="JSON list of memories (director mode)")
    p.add_argument("--language-code", default="en-IN")
    p.add_argument("--language-label", default="English (India)")
    p.add_argument("--samples-language-id")
    p.add_argument("--model", default="gpt-4o-mini")
    p.add_argument("--temperature", type=float, default=0.7)
    p.add_argument("--out", required=True)
    args = p.parse_args()
    result = asyncio.run(run(args))
    Path(args.out).write_text(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
