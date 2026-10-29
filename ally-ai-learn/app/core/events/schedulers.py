"""
Time-based event scheduler for managing asyncio timers.

This module handles the scheduling and lifecycle of TIME-based events,
including trigger and revoke coroutines for different condition operators.
"""

import asyncio
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Awaitable, Callable, Dict, List, Optional, Set

from livekit import rtc

from app.core.constants import ConditionOperator, DetectionType
from app.core.events.base import BaseEvent
from app.core.events.schemas import EventRegistryEntry
from app.core.events.utils import get_current_score_from_graph
from app.core.graph.utils import is_event_eligible
from app.core.logger import get_logger

if TYPE_CHECKING:
    from app.core.session_clock import SessionClock

logger = get_logger(__name__)


class TimeEventScheduler:
    """
    Manages asyncio timers for TIME-based events.

    Handles two types of time events:
    - LT/LTE: Immediately active, then revoked after timeout
    - GT/GTE/EQ: Triggered after timeout
    """

    def __init__(self):
        # Map of event_id -> asyncio.Task for scheduled time events
        self._time_tasks: Dict[str, asyncio.Task] = {}
        # Pause-aware clock; when set, timers count down only active (un-paused)
        # time. Falls back to plain asyncio.sleep when absent (tests/report mode).
        self._session_clock: Optional["SessionClock"] = None

    async def _sleep(self, seconds: float) -> None:
        """Sleep for ``seconds`` of active time, honoring pause if a clock is set."""
        if self._session_clock is not None:
            await self._session_clock.sleep(seconds)
        else:
            await asyncio.sleep(seconds)

    async def cancel_all(self) -> int:
        """Cancel all pending time event tasks and return the count cancelled."""
        tasks = list(self._time_tasks.values())
        if not tasks:
            return 0
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        self._time_tasks.clear()
        return len(tasks)

    async def start_time_event_schedulers(
        self,
        events: List[BaseEvent],
        event_registry: Dict[str, EventRegistryEntry],
        event_notifier: Callable,
        get_live_score: Callable[[], int],
        *,
        room: Optional[rtc.Room] = None,
        default_seconds: float = 60.0,
        agent_graph=None,
        thread_id: Optional[str] = None,
        session_clock: Optional["SessionClock"] = None,
    ) -> None:
        """
        Start asyncio timers for all TIME-based events.

        Behavior:
            - LT / LTE: Immediately sets the event's happened attribute to True,
              notifies UI/Core, and schedules a revoke after `seconds`
              (sets happened=False).

            - GT / GTE / EQ / unknown: Schedules a trigger after `seconds`,
              which sets the event's happened attribute to True and notifies
              UI/Core when the timer completes.

        Args:
            events:
                List of all events (will filter for TIME events).
            event_registry:
                Dictionary mapping event_id to EventRegistryEntry objects.
            event_notifier:
                Callback to notify about event changes:
                (detected_event_ids: set, room: rtc.Room, current_score: int)
                -> tuple
            room:
                Optional LiveKit room for sending UI/Core updates.
            default_seconds:
                Fallback timer value when event.data.time is missing or invalid.
            agent_graph:
                Optional LangGraph instance for updating state with
                branching instructions.
            thread_id:
                Optional thread ID for the current conversation session.
        """
        self._session_clock = session_clock

        logger.info(
            "Starting simplified TIME event schedulers. Total events: %s", len(events)
        )

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
                        "Failed to parse time for event=%s (raw: %s). "
                        "Using default=%s seconds.",
                        event_id,
                        raw_time,
                        default_seconds,
                    )
                    seconds = default_seconds

                if seconds < 0:
                    logger.warning(
                        "Negative timer value for event=%s (%s). Clamping to zero.",
                        event_id,
                        seconds,
                    )
                    seconds = 0.0

                # Parse condition operator (LT, GT, EQ, etc.)
                cond = ev.data.condition
                try:
                    cond_enum = (
                        cond
                        if isinstance(cond, ConditionOperator)
                        else (
                            ConditionOperator[str(cond).strip().upper()]
                            if cond is not None
                            else None
                        )
                    )
                except Exception:
                    logger.warning("Unknown condition for event %s: %r", event_id, cond)
                    cond_enum = None

                reg_entry = event_registry.get(event_id)
                last_occurred = reg_entry.occurred_at if reg_entry else None
                occ_count = reg_entry.occurrence_count if reg_entry else 0

                # ---- LT / LTE ----
                if cond_enum in (ConditionOperator.LT, ConditionOperator.LTE):
                    logger.info(
                        "Scheduling LT/LTE for %s: set True now, revoke "
                        "after %s seconds",
                        event_id,
                        seconds,
                    )

                    # 1. GET SCORE DIRECTLY VIA CALLBACK
                    current_score = get_live_score()

                    # 2. CHECK ELIGIBILITY
                    if not is_event_eligible(
                        event=ev,
                        elapsed_time=0.0,
                        current_score=current_score,
                        last_occurred_at=last_occurred,
                        occurrence_count=occ_count,
                    ):
                        logger.info(
                            f"Skipping LT/LTE event {event_id}: "
                            f"Not eligible (Score={current_score})."
                        )
                        continue

                    logger.info(
                        "Scheduling LT/LTE for %s: set True now, revoke after %s s",
                        event_id,
                        seconds,
                    )

                    # Update Registry
                    now_utc = datetime.now(timezone.utc)

                    # State becomes True immediately - update dict directly
                    if event_id in event_registry:
                        event_registry[event_id].happened = True
                        event_registry[event_id].occurred_at = now_utc
                        event_registry[event_id].occurrence_count += 1
                    else:
                        event_registry[event_id] = EventRegistryEntry(
                            happened=True,
                            trigger_multiple=False,
                            occurred_at=now_utc,
                            occurrence_count=1,
                        )

                    # Notify and capture branching instructions and additional score
                    try:

                        (
                            _,
                            additional_score,
                            branching_and_feedback_data,
                        ) = await event_notifier(room, detected_event_ids={event_id})
                        # Update graph state if graph and thread_id are provided
                        if agent_graph and thread_id:
                            state_updates = {}
                            if branching_and_feedback_data:
                                state_updates["branching_and_feedback_data"] = (
                                    branching_and_feedback_data
                                )
                                logger.info(
                                    f"Updating graph state with "
                                    f"{len(branching_and_feedback_data)} branching "
                                    f"and feedback data entries from LT/LTE time event "
                                    f"{event_id}"
                                )
                            if state_updates:
                                agent_graph.update_state(
                                    {"configurable": {"thread_id": thread_id}},
                                    values=state_updates,
                                    as_node="update_state_from_event_notifier",
                                )
                    except Exception as e:
                        logger.exception(
                            "Error while sending immediate LT event update for %s: %s",
                            event_id,
                            e,
                        )

                    # Schedule revoke
                    task = asyncio.create_task(
                        self._time_revoke_coroutine(
                            event_id,
                            seconds,
                            event_registry,
                            event_notifier,
                            room,
                            agent_graph,
                            thread_id,
                        )
                    )
                    self._time_tasks[event_id] = task

                # ---- GT / GTE / EQ ----
                else:
                    logger.info(
                        "Scheduling trigger for %s after %s seconds (condition=%s)",
                        event_id,
                        seconds,
                        cond_enum,
                    )

                    task = asyncio.create_task(
                        self._time_trigger_coroutine(
                            ev,
                            seconds,
                            event_registry,
                            event_notifier,
                            get_live_score,
                            room,
                            agent_graph,
                            thread_id,
                        )
                    )
                    self._time_tasks[event_id] = task

            except Exception:
                logger.exception(
                    "Unexpected error while scheduling TIME event: %s",
                    getattr(ev, "event_id", "<unknown>"),
                )

    async def _time_trigger_coroutine(
        self,
        event: BaseEvent,
        seconds: float,
        event_registry: Dict[str, EventRegistryEntry],
        event_notifier: Callable[[rtc.Room, int, Optional[Set[str]]], Awaitable[tuple]],
        get_live_score: Callable[[], int],  # <--- Callback
        room: Optional[rtc.Room],
        agent_graph=None,
        thread_id: Optional[str] = None,
    ) -> None:
        """
        Sleeps, then calls get_live_score() to check eligibility.
        """
        event_id = event.event_id
        try:
            logger.debug("Trigger sleeping for %s s (event=%s)", seconds, event_id)
            await self._sleep(seconds)

            # 1. GET SCORE FRESH AFTER SLEEP
            current_score = get_live_score()

            # 2. Get Registry Data
            reg_entry = event_registry.get(event_id)
            last_occurred = reg_entry.occurred_at if reg_entry else None
            occ_count = reg_entry.occurrence_count if reg_entry else 0

            # 3. CHECK ELIGIBILITY
            if not is_event_eligible(
                event=event,
                elapsed_time=seconds,
                current_score=current_score,
                last_occurred_at=last_occurred,
                occurrence_count=occ_count,
            ):
                logger.info(
                    f"Time event {event_id} woke up but "
                    f"is NOT eligible. (Score: {current_score})"
                )
                return

            logger.info("Time trigger fired: %s (after %s s)", event_id, seconds)

            # 4. Update Registry
            now_utc = datetime.now(timezone.utc)
            if event_id in event_registry:
                event_registry[event_id].happened = True
                event_registry[event_id].occurred_at = now_utc
                event_registry[event_id].occurrence_count += 1
            else:
                event_registry[event_id] = EventRegistryEntry(
                    happened=True,
                    trigger_multiple=False,
                    occurred_at=now_utc,
                    occurrence_count=1,
                )

            try:
                (
                    _,
                    additional_score,
                    branching_and_feedback_data,
                ) = await event_notifier(room, detected_event_ids={event_id})

                if agent_graph and thread_id:
                    state_updates = {}
                    if branching_and_feedback_data:
                        state_updates["branching_and_feedback_data"] = (
                            branching_and_feedback_data
                        )
                    if additional_score > 0:
                        state_updates["additional_score"] = additional_score

                    if state_updates:
                        agent_graph.update_state(
                            {"configurable": {"thread_id": thread_id}},
                            values=state_updates,
                            as_node="update_state_from_event_notifier",
                        )
            except Exception as e:
                logger.exception(
                    "Error while event_notifier after trigger for %s: %s", event_id, e
                )
                raise

        except asyncio.CancelledError:
            logger.info("Trigger task cancelled for event %s", event_id)
        finally:
            self._time_tasks.pop(event_id, None)

    async def _time_revoke_coroutine(
        self,
        event_id: str,
        seconds: float,
        event_registry: Dict[str, EventRegistryEntry],
        event_notifier: Callable[[rtc.Room, int, Optional[Set[str]]], Awaitable[tuple]],
        room: Optional[rtc.Room],
        agent_graph=None,
        thread_id: Optional[str] = None,
    ) -> None:
        """
        Sleep for the given duration and then revoke a TIME event.

        Behavior:
            After sleeping:
                - Sets the event's happened attribute to False.
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
            logger.debug(
                "Revoke coroutine sleeping for %s seconds (event=%s)", seconds, event_id
            )
            await self._sleep(seconds)

            logger.info("Time revoke fired: %s (after %s seconds)", event_id, seconds)
            # Update dict directly
            if event_id in event_registry:
                event_registry[event_id].happened = False
            else:
                event_registry[event_id] = EventRegistryEntry(
                    happened=False,
                    trigger_multiple=False,
                )

            try:
                # Get current score from graph state for revoke (for future use)
                if agent_graph and thread_id:
                    try:
                        get_current_score_from_graph(thread_id)
                    except Exception:
                        logger.warning(
                            f"Failed to get current score from graph for "
                            f"event {event_id}, using 0"
                        )

                await event_notifier(room, detected_event_ids=None)
            except Exception as e:
                logger.exception(
                    "Error while event_notifier during revoke for %s: %s", event_id, e
                )
                raise

        except asyncio.CancelledError:
            logger.info("Revoke task cancelled for event %s", event_id)
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
