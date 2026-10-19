"""FastAPI router: POST /api/v1/v2v-tester/start

Receives a request from ally-be to start a simulated learner bot in a LiveKit
room.  The bot runs as a fire-and-forget asyncio task — the endpoint returns
immediately while the bot runs in the background.
"""

from fastapi import APIRouter, Depends, HTTPException

from app.api.dependencies import verify_api_key
from app.core.config import settings
from app.core.logger import get_logger
from app.v2v_tester.schemas import StartV2VTesterRequest, StartV2VTesterResponse
from app.v2v_tester.tester_bot import launch_tester

logger = get_logger(__name__)

router = APIRouter(prefix="/v2v-tester", tags=["v2v-tester"])


@router.post("/start", response_model=StartV2VTesterResponse)
async def start_v2v_tester(
    body: StartV2VTesterRequest,
    _: None = Depends(verify_api_key),
) -> StartV2VTesterResponse:
    """
    Start an AI simulated learner bot in the given LiveKit room.

    The bot joins as a plain participant (not a LiveKit agent), subscribes to
    the counselor AI's audio, transcribes it with Google STT (chirp_2),
    generates learner responses with gpt-4o-mini, and speaks them back with a
    Google TTS voice for the session language.

    Returns immediately — the bot runs as a background asyncio task.
    """
    if not settings.V2V_TESTER_ENABLED:
        logger.info(
            "[V2V] tester disabled (V2V_TESTER_ENABLED=false); rejecting room=%s",
            body.roomName,
        )
        raise HTTPException(
            status_code=503,
            detail="v2v tester is disabled (V2V_TESTER_ENABLED=false)",
        )

    logger.info(
        "[V2V] launching tester bot: room=%s maxExchanges=%d language=%s",
        body.roomName,
        body.maxExchanges,
        body.language,
    )

    try:
        launch_tester(
            room_name=body.roomName,
            tester_token=body.testerToken,
            max_exchanges=body.maxExchanges,
            language=body.language,
            scenario_title=body.scenarioTitle,
            scenario_context=body.scenarioContext,
            scenario_session_id=body.scenarioSessionId,
            counselor_id=body.counselorId,
        )
    except RuntimeError as exc:
        # Per-process concurrency cap (memory guard) — the caller can retry
        # once the active run finishes.
        logger.warning("[V2V] launch rejected: %s", exc)
        raise HTTPException(status_code=429, detail=str(exc))

    return StartV2VTesterResponse(roomName=body.roomName)
