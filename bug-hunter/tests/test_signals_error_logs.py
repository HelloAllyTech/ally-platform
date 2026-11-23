"""Chunk 08: production error signatures from a recorded Logs Insights response."""

from __future__ import annotations

import json
from datetime import datetime, timezone

from bug_hunter.signals import error_logs
from bug_hunter.signals.state import InMemoryState
from tests.signal_fakes import FIXTURES

NOW = datetime(2026, 11, 15, 8, 0, tzinfo=timezone.utc)
GROUPS = {"ally-ai": ["/ally/prod/ally-ai"]}


class FixtureLogs:
    def __init__(self):
        self.data = json.loads((FIXTURES / "cloudwatch.json").read_text())
        self.queries = []

    def query(self, log_group, query, start, end):
        self.queries.append((log_group, start, end))
        return self.data.get(log_group, [])


def test_signatures_group_by_shape_and_scrub() -> None:
    a = error_logs.signature(
        "[2026-11-15T06:54:32+0000] [ERROR] [app.x] [d.py:640] [TraceID:2db2] - "
        "failed for user jane.doe@example.com: 503"
    )
    b = error_logs.signature(
        "[2026-11-15T07:01:00+0000] [ERROR] [app.x] [d.py:640] [TraceID:9f9f] - "
        "failed for user bob@example.com: 503"
    )
    assert a == b and "example.com" not in a


def test_new_signatures_with_app_frames_become_signals() -> None:
    cands, updates = error_logs.collect(
        FixtureLogs(), InMemoryState(), GROUPS, ["ally-ai"], now=NOW
    )
    titles = [c.title for c in cands]
    assert len(cands) == 2  # the two dispatch rows merge; httpx has no app frame
    dispatch = next(c for c in cands if "dispatch" in c.summary)
    assert dispatch.extra == {"count": 15, "mean_7d": 0.0, "new": True}
    assert dispatch.reported_by == "monitoring" and dispatch.key.startswith(
        "log:ally-ai:"
    )
    assert "example.com" not in dispatch.summary
    assert all("httpx" not in t for t in titles)
    assert "error_logs:baseline:ally-ai" in updates


def test_known_signature_only_returns_when_it_spikes() -> None:
    sig = error_logs.signature(
        "[2026-11-15T06:30:32+0000] [ERROR] [app.core.text_generations."
        "openai_text_generation_service] [openai_text_generation_service.py:210] "
        "[TraceID:N/A] - timeout after 30s"
    )
    dispatch_sig = error_logs.signature(
        "[2026-11-15T06:54:32+0000] [ERROR] [app.core.llm.dispatch] [dispatch.py:640] "
        "[TraceID:x] - Gemini call failed for user a@b.co: 503"
    )
    week = {f"2026-11-{d:02d}": 2 for d in range(8, 15)}
    state = InMemoryState(
        {"error_logs:baseline:ally-ai": {sig: dict(week), dispatch_sig: dict(week)}}
    )
    cands, _ = error_logs.collect(FixtureLogs(), state, GROUPS, ["ally-ai"], now=NOW)
    # timeout: 2 today vs 2/day -> quiet; dispatch: 15 today vs 2/day -> spiking
    assert len(cands) == 1 and cands[0].extra["new"] is False
    assert cands[0].title.startswith("spiking")


def test_apps_without_log_groups_are_skipped() -> None:
    logs = FixtureLogs()
    cands, _ = error_logs.collect(logs, InMemoryState(), {}, ["ally-ai"], now=NOW)
    assert cands == [] and logs.queries == []
