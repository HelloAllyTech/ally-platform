"""
Scenario report generation service.

Orchestrates the full lifecycle of a simulated N-turn text-only
conversation between a client agent (driven by the LangGraph) and a
counselor agent (a standalone LLM), then delivers results via webhook.
"""

import asyncio
import random
import time
from datetime import datetime, timezone
from typing import Optional

import httpx
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

from app.core.agent.factory import configure_llm_client
from app.core.config import settings
from app.core.constants import SCENARIO_REPORT_WEBHOOK_ENDPOINT
from app.core.embeddings import OpenAIEmbeddingClient
from app.core.events.base import BaseEvent
from app.core.events.event_orchestrator.event_orchestrator import EventOrchestrator
from app.core.graph.checkpointer import PruningCheckpointer
from app.core.graph.graph_builder import get_report_graph
from app.core.llm_usage.emitter import emit_langchain_usage
from app.core.llm_usage.tasks import LLMTask
from app.core.logger import get_logger
from app.core.scenario.base import Scenario
from app.core.scenario_report.evaluator import evaluate_transcript
from app.core.scenario_report.schemas import (
    ReportStatus,
    ScenarioReportRequest,
    ScenarioReportWebhookPayload,
    TranscriptEntry,
)
from app.core.scoring.score_keeper import ScoreKeeper
from app.llms import create_llm_client
from app.prompts.resolver import load_and_format, load_template

logger = get_logger(__name__)

# Semaphore to limit concurrent report generation tasks
# Prevents memory spikes from too many simultaneous reports
_report_semaphore = None


def _get_report_semaphore():
    global _report_semaphore
    if _report_semaphore is None:
        _report_semaphore = asyncio.Semaphore(settings.REPORT_CONCURRENCY_LIMIT)
    return _report_semaphore


# Registry of accepted ScenarioReportService instances, keyed by report_id:
# queued for a concurrency slot or running. Populated by accept_report() the
# moment the generate endpoint accepts a report -- not when it starts running
# -- so a cancel that lands while the report is still queued finds it, and a
# repeated trigger for the same report (ally-be retries the generate call) is
# refused instead of running the simulation and judge twice. Cleared when the
# run ends. Process-local — fine for a single-worker deployment, would need a
# Redis pubsub bridge for multi-worker setups (out of scope here; we run one
# worker per container).
_ACTIVE_REPORT_SERVICES: dict[str, "ScenarioReportService"] = {}

# Report-result webhook delivery: attempts, and the first backoff (doubling).
# The same bounded retry as the actor-evaluation webhook
# (app/core/scenario_session_evaluation/service.py): one transient failure
# must not throw away a finished simulation and judge.
_WEBHOOK_ATTEMPTS = 3
_WEBHOOK_BACKOFF_S = 1.0


def accept_report(service: "ScenarioReportService") -> bool:
    """Register a report the moment it is accepted, before it waits for a slot.

    Returns False, registering nothing, when a report with the same id is
    already queued or running in this process.
    """
    report_id = service._request.report_id
    if report_id in _ACTIVE_REPORT_SERVICES:
        return False
    _ACTIVE_REPORT_SERVICES[report_id] = service
    return True


def _release_report(service: "ScenarioReportService") -> None:
    """Unregister ``service``, if it is the one registered under its id."""
    report_id = service._request.report_id
    if _ACTIVE_REPORT_SERVICES.get(report_id) is service:
        del _ACTIVE_REPORT_SERVICES[report_id]


def request_cancel(report_id: str) -> bool:
    """Signal the queued or running report service (if any) to stop.

    Called by the FastAPI cancel endpoint after ally-be relays a user's
    cancel click. Returns True if a queued or running service was found and
    signalled, False if no in-flight report matches the ID (already
    completed or unknown). A queued report stops as soon as it gets a slot,
    before any setup or model call.
    """
    service = _ACTIVE_REPORT_SERVICES.get(report_id)
    if service is None:
        logger.info(
            "Cancel requested for report_id=%s but no active service found "
            "(already completed or unknown)",
            report_id,
        )
        return False
    service.request_cancel()
    return True


