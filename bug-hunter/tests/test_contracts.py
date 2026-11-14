"""Cross-app contract hints on a fixture: route prefixes, suffix matching with
parameters, exact beats parameter, queue sides, hints for both ends."""

from __future__ import annotations

from pathlib import Path

from bug_hunter.config import BugHunterConfig
from bug_hunter.context.contracts import (
    Contracts,
    build_contracts,
    match_quality,
    normalise_path,
)
from bug_hunter.context.repo_map import build_map
from tests.fixtures.repo_map.projects import make_repo

PROJECTS = {
    "ally-be": {
        "src/ai/constants/endpoints.constants.ts": (
            "export const AI_ENDPOINTS = {\n"
            "  analyze: 'api/v1/conversation/analyze',\n"
            "  note: `api/v1/summary/note/${id}`,\n"
            "  missing: 'api/v1/nothing/here',\n"
            "};\n"
        ),
        "src/queue/producer.ts": (
            "const q = 'sqs-learn-message-and-event-queue';\n"
            "export function send() { sqs.sendMessage({}); }\n"
        ),
        "src/ai/ai.module.ts": (
            "import { X } from './processors/transcribe-result.processor';\n"
        ),
    },
    "ally-ai": {
        "app/api/v1/api.py": (
            "from fastapi import APIRouter\n"
            "from app.api.v1.endpoints import conversation, summary\n"
            "api_router = APIRouter()\n"
            "api_router.include_router(conversation.router, prefix='/conversation')\n"
            "api_router.include_router(summary.router, prefix='/summary')\n"
        ),
        "app/api/v1/endpoints/conversation.py": (
            "router = APIRouter()\n\n@router.post('/analyze')\n"
            "def analyze(body):\n    return body\n"
        ),
        "app/api/v1/endpoints/summary.py": (
            "router = APIRouter()\n\n@router.post('/note/{note_id}')\n"
            "def note(note_id):\n    return note_id\n\n"
            "@router.post('/note/enhance')\ndef enhance():\n    return 1\n"
        ),
    },
    "ally-ai-learn": {
        "app/consumer.py": (
            "QUEUE = 'sqs-learn-message-and-event-queue'\n\n"
            "def poll():\n    sqs.receive_message(QueueUrl=QUEUE)\n"
        ),
    },
}


def test_contracts_on_fixture(config: BugHunterConfig, tmp_path: Path) -> None:
    repo = make_repo(tmp_path / "repo", PROJECTS)
    maps = {
        app: build_map(config, app, root=repo, cache_root=tmp_path / "cache")[0]
        for app in PROJECTS
    }
    contracts = build_contracts(config, maps, root=repo)
    routes = {(r.method, r.path): r.symbol for r in contracts.routes}
    assert routes == {
        ("post", "/conversation/analyze"): "analyze",
        ("post", "/summary/note/*"): "note",
        ("post", "/summary/note/enhance"): "enhance",
    }
    http = {(c.client_literal, c.route_path, c.route_symbol) for c in contracts.http}
    assert ("api/v1/conversation/analyze", "/conversation/analyze", "analyze") in http
    # `${id}` wildcards to * and meets the parameter route, not /note/enhance
    assert ("api/v1/summary/note/${id}", "/summary/note/*", "note") in http
    assert ("api/v1/summary/note/${id}", "/summary/note/enhance", "enhance") not in http
    unmatched = {u.literal for u in contracts.unmatched_client_calls}
    assert unmatched == {
        "api/v1/nothing/here"
    }  # the module import path is filtered out
    queues = {q.queue: (q.producers, q.consumers) for q in contracts.queues}
    assert queues == {
        "sqs-learn-message-and-event-queue": (
            ["ally-be:src/queue/producer.ts"],
            ["ally-ai-learn:app/consumer.py"],
        )
    }
    be_hints = contracts.hints_for("ally-be", "src/ai/constants/endpoints.constants.ts")
    assert any("calls ally-ai POST /conversation/analyze" in h for h in be_hints)
    ai_hints = contracts.hints_for("ally-ai", "app/api/v1/endpoints/conversation.py")
    assert ai_hints == [
        "called by ally-be src/ai/constants/endpoints.constants.ts "
        "(api/v1/conversation/analyze)"
    ]
    assert (
        "produces sqs-learn-message-and-event-queue"
        in contracts.hints_for("ally-be", "src/queue/producer.ts")[0]
    )
    # round trip
    again = Contracts.from_json(contracts.to_json())
    assert (
        len(again.http) == len(contracts.http)
        and again.queues[0].queue == "sqs-learn-message-and-event-queue"
    )


def test_match_quality_prefers_exact() -> None:
    assert normalise_path("${base}/api/v1/x/${id}/") == "*/api/v1/x/*"
    assert match_quality("api/v1/summary/note/enhance", "/summary/note/enhance") == 4
    assert match_quality("api/v1/summary/note/enhance", "/summary/note/*") == 3
    assert match_quality("api/v1/other", "/summary/note/*") == 0
    assert match_quality("x", "/a/b") == 0
