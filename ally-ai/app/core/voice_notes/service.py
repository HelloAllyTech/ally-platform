"""Voice notes on WhatsApp (Agents v2 chunk WA-A §1): audio in, transcript out.

ally-be downloads the note from Meta and sends the bytes here; the transcript
then runs exactly like a typed message (crisis check first, then the agent).
The audio never reaches a language model: only a speech provider hears it,
and only the transcript goes on.

Providers: Sarvam ``saarika`` first (Indian languages, with Hinglish heard as
Hindi; ``language_code: unknown`` detects the language), OpenAI Whisper as the
fallback. Sarvam's synchronous API takes about 30 s at a time, so a longer note
is cut into 29 s pieces with ffmpeg (in the image). Notes over 2 minutes are
not transcribed: the person is asked to type instead.
"""

from __future__ import annotations

import asyncio
import os
import tempfile
from dataclasses import dataclass
from typing import List, Optional, Tuple

import httpx

from app.core.config import settings
from app.core.round_trip.service import SARVAM_ASR_MODEL, SARVAM_BASE, _has_key
from app.utils.logger import get_logger

logger = get_logger(__name__)

MAX_SECONDS = 120.0
SARVAM_PIECE_SECONDS = 29
MAX_BYTES = 16 * 1024 * 1024
OPENAI_ASR_MODEL = "whisper-1"

# Whisper names the language; ally-be wants a code.
_WHISPER_LANGUAGES = {
    "hindi": "hi",
    "english": "en",
    "marathi": "mr",
    "tamil": "ta",
    "bengali": "bn",
    "telugu": "te",
    "kannada": "kn",
    "malayalam": "ml",
    "gujarati": "gu",
    "punjabi": "pa",
    "urdu": "ur",
}


@dataclass
class VoiceNoteResult:
    status: str  # "ok" | "too_long" | "failed"
    transcript: str = ""
    language: Optional[str] = None
    duration_sec: Optional[float] = None
    provider: Optional[str] = None


async def _run(*args: str) -> Tuple[int, bytes, bytes]:
    proc = await asyncio.create_subprocess_exec(
        *args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
    )
    out, err = await asyncio.wait_for(proc.communicate(), timeout=30)
    return proc.returncode or 0, out, err


async def probe_duration(path: str) -> Optional[float]:
    """Seconds of audio, by ffprobe; None when it can't tell."""
    code, out, _ = await _run(
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        path,
    )
    try:
        return float(out.decode().strip()) if code == 0 else None
    except ValueError:
        return None


async def wav_pieces(path: str, workdir: str) -> List[bytes]:
    """16 kHz mono WAV pieces of at most SARVAM_PIECE_SECONDS each."""
    pattern = os.path.join(workdir, "piece-%03d.wav")
    code, _, err = await _run(
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        path,
        "-ac",
        "1",
        "-ar",
        "16000",
        "-f",
        "segment",
        "-segment_time",
        str(SARVAM_PIECE_SECONDS),
        pattern,
    )
    if code != 0:
        raise RuntimeError(f"ffmpeg failed: {err.decode()[:200]}")
    names = sorted(n for n in os.listdir(workdir) if n.startswith("piece-"))
    pieces = []
    for name in names:
        with open(os.path.join(workdir, name), "rb") as fh:
            pieces.append(fh.read())
    return pieces


def _base_language(code: Optional[str]) -> Optional[str]:
    if not code or code == "unknown":
        return None
    return code.split("-")[0].lower()


async def sarvam_transcribe(pieces: List[bytes]) -> Tuple[str, Optional[str]]:
    """Each piece through Sarvam with the language detected; the most heard wins."""
    texts: List[str] = []
    languages: List[str] = []
    async with httpx.AsyncClient() as client:
        for piece in pieces:
            resp = await client.post(
                f"{SARVAM_BASE}/speech-to-text",
                headers={"api-subscription-key": settings.SARVAM.API_KEY or ""},
                files={"file": ("voice-note.wav", piece, "audio/wav")},
                data={"model": SARVAM_ASR_MODEL, "language_code": "unknown"},
                timeout=30,
            )
            resp.raise_for_status()
            body = resp.json()
            texts.append((body.get("transcript") or "").strip())
            lang = _base_language(body.get("language_code"))
            if lang:
                languages.append(lang)
    language = max(set(languages), key=languages.count) if languages else None
    return " ".join(t for t in texts if t).strip(), language


def _openai_transcribe_sync(path: str) -> Tuple[str, Optional[str]]:
    from openai import OpenAI

    client = OpenAI(api_key=settings.OPENAI.API_KEY, timeout=20)
    with open(path, "rb") as fh:
        result = client.audio.transcriptions.create(
            model=OPENAI_ASR_MODEL, file=fh, response_format="verbose_json"
        )
    text = (getattr(result, "text", "") or "").strip()
    language = getattr(result, "language", None)
    return text, _WHISPER_LANGUAGES.get(str(language or "").lower(), None)


async def transcribe_voice_note(audio: bytes, mime_type: str = "") -> VoiceNoteResult:
    """The transcript of one voice note, or why there is none. Never raises."""
    if not audio or len(audio) > MAX_BYTES:
        return VoiceNoteResult(status="failed")
    suffix = ".ogg" if "ogg" in mime_type else ".audio"
    with tempfile.TemporaryDirectory(prefix="voice-note-") as workdir:
        path = os.path.join(workdir, f"note{suffix}")
        with open(path, "wb") as fh:
            fh.write(audio)
        try:
            duration = await probe_duration(path)
        except (
            Exception
        ) as exc:  # noqa: BLE001 - never fatal; providers may still read it
            logger.warning("voice note: ffprobe failed (%s)", type(exc).__name__)
            duration = None
        if duration is not None and duration > MAX_SECONDS:
            return VoiceNoteResult(status="too_long", duration_sec=round(duration, 1))
        rounded = round(duration, 1) if duration is not None else None

        if _has_key(settings.SARVAM.API_KEY):
            try:
                pieces = await wav_pieces(path, workdir)
                text, language = await sarvam_transcribe(pieces)
                if text:
                    return VoiceNoteResult(
                        status="ok",
                        transcript=text,
                        language=language,
                        duration_sec=rounded,
                        provider="sarvam",
                    )
            except Exception as exc:  # noqa: BLE001 - fall back to OpenAI
                logger.warning("voice note: sarvam failed (%s)", type(exc).__name__)

        if _has_key(settings.OPENAI.API_KEY):
            try:
                text, language = await asyncio.to_thread(_openai_transcribe_sync, path)
                if text:
                    return VoiceNoteResult(
                        status="ok",
                        transcript=text,
                        language=language,
                        duration_sec=rounded,
                        provider="openai",
                    )
            except Exception as exc:  # noqa: BLE001 - reported as failed below
                logger.warning("voice note: openai failed (%s)", type(exc).__name__)

    return VoiceNoteResult(status="failed", duration_sec=rounded)
