"""Metering map (CR1): every assistant model call and embedding is metered, with
the run's attribution, and the recording never slows or fails a reply.

Three halves:
  * calls through ``generate_structured`` carry the scope's keys, ``step`` and an
    incrementing ``seq`` in their usage metadata;
  * knowledge search and indexing emit an embedding usage row;
  * a static check that the assistant's code reaches a provider only through the
    dispatcher (or the embedding service), so no call can bypass the meter.
"""

import ast
import json
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from pydantic import BaseModel

from app.core.constants import EmbeddingConstants
from app.core.knowledge_base.knowledge_chunk_service import (
    ChunkAudience,
    KnowledgeChunkService,
)
from app.core.llm import dispatch
from app.core.llm_usage import emitter as emitter_module
from app.core.llm_usage.scope import set_step, use_scope
from app.core.llm_usage.tasks import LLMTask

APP = Path(__file__).resolve().parents[3] / "app"

SCOPE = {
    "run_id": "run-1",
    "chatbot_id": "bot-7",
    "conversation_id": "conv-3",
    "channel": "web",
    "kind": "reply",
    "creator_user_id": 42,
    "draft_id": "0b5f3c1e-0000-4000-8000-000000000001",
}


class Answer(BaseModel):
    answer: str = ""


@pytest.fixture(autouse=True)
def reset_clients():
    dispatch.reset_clients()
    yield
    dispatch.reset_clients()


@pytest.fixture
def anthropic_client():
    response = SimpleNamespace(
        content=[
            SimpleNamespace(
                type="tool_use",
                name=dispatch._STRUCTURED_TOOL_NAME,
                input={"answer": "x"},
            )
        ],
        stop_reason="tool_use",
        usage=SimpleNamespace(input_tokens=100, output_tokens=25),
    )
    client = SimpleNamespace(
        messages=SimpleNamespace(create=AsyncMock(return_value=response))
    )
    with (
        patch.object(dispatch.settings.ANTHROPIC, "API_KEY", "anthropic-key"),
        patch.object(dispatch, "_get_anthropic_client", return_value=client),
    ):
        yield client


def _enabled_settings():
    settings = MagicMock()
    settings.LLM_USAGE.ENABLED = True
    settings.LLM_USAGE.QUEUE_URL = "https://sqs.example/test-queue"
    settings.ENV.ENV = "test"
    return settings


class _Recorder:
    """Stands in for the SQS send; collects bodies from the background thread."""

    def __init__(self):
        self.bodies = []
        self.threads = []
        self._event = threading.Event()

    def __call__(self, body):
        self.threads.append(threading.current_thread().name)
        self.bodies.append(json.loads(body)["data"]["llm_usage"])
        self._event.set()

    def wait(self, n, timeout=5.0):
        deadline = time.monotonic() + timeout
        while len(self.bodies) < n and time.monotonic() < deadline:
            self._event.wait(0.01)
        return self.bodies


@contextmanager
def own_executor():
    """A fresh send pool for one test, drained before its patches are undone, so
    no background send outlives the test."""
    pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="llm-usage-test")
    with patch.object(emitter_module, "_EXECUTOR", pool):
        try:
            yield pool
        finally:
            pool.shutdown(wait=True)


@pytest.fixture
def sent():
    recorder = _Recorder()
    with (
        patch.object(emitter_module, "settings", _enabled_settings()),
        patch.object(emitter_module, "_send_blocking", recorder),
        own_executor(),
    ):
        yield recorder


class TestStructuredCallsCarryAttribution:
    @pytest.mark.asyncio
    async def test_scope_step_and_seq_reach_the_metadata(self, anthropic_client):
        with (
            use_scope(**SCOPE),
            patch("app.core.llm_usage.emitter.emit_llm_usage_blocking") as emit,
        ):
            set_step(1)
            for _ in range(3):
                await dispatch.generate_structured(
                    schema=Answer,
                    prompt="q",
                    provider="anthropic",
                    task=LLMTask.WHATSAPP_AGENT_STEP.value,
                )

        metas = [c.kwargs["metadata"] for c in emit.call_args_list]
        assert [m["seq"] for m in metas] == [1, 2, 3]
        for meta in metas:
            for key, value in SCOPE.items():
                assert meta[key] == value
            assert meta["step"] == 1
        # Existing fields are untouched.
        assert emit.call_args.kwargs["usage"] == (100, 25, 125)
        assert emit.call_args.kwargs["task"] == "whatsapp_agent_step"

    @pytest.mark.asyncio
    async def test_no_scope_leaves_metadata_as_before(self, anthropic_client):
        with patch("app.core.llm_usage.emitter.emit_llm_usage_blocking") as emit:
            await dispatch.generate_structured(
                schema=Answer, prompt="q", provider="anthropic", task="nudge"
            )
        assert emit.call_args.kwargs["metadata"] is None

    @pytest.mark.asyncio
    async def test_through_to_the_wire_off_the_event_loop(self, anthropic_client, sent):
        with use_scope(**SCOPE):
            await dispatch.generate_structured(
                schema=Answer, prompt="q", provider="anthropic", task="nudge"
            )
        (usage,) = sent.wait(1)
        assert usage["metadata"]["run_id"] == "run-1"
        assert usage["metadata"]["seq"] == 1
        assert usage["prompt_tokens"] == 100
        assert sent.threads[0].startswith("llm-usage")


