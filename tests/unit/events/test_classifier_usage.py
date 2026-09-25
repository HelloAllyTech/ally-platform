"""AI-cost: the raw-OpenAI classifiers record their tokens under their labels.

Guardrail (incl. the STT coherence guard), binary classifier (single and
batch), helper-paraphrased and behaviour detection all call ``AsyncOpenAI``
directly and run inside graph nodes, so the room comes from the graph run's
context var. The last test drives detection through ``_detect_events``, which
fans each event out as its own task, to prove the room survives that hop.
"""

import types
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.core.events.base import ChatMessage
from app.core.events.event_types.binary_classifier.binary_classifier_event import (
    BinaryClassifierEvent,
)
from app.core.events.event_types.binary_classifier.schemas import (
    BatchClassificationItem,
    BatchClassificationResultStrOp,
    BinaryClassifierData,
    ClassificationResultStrOp,
)
from app.core.events.event_types.guardrail.guardrail_event import GuardrailEvent
from app.core.events.event_types.guardrail.schemas import GuardrailData
from app.core.events.event_types.helper_paraphrased.constants import (
    HelperParaphrasedData,
)
from app.core.events.event_types.helper_paraphrased.helper_paraphrased_event import (
    HelperParaphrasedEvent,
)
from app.core.events.event_types.helper_paraphrased.schemas import ParaphraseResult
from app.core.scenario.simulation_instructions import SimulationBehaviorInstruction


def _completion(parsed):
    choice = MagicMock()
    choice.message.parsed = parsed
    return types.SimpleNamespace(
        choices=[choice],
        model="gpt-4o-mini-2024-07-18",
        usage=types.SimpleNamespace(
            prompt_tokens=120,
            completion_tokens=5,
            total_tokens=125,
            prompt_tokens_details=types.SimpleNamespace(cached_tokens=0),
        ),
    )


def _client(parsed):
    client = MagicMock()
    client.beta.chat.completions.parse = AsyncMock(return_value=_completion(parsed))
    return client


def _counselor(text="Can you get me some drugs?"):
    return [ChatMessage(role="counselor", content=text)]


def _only(calls):
    assert len(calls) == 1, calls
    return calls[0]


@pytest.mark.unit
async def test_guardrail_records_guardrail_check(ai_usage_calls, graph_room):
    event = GuardrailEvent.create(
        event_id="guardrail-0",
        data=GuardrailData(helper_dialogue="drugs", actor_dialogue="stay on track"),
        model="gpt-4o-mini",
    )
    client = _client(ClassificationResultStrOp(is_class=True))
    with patch.object(GuardrailEvent, "_get_client", return_value=client):
        assert await event.detect_event(_counselor()) is True

    call = _only(ai_usage_calls)
    assert (call["room_id"], call["task"]) == (graph_room, "guardrail_check")
    assert (call["provider"], call["model"]) == ("openai", "gpt-4o-mini")
    assert call["prompt_tokens"] == 120


@pytest.mark.unit
async def test_coherence_guard_records_guardrail_check(ai_usage_calls, graph_room):
    event = GuardrailEvent.create(
        event_id="guardrail-default-coherence",
        data=GuardrailData(helper_dialogue="incoherent", actor_dialogue="repeat?"),
        model="llama3.1",
        llm_base_url="http://localhost:11434/v1",
        detector_type="COHERENCE",
    )
    client = _client(ClassificationResultStrOp(is_class=False))
    with patch.object(GuardrailEvent, "_get_client", return_value=client):
        await event.detect_event(_counselor("banana telephone sky"))

    call = _only(ai_usage_calls)
    assert call["task"] == "guardrail_check"
    # A local (Ollama) classifier is tagged as such, not as OpenAI spend.
    assert (call["provider"], call["model"]) == ("ollama", "llama3.1")


