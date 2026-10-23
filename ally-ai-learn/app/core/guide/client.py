"""The guide voice worker's three calls into ally-be.

All under ``{CORE_SERVICE_BASE_URL}/api/v1/guide/voice`` with the service key in
``x-api-key`` — the same base URL and key every other ai-learn → ally-be call
uses. The voice-session token from the dispatch is the second lock: it binds
each call to one thread, learner and organisation, and ally-be answers 401
once it has expired or a newer session for the thread has replaced it.

Closing a turn stream before it ends is how a barge-in reaches ally-be: the
dropped connection cancels the turn there. ``stream_turn`` is an async
generator over an ``httpx`` streaming response, so closing the generator (or
cancelling the task iterating it) closes the connection.
"""

from __future__ import annotations

from typing import Any, AsyncIterator, Dict, Optional

import httpx

from app.core.config import settings
from app.core.guide.contract import GuideVoiceFrame, GuideVoiceTurnRequest
from app.core.guide.ndjson import NdjsonFrameDecoder
from app.core.guide.session import GuideVoiceSessionInfo
from app.core.logger import get_logger

logger = get_logger(__name__)

GUIDE_VOICE_API_PREFIX = "/api/v1/guide/voice"
# Carries the voice-session token on session lookups and the end call.
GUIDE_VOICE_SESSION_HEADER = "x-guide-voice-session"

#: ally-be's HTTP errorCodes (uppercase) mapped to the frame failure codes the
#: worker acts on. Only refusals that can reach the worker are listed.
_HTTP_ERROR_CODES = {
    "GUIDE_DISABLED": "guide_disabled",
    "GUIDE_NO_ACCESS": "no_access",
    "GUIDE_MESSAGE_TOO_LONG": "message_too_long",
}


class GuideSessionEnded(Exception):
    """ally-be answered 401: the voice-session token expired or was replaced."""


class GuideBackendError(Exception):
    """ally-be could not be reached, or refused the call for another reason."""

    def __init__(self, message: str, *, status: Optional[int] = None, code: str):
        super().__init__(message)
        self.status = status
        self.code = code


def _error_code(response: httpx.Response) -> str:
    try:
        body = response.json()
    except ValueError:
        body = None
    if isinstance(body, dict):
        mapped = _HTTP_ERROR_CODES.get(str(body.get("errorCode") or ""))
        if mapped:
            return mapped
    return "internal_error"


class GuideBackendClient:
    """A small async client for the voice-worker endpoints."""

    def __init__(
        self,
        base_url: str,
        api_key: str,
        *,
        read_timeout_s: float = 60.0,
        transport: Optional[httpx.AsyncBaseTransport] = None,
    ) -> None:
        self._http = httpx.AsyncClient(
            base_url=base_url.rstrip("/"),
            headers={"x-api-key": api_key},
            timeout=httpx.Timeout(
                connect=5.0, read=read_timeout_s, write=10.0, pool=5.0
            ),
            transport=transport,
        )

    @classmethod
    def from_settings(cls) -> "GuideBackendClient":
        return cls(
            settings.CORE_SERVICE_BASE_URL,
            settings.CORE_SERVICE_API_KEY,
            read_timeout_s=settings.GUIDE_TURN_READ_TIMEOUT_S,
        )

    async def aclose(self) -> None:
        await self._http.aclose()

    @staticmethod
    def _session_headers(token: str) -> dict:
        # In a header, not the path: paths end up in access logs.
        return {GUIDE_VOICE_SESSION_HEADER: token}

    async def get_session(self, token: str) -> GuideVoiceSessionInfo:
        """What the session is for. Raises GuideSessionEnded on 401."""
        try:
            # Short: the learner waits in silence while this resolves.
            response = await self._http.get(
                f"{GUIDE_VOICE_API_PREFIX}/session",
                headers=self._session_headers(token),
                timeout=5.0,
            )
        except httpx.HTTPError as exc:
            raise GuideBackendError(
                f"voice session lookup failed: {type(exc).__name__}", code="transport"
            ) from exc
        if response.status_code == 401:
            raise GuideSessionEnded()
        if response.status_code != 200:
            raise GuideBackendError(
                f"voice session lookup returned {response.status_code}",
                status=response.status_code,
                code=_error_code(response),
            )
        try:
            return GuideVoiceSessionInfo.model_validate(response.json())
        except ValueError as exc:
            raise GuideBackendError(
                "voice session lookup returned an unreadable body",
                status=response.status_code,
                code="internal_error",
            ) from exc

    async def end_session(self, token: str) -> None:
        """Tell ally-be the session is over. Best-effort; never raises."""
        try:
            response = await self._http.post(
                f"{GUIDE_VOICE_API_PREFIX}/session/ended",
                headers=self._session_headers(token),
                timeout=5.0,
            )
            if response.status_code >= 400:
                logger.warning(
                    "[GUIDE] ending the voice session returned %s", response.status_code
                )
        except httpx.HTTPError as exc:
            logger.warning(
                "[GUIDE] ending the voice session failed: %s", type(exc).__name__
            )

    async def stream_turn(
        self,
        request: GuideVoiceTurnRequest,
        *,
        traceparent: Optional[str] = None,
    ) -> AsyncIterator[GuideVoiceFrame]:
        """Send one spoken turn and yield ally-be's frames as they arrive.

        Raises GuideSessionEnded on 401 and GuideBackendError when the turn
        never started (non-200, unreachable) or the stream broke mid-way.
        """
        body: Dict[str, Any] = request.model_dump(by_alias=True, exclude_none=True)
        headers = {"traceparent": traceparent} if traceparent else None
        try:
            async with self._http.stream(
                "POST", f"{GUIDE_VOICE_API_PREFIX}/turns", json=body, headers=headers
            ) as response:
                if response.status_code == 401:
                    raise GuideSessionEnded()
                if response.status_code != 200:
                    await response.aread()
                    raise GuideBackendError(
                        f"voice turn returned {response.status_code}",
                        status=response.status_code,
                        code=_error_code(response),
                    )
                decoder = NdjsonFrameDecoder()
                async for chunk in response.aiter_bytes():
                    for frame in decoder.feed(chunk):
                        yield frame
                for frame in decoder.flush():
                    yield frame
        except httpx.HTTPError as exc:
            raise GuideBackendError(
                f"voice turn stream failed: {type(exc).__name__}", code="transport"
            ) from exc
