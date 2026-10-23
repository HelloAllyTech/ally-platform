"""Persistent clip store: rendered clips shared across sessions and workers.

WHY THIS EXISTS

The in-process clip cache (``filler_clips._CACHE``) dies with its worker
process, and in prod every session started with it empty: ``cache_size`` equalled
``cache_misses`` in every session-totals line (2026-09-29..10-01), so each
session re-rendered its whole opener catalog and its first clip was ready only
3.3-4.7 s after setup. This store keeps the audio in S3, keyed by everything
that changes how it sounds, so a voice is rendered once and every later session
loads it in one round of parallel GETs.

It also holds CURATED takes. ``scripts/pregenerate_voice_clips.py`` renders
several takes of each catalog line, ranks them (length, loudness and speaker
similarity to the voice's own reply), and writes the best few as
``take-00`` (best), ``take-01``, ... Sessions play the best take and rotate
through the rest, so a repeated "Hmm…" is never the same recording twice.

LAYOUT

``{prefix}/{voice fingerprint}/{language}/{text hash}/take-NN.pcm``: raw 16-bit
little-endian mono PCM at ``MIXER_SAMPLE_RATE``, i.e. exactly what playback
uses, so a load needs no decode. The text hash covers the exact text sent to
the TTS, so a punctuation variant is its own entry.

Everything is best-effort and bounded: a slow or unreachable store costs at
most ``CLIP_STORE_TIMEOUT_MS`` and the session renders as before. Off unless
``CLIP_STORE_BUCKET`` is set.
"""

from __future__ import annotations

import asyncio
import hashlib
from typing import Dict, List, Optional, Sequence, Tuple

from app.core.config import settings
from app.core.logger import get_logger

logger = get_logger(__name__)

#: Most takes a session loads per line: the best plus two to rotate through.
MAX_TAKES = 3

_client = None
#: Strong references to in-flight background saves.
_PENDING: set = set()


def _s3():
    global _client
    if _client is None:
        import boto3
        from botocore.config import Config

        timeout_s = max(0.5, float(settings.CLIP_STORE_TIMEOUT_MS) / 1000.0)
        config = Config(
            connect_timeout=timeout_s,
            read_timeout=timeout_s,
            retries={"max_attempts": 1, "mode": "standard"},
            max_pool_connections=32,
        )
        kwargs = {"region_name": settings.AWS_REGION, "config": config}
        if settings.AWS_ENDPOINT_URL:
            kwargs.update(
                endpoint_url=settings.AWS_ENDPOINT_URL,
                aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
                aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
            )
        _client = boto3.client("s3", **kwargs)
    return _client


def enabled() -> bool:
    return bool(getattr(settings, "CLIP_STORE_BUCKET", ""))


def text_dir(fingerprint: str, language: str, text: str) -> str:
    """The key prefix holding every take of ``text`` in this voice."""
    digest = hashlib.sha256(text.strip().encode("utf-8")).hexdigest()[:20]
    prefix = settings.CLIP_STORE_PREFIX.strip("/")
    return f"{prefix}/{fingerprint}/{language or 'unknown'}/{digest}"


def take_key(fingerprint: str, language: str, text: str, take: int) -> str:
    return f"{text_dir(fingerprint, language, text)}/take-{take:02d}.pcm"


def _load_sync(fingerprint: str, language: str, text: str) -> List[bytes]:
    s3 = _s3()
    bucket = settings.CLIP_STORE_BUCKET
    listed = s3.list_objects_v2(
        Bucket=bucket,
        Prefix=text_dir(fingerprint, language, text) + "/",
        MaxKeys=MAX_TAKES * 2,
    )
    keys = sorted(
        o["Key"] for o in listed.get("Contents") or [] if o["Key"].endswith(".pcm")
    )[:MAX_TAKES]
    takes = []
    for key in keys:
        body = s3.get_object(Bucket=bucket, Key=key)["Body"].read()
        if body:
            takes.append(body)
    return takes


def _save_sync(fingerprint: str, language: str, text: str, take: int, pcm: bytes):
    _s3().put_object(
        Bucket=settings.CLIP_STORE_BUCKET,
        Key=take_key(fingerprint, language, text, take),
        Body=pcm,
        ContentType="application/octet-stream",
    )


async def load_many(
    fingerprint: str, language: str, texts: Sequence[str]
) -> Dict[str, List[bytes]]:
    """Every stored take of each of ``texts``, best first, within the timeout.

    Returns only the texts that had at least one take. Never raises: on a
    timeout or any error the caller renders what is missing, as before.
    """
    if not enabled() or not texts:
        return {}
    unique = list(dict.fromkeys(t for t in texts if t and t.strip()))

    async def _one(text: str) -> Tuple[str, List[bytes]]:
        try:
            return text, await asyncio.to_thread(
                _load_sync, fingerprint, language, text
            )
        except Exception as e:  # noqa: BLE001 - a store miss is just a render
            logger.debug("[CLIP_STORE] load failed for %r: %s", text, e)
            return text, []

    try:
        results = await asyncio.wait_for(
            asyncio.gather(*[_one(t) for t in unique]),
            timeout=float(settings.CLIP_STORE_TIMEOUT_MS) / 1000.0 * 2,
        )
    except asyncio.TimeoutError:
        logger.info("[CLIP_STORE] load timed out for %d line(s)", len(unique))
        return {}
    return {text: takes for text, takes in results if takes}


def save_in_background(
    fingerprint: str, language: str, text: str, pcm: bytes, take: int = 0
) -> None:
    """Write one take without waiting for it. A live render is saved as take 0
    only when the store had nothing for that line; curated sets are written by
    the pre-generation script and never overwritten here."""
    if not enabled() or not pcm:
        return
    from app.core.tasks import spawn_background_task

    async def _save() -> None:
        try:
            await asyncio.to_thread(_save_sync, fingerprint, language, text, take, pcm)
        except Exception as e:  # noqa: BLE001 - a lost write costs one re-render
            logger.debug("[CLIP_STORE] save failed for %r: %s", text, e)

    try:
        spawn_background_task(
            _save(), name="clip-store-save", background_tasks=_PENDING
        )
    except Exception:  # noqa: BLE001 - never break a render over a cache write
        pass


def save_sync(
    fingerprint: str, language: str, text: str, takes: Sequence[bytes]
) -> None:
    """Write a curated, ranked set of takes (best first). For the script."""
    for index, pcm in enumerate(list(takes)[:MAX_TAKES]):
        _save_sync(fingerprint, language, text, index, pcm)
    # A curated set replaces any longer, older one.
    for index in range(len(takes), MAX_TAKES):
        try:
            _s3().delete_object(
                Bucket=settings.CLIP_STORE_BUCKET,
                Key=take_key(fingerprint, language, text, index),
            )
        except Exception:  # noqa: BLE001
            pass


def store_language(language: Optional[str]) -> str:
    return (language or "unknown").strip() or "unknown"
