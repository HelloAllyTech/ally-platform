"""Ask Ally (v9 FR-43): ally-be's learner endpoint calls this for each reply
that passed its crisis screen, and relays the stream to the learner as SSE.
Auth is the service `X-API-Key` (AuthMiddleware), as for every /api/v1 route.
"""

import json

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from app.core.ask_ally import agent
from app.core.ask_ally.schemas import AskAllyRequest

router = APIRouter()


@router.post("/replies")
async def ask_ally_reply(req: AskAllyRequest) -> StreamingResponse:
    """One reply, streamed as newline-delimited JSON events (CONTRACT.md §5).
    Always 200 once the request validates: a failure is the stream's last
    event, so ally-be can finish with whatever the learner already saw."""

    async def lines():
        async for event in agent.stream_reply(req):
            yield json.dumps(event, ensure_ascii=False) + "\n"

    return StreamingResponse(lines(), media_type="application/x-ndjson")
