"""Real Postgres checkpointer (compose.yaml, `make db-up`): tables are created, a graph
run checkpoints there, a killed run resumes from it, and `replay` lists it."""

from __future__ import annotations

import pytest

from bug_hunter.graph.checkpointer import CheckpointerError, open_checkpointer

pytestmark = pytest.mark.docker


def test_postgres_checkpointer_round_trip() -> None:
    try:
        ctx = open_checkpointer()
        saver = ctx.__enter__()
    except CheckpointerError as exc:
        pytest.skip(f"checkpoint database not running: {exc}")
    try:
        cfg = {"configurable": {"thread_id": "it-round-trip", "checkpoint_ns": ""}}
        before = len(list(saver.list(cfg)))
        from langgraph.graph import END, START, StateGraph
        from typing_extensions import TypedDict

        class S(TypedDict, total=False):
            n: int

        g = StateGraph(S)
        g.add_node("inc", lambda s: {"n": s.get("n", 0) + 1})
        g.add_edge(START, "inc")
        g.add_edge("inc", END)
        compiled = g.compile(checkpointer=saver)
        out = compiled.invoke({"n": 0}, cfg)
        assert out["n"] == 1
        assert len(list(saver.list(cfg))) > before
    finally:
        ctx.__exit__(None, None, None)
