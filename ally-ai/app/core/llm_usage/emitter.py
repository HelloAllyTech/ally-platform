"""Best-effort emitter for LLM token-usage events (ally-ai).

Sends an ``llm_usage`` SQS message (wire shape mirrors turn_metrics:
``data.llm_usage = {...}``) to the queue ally-be consumes. Never blocks or
fails the LLM call path. No-ops unless ``settings.LLM_USAGE.QUEUE_URL`` is set.

Two optional token fields ride alongside the counts, both null when the call
site has nothing to report:

* ``cached_tokens`` — prompt tokens the provider served from its prompt cache.
  For OpenAI and Gemini this is a SUBSET of ``prompt_tokens``, not an addition
  to it: both report their prompt count inclusive of cache hits, so a consumer
  pricing cache reads at a discount must take them out of the full-rate prompt
  count rather than add them on top.
* ``metadata`` — a small dict breaking a count down further, e.g. Gemini's
  ``{"thoughts_tokens", "candidates_tokens"}`` or OpenAI's
  ``{"reasoning_tokens"}``. Informational: ``completion_tokens`` already
  includes every token billed at the output rate, so nothing in ``metadata``
  is to be added to it.

The FastAPI process has no SQS client by default, so we lazily create the
shared singleton on first use (idempotent — reuses the worker's if present).

Sending never runs on the event loop (CR1): from async code every send is handed
to a small background thread pool, fire-and-forget, and a failed send is logged
and dropped. Only a caller with no running loop (a sync worker thread, a test)
that asks for ``blocking`` sends inline.

Attribution (CR1): when a usage scope is active (``app.core.llm_usage.scope``,
set from ally-be's ``X-Ally-Usage`` header), every row's ``metadata`` carries the
scope's keys plus ``step`` and ``seq``. A caller that already added them (the
dispatcher does, so a patched emitter sees them) is left as it is.

Embeddings (CR1): ``emit_embedding_usage`` reports an embedding call's input
tokens as an ``'llm'`` row (prompt tokens only, ``metadata.call = "embedding"``):
ally-be stores ``service`` as 'llm' | 'stt' | 'tts' and prices tokens by model,
so no new service value is needed for it to land and be costed. Tokens are
counted off the event loop, with tiktoken when it can load the model's
encoding, else estimated as characters / 4 (the row's ``metadata.token_count``
says which).
"""

import asyncio
import json
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

from app.core.config import settings
from app.core.llm_usage.scope import usage_attribution
from app.core.queue.sqs_queue_client import SQSQueueClient
from app.utils.logger import get_logger

logger = get_logger(__name__)

# Sends run here, never on the event loop. Two workers: a send is one short SQS
# call, and a backlog only delays analytics, never a reply.
_EXECUTOR = ThreadPoolExecutor(max_workers=2, thread_name_prefix="llm-usage")


def usage_feed_on() -> bool:
    """Whether usage rows are sent at all (the health endpoint's ``usage_feed``)."""
    try:
        return _enabled()
    except Exception:  # noqa: BLE001
        return False


def _in_event_loop() -> bool:
    try:
        asyncio.get_running_loop()
        return True
    except RuntimeError:
        return False


def _run_safely(fn: Callable[..., None], *args: Any) -> None:
    try:
        fn(*args)
    except Exception:  # noqa: BLE001 — usage accounting never fails anything
        logger.debug("llm_usage background send failed (best-effort)", exc_info=True)


def _submit(fn: Callable[..., None], *args: Any, blocking: bool = False) -> None:
    """Run ``fn(*args)`` off the event loop. Inline only for a ``blocking`` caller
    with no running loop. Never raises."""
    try:
        if blocking and not _in_event_loop():
            _run_safely(fn, *args)
        else:
            _EXECUTOR.submit(_run_safely, fn, *args)
    except Exception:  # noqa: BLE001
        logger.debug("llm_usage submit failed (best-effort)", exc_info=True)


