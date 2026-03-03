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
from app.core.graph.graph_builder import build_report_graph
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
from app.prompts.resolver import resolve_template

logger = get_logger(__name__)

# Semaphore to limit concurrent report generation tasks
# Prevents memory spikes from too many simultaneous reports
_report_semaphore = asyncio.Semaphore(settings.REPORT_CONCURRENCY_LIMIT)


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
        # Limit turns to 15 to prevent memory spikes
        if self._request.turns > 15:
            logger.info(
                "Requested turns %d exceeds limit of 15, capping at 15 (report_id=%s)",
                self._request.turns,
                self._request.report_id,
            )
            self._request.turns = 15
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

    def _build_counselor_prompt(self, language_code: str, custom_prompt: str) -> str:
        """
        Build the counselor system prompt with dynamic language code
        and custom prompt injection.

        Args:
            language_code: BCP 47 language code (e.g., 'en-US', 'hi-IN')
            custom_prompt: Custom counselor instructions from the request

        Returns:
            Complete system prompt with both placeholders injected
        """
        template = resolve_template("ally_ai_learn_counselor_report")
        if not template:
            logger.warning(
                "Counselor template not found, using custom prompt only (report_id=%s)",
                self._request.report_id,
            )
            return custom_prompt

        return template.format(
            language_code=language_code,
            custom_prompt=custom_prompt.strip() if custom_prompt else "",
        )

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
        logger.info(
            "Starting report generation: report_id=%s, scenario_id=%s, turns=%s",
            report_id,
            req.scenario_id,
            req.turns,
        )

        try:
            # -- Setup
            embedding_client = OpenAIEmbeddingClient()

            scenario = Scenario.create(req.metadata, embedding_client=embedding_client)

            client_llm = configure_llm_client(scenario)
            counselor_llm = create_llm_client(language_code=req.language)

            event_orchestrator = EventOrchestrator(
                scenario=scenario,
                thread_id=report_id,
                room=None,
                termination_callback=self._on_termination,
                is_report_mode=True,
            )

            report_graph = build_report_graph().compile(checkpointer=self._checkpointer)

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
            )

            counselor_messages = [
                SystemMessage(content=counselor_system_prompt),
                HumanMessage(content=opening),
            ]

            for turn in range(req.turns):
                # Counselor speaks
                counselor_resp = await counselor_llm.llm_instance.ainvoke(
                    counselor_messages
                )
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

            logger.info(
                "Report result (report_id=%s): status=%s, "
                "metrics=%s, transcript_entries=%d",
                report_id,
                payload.status,
                payload.metrics,
                len(self._transcripts),
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
