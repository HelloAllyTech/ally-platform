"""LangSmith tracing in project ``ally-bug-hunter`` (spec §14), on only when an API key
is present. Traces carry scrubbed text only: every tool result and prompt input goes
through the scrubber before it becomes a message.
"""

from __future__ import annotations

import os

PROJECT = "ally-bug-hunter"


def configure(env: dict[str, str] | None = None) -> bool:
    """Set the LangSmith env vars if a key is present. Returns whether tracing is on."""
    env = os.environ if env is None else env
    if not env.get("LANGSMITH_API_KEY"):
        env["LANGSMITH_TRACING"] = "false"
        return False
    env.setdefault("LANGSMITH_TRACING", "true")
    env.setdefault("LANGSMITH_PROJECT", PROJECT)
    return env.get("LANGSMITH_TRACING", "true").lower() == "true"


def trace_url(run_id: str) -> str | None:
    """Best effort: the LangSmith URL of the root trace tagged with ``run_id``."""
    if os.environ.get("LANGSMITH_TRACING", "false").lower() != "true":
        return None
    try:
        from langsmith import Client

        client = Client()
        project = os.environ.get("LANGSMITH_PROJECT", PROJECT)
        runs = client.list_runs(
            project_name=project,
            is_root=True,
            filter=f'has(tags, "{run_id}")',
            limit=1,
        )
        for run in runs:
            return getattr(run, "url", None)
    except Exception:  # noqa: BLE001 - tracing is observability, never a failure
        return None
    return None