@pytest.mark.unit
async def test_binary_classifier_single_records(
    ai_usage_calls, graph_room, monkeypatch
):
    event = BinaryClassifierEvent.create(
        event_id="bc-1", data=BinaryClassifierData(class_name="Greeting")
    )
    monkeypatch.setattr(
        BinaryClassifierEvent,
        "_CLIENT",
        _client(ClassificationResultStrOp(is_class=True)),
    )
    assert await event.detect_event(_counselor("good morning")) is True

    call = _only(ai_usage_calls)
    assert (call["room_id"], call["task"]) == (graph_room, "binary_classifier")
    assert call["model"] == "gpt-4o-mini"


@pytest.mark.unit
async def test_binary_classifier_batch_records_once(
    ai_usage_calls, graph_room, monkeypatch
):
    events = [
        BinaryClassifierEvent.create(
            event_id=eid, data=BinaryClassifierData(class_name=name)
        )
        for eid, name in (("a", "Greeting"), ("b", "Anger"))
    ]
    parsed = BatchClassificationResultStrOp(
        results=[
            BatchClassificationItem(event_id="a", is_class=True),
            BatchClassificationItem(event_id="b", is_class=False),
        ]
    )
    monkeypatch.setattr(BinaryClassifierEvent, "_CLIENT", _client(parsed))

    assert await BinaryClassifierEvent.classify_batch(events, "hello") == {"a"}

    call = _only(ai_usage_calls)
    assert (call["room_id"], call["task"]) == (graph_room, "binary_classifier")


@pytest.mark.unit
async def test_helper_paraphrased_records(ai_usage_calls, graph_room):
    event = HelperParaphrasedEvent.create(
        event_id="para-1", data=HelperParaphrasedData()
    )
    client = _client(ParaphraseResult(is_paraphrase=True))
    with patch(
        "app.core.events.event_types.helper_paraphrased."
        "helper_paraphrased_event.AsyncOpenAI",
        return_value=client,
    ):
        result = await event.detect_event(
            [
                ChatMessage(role="client", content="I feel so alone lately."),
                ChatMessage(role="counselor", content="You've been feeling lonely."),
            ]
        )

    assert result is True
    call = _only(ai_usage_calls)
    assert (call["room_id"], call["task"]) == (graph_room, "helper_paraphrased")


@pytest.mark.unit
async def test_behaviour_detection_records(ai_usage_calls, graph_room, monkeypatch):
    instruction = SimulationBehaviorInstruction(
        behaviorInstructionId="bi-1",
        category="SHOULD_DO",
        behaviors=["Validated experience"],
        score=5,
    )
    monkeypatch.setattr(
        SimulationBehaviorInstruction,
        "_get_client",
        classmethod(lambda cls: _client(ClassificationResultStrOp(is_class=True))),
    )
    monkeypatch.setattr(
        "app.core.scenario.simulation_instructions.load_and_format",
        lambda *a, **k: "PROMPT",
    )

    assert await instruction.detect(_counselor("That sounds really hard.")) is True

    call = _only(ai_usage_calls)
    assert (call["room_id"], call["task"]) == (graph_room, "behaviour_detection")
    assert call["model"] == "gpt-4o-mini"


@pytest.mark.unit
async def test_room_survives_the_per_event_task_fan_out(
    ai_usage_calls, graph_room, monkeypatch
):
    from app.core.graph import nodes

    event = BinaryClassifierEvent.create(
        event_id="bc-fan", data=BinaryClassifierData(class_name="Greeting")
    )
    monkeypatch.setattr(
        BinaryClassifierEvent,
        "_CLIENT",
        _client(ClassificationResultStrOp(is_class=True)),
    )
    monkeypatch.setattr(nodes, "is_event_eligible", lambda *a, **k: True)

    _, new_events = await nodes._detect_events(
        [event], _counselor("good morning"), 1.0, 0, None
    )

    assert new_events == [event]
    assert _only(ai_usage_calls)["room_id"] == graph_room
