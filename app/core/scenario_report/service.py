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
from app.core.logger import get_logger
from app.core.scenario.base import Scenario
from app.core.scenario_report.evaluator import evaluate_transcript
from app.core.scenario_report.schemas import (
    ReportStatus,
    ScenarioReportRequest,
    ScenarioReportWebhookPayload,
    TranscriptEntry,
)
from app.llms import create_llm_client
from app.prompts.resolver import load_and_format

logger = get_logger(__name__)

# Semaphore to limit concurrent report generation tasks
# Prevents memory spikes from too many simultaneous reports
_report_semaphore = asyncio.Semaphore(settings.REPORT_CONCURRENCY_LIMIT)

# --------------- Anti-stagnation prompt fragments ---------------
# Appended once to the counselor system prompt (permanent guidance)
_ANTI_REPETITION_GUIDANCE = (
    "\n\nWhen responding:\n"
    "- Do not repeat phrases used earlier in the conversation.\n"
    "- Prefer asking a new question or exploring a new perspective.\n"
    "- Move the conversation forward rather than only validating feelings."
)

# Baked into the base prompt once at setup alongside anti-repetition guidance
_CONVERSATION_GOAL_REMINDER = (
    "Conversation Objective: Help the client explore underlying emotions. "
    "Avoid repeating validation. Introduce new insights or probing questions. "
    "Progress the discussion forward."
)

# Injected only when a repetition loop is detected
_STAGNATION_STEERING = (
    "The conversation is repeating validation statements. "
    "Shift toward exploring causes, coping strategies, or new questions."
)

_REPETITION_JACCARD_THRESHOLD = 0.5
_REPETITION_LOOKBACK = 3
_MAX_CONTEXT_MESSAGES = 20


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

    # Log queue position
    waiting_count = settings.REPORT_CONCURRENCY_LIMIT - _report_semaphore._value
    if waiting_count > 0:
        logger.info(
            "Report %s queued (waiting for slot, %d reports currently running)",
            report_id,
            waiting_count,
        )

    async with _report_semaphore:
        logger.info(
            "Report %s started execution (concurrency slot acquired)",
            report_id,
        )
        await service.run()


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
        self._terminated = False
        self._termination_event: Optional[BaseEvent] = None
        self._transcripts: list[TranscriptEntry] = []
        self._start_time: Optional[float] = None
        self._checkpointer = PruningCheckpointer()

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
        """PATCH the report payload to the core backend webhook."""
        url = (
            f"{settings.CORE_SERVICE_BASE_URL}"
            f"{SCENARIO_REPORT_WEBHOOK_ENDPOINT}"
            f"/{self._request.report_id}"
        )
        logger.info("Sending webhook to %s (status=%s)", url, payload.status)
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
        except httpx.HTTPStatusError as e:
            logger.error(
                "Webhook failed with HTTP %d for report_id=%s: %s",
                e.response.status_code,
                self._request.report_id,
                e.response.text,
            )
        except Exception:
            logger.exception(
                "Unexpected error sending webhook for report_id=%s",
                self._request.report_id,
            )

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
        logger.info(
            "Starting report generation: report_id=%s, scenario_id=%s, turns=%s",
            report_id,
            req.scenario_id,
            req.turns,
        )

        try:
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

            event_orchestrator = EventOrchestrator(
                scenario=scenario,
                thread_id=report_id,
                room=None,
                termination_callback=self._on_termination,
                is_report_mode=True,
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
            if not scenario.prompt_data or not scenario.prompt_data.opening_statements:
                raise ValueError(
                    "Opening statements are required for report generation"
                )

            opening = random.choice(scenario.prompt_data.opening_statements)

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
                + _ANTI_REPETITION_GUIDANCE
                + "\n\n"
                + _CONVERSATION_GOAL_REMINDER
            )

            counselor_messages = [
                SystemMessage(content=counselor_base_prompt),
                HumanMessage(content=opening),
            ]

            for turn in range(req.turns):
                # Counselor speaks — windowed context with goal reminder
                windowed = self._prepare_counselor_context(
                    counselor_messages,
                    counselor_base_prompt,
                )
                counselor_resp = await counselor_llm.llm_instance.ainvoke(windowed)
                counselor_text = counselor_resp.content
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
                graph_output = await report_graph.ainvoke(
                    {"messages": [HumanMessage(content=counselor_text)]},
                    config,
                )

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
            eval_result = await evaluate_transcript(
                transcripts=self._transcripts,
                prompt_data=scenario.prompt_data,
                counselor_prompt=counselor_system_prompt,
            )

            # Check if evaluation failed (all metrics are zero)
            metric_keys = (
                "gradual_disclosure",
                "difficulty_level",
                "colloquialism",
                "context_appropriateness",
                "consistency",
                "resistance",
            )
            all_zero = all(eval_result.get(k, 0) == 0 for k in metric_keys)

            if all_zero and self._transcripts:
                logger.error(
                    "Evaluation failed for report_id=%s, sending FAILED status",
                    report_id,
                )
                payload = ScenarioReportWebhookPayload(
                    metrics={k: 0 for k in metric_keys},
                    status=ReportStatus.FAILED,
                    transcripts=self._transcripts,
                )
            else:
                payload = ScenarioReportWebhookPayload(
                    metrics={k: eval_result[k] for k in metric_keys},
                    status=ReportStatus.COMPLETED,
                    transcripts=self._transcripts,
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
            await self._send_webhook(
                ScenarioReportWebhookPayload(
                    metrics={},
                    status=ReportStatus.FAILED,
                    transcripts=self._transcripts,
                )
            )
        finally:
            self._checkpointer.delete_thread(report_id)
