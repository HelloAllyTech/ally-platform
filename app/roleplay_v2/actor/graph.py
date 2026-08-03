"""Single-node LangGraph wrapping the ActorEngine for LLMAdapter streaming.

The LiveKit ``LLMAdapter`` converts the session chat context to
``{"messages": [...]}`` and streams the graph with ``stream_mode="messages"``
— tokens emitted by the chat model inside the node stream straight to TTS.

The node:
- advances the turn counter (``begin_turn``) when the last message is a real
  trainee utterance, so the turn card and the Director agree on turn_index;
- records ``prompt_compile_ms`` and ``direction_staleness_turns`` into the
  per-turn metrics via app/roleplay_v2/telemetry.py;
- emits actor LLM token usage (best-effort);
- invokes an ``on_turn`` hook from the configurable after the reply is
  generated — the voice worker uses it to hand the committed turn pair to
  the DirectorService without the graph importing LiveKit.
"""

from __future__ import annotations

import asyncio
import inspect
from typing import Annotated, Any, Optional, TypedDict

from langchain_core.messages import AnyMessage, HumanMessage
from langchain_core.runnables import RunnableConfig
from langgraph.graph import END, START, StateGraph, add_messages

from app.core.config import settings
from app.core.logger import get_logger
from app.roleplay_v2 import telemetry
from app.roleplay_v2.actor.engine import ActorEngine

logger = get_logger(__name__)


class ActorGraphState(TypedDict):
    messages: Annotated[list[AnyMessage], add_messages]


def _emit_actor_usage(room_id: str, engine: ActorEngine, response: Any) -> None:
    """Best-effort llm_usage emit for the actor turn."""
    try:
        usage = getattr(response, "usage_metadata", None) or {}
        prompt_tokens = int(usage.get("input_tokens", 0) or 0)
        completion_tokens = int(usage.get("output_tokens", 0) or 0)
        total_tokens = int(usage.get("total_tokens", 0) or 0)
        if not (prompt_tokens or completion_tokens or total_tokens):
            return
        input_details = usage.get("input_token_details") or {}
        cached_tokens = int(input_details.get("cache_read", 0) or 0)
        from app.core.llm_usage.emitter import emit_ai_usage

        llm = engine.llm
        model = getattr(llm, "model_name", None) or getattr(llm, "model", None)
        emit_ai_usage(
            room_id,
            service="llm",
            provider=type(llm).__name__,
            model=str(model) if model else "unknown",
            task="actor_turn",
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=total_tokens,
            cached_tokens=cached_tokens,
        )
    except Exception:  # noqa: BLE001 - usage must never break a turn
        logger.debug("[roleplay_v2] actor usage emit skipped", exc_info=True)


def build_actor_graph(engine: ActorEngine):
    """Compile the single-node actor graph bound to ``engine``.

    No checkpointer: the LLMAdapter passes the FULL chat context on every
    invocation, so graph state never needs to persist across turns.
    """

    async def generate_actor_response(
        state: ActorGraphState, config: Optional[RunnableConfig] = None
    ) -> dict:
        configurable = (config or {}).get("configurable", {}) or {}
        room_id: str = configurable.get("thread_id") or ""
        on_turn = configurable.get("on_turn")

        history = list(state["messages"])
        is_trainee_turn = bool(history) and isinstance(history[-1], HumanMessage)

        # A real trainee turn advances the shared counter; the opening
        # auto-reply (no preceding user message) only snapshots.
        if is_trainee_turn:
            snapshot = await engine.state_store.begin_turn()
        else:
            snapshot = await engine.state_store.snapshot()

        # Optional grace window: give a near-done Director verdict (for the
        # PREVIOUS turn) a beat to land before compiling the turn card —
        # trades a little voice latency for fresher direction. Off by
        # default (DIRECTOR_GRACE_MS=0). The advanced turn counters are
        # preserved; only Director-owned fields are re-read.
        grace_ms = float(getattr(settings, "DIRECTOR_GRACE_MS", 0.0))
        if is_trainee_turn and grace_ms > 0:
            await asyncio.sleep(grace_ms / 1000.0)
            fresh = await engine.state_store.snapshot()
            fresh.turn_index = snapshot.turn_index
            snapshot = fresh

        telemetry.reset_turn_fields(room_id)
        prepared = await engine.prepare(history, snapshot=snapshot)
        telemetry.record_turn_fields(
            room_id,
            prompt_compile_ms=round(prepared.prompt_compile_ms, 2),
            direction_staleness_turns=prepared.snapshot.direction_staleness_turns,
            roleplay_v2_state_id=prepared.snapshot.current_state_id,
            roleplay_v2_turn_index=prepared.snapshot.turn_index,
        )

        response = await engine.llm.ainvoke(prepared.messages)
        _emit_actor_usage(room_id, engine, response)

        if on_turn is not None and is_trainee_turn:
            trainee_text = engine._last_user_text(history)
            actor_text = getattr(response, "content", "")
            try:
                result = on_turn(snapshot.turn_index, trainee_text, actor_text)
                if inspect.isawaitable(result):
                    asyncio.ensure_future(result)
            except Exception:  # noqa: BLE001 - hook must never break the reply
                logger.exception("[roleplay_v2] on_turn hook failed")

        return {"messages": [response]}

    graph = StateGraph(ActorGraphState)
    graph.add_node("generate_actor_response", generate_actor_response)
    graph.add_edge(START, "generate_actor_response")
    graph.add_edge("generate_actor_response", END)
    return graph.compile()
