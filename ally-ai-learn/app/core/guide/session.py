"""What a guide voice job is for: its dispatch metadata and its ally-be session.

Neither shape is in the generated wire contract (``contract.py`` covers the
turn request and its NDJSON frames only), so the two models below are the one
place they are written down on this side. Both ignore unknown fields, like the
generated models, so ally-be can add to them without breaking a deployed
worker.
"""

from __future__ import annotations

import json
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from app.core.logger import get_logger

logger = get_logger(__name__)

TurnMode = Literal["hands_free", "push_to_talk"]

GUIDE_DISPATCH_KIND = "ally_guide"


def _turn_mode(value: Any) -> str:
    # A mode this worker doesn't know is served hands-free rather than refused:
    # the learner still gets a working voice session.
    return "push_to_talk" if value == "push_to_talk" else "hands_free"


class GuideVoiceDispatch(BaseModel):
    """Dispatch metadata ally-be attaches when it sends this worker to a room."""

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    kind: Literal["ally_guide"]
    voice_session_token: str = Field(alias="voiceSessionToken", min_length=1)
    language: str = "en"
    turn_mode: TurnMode = Field(default="hands_free", alias="turnMode")

    @field_validator("turn_mode", mode="before")
    @classmethod
    def _known_turn_mode(cls, value: Any) -> str:
        return _turn_mode(value)


class GuideVoiceSessionInfo(BaseModel):
    """``GET /v1/guide/voice/sessions/:token`` — no learner details, by design."""

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    thread_id: str = Field(alias="threadId")
    room_name: str = Field(alias="roomName")
    language: str = "en"
    turn_mode: TurnMode = Field(default="hands_free", alias="turnMode")

    @field_validator("turn_mode", mode="before")
    @classmethod
    def _known_turn_mode(cls, value: Any) -> str:
        return _turn_mode(value)


def parse_dispatch(metadata: Optional[str]) -> Optional[GuideVoiceDispatch]:
    """The job's dispatch, or None when it isn't a usable guide dispatch.

    Never logs the token: it is the only credential the worker holds for the
    learner's thread.
    """
    try:
        raw = json.loads(metadata or "")
    except (TypeError, ValueError):
        logger.error("[GUIDE] dispatch metadata is not JSON")
        return None
    if not isinstance(raw, dict) or raw.get("kind") != GUIDE_DISPATCH_KIND:
        logger.error(
            "[GUIDE] dispatch is not an ally_guide job (kind=%r)",
            raw.get("kind") if isinstance(raw, dict) else None,
        )
        return None
    try:
        return GuideVoiceDispatch.model_validate(raw)
    except ValidationError as exc:
        logger.error(
            "[GUIDE] dispatch metadata rejected: %s",
            [error.get("loc") for error in exc.errors()],
        )
        return None


def base_language(language: Optional[str]) -> str:
    """``hi-IN`` → ``hi``; anything empty → ``en``."""
    code = (language or "").strip()
    return code.split("-")[0].lower() if code else "en"


def provider_language_code(language: Optional[str]) -> str:
    """The BCP-47 code the speech providers expect.

    ally-be sends base codes (en, hi, mr, ta, kn). Every language Ally speaks is
    served in its Indian locale, English included — the same en-IN the roleplay
    agent defaults to.
    """
    code = (language or "").strip()
    if "-" in code:
        return code
    return f"{base_language(code)}-IN"
