"""Voice preview API endpoints."""

from typing import Any, Dict, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field, field_validator

from app.api.dependencies import verify_token
from app.core.constants import normalize_language_code_for_providers
from app.core.logger import get_logger
from app.tts.constants import DEFAULT_SAMPLE_TEXT, LANGUAGE_SAMPLE_TEXT
from app.tts.factory import create_tts_client

logger = get_logger(__name__)

router = APIRouter(
    prefix="/voice-preview",
    tags=["voice-preview"],
    dependencies=[Depends(verify_token)],
)


def get_sample_text_for_language(language_code: str) -> str:
    """
    Get appropriate sample text for a given BCP 47 language code.

    Tries exact match first, then falls back to prefix match (e.g. "hi"
    matches "hi-IN"), and finally defaults to English.

    Args:
        language_code: BCP 47 language code (e.g., "en-US", "hi-IN", "ml-IN")

    Returns:
        Sample text in the corresponding language
    """
    # Exact match
    if language_code in LANGUAGE_SAMPLE_TEXT:
        return LANGUAGE_SAMPLE_TEXT[language_code]
    # Fallback to English
    return DEFAULT_SAMPLE_TEXT


class PreviewRequest(BaseModel):
    """Request body for voice preview generation."""

    provider: Literal["DEEPGRAM", "ELEVENLABS", "SARVAM", "GOOGLE", "HUME"] = Field(
        ...,
        description="TTS provider name",
        examples=[
            "DEEPGRAM",
            "ELEVENLABS",
            "SARVAM",
            "GOOGLE",
            "HUME",
        ],
    )
    config: Dict[str, Any] = Field(
        ...,
        description="Provider-specific configuration (must be a non-empty dict)",
        examples=[
            {"model": "aura-asteria-en"},  # Deepgram
            {
                "voice_id": "21m00Tcm4TlvDq8ikWAM",
                "model": "eleven_turbo_v2_5",
            },  # ElevenLabs
            {"model": "bulbul:v2", "speaker": "meera"},  # Sarvam
            {"voice_name": "en-US-Neural2-A", "gender": "female"},  # Google
            {"voice_name": "Ava Song", "voice_provider": "HUME_AI"},  # Hume
        ],
    )

    @field_validator("config")
    @classmethod
    def validate_config_not_empty(cls, v: Dict[str, Any]) -> Dict[str, Any]:
        """Ensure config is a non-empty dictionary."""
        if not v:
            raise ValueError("config must be a non-empty dictionary")
        return v

    text: Optional[str] = Field(
        default=None,
        max_length=500,
        description=(
            "Text to synthesize. If not provided, an appropriate sample "
            "in the requested language will be used automatically."
        ),
    )
    language_code: str = Field(
        default="en-US",
        description="BCP 47 language code (e.g., 'en-US', 'hi-IN')",
    )


class PreviewErrorResponse(BaseModel):
    """Error response model."""

    detail: str


@router.post(
    "/generate",
    summary="Generate voice preview",
    description="Generate a voice preview audio file for any supported TTS provider.",
    responses={
        200: {
            "content": {"audio/mpeg": {}},
            "description": "MP3 audio file",
        },
        400: {"model": PreviewErrorResponse, "description": "Invalid request"},
        500: {"model": PreviewErrorResponse, "description": "Server error"},
    },
)
async def generate_voice_preview(request: PreviewRequest):
    """
    Generate a voice preview for the specified TTS provider.

    Uses the same configuration format that will be used in production,
    ensuring "what you preview is what you get" in LiveKit.

    If no text is provided, an appropriate sample in the requested
    language_code is selected automatically from LANGUAGE_SAMPLE_TEXT.

    Returns MP3 audio directly for browser playback.
    """
    try:
        # Normalize language code (e.g., en-GLOBAL -> en-GB) for provider compatibility
        effective_language_code = normalize_language_code_for_providers(
            request.language_code
        )

        # Resolve sample text: use caller-supplied text, or pick from
        # the language mapping based on language_code
        preview_text = request.text or get_sample_text_for_language(
            effective_language_code
        )

        logger.info(
            f"Generating voice preview: provider={request.provider}, "
            f"language_code={request.language_code}, "
            f"effective={effective_language_code}, "
            f"text_source={'user' if request.text else 'auto'}"
        )

        # Build TTS config in factory format
        tts_config = {
            "provider": request.provider,
            "config": request.config,
        }

        # Create TTS client using the factory
        client = create_tts_client(
            tts_config=tts_config,
            language_code=effective_language_code,
        )

        # Generate preview audio
        audio_bytes = await client.generate_preview(text=preview_text)

        logger.info(
            f"Preview generated successfully: provider={request.provider}, "
            f"size={len(audio_bytes)} bytes"
        )

        return Response(
            content=audio_bytes,
            media_type="audio/mpeg",
            headers={
                "Content-Disposition": "inline; filename=preview.mp3",
                "X-Provider": request.provider,
            },
        )

    except ValueError as e:
        logger.warning(f"Invalid preview request: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except NotImplementedError as e:
        logger.warning(f"Preview not implemented: {e}")
        raise HTTPException(
            status_code=501, detail=f"Preview not supported for {request.provider}: {e}"
        )
    except Exception as e:
        logger.exception(f"Preview generation failed: {e}")
        raise HTTPException(status_code=500, detail="Preview generation failed")
