"""
Report-specific LangGraph for simulating N-turn text-only conversations.

Reuses the core event detection, branching resolution, and LLM response
generation logic but strips out LiveKit/TTS/UI concerns.

Flow:
    START -> process_report_events -> resolve_report_branching
          -> generate_report_response -> END
"""

from typing import Annotated, Any, List, Optional, Tuple, cast

from langchain_core.messages import AIMessage, AnyMessage
from langchain_core.runnables import RunnableConfig
from langgraph.constants import END, START
from langgraph.graph import StateGraph, add_messages
from pydantic import BaseModel

from app.core.constants import DEFAULT_LANGUAGE_CODE
from app.core.events.base import BaseEvent
from app.core.graph.nodes import (
    _calculate_score_updates,
    _detect_events,
    _orchestrate_and_split_events,
    _prepare_event_context,
    _resolve_current_state,
)
from app.core.graph.prompt import generate_system_message
from app.core.graph.state import (
    BranchingAndFeedbackData,
    add_branching_and_feedback_data,
    add_events_accumulator,
    add_new_events,
    add_permitted_events,
    add_scores,
    replace_next_instruction,
)
from app.core.logger import get_logger
from app.core.scenario.base import Scenario
from app.core.time_utils import TimingContext

logger = get_logger(__name__)


# ------------------------------------------------------------------
# State
# ------------------------------------------------------------------


class ReportState(BaseModel):
    """
    Minimal LangGraph state for text-only report simulation.

    Excludes UI/LiveKit-only fields from SimulationState:
    - ``non_branching_feedback_data`` (async UI feedback)
    - ``feedback_to_send`` (UI display)
    """

    messages: Annotated[List[AnyMessage], add_messages]
    permitted_events: Annotated[List[BaseEvent], add_permitted_events]
    events_accumulator: Annotated[List[Tuple[str, BaseEvent]], add_events_accumulator]
    new_events: Annotated[List[BaseEvent], add_new_events]
    current_score: Annotated[int, add_scores]
    branching_and_feedback_data: Annotated[
        List[BranchingAndFeedbackData], add_branching_and_feedback_data
    ]
    next_instruction: Annotated[Optional[str], replace_next_instruction] = None


# ------------------------------------------------------------------


def _get_scenario_config(
    config: Optional[RunnableConfig],
) -> Tuple[Optional[Scenario], str, Optional[Any]]:
    """Extract scenario, language_code, and branching LLM config from graph config."""
    if not config or "configurable" not in config:
        return None, DEFAULT_LANGUAGE_CODE, None

    scenario = cast(
        Optional[Scenario], config["configurable"].get("scenario")
    )
    language_code = DEFAULT_LANGUAGE_CODE
    branching_llm_config = None

    if scenario and scenario.language_config:
        language_code = scenario.language_config.language_code
        branching_llm_config = scenario.language_config.branching_llm_config

    return scenario, language_code, branching_llm_config


# ====================================================================
# Node: process_report_events
# ====================================================================


async def process_report_events(
    state: ReportState, config: Optional[RunnableConfig] = None
) -> dict:
    """
    Detect and orchestrate events for a report turn.

    Mirrors ``process_events`` but omits UI event sending
    (handled by the orchestrator's ``is_report_mode`` flag).
    """
    with TimingContext("process_report_events") as timing:
        with timing.operation("Context preparation"):
            chat_messages, elapsed_time, live_score, orchestrator, room = (
                _prepare_event_context(state, config)
            )

        with timing.operation("Event detection"):
            detected_events, new_events = await _detect_events(
                state.permitted_events,
                chat_messages,
                elapsed_time,
                live_score,
                orchestrator,
            )

        additional_score = 0
        branching_and_feedback_data: list[BranchingAndFeedbackData] = []

        if orchestrator is not None:
            with timing.operation("Orchestration and splitting"):
                additional_score, branching_and_feedback_data, _ = (
                    await _orchestrate_and_split_events(orchestrator, room, new_events)
                )

        with timing.operation("Score calculation"):
            new_current_score = _calculate_score_updates(
                state, new_events, additional_score
            )

        timing.log_summary()

    update_dict: dict = {
        "messages": state.messages,
        "permitted_events": state.permitted_events,
        "events_accumulator": state.events_accumulator + detected_events,
        "new_events": new_events,
        "current_score": new_current_score,
    }

    if branching_and_feedback_data:
        update_dict["branching_and_feedback_data"] = branching_and_feedback_data

    return update_dict