# --------------- Anti-stagnation prompt fragments ---------------
# Loaded from .txt so they can be edited via the dashboard override system.
# strip() removes any trailing newline from the file.
_ANTI_REPETITION_GUIDANCE = load_template("counselor/anti_repetition_guidance").strip()
_CONVERSATION_GOAL_REMINDER = load_template(
    "counselor/conversation_goal_reminder"
).strip()
_STAGNATION_STEERING = load_template("counselor/stagnation_steering").strip()

_REPETITION_JACCARD_THRESHOLD = 0.5
_REPETITION_LOOKBACK = 3
_MAX_CONTEXT_MESSAGES = 20

# Opening statements are optional on a scenario. When none are configured,
# the report's conversation simulation still needs a first client utterance
# to kick things off (subsequent client turns are generated in-persona by the
# graph). Use a neutral greeting rather than failing the whole report.
_DEFAULT_REPORT_OPENING = "Hello."


async def run_report_with_concurrency_limit(
    service: "ScenarioReportService",
) -> None:
    """
    Execute report generation with semaphore-based concurrency control.

    The semaphore ensures only N reports run concurrently, preventing
    memory spikes from too many simultaneous long-running tasks.

    When the limit is reached, new tasks wait in the queue until a slot
    opens up. This is transparent to the API caller (they still get an
    immediate 202 response).

    Args:
        service: ScenarioReportService instance to run
    """
    report_id = service._request.report_id

    # Resolve (lazily initialize) the semaphore BEFORE reading its state.
    # Previously this function dereferenced the module-level
    # `_report_semaphore` directly — but that variable is `None` until
    # `_get_report_semaphore()` runs, so the first report every container
    # boot crashed with `AttributeError: 'NoneType' object has no attribute
    # '_value'` before ever entering the run loop. Reports landed in the
    # task graveyard and the DB status sat at STARTED indefinitely.
    semaphore = _get_report_semaphore()

    # Log queue position. `_value` is an asyncio.Semaphore implementation
    # detail (the remaining slot count); we only read it for telemetry so
    # an upstream change in CPython would just lose this log line, not
    # break execution.
    waiting_count = settings.REPORT_CONCURRENCY_LIMIT - semaphore._value
    if waiting_count > 0:
        logger.info(
            "Report %s queued (waiting for slot, %d reports currently running)",
            report_id,
            waiting_count,
        )

    try:
        async with semaphore:
            logger.info(
                "Report %s started execution (concurrency slot acquired)",
                report_id,
            )
            try:
                await service.run()
            except Exception as e:
                # Outer backstop for any exception that escapes service.run()
                # (e.g. a crash inside its own except: handler, an OOM, a bug
                # in the cleanup `finally`). Without this, the asyncio task
                # dies silently and the DB row sits at STARTED forever — which
                # was the exact failure mode users were reporting as "report
                # generation taking a lot more time". A FAILED webhook here
                # ensures the UI can show the error and stop polling.
                logger.exception(
                    "Report %s crashed outside service.run()'s handler: %s",
                    report_id,
                    e,
                )
                try:
                    error_message = f"{type(e).__name__}: {e}"[:500]
                    await service._send_webhook(
                        ScenarioReportWebhookPayload(
                            metrics={},
                            status=ReportStatus.FAILED,
                            transcripts=service._transcripts,
                            error_message=error_message,
                        )
                    )
                except Exception:
                    # Last-resort: if even the webhook send fails, log loudly
                    # so ops can spot it. The DB row will remain at STARTED
                    # but that's strictly better than an exception swallowed
                    # by asyncio's task done-callback with no log.
                    logger.exception(
                        "Failed to send FAILED webhook for report %s after outer crash",
                        report_id,
                    )
    finally:
        # run() unregisters itself; this covers a report that never got that
        # far (e.g. its task was cancelled while it waited for a slot), which
        # would otherwise block its id for the life of the process.
        _release_report(service)


