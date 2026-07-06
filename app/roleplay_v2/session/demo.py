"""Interactive text REPL against the sample v2 spec.

    python -m app.roleplay_v2.session.demo

You type as the TRAINEE (counselor); the sample "Maya" spec plays the client
with the full Actor + Director runtime (Director awaited every turn). After
each exchange the REPL prints the Director's ruling: state transitions,
observed behaviors/score, ledger changes, and the active stage direction.

Requires real LLM credentials (OPENAI_API_KEY etc.) — this is a dev tool,
not a test. Type 'quit' or Ctrl-D to end and print the session summary.
"""

import asyncio

from app.llms import create_llm_client
from app.roleplay_v2.session.turn_loop import RoleplayTurnEngine
from app.roleplay_v2.spec.models import RoleplaySpecEnvelope
from scenario_spec_sample import SCENARIO_SPEC_SAMPLE


def _print_state(result, previous_state_id: str) -> str:
    snap = result.state_snapshot
    print()
    if snap.current_state_id != previous_state_id:
        print(f"  ── state: {previous_state_id} → {snap.current_state_id} ──")
    else:
        print(f"  ── state: {snap.current_state_id} ──")
    if result.verdict is not None:
        observed = result.verdict.observed_behavior_ids()
        if observed:
            print(f"  behaviors observed: {', '.join(observed)}")
        print(f"  cumulative score: {snap.cumulative_score:g}")
    else:
        print("  (director missed this turn)")
    unlocked = [s for s, v in snap.ledger.items() if v != "locked"]
    print(f"  ledger: {', '.join(unlocked) if unlocked else 'all locked'}")
    if snap.stage_direction:
        print(f"  stage direction: {snap.stage_direction}")
    print()
    return snap.current_state_id


async def main() -> None:
    envelope = RoleplaySpecEnvelope.model_validate(SCENARIO_SPEC_SAMPLE)
    spec = await envelope.ensure_spec()

    actor_llm = create_llm_client(
        llm_config=spec.actor_model.to_llm_config() if spec.actor_model else None,
        language_code=spec.language_code,
    ).llm_instance
    director_llm = create_llm_client(
        llm_config=(
            spec.director_model.to_llm_config() if spec.director_model else None
        ),
        language_code=spec.language_code,
    ).llm_instance

    engine = RoleplayTurnEngine(spec, actor_llm, director_llm, room_id="demo-repl")

    print(f"=== Roleplay Studio v2 demo — {spec.title} ===")
    print("You are the TRAINEE. Type 'quit' to end.\n")

    opening = await engine.opening()
    print(f"CLIENT: {opening.actor_text}\n")
    current_state = opening.state_snapshot.current_state_id

    loop = asyncio.get_running_loop()
    while True:
        try:
            text = await loop.run_in_executor(None, input, "TRAINEE > ")
        except (EOFError, KeyboardInterrupt):
            break
        text = text.strip()
        if not text:
            continue
        if text.lower() in {"quit", "exit"}:
            break
        result = await engine.trainee_turn(text, await_director=True)
        print(f"\nCLIENT: {result.actor_text}")
        current_state = _print_state(result, current_state)

    snap = await engine.state_store.snapshot()
    await engine.close()
    print("\n=== Session summary ===")
    print(f"  state path: {' → '.join(snap.state_path)}")
    print(f"  cumulative score: {snap.cumulative_score:g}")
    print(f"  ledger: {snap.ledger}")
    hits = {k: v for k, v in snap.behavior_hits.items() if v}
    print(f"  behavior hits: {hits}")
    print(
        f"  director: {snap.director_commits} commit(s), "
        f"{snap.director_misses} miss(es)"
    )


if __name__ == "__main__":
    asyncio.run(main())