class TestEmbeddingsAreMetered:
    @pytest.fixture
    def service(self):
        db = AsyncMock()
        db.create_documents_bulk.return_value = {"succeeded": [], "failed": []}
        db.search_documents.return_value = []
        db.hybrid_search.return_value = []
        embedder = AsyncMock()
        embedder.embed.return_value = [0.1, 0.2]
        embedder.embed_many.side_effect = lambda texts: [[0.1] for _ in texts]
        return KnowledgeChunkService(vector_db=db, embedding_service=embedder)

    @pytest.mark.asyncio
    async def test_search_emits_an_embedding_search_row(self, service, sent):
        with use_scope(**SCOPE):
            try:
                await service.search(
                    "how do I ask about suicide?", audience=ChunkAudience.unrestricted()
                )
            except Exception:
                pass  # only the embedding row matters here
        (usage,) = sent.wait(1)
        assert usage["task"] == "embedding_search"
        assert usage["model"] == EmbeddingConstants.MODEL
        assert usage["service"] == "llm"
        assert usage["prompt_tokens"] > 0
        assert usage["completion_tokens"] == 0
        assert usage["metadata"]["call"] == "embedding"
        assert usage["metadata"]["run_id"] == "run-1"
        assert usage["metadata"]["seq"] == 1

    @pytest.mark.asyncio
    async def test_bulk_upsert_emits_an_embedding_index_row(self, service, sent):
        items = [
            {"chunk_id": f"1111111{i}-1111-1111-1111-111111111111", "text": t}
            for i, t in enumerate(["first passage text", "second passage text"])
        ]
        await service.bulk_upsert(
            [
                {
                    **item,
                    "document_id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                    "document_title": "Doc",
                    "chunk_index": i,
                }
                for i, item in enumerate(items)
            ]
        )
        (usage,) = sent.wait(1)
        assert usage["task"] == "embedding_index"
        assert usage["prompt_tokens"] > 0
        assert usage["metadata"]["inputs"] == 2
        # No scope on an indexing call from ally-be's ingest: still metered.
        assert "run_id" not in usage["metadata"]

    def test_token_count_falls_back_to_an_estimate(self):
        with patch.object(emitter_module, "_encoding_for", return_value=None):
            tokens, method = emitter_module.count_embedding_tokens(
                "text-embedding-3-small", ["x" * 40]
            )
        assert (tokens, method) == (10, "estimate")


class TestRecordingNeverBlocksOrFails:
    @pytest.mark.asyncio
    async def test_failing_sqs_send_neither_raises_nor_blocks(self):
        calls = []

        def slow_failing_send(**_):
            calls.append(threading.current_thread().name)
            time.sleep(0.5)
            raise RuntimeError("SQS down")

        sqs = MagicMock()
        sqs.send_message.side_effect = slow_failing_send
        with (
            patch.object(emitter_module, "settings", _enabled_settings()),
            patch.object(emitter_module.SQSQueueClient, "create_client"),
            patch.object(emitter_module.SQSQueueClient, "get_client", return_value=sqs),
            own_executor(),
            use_scope(**SCOPE),
        ):
            started = time.monotonic()
            dispatch._emit_usage("openai", "gpt-4o", "nudge", (10, 5, 15))
            elapsed = time.monotonic() - started
            deadline = time.monotonic() + 5
            while not calls and time.monotonic() < deadline:
                time.sleep(0.01)

        assert elapsed < 0.2
        assert calls and calls[0].startswith("llm-usage")

    @pytest.mark.asyncio
    async def test_raising_emitter_does_not_escape(self):
        with patch(
            "app.core.llm_usage.emitter.emit_llm_usage_blocking",
            side_effect=RuntimeError("boom"),
        ):
            dispatch._emit_usage("openai", "gpt-4o", "nudge", (10, 5, 15))


# ---------------------------------------------------------------------------
# Static check: no direct provider clients in the assistant's code.
# ---------------------------------------------------------------------------

GUARDED = [
    "agent_runtime",
    "knowledge_agent",
    "builder",
    "checkup",
    "memory_lines",
    "knowledge_base",
]
FORBIDDEN_NAMES = {
    "AsyncOpenAI",
    "OpenAI",
    "ChatOpenAI",
    "AsyncAnthropic",
    "Anthropic",
    "OpenAIEmbeddings",
}
FORBIDDEN_MODULES = ("openai", "anthropic", "google.genai", "langchain_openai")
# Files allowed to talk to a provider directly. None in the guarded directories
# today: model calls go through app/core/llm/dispatch.py and embeddings through
# app/core/embeddings/ (both outside them).
ALLOWLIST: set = set()


def _violations(path: Path):
    tree = ast.parse(path.read_text(), filename=str(path))
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name.startswith(FORBIDDEN_MODULES):
                    yield f"import {alias.name}"
        elif isinstance(node, ast.ImportFrom):
            module = node.module or ""
            if module.startswith(FORBIDDEN_MODULES) or (
                module == "google" and any(a.name == "genai" for a in node.names)
            ):
                yield f"from {module} import ..."
        elif isinstance(node, ast.Call):
            func = node.func
            name = getattr(func, "id", None) or getattr(func, "attr", None)
            if name in FORBIDDEN_NAMES:
                yield f"{name}(...)"


def test_assistant_code_reaches_providers_only_through_dispatch():
    found = []
    for directory in GUARDED:
        for path in sorted((APP / "core" / directory).rglob("*.py")):
            rel = str(path.relative_to(APP.parent))
            if rel in ALLOWLIST:
                continue
            found.extend(f"{rel}: {v}" for v in _violations(path))
    assert found == [], (
        "Call providers through app/core/llm/dispatch.py (or the embedding "
        "service) so every call is metered:\n" + "\n".join(found)
    )


def test_the_guarded_directories_exist():
    for directory in GUARDED:
        assert (APP / "core" / directory).is_dir(), directory
