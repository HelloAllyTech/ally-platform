from langgraph.constants import END, START
from langgraph.graph import StateGraph
from langgraph.graph.state import CompiledStateGraph

from app.core.config import settings
from app.core.graph.nodes import (
    clear_events_and_detected_data,
    compact_history,
    detect_behaviors,
    generate_response,
    process_events,
    process_gating_events,
    publish_done_thinking,
    resolve_branching_instruction,
    retrieve_knowledge,
    send_event_feedback,
    sync_events_and_behaviors_node,
    update_working_memory,
)
from app.core.graph.state import SimulationState


def build_resolve_branching_subgraph() -> CompiledStateGraph[SimulationState]:
    """
    Build a subgraph for resolving branching instructions.

    This subgraph is isolated from the main graph's streaming output.
    When subgraphs=False (default in LLMAdapter), the LLM outputs from
    this subgraph will NOT be streamed to TTS/UI.

    This is a workaround for LiveKit issue #2836:
    https://github.com/livekit/agents/issues/2836

    The issue: LangGraph LLMAdapter streams all LLM outputs from every node
    in a multi-node graph. By wrapping resolve_branching_instruction in a subgraph,
    its LLM outputs (used for resolving branching instruction tags) won't be
    streamed when subgraphs=False.

    Returns:
        Compiled subgraph that resolves branching instructions
    """
    subgraph = StateGraph(SimulationState)
    subgraph.add_node("resolve_branching_instruction", resolve_branching_instruction)
    subgraph.add_edge(START, "resolve_branching_instruction")
    subgraph.add_edge("resolve_branching_instruction", END)
    return subgraph.compile()


def build_retrieve_knowledge_subgraph() -> CompiledStateGraph[SimulationState]:
    """
    Build a subgraph for knowledge retrieval.

    This subgraph is isolated from the main graph's streaming output.
    When subgraphs=False (default in LLMAdapter), the LLM outputs from
    this subgraph will NOT be streamed to TTS/UI.

    Although retrieve_knowledge uses with_structured_output, LiveKit's
    LLMAdapter still intercepts the underlying LLM stream before the
    structured-output parser runs. Wrapping in a subgraph is the same
    workaround used for resolve_branching_instruction.

    This is a workaround for LiveKit issue #2836:
    https://github.com/livekit/agents/issues/2836

    Returns:
        Compiled subgraph that retrieves relevant knowledge context
    """
    subgraph = StateGraph(SimulationState)
    subgraph.add_node("retrieve_knowledge", retrieve_knowledge)
    subgraph.add_edge(START, "retrieve_knowledge")
    subgraph.add_edge("retrieve_knowledge", END)
    return subgraph.compile()


def build_compact_history_subgraph() -> CompiledStateGraph[SimulationState]:
    """
    Build a subgraph for the rolling-summary compactor.

    compact_history makes an LLM call (the summarizer), so it needs the same
    subgraph isolation as resolve_branching_instruction / retrieve_knowledge —
    otherwise its output would stream to TTS (LiveKit issue #2836).

    Returns:
        Compiled subgraph that updates the rolling conversation summary
    """
    subgraph = StateGraph(SimulationState)
    subgraph.add_node("compact_history", compact_history)
    subgraph.add_edge(START, "compact_history")
    subgraph.add_edge("compact_history", END)
    return subgraph.compile()


def build_update_working_memory_subgraph() -> CompiledStateGraph[SimulationState]:
    """
    Build a subgraph for the client working memory's consolidation trigger.

    Subgraph-wrapped for the same reason as compact_history even though this
    node only SCHEDULES its call: the detached task is created inside the node,
    so it inherits the run's streaming context, and the isolation is what keeps
    the updater's structured output from reaching TTS (LiveKit issue #2836).
    Cheap insurance against a leak that would be heard rather than logged.

    Returns:
        Compiled subgraph that fires the working-memory consolidation
    """
    subgraph = StateGraph(SimulationState)
    subgraph.add_node("update_working_memory", update_working_memory)
    subgraph.add_edge(START, "update_working_memory")
    subgraph.add_edge("update_working_memory", END)
    return subgraph.compile()


