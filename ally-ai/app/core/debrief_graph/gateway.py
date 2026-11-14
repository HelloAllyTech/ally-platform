"""ally-be's gateway tools: what the graph asks ally-be to do mid-run.

`POST {gateway_url}/tools/:name` with the run's bearer token (CONTRACT.md §2).
ally-ai never writes ally-be's database; these calls are how it reads guidance,
runs the rule checks, renders and finalises cards, and reports live progress.
"""

from __future__ import annotations

from typing import Any, Dict, Optional, Protocol

import httpx
from langgraph.types import RetryPolicy

#: A tool call that has not answered in this long is a transient failure.
TOOL_TIMEOUT_S = 30.0
#: Progress is fire-and-forget; a slow write is dropped, never waited on.
PROGRESS_TIMEOUT_S = 5.0


class GatewayError(Exception):
    """A tool call that did not succeed. `transient` failures (no answer, 5xx,
    429) are retried by the node's RetryPolicy; the rest end the run."""

    def __init__(self, tool: str, status: Optional[int], message: str) -> None:
        super().__init__(f"{tool}: {status or 'network'}: {message}")
        self.tool = tool
        self.status = status
        self.transient = status is None or status >= 500 or status == 429


def is_transient(error: Exception) -> bool:
    return isinstance(error, GatewayError) and error.transient


#: Gateway tools (checks, render, finalise, the agents' data tools) that did
#: not answer are retried.
GATEWAY_RETRY = RetryPolicy(max_attempts=3, initial_interval=0.5, retry_on=is_transient)


class Gateway(Protocol):
    async def call(self, tool: str, body: Dict[str, Any]) -> Dict[str, Any]: ...

    async def aclose(self) -> None: ...


class HttpGateway:
    """The real gateway: one HTTP client per run, closed by the runner.

    `timeout_s` is each tool call's limit (Ask Ally's tools must answer far
    sooner than a debrief run's)."""

    def __init__(
        self, base_url: str, token: str, timeout_s: float = TOOL_TIMEOUT_S
    ) -> None:
        self._timeout_s = timeout_s
        self._client = httpx.AsyncClient(
            base_url=base_url.rstrip("/"),
            headers={"Authorization": f"Bearer {token}"},
            timeout=timeout_s,
        )

    async def call(self, tool: str, body: Dict[str, Any]) -> Dict[str, Any]:
        timeout = PROGRESS_TIMEOUT_S if tool == "progress" else self._timeout_s
        try:
            res = await self._client.post(f"/tools/{tool}", json=body, timeout=timeout)
        except httpx.HTTPError as e:
            raise GatewayError(tool, None, type(e).__name__) from e
        if res.status_code >= 400:
            raise GatewayError(tool, res.status_code, res.text[:200])
        return res.json()

    async def aclose(self) -> None:
        await self._client.aclose()