def _with_attribution(
    metadata: Optional[Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    """``metadata`` plus the active scope's attribution (unless already there).
    The caller's own keys win on a clash."""
    if metadata and "seq" in metadata:
        return metadata
    attribution = usage_attribution()
    if not attribution:
        return metadata
    return {**attribution, **(metadata or {})}


def _enabled() -> bool:
    cfg = getattr(settings, "LLM_USAGE", None)
    return bool(
        cfg and getattr(cfg, "ENABLED", False) and getattr(cfg, "QUEUE_URL", "")
    )


def _build_body(
    service: str,
    provider: str,
    model: str,
    task: str,
    *,
    prompt_tokens: int = 0,
    completion_tokens: int = 0,
    total_tokens: int = 0,
    audio_ms: Optional[int] = None,
    characters: Optional[int] = None,
    room_id: Optional[str] = None,
    scenario_id: Optional[int] = None,
    scenario_session_id: Optional[str] = None,
    cached_tokens: Optional[int] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> str:
    env = None
    try:
        env = settings.ENV.ENV
    except Exception:
        env = None
    return json.dumps(
        {
            "message_type": "llm_usage",
            "timestamp": int(time.time()),
            "room_id": room_id,
            "data": {
                "llm_usage": {
                    "service": service,
                    "provider": provider or "unknown",
                    "model": model or "unknown",
                    "task": task,
                    "prompt_tokens": prompt_tokens,
                    "completion_tokens": completion_tokens,
                    "total_tokens": total_tokens,
                    "cached_tokens": cached_tokens,
                    "audio_ms": audio_ms,
                    "characters": characters,
                    "env": env,
                    "scenario_id": scenario_id,
                    "scenario_session_id": scenario_session_id,
                    "metadata": metadata or None,
                }
            },
        }
    )


def _send_blocking(body: str) -> None:
    """Send via the shared boto3 SQS client (lazily created). Never raises."""
    try:
        SQSQueueClient.create_client()  # idempotent
        client = SQSQueueClient.get_client()
        client.send_message(QueueUrl=settings.LLM_USAGE.QUEUE_URL, MessageBody=body)
    except Exception:
        logger.debug("llm_usage send failed (best-effort)", exc_info=True)


def _has_quantity(
    service: str,
    prompt_tokens: int,
    completion_tokens: int,
    total_tokens: int,
    audio_ms: Optional[int],
    characters: Optional[int],
) -> bool:
    if service == "stt":
        return bool(audio_ms)
    if service == "tts":
        return bool(characters)
    return bool(prompt_tokens or completion_tokens or total_tokens)


def emit_ai_usage(
    service: str,
    provider: Optional[str],
    model: Optional[str],
    task: Optional[str],
    *,
    prompt_tokens: int = 0,
    completion_tokens: int = 0,
    total_tokens: int = 0,
    audio_ms: Optional[int] = None,
    characters: Optional[int] = None,
    room_id: Optional[str] = None,
    scenario_id: Optional[int] = None,
    scenario_session_id: Optional[str] = None,
    cached_tokens: Optional[int] = None,
    metadata: Optional[Dict[str, Any]] = None,
    blocking: bool = False,
) -> None:
    """Best-effort emit for any AI service ('llm' | 'stt' | 'tts').

    Never raises and never blocks the event loop (see the module docstring).
    """
    try:
        if not task or not _enabled():
            return
        if room_id and room_id.startswith("preview-"):
            return
        if not _has_quantity(
            service,
            prompt_tokens,
            completion_tokens,
            total_tokens,
            audio_ms,
            characters,
        ):
            return
        body = _build_body(
            service,
            provider,
            model,
            task,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=total_tokens,
            audio_ms=audio_ms,
            characters=characters,
            room_id=room_id,
            scenario_id=scenario_id,
            scenario_session_id=scenario_session_id,
            cached_tokens=cached_tokens,
            metadata=_with_attribution(metadata),
        )
        _submit(_send_blocking, body, blocking=blocking)
    except Exception:
        logger.debug("emit_ai_usage skipped (best-effort)", exc_info=True)


def emit_llm_usage(
    provider: Optional[str],
    model: Optional[str],
    task: Optional[str],
    usage: Optional[Tuple[int, int, int]],
    room_id: Optional[str] = None,
    scenario_id: Optional[int] = None,
    scenario_session_id: Optional[str] = None,
    cached_tokens: Optional[int] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> None:
    """Back-compat LLM helper (async). Forwards to emit_ai_usage(service='llm')."""
    if not usage:
        return
    prompt, completion, total = usage
    emit_ai_usage(
        "llm",
        provider,
        model,
        task,
        prompt_tokens=prompt,
        completion_tokens=completion,
        total_tokens=total,
        room_id=room_id,
        scenario_id=scenario_id,
        scenario_session_id=scenario_session_id,
        cached_tokens=cached_tokens,
        metadata=metadata,
    )


def emit_llm_usage_blocking(
    provider: Optional[str],
    model: Optional[str],
    task: Optional[str],
    usage: Optional[Tuple[int, int, int]],
    room_id: Optional[str] = None,
    scenario_id: Optional[int] = None,
    scenario_session_id: Optional[str] = None,
    cached_tokens: Optional[int] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> None:
    """Back-compat LLM helper, kept for its callers. Despite the name it never
    blocks the event loop: called from async code the send goes to the background
    pool. It sends inline only where no loop is running (a sync thread, a test)."""
    if not usage:
        return
    prompt, completion, total = usage
    emit_ai_usage(
        "llm",
        provider,
        model,
        task,
        prompt_tokens=prompt,
        completion_tokens=completion,
        total_tokens=total,
        room_id=room_id,
        scenario_id=scenario_id,
        scenario_session_id=scenario_session_id,
        cached_tokens=cached_tokens,
        metadata=metadata,
        blocking=True,
    )


# ---------------------------------------------------------------------------
# Embeddings (CR1)
# ---------------------------------------------------------------------------

_ENCODINGS: Dict[str, Any] = {}


def _encoding_for(model: str) -> Any:
    """tiktoken's encoding for ``model`` (cached), or None when unavailable.
    Called off the event loop only: a first load can fetch the encoding file."""
    if model in _ENCODINGS:
        return _ENCODINGS[model]
    encoding = None
    try:
        import tiktoken

        try:
            encoding = tiktoken.encoding_for_model(model)
        except KeyError:
            encoding = tiktoken.get_encoding("cl100k_base")
    except Exception:  # noqa: BLE001 — fall back to the estimate
        logger.debug("tiktoken unavailable for %s; estimating", model, exc_info=True)
        encoding = None
    _ENCODINGS[model] = encoding
    return encoding


def count_embedding_tokens(model: str, texts: Sequence[str]) -> Tuple[int, str]:
    """(tokens, method) for embedding ``texts`` with ``model``. ``method`` is
    ``"tiktoken"`` for an exact count, ``"estimate"`` for characters / 4."""
    encoding = _encoding_for(model)
    if encoding is not None:
        try:
            return sum(len(encoding.encode(t or "")) for t in texts), "tiktoken"
        except Exception:  # noqa: BLE001
            logger.debug("tiktoken encode failed; estimating", exc_info=True)
    return sum(max(1, len(t or "") // 4) for t in texts if t), "estimate"


def _emit_embedding_blocking(
    provider: str,
    model: str,
    task: str,
    texts: List[str],
    metadata: Optional[Dict[str, Any]],
) -> None:
    tokens, method = count_embedding_tokens(model, texts)
    if not tokens:
        return
    body = _build_body(
        "llm",
        provider,
        model,
        task,
        prompt_tokens=tokens,
        completion_tokens=0,
        total_tokens=tokens,
        metadata={
            **(metadata or {}),
            "call": "embedding",
            "token_count": method,
            "inputs": len(texts),
        },
    )
    _send_blocking(body)


def emit_embedding_usage(
    model: Optional[str],
    texts: Sequence[str],
    task: Optional[str],
    *,
    provider: str = "openai",
    prompt_tokens: Optional[int] = None,
) -> None:
    """Report one embedding call (its input tokens). Never raises or blocks.

    ``prompt_tokens`` when the provider reported them; otherwise the texts are
    counted in the background thread. The scope's attribution is captured here,
    in the caller's context, before the work leaves it.
    """
    try:
        if not task or not _enabled():
            return
        texts = [t for t in texts if t]
        if not texts and not prompt_tokens:
            return
        metadata = _with_attribution(None)
        if prompt_tokens:
            body = _build_body(
                "llm",
                provider,
                model or "unknown",
                task,
                prompt_tokens=prompt_tokens,
                total_tokens=prompt_tokens,
                metadata={
                    **(metadata or {}),
                    "call": "embedding",
                    "token_count": "provider",
                    "inputs": len(texts),
                },
            )
            _submit(_send_blocking, body)
            return
        _submit(
            _emit_embedding_blocking,
            provider,
            model or "unknown",
            task,
            texts,
            metadata,
        )
    except Exception:  # noqa: BLE001
        logger.debug("emit_embedding_usage skipped (best-effort)", exc_info=True)