class ScenarioReportService:
    """
    Simulates an N-turn conversation and delivers results via webhook.

    Lifecycle:
        1. **Setup** -- parse scenario, create LLM clients, event
           orchestrator, and report-specific LangGraph.
        2. **Simulation** -- run the N-turn conversation loop with role
           flipping between the client graph and the counselor LLM.
        3. **Finalize** -- collect score/metrics, build webhook payload,
           POST to core backend.
    """

    def __init__(self, request: ScenarioReportRequest) -> None:
        self._request = request
        # In-conversation termination event (e.g. client said something
        # that triggered a TerminationEvent rule). Causes the run loop to
        # exit gracefully and the evaluator to still run — the resulting
        # report is COMPLETED with a partial transcript.
        self._terminated = False
        self._termination_event: Optional[BaseEvent] = None
        # User-initiated cancel from the studio UI. Distinct from
        # _terminated: when this is set we ALSO skip the evaluator (no
        # point burning LLM tokens on output no one will read) and the
        # final webhook ships status=CANCELLED with whatever transcripts
        # were already collected, so the user can review what was
        # generated before they cancelled.
        self._cancel_requested = False
        self._transcripts: list[TranscriptEntry] = []
        self._start_time: Optional[float] = None
        self._checkpointer = PruningCheckpointer()

    def request_cancel(self) -> None:
        """Mark the run for user-initiated cancellation.

        Called from the FastAPI cancel endpoint via the
        _ACTIVE_REPORT_SERVICES registry. Setting the flag is enough — a
        report still queued for a slot stops as soon as it gets one, and a
        running one checks it between turns and exits early. Idempotent:
        repeated calls are no-ops.
        """
        if self._cancel_requested:
            return
        self._cancel_requested = True
        logger.info(
            "Cancel requested for report_id=%s — it will stop before its next "
            "turn (or before starting, if still queued)",
            self._request.report_id,
        )

    # ------------------------------------------------------------------
    # Callbacks & helpers
    # ------------------------------------------------------------------

    async def _on_termination(self, event: BaseEvent) -> None:
        """Signal the conversation loop to stop early."""
        logger.info(
            "Termination event received: %s (report_id=%s)",
            event.event_id,
            self._request.report_id,
        )
        self._terminated = True
        self._termination_event = event

    def _record_transcript(self, content: str, role: str) -> None:
        """Append a transcript entry with real wall-clock timestamps."""
        now = time.monotonic()
        if self._start_time is None:
            self._start_time = now

        start_time = round(now - self._start_time, 2)

        self._transcripts.append(
            TranscriptEntry(
                content=content,
                start_time=start_time,
                role=role,
            )
        )

    def _get_termination_message(
        self, event_orchestrator: "EventOrchestrator"
    ) -> Optional[str]:
        """Resolve the termination message from the stored event, if any."""
        if not self._termination_event:
            return None
        term_config = event_orchestrator.get_termination_config(
            self._termination_event.event_id
        )
        if term_config and term_config.termination_message:
            return term_config.termination_message
        return None

    def _build_counselor_prompt(
        self,
        language_code: str,
        custom_prompt: str,
        backend_prompts: Optional[dict] = None,
    ) -> str:
        """
        Build the counselor system prompt with dynamic language code
        and custom prompt injection.

        Args:
            language_code: BCP 47 language code (e.g., 'en-US', 'hi-IN')
            custom_prompt: Custom counselor instructions from the request
            backend_prompts: promptData.prompts from metadata (dashboard edits)

        Returns:
            Complete system prompt with both placeholders injected
        """
        result = load_and_format(
            "counselor/report_generation_prompt",
            prompt_data=backend_prompts,
            language_code=language_code,
            custom_prompt=custom_prompt.strip() if custom_prompt else "",
        )
        if not result:
            logger.warning(
                "Counselor template not found, using custom prompt only (report_id=%s)",
                self._request.report_id,
            )
            return custom_prompt

        return result

    async def _send_webhook(self, payload: ScenarioReportWebhookPayload) -> None:
        """PATCH the report payload to the core backend webhook.

        Retried with backoff, up to ``_WEBHOOK_ATTEMPTS`` attempts, on a 5xx
        (as the actor-evaluation webhook is) and on a failure to connect, which
        never reaches Core: the payload carries a finished simulation and
        judge, and dropping it on one transient failure makes the user
        regenerate the whole report. A 4xx, or a failure after the request may
        have been delivered (a read timeout), is not retried.
        """
        url = (
            f"{settings.CORE_SERVICE_BASE_URL}"
            f"{SCENARIO_REPORT_WEBHOOK_ENDPOINT}"
            f"/{self._request.report_id}"
        )
        logger.info("Sending webhook to %s (status=%s)", url, payload.status)
        for attempt in range(_WEBHOOK_ATTEMPTS):
            retry_in = _WEBHOOK_BACKOFF_S * (2**attempt)
            can_retry = attempt < _WEBHOOK_ATTEMPTS - 1
            try:
                async with httpx.AsyncClient(timeout=30.0) as client:
                    resp = await client.patch(
                        url,
                        json=payload.model_dump(),
                        headers={
                            "Content-Type": "application/json",
                            "x-api-key": settings.CORE_SERVICE_API_KEY,
                        },
                    )
                    resp.raise_for_status()
                    logger.info(
                        "Webhook delivered successfully (status=%d)", resp.status_code
                    )
                    return
            except httpx.HTTPStatusError as e:
                if e.response.status_code >= 500 and can_retry:
                    logger.warning(
                        "Webhook failed with HTTP %d for report_id=%s, "
                        "retrying in %.1fs (attempt %d/%d)",
                        e.response.status_code,
                        self._request.report_id,
                        retry_in,
                        attempt + 1,
                        _WEBHOOK_ATTEMPTS,
                    )
                    await asyncio.sleep(retry_in)
                    continue
                logger.error(
                    "Webhook failed with HTTP %d for report_id=%s: %s",
                    e.response.status_code,
                    self._request.report_id,
                    e.response.text,
                )
                return
            except (httpx.ConnectError, httpx.ConnectTimeout) as e:
                if can_retry:
                    logger.warning(
                        "Webhook could not connect for report_id=%s (%s), "
                        "retrying in %.1fs (attempt %d/%d)",
                        self._request.report_id,
                        type(e).__name__,
                        retry_in,
                        attempt + 1,
                        _WEBHOOK_ATTEMPTS,
                    )
                    await asyncio.sleep(retry_in)
                    continue
                logger.exception(
                    "Webhook could not connect for report_id=%s after %d attempts",
                    self._request.report_id,
                    _WEBHOOK_ATTEMPTS,
                )
                return
            except Exception:
                logger.exception(
                    "Unexpected error sending webhook for report_id=%s",
                    self._request.report_id,
                )
                return

    @staticmethod
    def _detect_repetition_loop(
        messages: list,
        lookback: int = _REPETITION_LOOKBACK,
        threshold: float = _REPETITION_JACCARD_THRESHOLD,
    ) -> bool:
        """
        Return True when the last *lookback* counselor (AI) messages are
        pairwise similar above *threshold* (word-set Jaccard).

        Lightweight check — no extra model calls.
        """
        counselor_texts = [
            msg.content.lower() for msg in messages if isinstance(msg, AIMessage)
        ]
        if len(counselor_texts) < lookback:
            return False

        recent = counselor_texts[-lookback:]
        for i in range(len(recent) - 1):
            words_a = set(recent[i].split())
            words_b = set(recent[i + 1].split())
            if not words_a or not words_b:
                return False
            similarity = len(words_a & words_b) / len(words_a | words_b)
            if similarity < threshold:
                return False
        return True

    def _prepare_counselor_context(
        self,
        full_messages: list,
        base_system_content: str,
    ) -> list:
        """
        Build the message list actually sent to the counselor LLM:

        1. Sliding window — keeps only the last K conversation messages.
        2. Stagnation steering — appended to the system prompt only when
           a repetition loop is detected.

        The *full_messages* list is never mutated.
        """
        conversation = full_messages[1:]  # everything after the system message

        if len(conversation) > _MAX_CONTEXT_MESSAGES:
            conversation = conversation[-_MAX_CONTEXT_MESSAGES:]

        system_content = base_system_content

        if self._detect_repetition_loop(full_messages):
            system_content += "\n\n" + _STAGNATION_STEERING
            logger.debug(
                "Repetition loop detected — injecting stagnation steering "
                "(report_id=%s)",
                self._request.report_id,
            )

        return [SystemMessage(content=system_content)] + conversation

    def _extract_client_reply(self, graph_output: dict) -> str:
        """Pull the last AIMessage content from a graph invocation result."""
        if graph_output and "messages" in graph_output:
            for msg in reversed(graph_output["messages"]):
                if isinstance(msg, AIMessage):
                    return msg.content
        return ""

    # ------------------------------------------------------------------
    # Main execution
    # ------------------------------------------------------------------

    async def run(self) -> None:
        """
        Execute the full report generation lifecycle.

        Designed to be run via ``asyncio.create_task``.  Catches all
        exceptions and sends a FAILED webhook on error.
        """
        req = self._request
        report_id = req.report_id
        _run_start = time.perf_counter()

        # accept_report() registered us when the report was accepted, so a
        # cancel could find us while we were queued. Register here too in case
        # run() was called directly; never displace another instance.
        if _ACTIVE_REPORT_SERVICES.setdefault(report_id, self) is not self:
            logger.warning(
                "report_id=%s is registered to another service instance; this "
                "run cannot be cancelled through the registry",
                report_id,
            )

        try:
            # Cancelled while queued for a slot: stop before any setup or model
            # call, shipping the same CANCELLED webhook a mid-run cancel does.
            if self._cancel_requested:
                logger.info(
                    "Report %s cancelled before it started — skipping the "
                    "simulation and eval, shipping CANCELLED webhook",
                    report_id,
                )
                await self._send_webhook(
                    ScenarioReportWebhookPayload(
                        metrics={},
                        status=ReportStatus.CANCELLED,
                        transcripts=[],
                        report_markdown="",
                        error_message=None,
                    )
                )
                return

            logger.info(
                "Starting report generation: report_id=%s, scenario_id=%s, turns=%s",
                report_id,
                req.scenario_id,
                req.turns,
            )

            # -- Setup
            # Two independent tracks run concurrently:
            #   A) scenario chain  : create embedding client → build scenario
            #  → configure client LLM
            #   B) counselor LLM   : create_llm_client (no scenario dependency)
            #
            # get_report_graph() returns the module-level cached StateGraph
            # (built once at import time); only .compile() runs per-report.
            embedding_client = OpenAIEmbeddingClient()

            async def _build_scenario_track():
                scenario = Scenario.create(
                    req.metadata, embedding_client=embedding_client
                )
                client_llm = configure_llm_client(scenario)
                return scenario, client_llm

            async def _build_counselor_track():
                return create_llm_client(language_code=req.language)

            (scenario, client_llm), counselor_llm = await asyncio.gather(
                _build_scenario_track(),
                _build_counselor_track(),
            )

            # Single ScoreKeeper shared across the EventOrchestrator (event
            # scores) and the detect_behaviors graph node (behavior scores).
            # Without this, both code paths fall back to fresh ScoreKeeper()
            # instances and their totals never combine. Wiring it here is
            # also what makes simulation-state transitions activate during
            # a report run: generate_response reads
            # `score_keeper.get_total_score()` per turn and forwards it as
            # current_score into _resolve_simulation_state_by_score. Without
            # a score_keeper in the configurable, the resolver gets None every
            # turn (treated as score 0) and pins to the opening state forever —
            # so transitions never fire and reports can't exercise state-2+
            # behavior or per-state RAG gating beyond the starting state.
            score_keeper = ScoreKeeper()

            event_orchestrator = EventOrchestrator(
                scenario=scenario,
                thread_id=report_id,
                room=None,
                termination_callback=self._on_termination,
                is_report_mode=True,
                score_keeper=score_keeper,
            )

            report_graph = get_report_graph().compile(checkpointer=self._checkpointer)

            config = {
                "configurable": {
                    "thread_id": report_id,
                    "scenario": scenario,
                    "agent_joined_at": datetime.now(timezone.utc).isoformat(),
                    "event_orchestrator": event_orchestrator,
                    "llm_client": client_llm,
                    "embedding_client": embedding_client,
                    "score_keeper": score_keeper,
                }
            }

            report_graph.update_state(
                config,
                values={
                    "messages": [],
                    "permitted_events": scenario.events,
                    "events_accumulator": [],
                    "new_events": [],
                    "current_score": 0,
                    "branching_and_feedback_data": [],
                    "non_branching_feedback_data": [],
                    "feedback_to_send": None,
                    "behavior_feedback_data": [],
                    "next_instruction": None,
                },
            )

            await event_orchestrator.initialize(graph=report_graph)

            # -- Conversation simulation
            # Opening statements are optional. When present, the client opens
            # with one of the scripted lines; when absent, fall back to a
            # neutral greeting so the report still generates (this mirrors the
            # live session, where the client simply opens the conversation).
            if scenario.prompt_data and scenario.prompt_data.opening_statements:
                opening = random.choice(scenario.prompt_data.opening_statements)
            else:
                opening = _DEFAULT_REPORT_OPENING
                logger.info(
                    "No opening statements configured for scenario %s; using "
                    "fallback opening for report %s",
                    req.scenario_id,
                    report_id,
                )

            report_graph.update_state(
                config,
                values={"messages": [AIMessage(content=opening)]},
            )
            self._record_transcript(opening, "CLIENT")

            counselor_system_prompt = self._build_counselor_prompt(
                language_code=req.language,
                custom_prompt=req.prompt,
                backend_prompts=(
                    scenario.prompt_data.prompts if scenario.prompt_data else None
                ),
            )

            # Anti-repetition guidance and goal reminder are baked into the
            # base prompt once at setup. The original prompt is kept clean
            # for evaluation.
            counselor_base_prompt = (
                counselor_system_prompt
                + "\n\n"
                + _ANTI_REPETITION_GUIDANCE
                + "\n\n"
                + _CONVERSATION_GOAL_REMINDER
            )

            counselor_messages = [
                SystemMessage(content=counselor_base_prompt),
                HumanMessage(content=opening),
            ]

            for turn in range(req.turns):
                # User-initiated cancel check — break before doing any
                # work on this turn so the cancel feels responsive. The
                # final webhook below will ship status=CANCELLED with
                # whatever transcripts we already have.
                if self._cancel_requested:
                    logger.info(
                        "Cancel received before turn %d, exiting run loop "
                        "(report_id=%s, partial_transcripts=%d)",
                        turn + 1,
                        report_id,
                        len(self._transcripts),
                    )
                    break

                # Per-turn latency instrumentation — grep `[REPORT_TURN]` to
                # see the actual cost breakdown for any report run. Helps
                # answer "why is report-gen slow" with data instead of
                # guesses (counselor LLM vs. client graph vs. context-prep).
                turn_started_at = time.monotonic()

                # Counselor speaks — windowed context with goal reminder
                windowed = self._prepare_counselor_context(
                    counselor_messages,
                    counselor_base_prompt,
                )
                counselor_started_at = time.monotonic()
                counselor_resp = await counselor_llm.llm_instance.ainvoke(windowed)
                counselor_text = counselor_resp.content
                counselor_ms = (time.monotonic() - counselor_started_at) * 1000
                # Outside any graph node, so the room (the report id, as the
                # rehearsal's graph-node calls use) is passed explicitly.
                emit_langchain_usage(
                    counselor_resp,
                    task=LLMTask.SCENARIO_REPORT_COUNSELOR.value,
                    llm_client=counselor_llm,
                    room_id=report_id,
                    metadata={"report_id": report_id},
                )
                self._record_transcript(counselor_text, "COUNSELOR")
                counselor_messages.append(AIMessage(content=counselor_text))

                # Time-based termination fired while counselor was speaking
                if self._terminated:
                    term_msg = self._get_termination_message(event_orchestrator)
                    if term_msg:
                        self._record_transcript(term_msg, "CLIENT")
                        logger.info(
                            "Client termination reply at turn %d: %s",
                            turn + 1,
                            term_msg,
                        )
                    logger.info("Terminated after counselor turn %d", turn + 1)
                    break

                # Client speaks (via graph)
                graph_started_at = time.monotonic()
                graph_output = await report_graph.ainvoke(
                    {"messages": [HumanMessage(content=counselor_text)]},
                    config,
                )
                graph_ms = (time.monotonic() - graph_started_at) * 1000

                # Event-based termination fired during graph invocation
                if self._terminated:
                    term_msg = self._get_termination_message(event_orchestrator)
                    client_text = term_msg or self._extract_client_reply(graph_output)
                    if client_text:
                        self._record_transcript(client_text, "CLIENT")
                        logger.info(
                            "Client termination reply at turn %d: %s",
                            turn + 1,
                            client_text,
                        )
                    break

                client_text = self._extract_client_reply(graph_output)

                if not client_text:
                    logger.warning("No client response at turn %d", turn + 1)
                    continue

                self._record_transcript(client_text, "CLIENT")
                counselor_messages.append(HumanMessage(content=client_text))

                turn_ms = (time.monotonic() - turn_started_at) * 1000
                logger.info(
                    "[REPORT_TURN] turn=%d/%d counselor_ms=%.0f graph_ms=%.0f "
                    "total_ms=%.0f score=%d",
                    turn + 1,
                    req.turns,
                    counselor_ms,
                    graph_ms,
                    turn_ms,
                    score_keeper.get_total_score(),
                )
                logger.debug(
                    "Turn %d/%d completed (terminated=%s)",
                    turn + 1,
                    req.turns,
                    self._terminated,
                )

            # Cancel remaining time-event timers
            cancelled = await event_orchestrator._scheduler.cancel_all()
            if cancelled:
                logger.info("Cancelled %d pending time event task(s)", cancelled)

            # ==========================================================
            # Phase 3 -- Finalize + webhook
            # ==========================================================
            # Short-circuit when the user cancelled: skip the evaluator
            # entirely (saves 5-60s of GPT-4o-mini cost) and ship a
            # CANCELLED webhook with whatever partial transcripts we
            # already collected. ally-be persists those transcripts so
            # the user can review what was generated before they cancelled.
            if self._cancel_requested:
                logger.info(
                    "Report %s cancelled by user — skipping eval, "
                    "shipping CANCELLED webhook with %d partial transcripts",
                    report_id,
                    len(self._transcripts),
                )
                cancel_payload = ScenarioReportWebhookPayload(
                    metrics={},
                    status=ReportStatus.CANCELLED,
                    transcripts=self._transcripts,
                    report_markdown="",
                    error_message=None,
                )
                await self._send_webhook(cancel_payload)
                return

            # The evaluator is a single LLM call against the full transcript
            # — typically 5-15s. Timing it separately lets us tell whether
            # report latency is dominated by the N-turn simulation vs the
            # final evaluation (grep `[REPORT_EVAL]`).
            transcript_chars = sum(len(t.content) for t in self._transcripts)
            eval_started_at = time.monotonic()
            eval_result = await evaluate_transcript(
                transcripts=self._transcripts,
                prompt_data=scenario.prompt_data,
                counselor_prompt=counselor_system_prompt,
                selected_prompt_code=self._request.evaluator_prompt_code,
                report_id=report_id,
            )
            eval_ms = (time.monotonic() - eval_started_at) * 1000
            logger.info(
                "[REPORT_EVAL] report_id=%s eval_ms=%.0f transcript_chars=%d "
                "turns_recorded=%d final_score=%d",
                report_id,
                eval_ms,
                transcript_chars,
                len(self._transcripts),
                score_keeper.get_total_score(),
            )

            metrics = eval_result.get("metrics", {})
            report_markdown = eval_result.get("report_markdown", "")
            # An eval that timed out / errored returns `{"metrics": {},
            # "report_markdown": ""}` from evaluator.evaluate_transcript's
            # except path — the previous `all_zero` check evaluated to
            # False on that input (because `bool({}) is False`) and the
            # report sailed through as COMPLETED with empty content. Treat
            # empty metrics OR empty markdown as failure now, so the
            # user gets a clear FAILED status + toast instead of a
            # deceptively-green report card with no content.
            metrics_missing = not metrics
            markdown_missing = not report_markdown.strip()
            all_zero = bool(metrics) and all(v == 0 for v in metrics.values())
            eval_failed = metrics_missing or markdown_missing or all_zero

            if eval_failed and self._transcripts:
                logger.error(
                    "Evaluation failed for report_id=%s, sending FAILED status "
                    "(metrics_missing=%s markdown_missing=%s all_zero=%s)",
                    report_id,
                    metrics_missing,
                    markdown_missing,
                    all_zero,
                )
                if metrics_missing or markdown_missing:
                    failure_reason = (
                        "The LLM judge could not produce a report. This usually "
                        "means the evaluation call timed out or hit a token "
                        "limit on a long transcript. Try a shorter turn count, "
                        "or regenerate."
                    )
                else:
                    failure_reason = (
                        "Evaluation returned zero scores for every metric. "
                        "The LLM judge either failed to parse the transcript or "
                        "the conversation produced no scorable content. "
                        "Try regenerating, or check the transcript quality."
                    )
                payload = ScenarioReportWebhookPayload(
                    metrics=metrics,
                    status=ReportStatus.FAILED,
                    transcripts=self._transcripts,
                    report_markdown=report_markdown,
                    error_message=failure_reason,
                )
            else:
                payload = ScenarioReportWebhookPayload(
                    metrics=metrics,
                    status=ReportStatus.COMPLETED,
                    transcripts=self._transcripts,
                    report_markdown=eval_result.get("report_markdown", ""),
                )

            elapsed = time.perf_counter() - _run_start
            logger.info(
                "Report complete | report_id=%s | status=%s | turns=%d | "
                "time=%.1fs\n",
                report_id,
                payload.status,
                len(self._transcripts),
                elapsed,
            )

            await self._send_webhook(payload)
            logger.info("Report generation completed: report_id=%s", report_id)

        except Exception as e:
            logger.exception(f"Report generation failed: report_id=%s: {e}", report_id)
            # Truncate to keep DB column / UI toast sane. We surface the
            # exception type + message so engineers can grep logs and users
            # see something concrete instead of an indefinite spinner.
            error_message = f"{type(e).__name__}: {e}"[:500]
            await self._send_webhook(
                ScenarioReportWebhookPayload(
                    metrics={},
                    status=ReportStatus.FAILED,
                    transcripts=self._transcripts,
                    error_message=error_message,
                )
            )
        finally:
            self._checkpointer.delete_thread(report_id)
            # Always unregister so the cancel endpoint stops finding a
            # completed service and the id can be generated again. Only our
            # own entry; idempotent.
            _release_report(self)
