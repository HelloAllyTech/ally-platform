"""Scribe v2 shadow runs: after delivery only, detached, never raising."""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

from app.core.note_harness.models import HarnessReport
from app.core.queue import transcription_request_handler as handler_module
from app.core.queue.transcription_request_handler import TranscriptionRequestHandler

NOTE_HARNESS = {"shadow": True, "note_spec": {"fields": []}}


def _handler(delivered=True):
    ally_core = AsyncMock()
    text_gen = AsyncMock()
    text_gen.diarize_from_transcription.return_value = SimpleNamespace(
        messages=[
            SimpleNamespace(role="client", content="hi", start_time=0, end_time=1),
        ]
    )
    text_gen.generate_note_draft.return_value = HarnessReport(
        mode="SCRIBE", path="single", llm_calls=1
    )
    handler = TranscriptionRequestHandler(
        ally_core_service=ally_core,
        text_generation_service=text_gen,
        transcription_service=Mock(),
    )
    handler._generate_summary = AsyncMock(return_value={"summary": "v1"})
    handler.send_combined_result_to_ally_core = AsyncMock(return_value=delivered)
    return handler, ally_core, text_gen


async def _drain():
    while handler_module._background_tasks:
        await asyncio.gather(*list(handler_module._background_tasks))


@pytest.mark.asyncio
async def test_shadow_runs_after_v1_delivery_and_posts_the_report():
    handler, ally_core, text_gen = _handler()
    request = SimpleNamespace(chat_id=7, segments_text="00:00-00:01 hi")

    ok = await handler._process_transcription_result(
        request, session_mode="SCRIBE", correlation_id="c-1", note_harness=NOTE_HARNESS
    )
    await _drain()

    assert ok is True
    # v1 is untouched: summary generated and delivered as before.
    handler._generate_summary.assert_awaited_once()
    text_gen.generate_note_draft.assert_awaited_once()
    args = ally_core.post_note_draft.await_args
    assert args.args[0] == 7
    assert args.args[1]["path"] == "single"
    assert args.kwargs == {"shadow": True, "correlation_id": "c-1"}


@pytest.mark.asyncio
async def test_no_shadow_without_the_flag_or_without_delivery():
    handler, ally_core, text_gen = _handler()
    request = SimpleNamespace(chat_id=7, segments_text="x")
    await handler._process_transcription_result(request)
    await _drain()
    text_gen.generate_note_draft.assert_not_awaited()

    handler, ally_core, text_gen = _handler(delivered=False)
    await handler._process_transcription_result(request, note_harness=NOTE_HARNESS)
    await _drain()
    text_gen.generate_note_draft.assert_not_awaited()


@pytest.mark.asyncio
async def test_shadow_failures_are_reported_not_raised():
    handler, ally_core, text_gen = _handler()
    text_gen.generate_note_draft.side_effect = RuntimeError("boom")
    ally_core.post_note_draft.side_effect = RuntimeError("be down")

    await handler._run_note_harness_shadow(
        7, [], NOTE_HARNESS, session_mode="SCRIBE", prompts=None, correlation_id=None
    )
    assert ally_core.post_note_draft.await_args.args[1]["error"] == "RuntimeError"

    # An unreadable request is dropped before any model call.
    text_gen.generate_note_draft.reset_mock()
    await handler._run_note_harness_shadow(
        7,
        [],
        {"note_spec": "nope"},
        session_mode=None,
        prompts=None,
        correlation_id=None,
    )
    text_gen.generate_note_draft.assert_not_awaited()


@pytest.mark.asyncio
async def test_cached_fallback_does_not_need_the_v2_prompts():
    """A store without the new harness prompts must not stop the v1 fallback."""
    from app.core.queue.transcription_request_handler import (
        _REQUIRED_PIPELINE_PROMPT_CODES,
        PIPELINE_PROMPT_CODES,
    )

    assert "ally_ai_scribe_note_generate" in PIPELINE_PROMPT_CODES
    assert "ally_ai_scribe_note_generate" not in _REQUIRED_PIPELINE_PROMPT_CODES

    handler, ally_core, _ = _handler()
    ally_core.get_prompts_by_codes.side_effect = RuntimeError("be down")
    handler_module._last_good_pipeline_prompts.clear()
    for code in _REQUIRED_PIPELINE_PROMPT_CODES:
        handler_module._last_good_pipeline_prompts[code] = {"prompt": "t"}
    try:
        prompts = await handler._fetch_pipeline_prompts(7, None)
    finally:
        handler_module._last_good_pipeline_prompts.clear()
    assert set(prompts) == set(_REQUIRED_PIPELINE_PROMPT_CODES)
