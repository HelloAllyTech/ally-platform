"""Best-effort emitter for LLM token-usage events.

Reuses the existing ``msg_event_queue`` (same SQS queue as turn_metrics — Core
routes by ``message_type``). Fire-and-forget: never blocks or fails the LLM
path. Mirrors the turn_metrics emit pattern.
"""

import asyncio
import logging
from typing import Optional, Tuple

from app.core.config import settings
from app.core.events.schemas import CoreEventMessageType, LLMUsageData
from app.core.llm_usage.tasks import LLMTask
from app.core.queue import msg_event_queue

logger = logging.getLogger(__name__)


def emit_ai_usage(
    room_id: Optional[str],
    *,
    service: str,
    provider: Optional[str],
    model: Optional[str],
    task: str,
    prompt_tokens: int = 0,
    completion_tokens: int = 0,
    total_tokens: int = 0,
    cached_tokens: int = 0,
    audio_ms: Optional[int] = None,
    characters: Optional[int] = None,
    scenario_id: Optional[int] = None,
) -> None:
    """Schedule a best-effort ``llm_usage`` SQS message for any AI service
    ('llm' | 'stt' | 'tts'). Never raises, never blocks the agent."""
    try:
        if not getattr(settings, "LLM_USAGE_ENABLED", True):
            return
        # Previews are ephemeral and have no persisted session in Core.
        if room_id and room_id.startswith("preview-"):
            return
        # Skip when there's no billable quantity for the service.
        if service == "stt" and not audio_ms:
            return
        if service == "tts" and not characters:
            return
        if service == "llm" and not (prompt_tokens or completion_tokens or total_tokens):
            return

        env = None
        try:
            env = settings.ENV.value
        except Exception:
            env = None

        message = CoreEventMessageType.create_llm_usage(
            room_id=room_id or "",
            llm_usage=LLMUsageData(
                service=service,
                provider=provider or "unknown",
                model=model or "unknown",
                task=task,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                total_tokens=total_tokens,
                cached_tokens=cached_tokens,
                audio_ms=audio_ms,
                characters=characters,
                env=env,
                scenario_id=scenario_id,
            ),
        )
        body = message.model_dump_json()

        # Fire-and-forget on the running loop.
        asyncio.create_task(_send(body))
    except Exception:
        logger.debug("emit_ai_usage skipped (best-effort)", exc_info=True)


def emit_llm_usage(
    room_id: Optional[str],
    provider: Optional[str],
    model: Optional[str],
    task: str = LLMTask.AGENT_TURN.value,
    usage: Optional[Tuple[int, ...]] = None,
    scenario_id: Optional[int] = None,
) -> None:
    """Back-compat LLM helper — forwards to emit_ai_usage(service='llm').

    ``usage`` is (prompt, completion, total) or (prompt, completion, total,
    cached) — the 3-tuple form is still accepted (cached defaults to 0) so
    existing call sites that haven't been updated to extract cache_read
    keep working unchanged.
    """
    if not usage:
        return
    prompt, completion, total = usage[0], usage[1], usage[2]
    cached = usage[3] if len(usage) > 3 else 0
    emit_ai_usage(
        room_id,
        service="llm",
        provider=provider,
        model=model,
        task=task,
        prompt_tokens=prompt,
        completion_tokens=completion,
        total_tokens=total,
        cached_tokens=cached,
        scenario_id=scenario_id,
    )


async def _send(body: str) -> None:
    try:
        await msg_event_queue.send_message(body)
    except Exception:
        logger.debug("llm_usage send failed (best-effort)", exc_info=True)