# ====================================================================
# Node: resolve_report_branching
# ====================================================================


async def resolve_report_branching(
    state: ReportState, config: Optional[RunnableConfig] = None
) -> dict:
    """
    Pick the highest-score branching event, resolve ``llm_response`` tags,
    and set ``next_instruction`` + ``feedback_to_send``.

    This is a streamlined version of ``resolve_branching_instruction``
    that skips UI-specific concerns.
    """
    logger.info("Resolving branching instruction (report mode)")

    next_instruction = None
    selected = None

    if state.branching_and_feedback_data:
        candidates = [
            ed
            for ed in state.branching_and_feedback_data
            if ed.branching_instruction is not None
        ]

        if candidates:
            selected = max(candidates, key=lambda e: abs(e.score))
            instruction = selected.branching_instruction
            _, language_code, branching_llm_config = _get_scenario_config(config)

            if instruction.needs_llm_resolution():
                logger.info("Resolving LLM response tags in branching instruction")
                await instruction.resolve_llm_responses(
                    llm_config=branching_llm_config,
                    language_code=language_code,
                )

            next_instruction = (
                await instruction.resolve_dynamic_branching_instruction(
                    messages=state.messages,
                    llm_config=branching_llm_config,
                    language_code=language_code,
                )
            )

    return {"next_instruction": next_instruction}


# ====================================================================
# Node: generate_report_response
# ====================================================================


async def generate_report_response(
    state: ReportState, config: Optional[RunnableConfig] = None
) -> ReportState:
    """
    Generate a text-only LLM response for the client agent.

    Mirrors the core ``generate_response`` logic but omits
    UI feedback sending and voice expression processing.
    """
    logger.info("Generating response (report mode)")

    next_instruction = state.next_instruction
    scenario, language_code, _ = _get_scenario_config(config)

    system_message = None
    current_state = None
    if scenario is not None:
        if not next_instruction:
            current_state = _resolve_current_state(
                scenario.state_instructions, state.current_score
            )

        system_message = generate_system_message(
            prompt_data=scenario.prompt_data,
            next_instruction=next_instruction,
            language_code=language_code,
            behavior_instructions=scenario.behavior_instructions,
            current_state=current_state,
        )

    llm_client = (
        config["configurable"].get("llm_client")
        if config and "configurable" in config
        else None
    )

    if llm_client is None:
        from app.llms import create_llm_client

        llm_config_from_metadata = (
            scenario.language_config.llm_config
            if scenario and scenario.language_config
            else None
        )
        try:
            llm_client = create_llm_client(
                llm_config=llm_config_from_metadata,
                language_code=language_code,
            )
        except Exception as e:
            logger.warning(
                "LLM config failed for %s, using default: %s",
                language_code,
                e,
            )
            llm_client = create_llm_client(
                language_code=DEFAULT_LANGUAGE_CODE
            )

    messages_to_send = []
    if system_message is not None:
        messages_to_send.append(system_message)
    messages_to_send.extend(state.messages)

    response = await llm_client.llm_instance.ainvoke(messages_to_send)

    return ReportState(
        messages=[AIMessage(content=response.content)],
        permitted_events=state.permitted_events,
        events_accumulator=state.events_accumulator,
        current_score=state.current_score,
        new_events=[],
        branching_and_feedback_data=[],
        next_instruction=None,
    )


# ====================================================================
# Graph builder
# ====================================================================


def build_report_graph() -> StateGraph:
    """
    Build the report-specific LangGraph.

    Flow:
        START -> process_report_events -> resolve_report_branching
              -> generate_report_response -> END
    """
    graph = StateGraph(ReportState)

    graph.add_node("process_report_events", process_report_events)
    graph.add_node("resolve_report_branching", resolve_report_branching)
    graph.add_node("generate_report_response", generate_report_response)

    graph.add_edge(START, "process_report_events")
    graph.add_edge("process_report_events", "resolve_report_branching")
    graph.add_edge("resolve_report_branching", "generate_report_response")
    graph.add_edge("generate_report_response", END)

    return graph
