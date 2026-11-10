"""The Debrief graph.

    START → plan ─┬→ safety_reader ─┐        (same superstep)
                  └→ analyst ───────┴→ after_reading
    plan ─(no budget for the safety reader)→ finish
    after_reading ─(no safety reading)→ finish
                  ├→ progress_reader → guidance_lookup
                  └→ guidance_lookup → prepare_writer ─(no budget)→ finish
                                                      └→ writer ─(failed twice)→ finish
                                                                └→ checks
    checks ─(evaluator fits)→ evaluator → score_draft
           └(no budget)───────────────→ score_draft
    score_draft ─(below the bar, rounds left)→ revise_gate ─→ reviser ─→ checks
               │                                         └(deadline / budget)→ decide
               │                                    reviser ─(failed twice)→ decide
               └(meets the bar or no rounds left)→ decide → finish → END

The loop ends: every pass through `revise_gate` that reaches the reviser adds a
round, and `score_draft` stops at the recipe's `maxRevisionRounds`.
"""

from __future__ import annotations

from typing import Optional, Tuple

from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph
from langgraph.types import RetryPolicy

from app.core.agent_runtime import checkpointer as runtime_checkpointer
from app.core.debrief_graph import model_steps, nodes
from app.core.debrief_graph.context import DebriefRunContext
from app.core.debrief_graph.gateway import is_transient
from app.core.debrief_graph.model_step import make_model_step
from app.core.debrief_graph.state import DebriefState

#: Gateway tools (checks, render, finalise) that did not answer are retried.
GATEWAY_RETRY = RetryPolicy(max_attempts=3, initial_interval=0.5, retry_on=is_transient)


def build_graph(checkpointer: Optional[BaseCheckpointSaver]) -> CompiledStateGraph:
    g = StateGraph(DebriefState, context_schema=DebriefRunContext)
    g.add_node("plan", nodes.plan)
    g.add_node("safety_reader", **make_model_step(model_steps.SAFETY_READER))
    g.add_node("analyst", **make_model_step(model_steps.ANALYST))
    g.add_node("after_reading", nodes.after_reading)
    g.add_node("progress_reader", **make_model_step(model_steps.PROGRESS_READER))
    g.add_node("guidance_lookup", nodes.guidance_lookup)
    g.add_node("prepare_writer", nodes.prepare_writer)
    g.add_node("writer", **make_model_step(model_steps.WRITER))
    g.add_node("checks", nodes.checks, retry_policy=GATEWAY_RETRY)
    g.add_node("evaluator", **make_model_step(model_steps.EVALUATOR))
    g.add_node("score_draft", nodes.score_draft)
    g.add_node("revise_gate", nodes.revise_gate)
    g.add_node("reviser", **make_model_step(model_steps.REVISER))
    g.add_node("decide", nodes.decide, retry_policy=GATEWAY_RETRY)
    g.add_node("finish", nodes.finish)

    g.add_edge(START, "plan")
    g.add_edge("safety_reader", "after_reading")
    g.add_edge("analyst", "after_reading")
    g.add_edge("progress_reader", "guidance_lookup")
    g.add_edge("guidance_lookup", "prepare_writer")
    g.add_edge("evaluator", "score_draft")
    g.add_edge("decide", "finish")
    g.add_edge("finish", END)
    return g.compile(checkpointer=checkpointer)


_compiled: Optional[Tuple[object, CompiledStateGraph]] = None
_fallback_saver: Optional[BaseCheckpointSaver] = None


def get_debrief_graph() -> CompiledStateGraph:
    """Compiled once per checkpointer: the Agents v2 runtime's when startup
    opened it, otherwise one process-wide in-memory saver (so a resume within
    the same process still finds its thread)."""
    global _compiled, _fallback_saver
    saver = runtime_checkpointer._saver
    if saver is None:
        if _fallback_saver is None:
            _fallback_saver = runtime_checkpointer.get_checkpointer()
        saver = _fallback_saver
    if _compiled is None or _compiled[0] is not saver:
        _compiled = (saver, build_graph(saver))
    return _compiled[1]
