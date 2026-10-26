"""
Orchestration for goal-based actor evaluation of a real session: run the LLM
judge, then PATCH the result to ally-be's session-evaluation webhook.

Mirrors the scenario-report service's fire-and-forget + webhook pattern, but
evaluates an EXISTING transcript supplied by ally-be (no conversation is
generated here).
"""

import asyncio
import traceback

import httpx

from app.core.config import settings
from app.core.constants import ACTOR_EVALUATION_WEBHOOK_ENDPOINT
from app.core.logger import get_logger
from app.core.scenario_session_evaluation.evaluator import evaluate_actor_goals
from app.core.scenario_session_evaluation.schemas import (
    ActorEvaluationRequest,
    ActorEvaluationWebhookPayload,
)

logger = get_logger(__name__)


async def _send_webhook(
    scenario_session_id: str, payload: ActorEvaluationWebhookPayload
) -> None:
    """PATCH the evaluation result to the core backend (best-effort)."""
    url = (
        f"{settings.CORE_SERVICE_BASE_URL}"
        f"{ACTOR_EVALUATION_WEBHOOK_ENDPOINT}"
        f"/{scenario_session_id}/evaluation"
    )
    logger.info(
        "Sending actor-evaluation webhook to %s (status=%s)", url, payload.status
    )
    headers = {
        "Content-Type": "application/json",
        "x-api-key": settings.CORE_SERVICE_API_KEY,
    }
    retries = 3
    backoff_factor = 1.0
    for attempt in range(retries):
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.patch(
                    url,
                    json=payload.model_dump(),
                    headers=headers,
                )
                resp.raise_for_status()
                logger.info(
                    "Actor-evaluation webhook delivered (status=%d)", resp.status_code
                )
                return
        except httpx.HTTPStatusError as e:
            if e.response.status_code >= 500 and attempt < retries - 1:
                sleep_time = backoff_factor * (2**attempt)
                logger.warning(
                    "Actor-evaluation webhook failed with %d, retrying in %.1fs",
                    e.response.status_code,
                    sleep_time,
                )
                await asyncio.sleep(sleep_time)
                continue

            logger.error(
                "Actor-evaluation webhook failed HTTP %d for session=%s: %s",
                e.response.status_code,
                scenario_session_id,
                e.response.text,
            )
            return
        except Exception:
            logger.exception(
                "Unexpected error sending actor-evaluation webhook for session=%s",
                scenario_session_id,
            )
            return


async def run_actor_evaluation(request: ActorEvaluationRequest) -> None:
    """Evaluate the actor against the goals and webhook the result back."""
    try:
        result = await evaluate_actor_goals(
            request.transcript,
            request.goals,
            scenario_session_id=request.scenario_session_id,
            prompts=request.prompts,
        )
        payload = ActorEvaluationWebhookPayload(
            status="COMPLETED",
            metrics=result["metrics"],
            not_applicable=result["not_applicable"],
            report_markdown=result["report_markdown"],
        )
    except KeyError:
        logger.warning(
            "Actor evaluation failed for session=%s due to a missing key in the "
            "evaluation result. "
            "This is expected if the LLM judge returns a malformed response.",
            request.scenario_session_id,
        )
        payload = ActorEvaluationWebhookPayload(
            status="FAILED",
            error_message="Evaluation failed due to a missing key in the result.",
        )
    except Exception:  # noqa: BLE001 — report the failure to ally-be
        logger.error(
            "Actor evaluation failed for session=%s",
            request.scenario_session_id,
            exc_info=True,
        )
        payload = ActorEvaluationWebhookPayload(
            status="FAILED", error_message=traceback.format_exc()
        )

    await _send_webhook(request.scenario_session_id, payload)
