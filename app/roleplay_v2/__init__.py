"""Roleplay Studio v2 runtime.

A spec-driven roleplay engine that runs alongside the v1 scenario runtime
without touching it:

- ``spec``     — pydantic models for the frozen ScenarioSpec contract,
  runtime session state, and room-metadata parsing.
- ``actor``    — layered prompt compiler + LangGraph used by the voice
  worker's LLMAdapter and by the text-mode turn loop.
- ``director`` — the per-turn referee: observes trainee behaviors, walks the
  state machine, unlocks disclosure-ledger secrets, and issues stage
  directions. Emits results over SQS and the "director" data channel.
- ``session``  — text-mode turn loop used by the local demo REPL.

The voice entrypoint is ``app/worker_v2.py`` (a sibling of ``app/worker.py``;
v1 is untouched).
"""