def build_simulation_graph() -> StateGraph[SimulationState]:
    """
    Build the LangGraph state graph.

    Flow:
    1. START splits into three parallel paths:
       - detect_behaviors: Detects behaviors from behavior instructions
       - process_events: Detects events, updates EventRegistry
       - retrieve_knowledge: Retrieves relevant knowledge context (as subgraph)
    2. sync_events_and_behaviors_node:
        Convergence point for all three parallel paths
    3. resolve_branching_instruction: Resolves branching instructions with LLM calls
       (as subgraph)
    4. generate_response: Generates LLM response based on detected events
    5. publish_done_thinking: Terminal node on the reply path; fires the
       done_thinking signal once the reply has finished streaming.
    6. send_event_feedback: Sends event and behavior feedback to the UI and clears
       transient state. Separated from generate_response so the core nodes can be
       reused by the report graph without UI concerns.

    Note: resolve_branching_instruction and retrieve_knowledge are subgraphs
    to prevent their LLM outputs from being streamed. With subgraphs=False
    (default in LLMAdapter), only root graph outputs are streamed.

    This is a workaround for LiveKit issue #2836:
    https://github.com/livekit/agents/issues/2836
    """
    # Build the main graph
    graph = StateGraph(SimulationState)
    # EVENTS_OFF_GATE_DEFER_DETECTION splits event handling into a gating node
    # (detects only reply-shaping events; gates the reply) and deferred
    # (non-reply-shaping) detection. The flag-OFF path keeps the single
    # process_events node — today's topology exactly.
    #
    # Deferred detection is NOT a graph node (it used to be — see git history
    # for `process_deferred_events`). LangGraph schedules nodes in
    # "supersteps" with a hard barrier between them: nothing in the next
    # superstep can start until EVERYTHING in the current one finishes, even
    # tasks nothing downstream depends on. process_gating_events completing
    # triggers both sync_events_and_behaviors_node AND (formerly)
    # process_deferred_events into the same superstep, so the reply
    # (resolve_branching_instruction, one superstep later) waited on deferred
    # detection's full duration every turn — exactly the latency
    # EVENTS_OFF_GATE_DEFER_DETECTION was supposed to eliminate. Deferred
    # detection now runs as a genuinely detached asyncio task, spawned from
    # inside process_gating_events via orchestrator._spawn_background (see
    # app/core/graph/nodes.py), which is outside LangGraph's scheduler
    # entirely and therefore cannot block any superstep.
    events_node = (
        "process_gating_events"
        if settings.EVENTS_OFF_GATE_DEFER_DETECTION
        else "process_events"
    )
    if settings.EVENTS_OFF_GATE_DEFER_DETECTION:
        graph.add_node("process_gating_events", process_gating_events)
    else:
        graph.add_node("process_events", process_events)

    # Build the resolve_branching_instruction subgraph and add it as a node
    # This prevents its LLM outputs (for resolving branching tags) from being streamed
    resolve_branching_subgraph = build_resolve_branching_subgraph()
    graph.add_node("resolve_branching_instruction", resolve_branching_subgraph)

    # Add generate_response as a regular node (its LLM outputs WILL be streamed)
    graph.add_node("generate_response", generate_response)

    # Add detect_behaviors as a regular node
    # This runs in parallel with process_events from START
    graph.add_node("detect_behaviors", detect_behaviors)

    # Build the retrieve_knowledge subgraph and add it as a node
    # This prevents its LLM outputs from being streamed to TTS/UI
    retrieve_knowledge_subgraph = build_retrieve_knowledge_subgraph()
    graph.add_node("retrieve_knowledge", retrieve_knowledge_subgraph)

    # sync_events_and_behaviors_node acts as a convergence point for
    # detect_behaviors, process_events, and retrieve_knowledge
    # before resolve_branching_instruction
    graph.add_node("sync_events_and_behaviors_node", sync_events_and_behaviors_node)

    # send_event_feedback runs last — sends event scores/feedback to UI.
    # Kept separate from generate_response so that node stays reusable
    # for contexts that don't need UI feedback (e.g. report generation).
    graph.add_node("send_event_feedback", send_event_feedback)

    # publish_done_thinking is the terminal node on the reply path: it fires the
    # done_thinking signal once generate_response finishes streaming the reply.
    # It makes no LLM calls, so no subgraph isolation is needed. Omitted from the
    # report graph (which has no LiveKit room).
    graph.add_node("publish_done_thinking", publish_done_thinking)

    # START splits into parallel paths
    graph.add_edge(START, "detect_behaviors")
    graph.add_edge(START, events_node)
    graph.add_edge(START, "retrieve_knowledge")

    # The event node and retrieve_knowledge always gate the response (the reply
    # consumes branching instructions + retrieved_context).
    graph.add_edge(events_node, "sync_events_and_behaviors_node")
    graph.add_edge("retrieve_knowledge", "sync_events_and_behaviors_node")

    if settings.BEHAVIORS_OFF_GATE:
        # Behaviors only drive scoring + UI feedback (not the reply text), so
        # run them parallel to the response and join at send_event_feedback —
        # off the voice-to-voice critical path. See BEHAVIORS_OFF_GATE.
        graph.add_edge("detect_behaviors", "send_event_feedback")
    else:
        graph.add_edge("detect_behaviors", "sync_events_and_behaviors_node")

    # Continue with sequential flow
    graph.add_edge("sync_events_and_behaviors_node", "resolve_branching_instruction")
    graph.add_edge("resolve_branching_instruction", "generate_response")
    graph.add_edge("resolve_branching_instruction", "send_event_feedback")

    graph.add_edge("generate_response", "publish_done_thinking")

    # Client working memory: also strictly AFTER publish_done_thinking, and
    # PARALLEL to compact_history rather than chained behind it. The two are
    # independent — one records what was said, the other who said it — and
    # chaining would make this wait on the summarizer's gate for no reason.
    # Both only schedule detached work, so neither extends the run measurably.
    #
    # Unconditional now that prompt selection is the only opt-in. The node used
    # to be added only when CLIENT_WORKING_MEMORY_ENABLED was true, which read
    # the flag at BUILD time against a graph compiled once at import — so the
    # env var could only be turned on by a restart, and a scenario pointed at
    # the working-memory prompt on a worker built without it ran silently
    # without the feature. The per-turn gate inside the node is what decides
    # whether any work happens: a scenario whose prompt declares no
    # working_memory placeholder returns immediately, so the cost for every
    # other simulation in the fleet is one no-op node visit.
    working_memory_subgraph = build_update_working_memory_subgraph()
    graph.add_node("update_working_memory", working_memory_subgraph)
    graph.add_edge("publish_done_thinking", "update_working_memory")
    graph.add_edge("update_working_memory", END)

    if settings.ROLLING_SUMMARY_ENABLED:
        # Rolling-summary compactor: strictly AFTER publish_done_thinking (the
        # reply has fully streamed; the done_thinking signal is already out),
        # so its summarizer LLM call never adds latency to the spoken reply.
        # It extends the graph run by one bounded call every
        # ROLLING_SUMMARY_EVERY_TURNS turns. Subgraph-wrapped so its LLM
        # output never streams to TTS.
        compact_history_subgraph = build_compact_history_subgraph()
        graph.add_node("compact_history", compact_history_subgraph)
        graph.add_edge("publish_done_thinking", "compact_history")
        graph.add_edge("compact_history", END)
    else:
        graph.add_edge("publish_done_thinking", END)
    graph.add_edge("send_event_feedback", END)

    return graph


