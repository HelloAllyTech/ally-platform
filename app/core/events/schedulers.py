"""
Time-based event scheduler for managing asyncio timers.

This module handles the scheduling and lifecycle of TIME-based events,
including trigger and revoke coroutines for different condition operators.
"""

import asyncio
from typing import Dict, List, Optional, Callable, Awaitable, TYPE_CHECKING, Set

from livekit import rtc

from app.core.constants import DetectionType, ConditionOperator
from app.core.events.base import BaseEvent
from app.utils.logger import get_logger

from app.core.events.schemas import EventRegistryEntry
from app.utils.event_utils import get_current_score_from_graph

logger = get_logger(__name__)


class TimeEventScheduler:
    """
    Manages asyncio timers for TIME-based events.
    
    Handles two types of time events:
    - LT/LTE: Immediately active, then revoked after timeout
    - GT/GTE/EQ: Triggered after timeout
    """
    
    def __init__(self):
        """Initialize the time event scheduler."""
        # Map of event_id -> asyncio.Task for scheduled time events
        self._time_tasks: Dict[str, asyncio.Task] = {}
    
    async def start_time_event_schedulers(
        self,
        events: List[BaseEvent],
        event_registry: Dict[str, EventRegistryEntry],
        event_notifier: Callable[[rtc.Room, int, Optional[Set[str]]], Awaitable[tuple]],
        *,
        room: Optional[rtc.Room] = None,
        default_seconds: float = 60.0,
        agent_graph = None,
        thread_id: Optional[str] = None,
    ) -> None:
        """
        Start asyncio timers for all TIME-based events.

        Behavior:
            - LT / LTE:
                  Immediately sets the event's "happened" to True, notifies UI/Core,
                  and schedules a revoke after `seconds` (sets happened=False).

            - GT / GTE / EQ / unknown:
                  Schedules a trigger after `seconds`, which sets the event's "happened"
                  to True and notifies UI/Core when the timer completes.

        Args:
            events:
                List of all events (will filter for TIME events).
            event_registry:
                Dictionary mapping event_id to event state (with 'happened' and 'trigger_multiple' keys).
            event_notifier:
                Callback to notify about event changes: 
                (detected_event_ids: set, room: rtc.Room, current_score: int) -> tuple
            room:
                Optional LiveKit room for sending UI/Core updates.
            default_seconds:
                Fallback timer value when event.data.time is missing or invalid.
            agent_graph:
                Optional LangGraph instance for updating state with branching instructions.
            thread_id:
                Optional thread ID for the current conversation session.
        """
        logger.info("Starting simplified TIME event schedulers. Total events: %s", len(events))

        for ev in events:
            try:
                if ev.detection_type != DetectionType.TIME:
                    continue

                event_id = ev.event_id
                if not event_id:
                    logger.error("TIME event missing event_id: %s", ev)
                    continue

                # Parse timer value
                raw_time = ev.data.time
                try:
                    seconds = float(raw_time)
                except Exception:
                    logger.warning(
                        "Failed to parse time for event=%s (raw: %s). Using default=%s seconds.",
                        event_id, raw_time, default_seconds
                    )
                    seconds = default_seconds

                if seconds < 0:
                    logger.warning("Negative timer value for event=%s (%s). Clamping to zero.", event_id, seconds)
                    seconds = 0.0

                # Parse condition operator (LT, GT, EQ, etc.)
                cond = ev.data.condition
                try:
                    cond_enum = cond if isinstance(cond, ConditionOperator) else (
                        ConditionOperator[str(cond).strip().upper()] if cond is not None else None
                    )
                except Exception:
                    logger.warning("Unknown condition for event %s: %r", event_id, cond)
                    cond_enum = None

                # ---- LT / LTE ----
                if cond_enum in (ConditionOperator.LT, ConditionOperator.LTE):
                    logger.info("Scheduling LT/LTE for %s: set True now, revoke after %s seconds", event_id, seconds)

                    # State becomes True immediately - update dict directly
                    if event_id in event_registry:
                        event_registry[event_id]["happened"] = True
                    else:
                        event_registry[event_id] = {"happened": True, "trigger_multiple": False}

                    # Notify and capture branching instructions and additional score
                    try:
                        # Get current score from graph state
                        current_score = 0
                        if agent_graph and thread_id:
                            try:
                                current_score = get_current_score_from_graph(thread_id)
                            except Exception:
                                logger.warning(f"Failed to get current score from graph for event {event_id}, using 0")
                        
                        _, additional_score, branching_instructions = await event_notifier(room, current_score=current_score, detected_event_ids={event_id})
                        # Update graph state if graph and thread_id are provided
                        if agent_graph and thread_id:
                            state_updates = {}
                            if branching_instructions:
                                state_updates["branching_instructions"] = branching_instructions
                                logger.info(f"Updating graph state with {len(branching_instructions)} branching instructions from LT/LTE time event {event_id}")
                            if additional_score > 0:
                                state_updates["additional_score"] = additional_score
                                logger.info(f"Updating graph state with additional score {additional_score} from LT/LTE time event {event_id}")
                            if state_updates:
                                agent_graph.update_state(
                                    {"configurable": {"thread_id": thread_id}},
                                    values=state_updates,
                                )
                    except Exception:
                        logger.exception("Error while sending immediate LT event update for %s", event_id)

                    # Schedule revoke
                    task = asyncio.create_task(
                        self._time_revoke_coroutine(event_id, seconds, event_registry, event_notifier, room, agent_graph, thread_id)
                    )
                    self._time_tasks[event_id] = task

                # ---- GT / GTE / EQ ----
                else:
                    logger.info("Scheduling trigger for %s after %s seconds (condition=%s)", event_id, seconds,
                                cond_enum)

                    task = asyncio.create_task(
                        self._time_trigger_coroutine(event_id, seconds, event_registry, event_notifier, room, agent_graph, thread_id)
                    )
                    self._time_tasks[event_id] = task

            except Exception:
                logger.exception("Unexpected error while scheduling TIME event: %s",
                                 getattr(ev, "event_id", "<unknown>"))

    async def _time_trigger_coroutine(
        self,
        event_id: str,
        seconds: float,
        event_registry: Dict[str, EventRegistryEntry],
        event_notifier: Callable[[rtc.Room, int, Optional[Set[str]]], Awaitable[tuple]],
        room: Optional[rtc.Room],
        agent_graph = None,
        thread_id: Optional[str] = None,
    ) -> None:
        """
        Sleep for the given duration and then activate a TIME event.

        Behavior:
            After sleeping:
                - Sets the event's "happened" to True.
                - Calls event_notifier so UI/Core receive the event.
                - Updates LangGraph state with branching instructions if available.

        Args:
            event_id:
                The TIME event to trigger.
            seconds:
                Timer length before the event fires.
            event_registry:
                Dictionary mapping event_id to event state.
            event_notifier:
                Callback to notify about event changes.
            room:
                Optional LiveKit room for sending event notifications.
            agent_graph:
                Optional LangGraph instance for updating state.
            thread_id:
                Optional thread ID for the current conversation session.
        """
        try:
            logger.debug("Trigger coroutine sleeping for %s seconds (event=%s)", seconds, event_id)
            await asyncio.sleep(seconds)

            logger.info("Time trigger fired: %s (after %s seconds)", event_id, seconds)
            # Update dict directly
            if event_id in event_registry:
                event_registry[event_id]["happened"] = True
            else:
                event_registry[event_id] = {"happened": True, "trigger_multiple": False}

            try:
                # Get current score from graph state
                current_score = 0
                if agent_graph and thread_id:
                    try:
                        current_score = get_current_score_from_graph(thread_id)
                    except Exception:
                        logger.warning(f"Failed to get current score from graph for event {event_id}, using 0")
                
                _, additional_score, branching_instructions = await event_notifier(room, current_score=current_score, detected_event_ids={event_id})
                # Update graph state if graph and thread_id are provided
                if agent_graph and thread_id:
                    state_updates = {}
                    if branching_instructions:
                        state_updates["branching_instructions"] = branching_instructions
                        logger.info(f"Updating graph state with {len(branching_instructions)} branching instructions from time event {event_id}")
                    if additional_score > 0:
                        state_updates["additional_score"] = additional_score
                        logger.info(f"Updating graph state with additional score {additional_score} from time event {event_id}")
                    if state_updates:
                        agent_graph.update_state(
                            {"configurable": {"thread_id": thread_id}},
                            values=state_updates,
                        )
            except Exception:
                logger.exception("Error while event_notifier after trigger for %s", event_id)

        except asyncio.CancelledError:
            logger.info("Trigger task cancelled for event %s", event_id)
        except Exception:
            logger.exception("Exception in trigger task for %s", event_id)
        finally:
            self._time_tasks.pop(event_id, None)

    async def _time_revoke_coroutine(
        self,
        event_id: str,
        seconds: float,
        event_registry: Dict[str, EventRegistryEntry],
        event_notifier: Callable[[rtc.Room, int, Optional[Set[str]]], Awaitable[tuple]],
        room: Optional[rtc.Room],
        agent_graph = None,
        thread_id: Optional[str] = None,
    ) -> None:
        """
        Sleep for the given duration and then revoke a TIME event.

        Behavior:
            After sleeping:
                - Sets the event's "happened" to False.
                - Calls event_notifier so UI/Core receive the change.

        Used only for LT / LTE semantics.

        Args:
            event_id:
                The TIME event being revoked.
            seconds:
                The duration after which the event becomes False again.
            event_registry:
                Dictionary mapping event_id to event state.
            event_notifier:
                Callback to notify about event changes.
            room:
                Optional LiveKit room for sending event notifications.
            agent_graph:
                Optional LangGraph instance (not used in revoke, for consistency).
            thread_id:
                Optional thread ID (not used in revoke, for consistency).
        """
        try:
            logger.debug("Revoke coroutine sleeping for %s seconds (event=%s)", seconds, event_id)
            await asyncio.sleep(seconds)

            logger.info("Time revoke fired: %s (after %s seconds)", event_id, seconds)
            # Update dict directly
            if event_id in event_registry:
                event_registry[event_id]["happened"] = False
            else:
                event_registry[event_id] = {"happened": False, "trigger_multiple": False}

            try:
                # Get current score from graph state for revoke
                current_score = 0
                if agent_graph and thread_id:
                    try:
                        current_score = get_current_score_from_graph(thread_id)
                    except Exception:
                        logger.warning(f"Failed to get current score from graph for event {event_id}, using 0")
                
                await event_notifier(room, current_score=current_score, detected_event_ids=None)
            except Exception:
                logger.exception("Error while event_notifier during revoke for %s", event_id)

        except asyncio.CancelledError:
            logger.info("Revoke task cancelled for event %s", event_id)
        except Exception:
            logger.exception("Exception in revoke task for %s", event_id)
        finally:
            self._time_tasks.pop(event_id, None)

    def cancel_time_event(self, event_id: str) -> None:
        """
        Cancel a specific time event task.
        
        Args:
            event_id: The event ID whose task should be cancelled
        """
        task = self._time_tasks.pop(event_id, None)
        if task and not task.done():
            task.cancel()
            logger.info(f"Cancelled time event task for: {event_id}")

