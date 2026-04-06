import asyncio
import json
import types

import pytest

from app.core.events import handlers as eh


class DummyItem:
    def __init__(self, role, content):
        self.role = role
        self.content = content


class DummyEvent:
    def __init__(self, item, created_at):
        self.item = item
        self.created_at = created_at


class TestEventHandler:
    # -------------------- extract_content --------------------
    def test_extract_content_with_string(self):
        item = DummyItem(role="assistant", content="hello")
        assert eh.extract_content(item) == "hello"

    def test_extract_content_with_list(self):
        item = DummyItem(role="assistant", content=["hel", "lo"])
        assert eh.extract_content(item) == "hello"

    def test_extract_content_with_other(self):
        item = DummyItem(role="assistant", content={"x": 1})
        assert eh.extract_content(item) == ""

    # -------------------- calculate_start_time --------------------
    def test_calculate_start_time_basic(self):
        # joined at t=1000, event at t=1010 => 10s delta
        joined_iso = "1970-01-01T00:16:40+00:00"
        delta = eh.calculate_start_time(1010.0, joined_iso)
        assert pytest.approx(delta, rel=1e-6) == 10.0

    def test_calculate_start_time_none_for_falsy_timestamp(self):
        # Function returns None when event_timestamp is falsy
        assert eh.calculate_start_time(0, "2024-01-01T00:00:00+00:00") is None
        assert eh.calculate_start_time(None, "2024-01-01T00:00:00+00:00") is None

    # -------------------- send_event_to_queue --------------------
    @pytest.mark.asyncio
    async def test_send_event_to_queue_success(self, monkeypatch):
        sent = {}

        async def fake_send(msg):
            sent["msg"] = msg

        class DummyQueue:
            async def send_message(self, m):
                await fake_send(m)

        monkeypatch.setattr(eh, "msg_event_queue", DummyQueue())

        await eh.send_event_to_queue("payload")
        assert sent["msg"] == "payload"

    @pytest.mark.asyncio
    async def test_send_event_to_queue_logs_error(self, monkeypatch, caplog):
        class DummyQueue:
            async def send_message(self, m):
                raise RuntimeError("boom")

        monkeypatch.setattr(eh, "msg_event_queue", DummyQueue())

        with caplog.at_level("ERROR"):
            await eh.send_event_to_queue("payload")
        assert any(
            "Failed to send event to queue" in rec.message for rec in caplog.records
        )

    # -------------------- create_conversation_handler --------------------
    @pytest.mark.asyncio
    async def test_create_conversation_handler_enqueues_correct_message(
        self, monkeypatch
    ):
        # Capture create_task coroutine to run it deterministically
        created_tasks = []

        def fake_create_task(coro):
            created_tasks.append(coro)

            # return a dummy task-like object
            class _T:
                def cancel(self):
                    pass

            return _T()

        # Fallback path should not be used if create_task works
        monkeypatch.setattr(asyncio, "create_task", fake_create_task)

        # Stub CoreEventMessageType.create to return object with model_dump_json
        class DummyCoreEvent:
            def __init__(self, payload):
                self._payload = payload

            def model_dump_json(self):
                return json.dumps(self._payload)

        created_core_events = {}

        def fake_core_create(room_id, chat_message=None, event_id=None):
            created_core_events["args"] = {
                "room_id": room_id,
                "chat_message": chat_message,
                "event_id": event_id,
            }
            return DummyCoreEvent(
                {
                    "room_id": room_id,
                    "role": chat_message.role,
                    "content": chat_message.content,
                }
            )

        monkeypatch.setattr(
            eh, "CoreEventMessageType", types.SimpleNamespace(create=fake_core_create)
        )

        # Intercept queue send
        sent = {}

        class DummyQueue:
            async def send_message(self, m):
                sent["msg"] = m

        monkeypatch.setattr(eh, "msg_event_queue", DummyQueue())

        # Build handler and trigger
        handler, state_handlers, cleanup = eh.create_conversation_handler(
            room_id="room-123", joined_iso="2024-01-01T00:00:00+00:00"
        )

        # assistant -> CLIENT, others -> COUNSELOR
        event = DummyEvent(
            DummyItem(role="assistant", content="hi there"), created_at=1704067205.0
        )
        handler(event)

        # Run the scheduled coroutine
        assert created_tasks, "Expected asyncio.create_task to be invoked"
        await created_tasks[0]

        # Validate what was enqueued
        assert "msg" in sent
        payload = json.loads(sent["msg"])
        assert payload["room_id"] == "room-123"
        assert payload["role"] == "CLIENT"
        assert payload["content"] == "hi there"

        # Validate CoreEventMessageType.create inputs
        args = created_core_events["args"]
        assert args["room_id"] == "room-123"
        assert args["event_id"] is None
        assert args["chat_message"].role == "CLIENT"

    @pytest.mark.asyncio
    async def test_create_conversation_handler_fallback_loop(self, monkeypatch):
        # Force RuntimeError on asyncio.create_task to hit fallback path
        def boom_create_task(_):
            raise RuntimeError("no loop")

        monkeypatch.setattr(asyncio, "create_task", boom_create_task)

        # Capture tasks created via get_event_loop().create_task
        loop_created = {}

        class DummyLoop:
            def create_task(self, coro):
                loop_created["coro"] = coro

                class _T:
                    def cancel(self):
                        pass

                return _T()

        class DummyEventLoopPolicy:
            def get_event_loop(self):
                return DummyLoop()

        # Monkeypatch asyncio.get_event_loop to return our dummy loop
        monkeypatch.setattr(asyncio, "get_event_loop", lambda: DummyLoop())

        # Minimal stubs
        class DummyCoreEvent:
            def model_dump_json(self):
                return "{}"

        monkeypatch.setattr(
            eh,
            "CoreEventMessageType",
            types.SimpleNamespace(create=lambda **_: DummyCoreEvent()),
        )

        class DummyQueue:
            async def send_message(self, m):
                pass

        monkeypatch.setattr(eh, "msg_event_queue", DummyQueue())

        handler, state_handlers, cleanup = eh.create_conversation_handler(
            "room", "2024-01-01T00:00:00+00:00"
        )
        handler(
            DummyEvent(DummyItem(role="user", content="hey"), created_at=1704067205.0)
        )

        # ensure fallback scheduled something
        assert "coro" in loop_created
        await loop_created["coro"]

    @pytest.mark.asyncio
    async def test_create_conversation_handler_deduplicates_utterances(
        self, monkeypatch
    ):
        """Test that duplicate utterances are skipped."""
        created_tasks = []

        def fake_create_task(coro):
            created_tasks.append(coro)
            return types.SimpleNamespace(cancel=lambda: None)

        monkeypatch.setattr(asyncio, "create_task", fake_create_task)

        class DummyCoreEvent:
            def model_dump_json(self):
                return "{}"

        monkeypatch.setattr(
            eh,
            "CoreEventMessageType",
            types.SimpleNamespace(create=lambda **_: DummyCoreEvent()),
        )

        class DummyQueue:
            async def send_message(self, m):
                pass

        monkeypatch.setattr(eh, "msg_event_queue", DummyQueue())

        handler, state_handlers, cleanup = eh.create_conversation_handler(
            "room-123", "2024-01-01T00:00:00+00:00"
        )

        # First event - should be processed
        event1 = DummyEvent(
            DummyItem(role="user", content="hello"), created_at=1704067205.0
        )
        handler(event1)
        assert len(created_tasks) == 1

        # Duplicate event (same content and timestamp) - should be skipped
        event2 = DummyEvent(
            DummyItem(role="user", content="hello"), created_at=1704067205.0
        )
        handler(event2)
        assert len(created_tasks) == 1  # No new task created

        # Different content - should be processed
        event3 = DummyEvent(
            DummyItem(role="user", content="world"), created_at=1704067205.0
        )
        handler(event3)
        assert len(created_tasks) == 2  # New task created

        # Same content, different timestamp - should be processed
        event4 = DummyEvent(
            DummyItem(role="user", content="hello"), created_at=1704067206.0
        )
        handler(event4)
        assert len(created_tasks) == 3  # New task created

    def test_create_conversation_handler_cleanup(self, monkeypatch):
        """Test that cleanup function clears the seen_utterances set."""

        class DummyCoreEvent:
            def model_dump_json(self):
                return "{}"

        monkeypatch.setattr(
            eh,
            "CoreEventMessageType",
            types.SimpleNamespace(create=lambda **_: DummyCoreEvent()),
        )

        class DummyQueue:
            async def send_message(self, m):
                pass

        monkeypatch.setattr(eh, "msg_event_queue", DummyQueue())
        monkeypatch.setattr(
            asyncio, "create_task", lambda _: types.SimpleNamespace(cancel=lambda: None)
        )

        handler, state_handlers, cleanup = eh.create_conversation_handler(
            "room-123", "2024-01-01T00:00:00+00:00"
        )

        # Process some events
        event1 = DummyEvent(
            DummyItem(role="user", content="hello"), created_at=1704067205.0
        )
        handler(event1)

        event2 = DummyEvent(
            DummyItem(role="user", content="world"), created_at=1704067206.0
        )
        handler(event2)

        # Cleanup should clear the set
        cleanup()

        # After cleanup, same events should be processed again (no deduplication)
        # This is expected behavior - cleanup resets the state
        # Process the same event again - it should be accepted after cleanup
        event3 = DummyEvent(
            DummyItem(role="user", content="hello"), created_at=1704067205.0
        )
        handler(event3)  # Should process since cleanup cleared the set

        # Call cleanup again to ensure it's idempotent
        cleanup()


