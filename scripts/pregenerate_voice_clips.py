"""Pre-render and curate opener clips per voice into the persistent clip store.

WHY

A session renders its opener catalog on demand, and in prod every session did
it from scratch: the first clip was ready 3.3-4.7 s after setup and no take
was ever compared with another. This script does that work ahead of time,
once per voice, and keeps only the best takes:

1. Build the voice's TTS client exactly as a session does
   (``tts_config_for_voice`` + ``create_tts_client``), so the voice fingerprint
   and therefore the store keys match what sessions look up.
2. Render a reference: the language's catalog lines spoken as one utterance,
   twice. That is the voice as the learner hears it in a reply.
3. Render ``--takes`` takes of every spoken catalog line (generative voices
   differ per take; fixed-speaker ones barely do, so they get one).
4. Rank the takes: drop implausible lengths (filler_clips does), then score
   speaker similarity to the reference (WeSpeaker ResNet34 embeddings, ONNX)
   with a penalty for loudness far from the reference.
5. Write the best ``MAX_TAKES`` per line to the store as take-00 (best) ...,
   or with ``--dry-run`` write WAVs and a report locally instead.

Sessions play take-00 first and rotate through the rest
(``OpenerPlayer._next_take``).

USAGE

    poetry run python scripts/pregenerate_voice_clips.py voices.json --dry-run out/
    CLIP_STORE_BUCKET=ally-prd-s3-assets poetry run python \\
        scripts/pregenerate_voice_clips.py voices.json

``voices.json`` is a list of ``{"name", "provider", "config", "language",
"gender"}``: ``scenario_voices`` rows plus the language value (``hi-IN``).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import math
import os
import sys
import wave
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(".env")

from app.core.agent.factory import tts_config_for_voice  # noqa: E402
from app.core.livekit import clip_store  # noqa: E402
from app.core.livekit import filler_clips as fc  # noqa: E402
from app.core.livekit.opener_catalog import build_session_catalog  # noqa: E402
from app.core.scenario.base import Scenario  # noqa: E402
from app.tts.factory import create_tts_client  # noqa: E402

EMBED_REPO = "Wespeaker/wespeaker-voxceleb-resnet34-LM"
EMBED_FILE = "voxceleb_resnet34_LM.onnx"
#: A take whose RMS is this many dB from the reference loses this much score
#: per dB: a whispered or shouted "Hmm" is a different moment, not a better one.
LOUDNESS_PENALTY_PER_DB = 0.01
LOUDNESS_FREE_DB = 4.0
#: Speaker embeddings separate voices on sentences (same voice 0.53-0.66 vs
#: different 0.10-0.31 cosine, four prod ElevenLabs voices, 2026-10-02) but
#: are noise on a half-second hum. Similarity counts fully from this length
#: and not at all below SIMILARITY_MIN_MS; shorter takes are ranked on how
#: typical their length and loudness are among the takes instead.
SIMILARITY_FULL_MS = 1500.0
SIMILARITY_MIN_MS = 500.0
TYPICALITY_PENALTY = 0.3

#: Plain conversational sentences for the reference: the voice as heard in a
#: reply. Languages without an entry fall back to the catalog lines.
REFERENCE_TEXT = {
    "en": "I have been working late almost every night this month. "
    "Honestly, I don't know how much longer I can keep this up.",
    "hi": "इस महीने मैं लगभग हर रात देर तक काम कर रही हूँ। "
    "सच कहूँ तो, पता नहीं मैं यह कब तक कर पाऊँगी।",
    "mr": "या महिन्यात मी जवळजवळ रोज रात्री उशिरापर्यंत काम करते आहे. "
    "खरं सांगू तर, हे किती दिवस जमेल माहीत नाही.",
    "ta": "இந்த மாதம் கிட்டத்தட்ட ஒவ்வொரு இரவும் நான் தாமதமாக வேலை செய்கிறேன். "
    "உண்மையில், இதை எவ்வளவு நாள் தொடர முடியும் என்று தெரியவில்லை.",
    "kn": "ಈ ತಿಂಗಳು ನಾನು ಬಹುತೇಕ ಪ್ರತಿ ರಾತ್ರಿ ತಡವಾಗಿ ಕೆಲಸ ಮಾಡುತ್ತಿದ್ದೇನೆ. "
    "ನಿಜ ಹೇಳಬೇಕೆಂದರೆ, ಇದನ್ನು ಎಷ್ಟು ದಿನ ಮುಂದುವರಿಸಬಹುದು ಗೊತ್ತಿಲ್ಲ.",
    "te": "ఈ నెల నేను దాదాపు ప్రతి రాత్రి ఆలస్యంగా పని చేస్తున్నాను. "
    "నిజం చెప్పాలంటే, ఇది ఎంత కాలం కొనసాగించగలనో తెలియదు.",
    "ml": "ഈ മാസം ഞാൻ മിക്കവാറും എല്ലാ രാത്രിയും വൈകി ജോലി ചെയ്യുന്നു. "
    "സത്യം പറഞ്ഞാൽ, ഇത് എത്ര നാൾ തുടരാനാകുമെന്ന് അറിയില്ല.",
    "bn": "এই মাসে আমি প্রায় প্রতি রাতেই দেরি পর্যন্ত কাজ করছি। "
    "সত্যি বলতে, এটা আর কতদিন চালিয়ে যেতে পারব জানি না।",
    "gu": "આ મહિને હું લગભગ દરરોજ રાત્રે મોડે સુધી કામ કરું છું. "
    "સાચું કહું તો, આ કેટલો સમય ચાલુ રાખી શકીશ ખબર નથી.",
    "pa": "ਇਸ ਮਹੀਨੇ ਮੈਂ ਲਗਭਗ ਹਰ ਰਾਤ ਦੇਰ ਤੱਕ ਕੰਮ ਕਰ ਰਹੀ ਹਾਂ। "
    "ਸੱਚ ਦੱਸਾਂ ਤਾਂ, ਪਤਾ ਨਹੀਂ ਇਹ ਕਿੰਨਾ ਚਿਰ ਚੱਲ ਸਕਾਂਗੀ।",
}


# ---- speaker embedding ---------------------------------------------------


def _to_16k(audio48k: np.ndarray) -> np.ndarray:
    """48 kHz -> 16 kHz with a windowed-sinc low-pass first. Plain decimation
    folds 8-24 kHz content into the speech band and wrecks the embedding."""
    taps = 101
    n = np.arange(taps) - (taps - 1) / 2
    cutoff = 7600.0 / 48000.0
    kernel = 2 * cutoff * np.sinc(2 * cutoff * n) * np.hamming(taps)
    kernel /= kernel.sum()
    return np.convolve(audio48k, kernel, mode="same")[::3]


def _fbank(pcm48k: np.ndarray) -> np.ndarray:
    """80-dim log-mel filterbank at 16 kHz, 25 ms / 10 ms, mean-normalised —
    the WeSpeaker front end (Kaldi fbank, Hamming window, pre-emphasis 0.97)."""
    audio = _to_16k(pcm48k.astype(np.float64))
    sr, win, hop, nfft, mels = 16000, 400, 160, 512, 80
    if len(audio) < win:
        audio = np.pad(audio, (0, win - len(audio)))
    count = 1 + (len(audio) - win) // hop
    idx = np.arange(win)[None, :] + hop * np.arange(count)[:, None]
    frames = audio[idx]
    frames = frames - frames.mean(axis=1, keepdims=True)
    frames = np.concatenate(
        [frames[:, :1] * (1 - 0.97), frames[:, 1:] - 0.97 * frames[:, :-1]], axis=1
    )
    power = np.abs(np.fft.rfft(frames * np.hamming(win), nfft)) ** 2

    def mel(f):
        return 1127.0 * np.log(1.0 + f / 700.0)

    edges = np.linspace(mel(20.0), mel(sr / 2), mels + 2)
    bins = mel(np.linspace(0, sr / 2, nfft // 2 + 1))
    bank = np.zeros((mels, nfft // 2 + 1))
    for m in range(mels):
        lo, mid, hi = edges[m], edges[m + 1], edges[m + 2]
        up = (bins - lo) / (mid - lo)
        down = (hi - bins) / (hi - mid)
        bank[m] = np.clip(np.minimum(up, down), 0, None)
    feats = np.log(np.maximum(power @ bank.T, np.finfo(float).eps))
    return (feats - feats.mean(axis=0, keepdims=True)).astype(np.float32)


class SpeakerEmbedder:
    def __init__(self) -> None:
        import onnxruntime as ort
        from huggingface_hub import hf_hub_download

        path = hf_hub_download(EMBED_REPO, EMBED_FILE)
        self._session = ort.InferenceSession(path, providers=["CPUExecutionProvider"])
        self._input = self._session.get_inputs()[0].name

    def embed(self, pcm: bytes) -> np.ndarray:
        samples = np.frombuffer(pcm, dtype="<i2").astype(np.float32)
        feats = _fbank(samples)[None, :, :]
        vec = self._session.run(None, {self._input: feats})[0][0]
        return vec / (np.linalg.norm(vec) + 1e-9)


def _rms_db(pcm: bytes) -> float:
    samples = np.frombuffer(pcm, dtype="<i2").astype(np.float64)
    rms = math.sqrt(float(np.mean(samples**2))) if len(samples) else 0.0
    return 20 * math.log10(max(rms, 1.0))


# ---- rendering -----------------------------------------------------------


def build_client(voice: Dict[str, Any]):
    scenario_voice = Scenario._build_voice({"voice": voice})
    gender = None
    if voice.get("gender"):
        from app.tts import Gender

        try:
            gender = Gender(str(voice["gender"]).lower())
        except ValueError:
            gender = None
    return create_tts_client(
        tts_config=tts_config_for_voice(scenario_voice),
        language_code=voice["language"],
        gender=gender,
    )


async def render(clip_tts, text: str) -> Optional[bytes]:
    out = await fc._render_one(clip_tts, text, 0)
    if out is None:
        return None
    frames, _ = out
    return fc._pcm_of(frames)


def default_takes(client) -> int:
    """Generative voices differ per take, so choosing among takes pays off;
    fixed-speaker ones render near-identical audio, so one is enough."""
    model = str(getattr(client, "_model", "") or "").lower()
    if "v3" in model:
        return 4
    if type(client).__name__ == "ElevenLabsTTSClient":
        return 2
    return 1


def _duration_ms(pcm: bytes) -> float:
    return len(pcm) / 2.0 / fc.MIXER_SAMPLE_RATE * 1000.0


def rank_takes(
    takes: List[bytes], ref_vec: np.ndarray, ref_db: float, embedder
) -> List[Tuple[float, float, bytes]]:
    """``(score, similarity, pcm)`` best first.

    score = w * similarity - typicality penalty - loudness penalty, where w
    grows with the line's median take length (see SIMILARITY_FULL_MS): spoken
    lines are judged mostly on sounding like the voice, hums on being an
    ordinary rendering rather than an outlier in length or level.
    """
    med_ms = float(np.median([_duration_ms(t) for t in takes]))
    med_db = float(np.median([_rms_db(t) for t in takes]))
    # Weighted by the LINE's typical length, not each take's: a run-on take
    # of a hum is long, and must not earn the right to be judged as speech.
    weight = min(
        1.0,
        max(
            0.0, (med_ms - SIMILARITY_MIN_MS) / (SIMILARITY_FULL_MS - SIMILARITY_MIN_MS)
        ),
    )
    ranked = []
    for pcm in takes:
        ms = _duration_ms(pcm)
        similarity = float(embedder.embed(pcm) @ ref_vec)
        atypical = abs(ms - med_ms) / max(med_ms, 1.0) + abs(_rms_db(pcm) - med_db) / 20
        off_db = max(0.0, abs(_rms_db(pcm) - ref_db) - LOUDNESS_FREE_DB)
        score = (
            weight * similarity
            - TYPICALITY_PENALTY * atypical
            - LOUDNESS_PENALTY_PER_DB * off_db
        )
        ranked.append((score, similarity, pcm))
    ranked.sort(key=lambda r: r[0], reverse=True)
    return ranked


def write_wav(path: Path, pcm: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(fc.MIXER_SAMPLE_RATE)
        w.writeframes(pcm)


async def curate_voice(voice, embedder, takes_override, dry_run: Optional[Path]):
    client = build_client(voice)
    name = voice.get("name") or voice.get("config", {}).get("voice_id")
    if not client.can_create_clip_tts():
        return {"voice": name, "status": "skipped: clip policy refuses this voice"}
    _ = client.tts_instance  # build first, exactly as a live session has
    fingerprint = fc.voice_fingerprint(client)
    language = clip_store.store_language(voice["language"])
    catalog = build_session_catalog(voice["language"], gender=voice.get("gender"))
    lines = [e.text for e in catalog.entries.values() if e.text]
    if not lines:
        return {"voice": name, "status": "skipped: no catalog lines in language"}

    clip_tts = client.create_clip_tts()
    try:
        primary = voice["language"].split("-")[0].lower()
        reference = REFERENCE_TEXT.get(primary) or " ".join(lines)
        refs = [r for r in [await render(clip_tts, reference) for _ in range(2)] if r]
        if not refs:
            return {"voice": name, "status": "failed: reference did not render"}
        ref_vec = np.mean([embedder.embed(r) for r in refs], axis=0)
        ref_vec = ref_vec / (np.linalg.norm(ref_vec) + 1e-9)
        ref_db = float(np.mean([_rms_db(r) for r in refs]))

        count = takes_override or default_takes(client)
        report = {"voice": name, "fingerprint": fingerprint, "language": language}
        report["lines"] = {}
        for line in lines:
            text = fc._synthesis_text(line, 0)
            takes = [
                t for t in [await render(clip_tts, text) for _ in range(count)] if t
            ]
            if not takes:
                report["lines"][line] = "no plausible take"
                continue
            ranked = rank_takes(takes, ref_vec, ref_db, embedder)
            kept = [pcm for _, _, pcm in ranked[: clip_store.MAX_TAKES]]
            report["lines"][line] = [round(sim, 3) for _, sim, _ in ranked]
            if dry_run is not None:
                for i, pcm in enumerate(kept):
                    write_wav(dry_run / f"{name}/{line[:24]}-take{i}.wav", pcm)
            else:
                await asyncio.to_thread(
                    clip_store.save_sync, fingerprint, language, text, kept
                )
        report["status"] = "ok"
        return report
    finally:
        aclose = getattr(clip_tts, "aclose", None)
        if aclose is not None:
            await aclose()


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("voices", type=Path)
    parser.add_argument("--dry-run", type=Path, default=None)
    parser.add_argument("--takes", type=int, default=0)
    args = parser.parse_args()
    if args.dry_run is None and not clip_store.enabled():
        sys.exit("CLIP_STORE_BUCKET is not set (or pass --dry-run DIR)")

    voices = json.loads(args.voices.read_text())
    embedder = SpeakerEmbedder()
    from livekit.agents.utils import http_context

    http_context._new_session_ctx()
    try:
        for voice in voices:
            try:
                result = await curate_voice(voice, embedder, args.takes, args.dry_run)
            except Exception as e:  # noqa: BLE001 - one bad voice must not stop the run
                result = {"voice": voice.get("name"), "status": f"failed: {e}"}
            print(json.dumps(result, ensure_ascii=False), flush=True)
    finally:
        await http_context._close_http_ctx()


if __name__ == "__main__":
    os.environ.setdefault("LOG_LEVEL", "WARNING")
    asyncio.run(main())
