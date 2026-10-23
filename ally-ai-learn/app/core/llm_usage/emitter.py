"""Best-effort emitter for LLM token-usage events.

Reuses the existing ``msg_event_queue`` (same SQS queue as turn_metrics — Core
routes by ``message_type``). Fire-and-forget: never blocks or fails the LLM
path. Mirrors the turn_metrics emit pattern.
"""

import asyncio
import logging
from typing import Any, Dict, Optional, Tuple

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
    scenario_session_id: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> None:
    """Schedule a best-effort ``llm_usage`` SQS message for any AI service
    ('llm' | 'stt' | 'tts'). Never raises, never blocks the agent.

    ``room_id`` (the LiveKit room name) is what attributes a call to a session
    in Core. A call made outside any room (the post-session actor evaluation,
    an HTTP request) passes ``scenario_session_id`` instead, which Core reads
    first. ``metadata`` is stored verbatim on the row, for context no column
    carries (a studio rehearsal's ``report_id``)."""
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
        if service == "llm" and not (
            prompt_tokens or completion_tokens or total_tokens
        ):
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
                scenario_session_id=scenario_session_id,
                metadata=metadata,
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
    scenario_session_id: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
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
        scenario_session_id=scenario_session_id,
        metadata=metadata,
    )


def _resolve_room_id(room_id: Optional[str]) -> Optional[str]:
    """The explicit room, else the graph run's context var.

    Call sites that run outside a graph node must pass ``room_id``: there the
    context var reads "unknown" and Core can't attribute the cost to a session.
    Inside a node (and tasks spawned from one, which copy the context) the
    context var is the room name.
    """
    if room_id:
        return room_id
    try:
        from app.core.graph.instrumentation import get_room_id

        return get_room_id()
    except Exception:
        return None


def emit_langchain_usage(
    response: Any,
    *,
    task: str,
    llm_client: Any = None,
    room_id: Optional[str] = None,
    provider: Optional[str] = None,
    model: Optional[str] = None,
    scenario_id: Optional[int] = None,
    scenario_session_id: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> None:
    """Emit the usage carried by a LangChain ``AIMessage``. Never raises.

    ``response`` is the RAW message — a structured-output call must ask for
    ``include_raw=True``, because the parsed model alone carries no usage.
    Provider and model default to ``llm_client``'s (a ``BaseLLMClient``).
    Nothing is emitted when the response reports no usage.
    """
    try:
        from app.core.llm_usage.extract import extract_usage_from_aimessage

        usage = extract_usage_from_aimessage(response)
        if not usage:
            return
        if llm_client is not None:
            provider = provider or getattr(llm_client, "provider", None)
            if not model:
                llm_instance = getattr(llm_client, "llm_instance", None)
                model = getattr(llm_instance, "model_name", None) or getattr(
                    llm_instance, "model", None
                )
        emit_llm_usage(
            # A call attributed by session id is made outside any room: don't
            # borrow a room from the context var (it would read "unknown").
            room_id=(room_id if scenario_session_id else _resolve_room_id(room_id)),
            provider=provider,
            model=model if isinstance(model, str) else None,
            task=task,
            usage=usage,
            scenario_id=scenario_id,
            scenario_session_id=scenario_session_id,
            metadata=metadata,
        )
    except Exception:
        logger.debug("emit_langchain_usage skipped (best-effort)", exc_info=True)


def emit_openai_usage(
    completion: Any,
    *,
    task: str,
    model: Optional[str],
    provider: str = "openai",
    room_id: Optional[str] = None,
    scenario_id: Optional[int] = None,
    scenario_session_id: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> None:
    """Emit the usage carried by a raw OpenAI SDK completion. Never raises.

    ``model`` is the REQUESTED model id (as configured), not
    ``completion.model``, which the API returns date-suffixed and which would
    then miss Core's per-model pricing.
    """
    try:
        from app.core.llm_usage.extract import extract_usage_from_openai_completion

        usage = extract_usage_from_openai_completion(completion)
        if not usage:
            return
        emit_llm_usage(
            # As in emit_langchain_usage: a call attributed by session id is
            # not handed a room from the context var.
            room_id=(room_id if scenario_session_id else _resolve_room_id(room_id)),
            provider=provider,
            model=model,
            task=task,
            usage=usage,
            scenario_id=scenario_id,
            scenario_session_id=scenario_session_id,
            metadata=metadata,
        )
    except Exception:
        logger.debug("emit_openai_usage skipped (best-effort)", exc_info=True)


def emit_embedding_usage(
    *,
    task: str,
    model: Optional[str],
    input_tokens: int,
    provider: str = "openai",
    room_id: Optional[str] = None,
) -> None:
    """Emit an embedding call: billed on input tokens only. Never raises."""
    try:
        emit_ai_usage(
            _resolve_room_id(room_id),
            service="llm",
            provider=provider,
            model=model,
            task=task,
            prompt_tokens=int(input_tokens or 0),
            completion_tokens=0,
            total_tokens=int(input_tokens or 0),
        )
    except Exception:
        logger.debug("emit_embedding_usage skipped (best-effort)", exc_info=True)


async def _send(body: str) -> None:
    try:
        await msg_event_queue.send_message(body)
    except Exception:
        logger.debug("llm_usage send failed (best-effort)", exc_info=True)