def _build_report_graph() -> StateGraph:
    """
    Construct the report-specific StateGraph (topology only, not compiled).

    Reuses the core simulation nodes (process_events, resolve_branching_instruction,
    generate_response, detect_behaviors, retrieve_knowledge) but omits the
    LiveKit/TTS/UI-only nodes:
    - send_event_feedback  (UI score/emoji feedback sending)

    Uses SimulationState so nodes are shared without any adaptation.
    The UI-only fields (non_branching_feedback_data, feedback_to_send,
    behavior_feedback_data) carry their defaults and are simply never sent to UI.

    Flow:
        START → [process_events, retrieve_knowledge (subgraph),
        detect_behaviors] (parallel)
              → sync_events_and_behaviors_node
              → resolve_branching_instruction (subgraph)
              → generate_response
              → clear_events_and_detected_data → END

    Not called directly — use ``get_report_graph()`` which caches the result.
    """
    graph = StateGraph(SimulationState)

    graph.add_node("process_events", process_events)

    # Subgraph prevents streaming of branching resolution LLM text output
    resolve_branching_subgraph = build_resolve_branching_subgraph()
    graph.add_node("resolve_branching_instruction", resolve_branching_subgraph)

    # Subgraph prevents streaming of knowledge retrieval LLM output
    retrieve_knowledge_subgraph = build_retrieve_knowledge_subgraph()
    graph.add_node("retrieve_knowledge", retrieve_knowledge_subgraph)

    graph.add_node("generate_response", generate_response)

    # detect_behaviors runs in parallel with process_events
    # and retrieve_knowledge from START
    graph.add_node("detect_behaviors", detect_behaviors)

    # Sync node for fan-in of all three parallel paths before
    # resolve_branching_instruction
    graph.add_node("sync_events_and_behaviors_node", sync_events_and_behaviors_node)

    # Add clear_events_and_detected_data node to clean up event data
    graph.add_node("clear_events_and_detected_data", clear_events_and_detected_data)

    # START fans out to all three parallel paths
    graph.add_edge(START, "process_events")
    graph.add_edge(START, "retrieve_knowledge")
    graph.add_edge(START, "detect_behaviors")

    # All three converge at sync node
    graph.add_edge("process_events", "sync_events_and_behaviors_node")
    graph.add_edge("retrieve_knowledge", "sync_events_and_behaviors_node")
    graph.add_edge("detect_behaviors", "sync_events_and_behaviors_node")

    graph.add_edge("sync_events_and_behaviors_node", "resolve_branching_instruction")
    graph.add_edge("resolve_branching_instruction", "generate_response")
    graph.add_edge("generate_response", "clear_events_and_detected_data")

    # Clear events data and lead to END
    graph.add_edge("clear_events_and_detected_data", END)

    return graph


# Module-level cache: the graph topology is static, so it is built once and
# reused. Only .compile(checkpointer=...) is called per-report, which is cheap.
_report_graph: StateGraph = _build_report_graph()


def get_report_graph() -> StateGraph:
    """Return the cached report StateGraph (built once at import time)."""
    return _report_graph