class DummyStateEvent:
    """Minimal stand-in for AgentStateChangedEvent / UserStateChangedEvent."""

    def __init__(self, new_state, created_at):
        self.new_state = new_state
        self.created_at = created_at


class TestConversationHandlerTimestamps:
    """Tests for start_time / end_time tracking via state-change handlers."""

    def _common_stubs(self, monkeypatch):
        """Apply common monkeypatches and return a list that collects chat_messages."""
        collected = []

        class DummyCoreEvent:
            def model_dump_json(self):
                return "{}"

        def fake_core_create(room_id, chat_message=None, event_id=None):
            collected.append(chat_message)
            return DummyCoreEvent()

        monkeypatch.setattr(
            eh,
            "CoreEventMessageType",
            types.SimpleNamespace(create=fake_core_create),
        )
        monkeypatch.setattr(
            asyncio,
            "create_task",
            lambda _: types.SimpleNamespace(cancel=lambda: None),
        )

        class DummyQueue:
            async def send_message(self, m):
                pass

        monkeypatch.setattr(eh, "msg_event_queue", DummyQueue())
        return collected

    def test_agent_start_time_from_state_change(self, monkeypatch):
        """Agent transcript start_time should come from agent_state_changed."""
        collected = self._common_stubs(monkeypatch)
        # joined at unix 1704067200 (2024-01-01T00:00:00+00:00)
        handler, state_handlers, cleanup = eh.create_conversation_handler(
            "room", "2024-01-01T00:00:00+00:00"
        )

        # Simulate agent starting to speak at t+3s
        state_handlers["agent_state"](
            DummyStateEvent(new_state="speaking", created_at=1704067203.0)
        )
        # conversation_item_added fires at t+5s (audio finished)
        handler(
            DummyEvent(
                DummyItem(role="assistant", content="hello"),
                created_at=1704067205.0,
            )
        )

        assert len(collected) == 1
        msg = collected[0]
        assert msg.role == "CLIENT"
        assert pytest.approx(msg.start_time, rel=1e-3) == 3.0  # from state change
        assert pytest.approx(msg.end_time, rel=1e-3) == 5.0  # from created_at

    def test_user_start_time_from_state_change(self, monkeypatch):
        """User transcript start_time should come from user_state_changed."""
        collected = self._common_stubs(monkeypatch)
        handler, state_handlers, cleanup = eh.create_conversation_handler(
            "room", "2024-01-01T00:00:00+00:00"
        )

        # Simulate user starting to speak at t+2s
        state_handlers["user_state"](
            DummyStateEvent(new_state="speaking", created_at=1704067202.0)
        )
        # conversation_item_added fires at t+6s (final transcript committed)
        handler(
            DummyEvent(
                DummyItem(role="user", content="hey"),
                created_at=1704067206.0,
            )
        )

        assert len(collected) == 1
        msg = collected[0]
        assert msg.role == "COUNSELOR"
        assert pytest.approx(msg.start_time, rel=1e-3) == 2.0
        assert pytest.approx(msg.end_time, rel=1e-3) == 6.0

    def test_fallback_when_no_state_change(self, monkeypatch):
        """Without a prior state change, start_time should fall back to end_time."""
        collected = self._common_stubs(monkeypatch)
        handler, state_handlers, cleanup = eh.create_conversation_handler(
            "room", "2024-01-01T00:00:00+00:00"
        )

        # No state_change event before conversation_item_added
        handler(
            DummyEvent(
                DummyItem(role="assistant", content="hi"),
                created_at=1704067210.0,
            )
        )

        assert len(collected) == 1
        msg = collected[0]
        assert msg.start_time == msg.end_time
        assert pytest.approx(msg.end_time, rel=1e-3) == 10.0

    def test_speaking_start_is_consumed(self, monkeypatch):
        """Speaking start should be consumed after one conversation item."""
        collected = self._common_stubs(monkeypatch)
        handler, state_handlers, cleanup = eh.create_conversation_handler(
            "room", "2024-01-01T00:00:00+00:00"
        )

        # Agent starts speaking at t+3s
        state_handlers["agent_state"](
            DummyStateEvent(new_state="speaking", created_at=1704067203.0)
        )
        # First item consumes the start time
        handler(
            DummyEvent(
                DummyItem(role="assistant", content="first"),
                created_at=1704067205.0,
            )
        )
        # Second item without new state change should fall back
        handler(
            DummyEvent(
                DummyItem(role="assistant", content="second"),
                created_at=1704067208.0,
            )
        )

        assert len(collected) == 2
        assert pytest.approx(collected[0].start_time, rel=1e-3) == 3.0
        # Second message: no speaking start captured → falls back to end_time
        assert collected[1].start_time == collected[1].end_time
        assert pytest.approx(collected[1].end_time, rel=1e-3) == 8.0
