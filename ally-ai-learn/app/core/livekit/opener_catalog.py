"""The fixed catalog of turn openers, and rendering it for one session's voice.

WHY A CATALOG
-------------
Turn openers (the "hmm…", "um…", breath or sigh the learner hears before the
character's reply) used to be GENERATED per session by a small LLM. In prod that
produced 101 distinct phrases across the whole platform, 62% of them bare hums,
English "uh/um" inside Hindi and Marathi sessions, and no breaths or sighs at
all. A generator told to be short and commit to nothing converges on the
cheapest safe output.

A curated catalog fixes the SUPPLY side: every entry is authored once, in the
language's native script, tagged with the kind of sound it is (so it can fit the
character's state) and its family (so "hmm" / "hmmm" / "hmm…" count as one
sound for the no-repeat rule). The working-memory delivery plan only ever
chooses ids from it. Because the set is fixed, rendered clips are shared through
the worker-wide cache and most sessions pay no TTS call for them at all.

Entries come from three places:

* ``opener_catalog.json`` (beside this module) — the curated set, TTS-rendered
  per voice;
* ``asset`` entries (breath, sigh) — bundled audio, played as-is, skipped when
  the file is not shipped;
* the scenario's Studio ``allowed_fillers`` — authored per language, added as
  ``lexical`` entries so a curator can extend the catalog without a deploy.

Everything here is best-effort: a failure yields fewer entries, never an error.
"""

from __future__ import annotations

import json
import wave
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

from app.core.logger import get_logger

logger = get_logger(__name__)

#: Next to this module on purpose: the repo's .gitignore excludes every
#: ``data/`` directory, and a catalog under one silently never shipped.
_DATA_PATH = Path(__file__).with_name("opener_catalog.json")
_ASSET_DIR = Path(__file__).resolve().parents[2] / "assets" / "openers"

#: Every kind the plan may ask for. ``silence`` is not a catalog kind — it is
#: the absence of an opener — but the plan speaks the same vocabulary.
VOCAL_KINDS = ("hum", "hesitation", "reflective", "lexical")
BODY_KINDS = ("breath", "sigh")
OPENER_KINDS = VOCAL_KINDS + BODY_KINDS

#: Prefix for entries built from the scenario's Studio filler words.
STUDIO_PREFIX = "studio:"


@dataclass(frozen=True)
class CatalogEntry:
    """One opener the session can play."""

    id: str
    kind: str
    family: str
    #: What the TTS is asked to say. None for asset entries.
    text: Optional[str] = None
    #: Absolute path of a bundled audio file, for asset entries.
    asset_path: Optional[str] = None

    @property
    def is_asset(self) -> bool:
        return self.asset_path is not None


@dataclass
class SessionCatalog:
    """The entries available to ONE session: its language, its assets."""

    language: str
    entries: Dict[str, CatalogEntry] = field(default_factory=dict)

    def get(self, entry_id: str) -> Optional[CatalogEntry]:
        return self.entries.get(entry_id)

    def ids_of_kind(self, kind: str) -> List[str]:
        return [e.id for e in self.entries.values() if e.kind == kind]

    def describe_for_prompt(self) -> str:
        """One line per entry, for the planner prompt: id, kind and the words.

        Asset entries are described by kind only — there are no words, and the
        model needs to know the sound exists, not what file backs it.
        """
        lines = []
        for entry in self.entries.values():
            spoken = f' "{entry.text}"' if entry.text else f" ({entry.kind} sound)"
            lines.append(f"- {entry.id} [{entry.kind}]{spoken}")
        return "\n".join(lines) if lines else "(no openers available)"


def primary_language(language_code: Optional[str]) -> str:
    """``hi-IN`` -> ``hi``. Unknown/empty -> ``en``."""
    code = (language_code or "").strip().lower()
    if not code:
        return "en"
    return code.replace("_", "-").split("-", 1)[0] or "en"


@lru_cache(maxsize=1)
def _load_raw() -> List[Dict[str, Any]]:
    try:
        with _DATA_PATH.open(encoding="utf-8") as fh:
            data = json.load(fh)
        entries = data.get("entries") or []
        return [e for e in entries if isinstance(e, dict)]
    except Exception:  # noqa: BLE001 - a missing catalog means no openers
        logger.warning("[OPENER] catalog could not be loaded", exc_info=True)
        return []


