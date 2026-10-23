"""Tests for batched binary-classifier detection (BATCH_EVENT_CLASSIFIERS)."""

from unittest.mock import AsyncMock, MagicMock

import pytest

from app.core.events.event_types.binary_classifier.binary_classifier_event import (
    BinaryClassifierEvent,
)
from app.core.events.event_types.binary_classifier.prompts import (
    get_batch_binary_classifier_prompt,
)
from app.core.events.event_types.binary_classifier.schemas import (
    BatchClassificationItem,
    BatchClassificationResultStrOp,
    BinaryClassifierData,
)


def _make_event(event_id: str, class_name: str) -> BinaryClassifierEvent:
    return BinaryClassifierEvent.create(
        event_id=event_id,
        data=BinaryClassifierData(class_name=class_name),
    )


def _mock_completion(items):
    parsed = BatchClassificationResultStrOp(
        results=[
            BatchClassificationItem(event_id=eid, is_class=val) for eid, val in items
        ]
    )
    message = MagicMock()
    message.parsed = parsed
    choice = MagicMock()
    choice.message = message
    completion = MagicMock()
    completion.choices = [choice]
    return completion


@pytest.mark.asyncio
async def test_classify_batch_returns_only_matched(monkeypatch):
    e1, e2 = _make_event("a", "Greeting"), _make_event("b", "Anger")
    client = MagicMock()
    client.beta.chat.completions.parse = AsyncMock(
        return_value=_mock_completion([("a", True), ("b", False)])
    )
    monkeypatch.setattr(BinaryClassifierEvent, "_CLIENT", client)

    matched = await BinaryClassifierEvent.classify_batch([e1, e2], "good morning")

    assert matched == {"a"}
    # One LLM call for both events (the whole point of batching).
    client.beta.chat.completions.parse.assert_awaited_once()


@pytest.mark.asyncio
async def test_classify_batch_ignores_unknown_event_ids(monkeypatch):
    e1 = _make_event("a", "Greeting")
    client = MagicMock()
    client.beta.chat.completions.parse = AsyncMock(
        return_value=_mock_completion([("a", True), ("hallucinated", True)])
    )
    monkeypatch.setattr(BinaryClassifierEvent, "_CLIENT", client)

    matched = await BinaryClassifierEvent.classify_batch([e1], "hi")

    assert matched == {"a"}


@pytest.mark.asyncio
async def test_classify_batch_empty_text_skips_call(monkeypatch):
    client = MagicMock()
    client.beta.chat.completions.parse = AsyncMock()
    monkeypatch.setattr(BinaryClassifierEvent, "_CLIENT", client)

    matched = await BinaryClassifierEvent.classify_batch([_make_event("a", "X")], "   ")

    assert matched == set()
    client.beta.chat.completions.parse.assert_not_awaited()


@pytest.mark.asyncio
async def test_classify_batch_propagates_errors_for_fallback(monkeypatch):
    """classify_batch must raise so the caller can fall back to per-event."""
    client = MagicMock()
    client.beta.chat.completions.parse = AsyncMock(side_effect=RuntimeError("boom"))
    monkeypatch.setattr(BinaryClassifierEvent, "_CLIENT", client)

    with pytest.raises(RuntimeError):
        await BinaryClassifierEvent.classify_batch([_make_event("a", "X")], "hi")


def test_batch_prompt_lists_every_class():
    system_prompt, user_prompt = get_batch_binary_classifier_prompt(
        [
            ("a", BinaryClassifierData(class_name="Greeting")),
            ("b", BinaryClassifierData(class_name="Anger")),
        ],
        "good morning",
    )
    assert 'id="a"' in system_prompt and "Greeting" in system_prompt
    assert 'id="b"' in system_prompt and "Anger" in system_prompt
    assert "good morning" in user_prompt
