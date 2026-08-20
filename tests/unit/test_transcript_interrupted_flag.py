"""The transcript carries whether the learner talked over a client turn.

This matters because of what `content` is. LiveKit builds the assistant
ChatMessage from the text that actually reached TTS before the utterance
stopped, so on an interrupted turn the transcript holds a PREFIX of what the
model produced — measured across judged turns, a cut turn keeps about 36% of the
generated characters against 107% on an uncut one. Without the flag the language
judge reads that prefix as the actor failing to finish a sentence, which is why
`truncation` became the second-largest annotation category.

None is not False. An older worker sends nothing and a COUNSELOR turn has no
such notion, and neither may be read as "known not to be interrupted".
"""

import types

import pytest

import app.core.graph.nodes  # noqa: F401  (settles a pre-existing import cycle)
from app.core.events import handlers


def _item(role: str, content: str, **kw):
    return types.SimpleNamespace(role=role, content=content, **kw)


def _event(item, created_at: float = 100.0):
    return types.SimpleNamespace(item=item, created_at=created_at)


@pytest.fixture
def sent(monkeypatch):
    """Capture the ChatMessage each handler call would ship, without SQS."""
    captured = []

    def _create(room_id, chat_message):
        captured.append(chat_message)
        return types.SimpleNamespace(model_dump_json=lambda: "{}")

    monkeypatch.setattr(handlers.CoreEventMessageType, "create", staticmethod(_create))
    monkeypatch.setattr(handlers, "send_event_to_queue", lambda _: None)
    monkeypatch.setattr(handlers.asyncio, "create_task", lambda coro: None)
    return captured


def _handler(room_id="room-1"):
    on_item, _, _ = handlers.create_conversation_handler(
        room_id, "2026-01-01T00:00:00Z"
    )
    return on_item


def test_an_interrupted_client_turn_is_flagged(sent):
    _handler()(
        _event(
            _item("assistant", "I understand what you're saying, and", interrupted=True)
        )
    )
    assert sent[-1].interrupted is True


def test_a_completed_client_turn_is_explicitly_false(sent):
    # False is a real observation here — this worker looked and the turn was not
    # interrupted — which is what makes it usable for conditioning.
    _handler()(
        _event(_item("assistant", "It has been a hard week.", interrupted=False))
    )
    assert sent[-1].interrupted is False


def test_a_counsellor_turn_carries_none(sent):
    # The notion does not apply, and False would claim it does.
    _handler()(_event(_item("user", "how has the week been?", interrupted=True)))
    assert sent[-1].interrupted is None


def test_a_livekit_version_without_the_attribute_does_not_crash(sent):
    # Read defensively: the attribute is absent on older LiveKit builds, and a
    # transcript failing to publish is far worse than a missing flag.
    _handler()(_event(_item("assistant", "I see.")))
    assert sent[-1].interrupted is False
    assert sent[-1].content == "I see."


def test_the_flag_does_not_disturb_the_rest_of_the_message(sent):
    on_item = _handler()
    on_item(
        _event(_item("assistant", "Yes, exactly.", interrupted=True), created_at=100.0)
    )
    msg = sent[-1]
    assert msg.role == "CLIENT"
    assert msg.content == "Yes, exactly."
    assert msg.end_time is not None
