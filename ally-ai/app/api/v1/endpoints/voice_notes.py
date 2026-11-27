"""Voice notes (Agents v2 chunk WA-A §1): ally-be sends a WhatsApp voice note,
this answers with its transcript. Stateless; the audio is not stored here and
never reaches a language model. See core/voice_notes/service.py.
"""

import base64
import binascii
from typing import Optional

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from app.core.voice_notes.service import transcribe_voice_note

router = APIRouter()


class VoiceNoteRequest(BaseModel):
    # Base64 of the audio file as Meta served it (ogg/opus for a voice note).
    audio_base64: str = Field(..., min_length=1)
    mime_type: str = ""


class VoiceNoteResponse(BaseModel):
    status: str
    transcript: str = ""
    language: Optional[str] = None
    duration_sec: Optional[float] = None
    provider: Optional[str] = None


@router.post("/transcribe", response_model=VoiceNoteResponse)
async def transcribe(req: VoiceNoteRequest) -> VoiceNoteResponse:
    try:
        audio = base64.b64decode(req.audio_base64, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="audio is not base64"
        )
    result = await transcribe_voice_note(audio, req.mime_type)
    return VoiceNoteResponse(**result.__dict__)
