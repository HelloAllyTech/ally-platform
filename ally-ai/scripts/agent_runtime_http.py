"""What the Agents v2 scripts share (agent_parity.py, agent_conversation_eval.py):
the two endpoints, one timed POST, p50, and the server options and client."""

import argparse
import os
import statistics
import time
from typing import Any, Dict, List, Optional, Tuple

import httpx

V1_PATH = "/api/v1/knowledge-agent/answer"
V2_PATH = "/api/v1/agent/run"


def call(
    client: httpx.Client, path: str, payload: Dict[str, Any]
) -> Tuple[Optional[Dict[str, Any]], float, Optional[str]]:
    """POST `payload`. Returns ``(result, ms, error)``; `result` is None on error."""
    started = time.monotonic()
    try:
        response = client.post(path, json=payload)
    except httpx.HTTPError as e:
        return None, (time.monotonic() - started) * 1000, type(e).__name__
    ms = (time.monotonic() - started) * 1000
    if response.status_code != 200:
        return None, ms, f"HTTP {response.status_code}: {response.text[:200]}"
    return response.json(), ms, None


def p50(values: List[float]) -> float:
    return statistics.median(values) if values else 0.0


def add_server_args(parser: argparse.ArgumentParser) -> None:
    """--base-url and --api-key (default API__X_API_KEY)."""
    parser.add_argument("--base-url", default="http://localhost:3001")
    parser.add_argument("--api-key", default=os.getenv("API__X_API_KEY"))


def make_client(
    parser: argparse.ArgumentParser, args: argparse.Namespace, timeout: float
) -> httpx.Client:
    """The client for ally-ai; exits with a usage error when there is no API key."""
    if not args.api_key:
        parser.error("pass --api-key or set API__X_API_KEY")
    return httpx.Client(
        base_url=args.base_url,
        headers={"x-api-key": args.api_key},
        timeout=timeout,
    )
