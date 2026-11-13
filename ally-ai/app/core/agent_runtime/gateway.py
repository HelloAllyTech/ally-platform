"""ally-be's tool gateway, as the chatbot agent calls it (chunk 3b).

`POST {url}/tools/{name}` with `{run_id, step, input}`, the service key
(`x-api-key`) and the run's token (`Authorization: Bearer`). ally-be decides
nothing here: it checks both credentials, the tool and the bot's abilities, does
the work once per run id and step, and answers `{ok, result | error, replayed}`.

The token is a credential. It lives only in this client, which reaches the graph as
runtime context (never checkpointed, never in state, the trace or a log line), and
is closed when the run ends. A call never raises: a timeout, a network error, a 4xx
or 5xx or a reply that isn't JSON comes back as `ok: false` with a short code the
agent reads.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Optional

import httpx

from app.core.config import settings
from app.utils.logger import get_logger

logger = get_logger(__name__)

#: One gateway call's limit. No retry inside the run: the run id and step are the
#: idempotency key, so a redelivered message replays rather than repeats.
GATEWAY_TIMEOUT_S = 5.0


class AgentGatewayClient:
    """One HTTP client per run, closed by the runner."""

    def __init__(
        self,
        url: str,
        token: str,
        *,
        transport: Optional[httpx.AsyncBaseTransport] = None,
    ) -> None:
        self._client = httpx.AsyncClient(
            base_url=url.rstrip("/"),
            headers={
                "x-api-key": settings.API.X_API_KEY,
                "Authorization": f"Bearer {token}",
            },
            timeout=GATEWAY_TIMEOUT_S,
            transport=transport,
        )

    def __repr__(self) -> str:  # never the headers
        return "AgentGatewayClient()"

    async def call(
        self, name: str, *, run_id: str, step: int, input: Dict[str, Any]
    ) -> Dict[str, Any]:
        """`{ok: True, result}` or `{ok: False, error}`, whatever happened."""
        try:
            res = await self._client.post(
                f"/tools/{name}",
                json={"run_id": run_id, "step": step, "input": input},
            )
        except httpx.TimeoutException:
            return _failed(name, "timeout")
        except httpx.HTTPError as error:
            return _failed(name, "network", type(error).__name__)
        if res.status_code >= 400:
            return _failed(name, f"http_{res.status_code}")
        try:
            body = res.json()
        except ValueError:
            return _failed(name, "bad_response")
        if not isinstance(body, dict) or not isinstance(body.get("ok"), bool):
            return _failed(name, "bad_response")
        if body["ok"]:
            result = body.get("result")
            return {"ok": True, "result": result if isinstance(result, dict) else {}}
        return {"ok": False, "error": str(body.get("error") or "failed")[:64]}

    async def aclose(self) -> None:
        await self._client.aclose()


def _failed(name: str, code: str, detail: str = "") -> Dict[str, Any]:
    # The tool and the code only: never the input, the response body or the token.
    logger.warning(
        "Agent gateway %s failed: %s%s", name, code, f" ({detail})" if detail else ""
    )
    return {"ok": False, "error": code}


@dataclass
class AgentRunContext:
    """What a run gets besides its state: LangGraph runtime context, which is not
    checkpointed. `gateway` is None for a run without one (every bot today)."""

    gateway: Optional[AgentGatewayClient] = None