def catalog_available() -> bool:
    """Whether the curated catalog loaded. False sends the worker to the legacy
    filler path instead of a session with no openers at all."""
    return bool(_load_raw())


def normalize_gender(value: Optional[str]) -> Optional[str]:
    """``"Female"`` -> ``"female"``; anything but female/male -> None."""
    text = str(value or "").strip().lower()
    return text if text in ("female", "male") else None


def build_session_catalog(
    language_code: Optional[str],
    studio_fillers: Optional[Iterable[str]] = None,
    asset_dir: Optional[Path] = None,
    gender: Optional[str] = None,
) -> SessionCatalog:
    """The catalog for a session in ``language_code``.

    An entry without text in this language is left out rather than falling back
    to English: the Indic TTS voices spell Latin text letter by letter, and an
    English "hmm" inside a Marathi session is exactly the mismatch this replaces.
    """
    lang = primary_language(language_code)
    assets = asset_dir or _ASSET_DIR
    catalog = SessionCatalog(language=lang)
    for raw in _load_raw():
        entry_id = str(raw.get("id") or "").strip()
        kind = str(raw.get("kind") or "").strip()
        if not entry_id or kind not in OPENER_KINDS:
            continue
        family = str(raw.get("family") or entry_id)
        asset = raw.get("asset")
        if asset:
            name = str(asset)
            if "{gender}" in name:
                # A breath or sigh carries the speaker's body: one in the
                # wrong voice is worse than none, so no gender means no entry.
                voice_gender = normalize_gender(gender)
                if voice_gender is None:
                    continue
                name = name.replace("{gender}", voice_gender)
            path = assets / name
            if path.is_file():
                catalog.entries[entry_id] = CatalogEntry(
                    id=entry_id, kind=kind, family=family, asset_path=str(path)
                )
            continue
        text = (raw.get("texts") or {}).get(lang)
        if isinstance(text, str) and text.strip():
            catalog.entries[entry_id] = CatalogEntry(
                id=entry_id, kind=kind, family=family, text=text.strip()
            )

    known_texts = {e.text.strip().lower() for e in catalog.entries.values() if e.text}
    for word in studio_fillers or []:
        if not isinstance(word, str) or not word.strip():
            continue
        text = word.strip()
        if text.lower() in known_texts:
            continue
        known_texts.add(text.lower())
        entry_id = f"{STUDIO_PREFIX}{text.lower()}"
        catalog.entries[entry_id] = CatalogEntry(
            id=entry_id, kind="lexical", family=entry_id, text=text
        )
    return catalog


def load_asset_clip(entry: CatalogEntry):
    """Decode an asset entry's WAV into an in-memory ``FillerClip``, or None.

    Assets are voice-agnostic by design (a breath carries no words), so they are
    decoded once per session with no TTS call and no cache key on the voice.
    """
    if not entry.asset_path:
        return None
    try:
        from app.core.livekit.filler_clips import (
            MIXER_SAMPLE_RATE,
            FillerClip,
            _frames_from_pcm,
            _resample_to_mixer_rate,
        )

        with wave.open(entry.asset_path, "rb") as wav:
            if wav.getsampwidth() != 2:
                logger.warning(
                    "[OPENER] asset %s is not 16-bit PCM; skipped", entry.asset_path
                )
                return None
            pcm = wav.readframes(wav.getnframes())
            mono = _resample_to_mixer_rate(pcm, wav.getframerate(), wav.getnchannels())
        frames = _frames_from_pcm(mono, MIXER_SAMPLE_RATE, 1)
        if not frames:
            return None
        return FillerClip(
            phrase=entry.id,
            frames=frames,
            duration_ms=(len(mono) / 2.0) / MIXER_SAMPLE_RATE * 1000.0,
            filler_type=entry.kind,
            source="asset",
        )
    except Exception:  # noqa: BLE001 - a bad asset means that entry is off
        logger.warning("[OPENER] could not load asset %s", entry.asset_path)
        return None
