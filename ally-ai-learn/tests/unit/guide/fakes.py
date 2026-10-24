"""Shared fakes for the guide voice worker tests."""

import asyncio
import json
from typing import List, Optional

import httpx

from app.core.guide.client import GuideBackendClient


class ChunkedStream(httpx.AsyncByteStream):
    """A response body delivered in the given chunks. With ``hang=True`` it
    stops after the chunks and waits until closed — a turn still streaming."""

    def __init__(self, chunks: List[bytes], *, hang: bool = False) -> None:
        self._chunks = chunks
        self._hang = hang
        self.closed = asyncio.Event()

    async def __aiter__(self):
        for chunk in self._chunks:
            yield chunk
        if self._hang:
            await asyncio.Event().wait()

    async def aclose(self) -> None:
        self.closed.set()


def ndjson(*frames: dict) -> bytes:
    return b"".join((json.dumps(f) + "\n").encode() for f in frames)


class Recorder:
    """An httpx MockTransport handler that records requests and replies from
    a queue of (status, body-or-stream) pairs."""

    def __init__(self, *responses) -> None:
        self.responses = list(responses)
        self.requests: List[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        status, body = self.responses.pop(0)
        if isinstance(body, httpx.AsyncByteStream):
            return httpx.Response(status, stream=body)
        if isinstance(body, (dict, list)):
            return httpx.Response(status, json=body)
        return httpx.Response(status, content=body or b"")

    def json_body(self, index: int = -1) -> Optional[dict]:
        content = self.requests[index].content
        return json.loads(content) if content else None


def make_client(recorder: Recorder) -> GuideBackendClient:
    return GuideBackendClient(
        "https://be.test/",
        "svc-key",
        transport=httpx.MockTransport(recorder),
    )
