import asyncio
import inspect
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

        def fake_create_task(coro, **_kwargs):
            created_tasks.append(coro)

            # return a dummy task-like object
            class _T:
                def cancel(self):
                    pass

                def add_done_callback(self, _cb):
                    pass

            return _T()

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
    async def test_create_conversation_handler_tracks_task_against_gc(
        self, monkeypatch
    ):
        """
        Regression test: asyncio only keeps a *weak* reference to a task once
        it's created. With nothing else holding it, the scheduled transcript
        send can be garbage-collected while still pending — surfacing at
        teardown as "Task was destroyed but it is pending!" and, worse,
        silently dropping that transcript message. `create_conversation_handler`
        must accept a `background_tasks` set and register the scheduled task
        there so a GC pass can't take it out from under the send.
        """
        import gc

        release = asyncio.Event()
        sent = []

        class SlowQueue:
            async def send_message(self, m):
                await release.wait()
                sent.append(m)

        monkeypatch.setattr(eh, "msg_event_queue", SlowQueue())

        class DummyCoreEvent:
            def __init__(self, payload):
                self._payload = payload

            def model_dump_json(self):
                return json.dumps(self._payload)

        monkeypatch.setattr(
            eh,
            "CoreEventMessageType",
            types.SimpleNamespace(
                create=lambda room_id, chat_message=None, event_id=None: (
                    DummyCoreEvent(
                        {
                            "room_id": room_id,
                            "role": chat_message.role,
                            "content": chat_message.content,
                        }
                    )
                )
            ),
        )

        background_tasks: set = set()
        handler, _state_handlers, _cleanup = eh.create_conversation_handler(
            room_id="room-123",
            joined_iso="2024-01-01T00:00:00+00:00",
            background_tasks=background_tasks,
        )

        handler(
            DummyEvent(
                DummyItem(role="assistant", content="hi there"),
                created_at=1704067205.0,
            )
        )

        # Let the scheduled task start running (up to its `release.wait()`).
        await asyncio.sleep(0)
        assert background_tasks, "scheduled send task must be tracked while pending"

        # Force a GC pass with no local strong reference to the task left —
        # only `background_tasks` (and asyncio's own weak ref) point at it.
        gc.collect()
        await asyncio.sleep(0)

        release.set()
        await asyncio.wait_for(asyncio.gather(*background_tasks), timeout=1)

        assert sent, "transcript message was dropped by a garbage-collected task"
        assert not background_tasks, "done task should be discarded from the set"

    def test_create_conversation_handler_without_a_running_loop(
        self, monkeypatch, caplog
    ):
        """No running loop: log the drop, don't fake a send.

        This used to fall back to ``get_event_loop().create_task``, which
        abandoned the coroutine built for the first (failed) create_task and
        queued a second one onto a loop nobody runs — so it never sent
        either, and the orphan resurfaced as a RuntimeWarning.
        """

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

        handler, _state_handlers, _cleanup = eh.create_conversation_handler(
            "room", "2024-01-01T00:00:00+00:00"
        )
        with caplog.at_level("ERROR"):
            handler(
                DummyEvent(
                    DummyItem(role="user", content="hey"), created_at=1704067205.0
                )
            )

        assert any("transcript-send" in r.getMessage() for r in caplog.records)

    @pytest.mark.asyncio
    async def test_create_conversation_handler_deduplicates_utterances(
        self, monkeypatch
    ):
        """Test that duplicate utterances are skipped."""
        created_tasks = []

        def fake_create_task(coro, **_kwargs):
            created_tasks.append(coro)
            # This test only counts scheduling attempts and never runs them;
            # close each coroutine so the stub doesn't leak the very
            # "never awaited" RuntimeWarning the handler was fixed to avoid.
            coro.close()
            return types.SimpleNamespace(
                cancel=lambda: None, add_done_callback=lambda _cb: None
            )

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

    def test_create_conversation_handler_survives_falsy_created_at(self, monkeypatch):
        """A conversation item with a falsy created_at must not raise.

        calculate_start_time() returns None for a falsy timestamp, and with
        no speaking-start recorded for this role, both start_time and
        end_time end up None. LiveKit's EventEmitter re-raises TypeError
        (unlike every other exception, which it logs and swallows), so an
        unguarded TypeError escaping this handler propagates out of
        session.emit("conversation_item_added", ...) and can kill whichever
        LiveKit-internal task drives that event for the rest of the
        session -- silently stopping the transcript mid-session while audio
        and turn-taking carry on unaffected.
        """
        monkeypatch.setattr(
            eh,
            "CoreEventMessageType",
            types.SimpleNamespace(
                create=lambda **_: types.SimpleNamespace(model_dump_json=lambda: "{}")
            ),
        )
        monkeypatch.setattr(
            asyncio, "create_task", lambda _: types.SimpleNamespace(cancel=lambda: None)
        )

        handler, _, _ = eh.create_conversation_handler(
            "room-123", "2024-01-01T00:00:00+00:00"
        )

        event = DummyEvent(DummyItem(role="user", content="hello"), created_at=0)

        handler(event)  # must not raise TypeError

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
            lambda coro, **_kwargs: (
                coro.close(),
                types.SimpleNamespace(
                    cancel=lambda: None, add_done_callback=lambda _cb: None
                ),
            )[1],
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


class TestShutdownHandlerBoundsInlineFinalize:
    """Regression for the recurring SIGUSR1 kill (supervised_proc.py:256/364).

    on_shutdown has two finalize paths: one that drains an already in-flight
    finalize task under asyncio.wait_for(timeout=16.0), and one that calls
    finalize_session() inline when no task had been scheduled yet. Only the
    first was bounded by commit a94fa6b — the inline path could run
    unbounded and push on_shutdown past the SDK's shutdown_process_timeout,
    triggering a forced kill mid-save.
    """

    @pytest.mark.asyncio
    async def test_on_shutdown_times_out_a_hanging_inline_finalize(self, monkeypatch):
        finalize_started = asyncio.Event()
        hanging_task = None

        async def hanging_finalize_session(**kwargs):
            nonlocal hanging_task
            finalize_started.set()
            # The real test is the timeout on the other side; this task just
            # needs to stay pending long enough for that to fire.
            hanging_task = asyncio.current_task()
            try:
                await asyncio.sleep(3600)
            except asyncio.CancelledError:
                pass

        monkeypatch.setattr(eh, "finalize_session", hanging_finalize_session)

        # Exercise the real timeout/shield machinery but on a test-sized
        # clock: clamp every asyncio.wait_for call to at most 50ms instead of
        # the production 16s budget.
        real_wait_for = asyncio.wait_for

        async def clamped_wait_for(aw, timeout=None):
            if timeout is not None:
                timeout = min(timeout, 0.05)
            return await real_wait_for(aw, timeout=timeout)

        monkeypatch.setattr(eh.asyncio, "wait_for", clamped_wait_for)

        class DummyOrchestrator:
            deferred_termination_event = None
            _background_tasks = set()

        async def noop_cleanup():
            pass

        handler = eh.create_shutdown_handler(
            event_orchestrator=DummyOrchestrator(),
            room_name="room-1",
            final_score_sent_ref=lambda: False,
            set_final_score_sent=lambda v: None,
            cleanup_background_tasks=noop_cleanup,
        )

        try:
            # Bounded regardless of whether the fix is present: pre-fix, the
            # inline finalize_session() call has no cap of its own, on_shutdown()
            # never returns, and this raises TimeoutError.
            await real_wait_for(handler(), timeout=2.0)
        finally:
            if hanging_task:
                hanging_task.cancel()

        assert finalize_started.is_set()


class TestFireAndForgetSendsAreNeverAbandoned:
    """Regression: a scheduled send must never leave its coroutine un-awaited.

    The coroutine object is built *before* `asyncio.create_task` ever sees it
    (`create_task(send_event_to_queue(payload))`). Called from a context with
    no running loop, `create_task` raises and that coroutine is abandoned:
    the transcript/metric is silently dropped, and Python only reports it
    much later — at an arbitrary GC pass, usually inside an unrelated test —
    as ``RuntimeWarning: coroutine 'send_event_to_queue' was never awaited``.
    Whatever we do with the payload, the coroutine has to be disposed of.
    """

    @staticmethod
    def _track_sends(monkeypatch):
        """Replace send_event_to_queue with a factory that records its coros."""
        created = []

        async def _send(_payload):
            return None

        def _factory(payload):
            coro = _send(payload)
            created.append(coro)
            return coro

        monkeypatch.setattr(eh, "send_event_to_queue", _factory)

        class DummyCoreEvent:
            def model_dump_json(self):
                return "{}"

        monkeypatch.setattr(
            eh,
            "CoreEventMessageType",
            types.SimpleNamespace(
                create=lambda **_: DummyCoreEvent(),
                create_turn_metrics=lambda *_a, **_k: DummyCoreEvent(),
            ),
        )
        return created

    @staticmethod
    def _assert_all_disposed(created):
        assert created, "handler never built a send coroutine"
        abandoned = [
            c for c in created if inspect.getcoroutinestate(c) == inspect.CORO_CREATED
        ]
        assert not abandoned, (
            f"{len(abandoned)} of {len(created)} send coroutine(s) left un-awaited "
            "— they will surface as a RuntimeWarning and the payload is lost"
        )

    def test_transcript_send_without_a_running_loop(self, monkeypatch):
        """`on_conversation_item_added` runs sync; no loop must not leak."""
        created = self._track_sends(monkeypatch)

        handler, _state_handlers, _cleanup = eh.create_conversation_handler(
            "room", "2024-01-01T00:00:00+00:00"
        )
        handler(
            DummyEvent(DummyItem(role="user", content="hey"), created_at=1704067205.0)
        )

        self._assert_all_disposed(created)

    def test_turn_metrics_send_without_a_running_loop(self, monkeypatch):
        """Same defect on the turn-metrics emit off `agent_state_changed`."""
        created = self._track_sends(monkeypatch)
        monkeypatch.setattr(
            eh,
            "turn_metrics",
            types.SimpleNamespace(
                note_user_speech_end=lambda *_a, **_k: None,
                finalize=lambda *_a, **_k: {"total_ms": 1200},
            ),
        )
        monkeypatch.setattr(
            eh, "TurnMetricsData", lambda **kw: types.SimpleNamespace(**kw)
        )

        _handler, state_handlers, _cleanup = eh.create_conversation_handler(
            "room", "2024-01-01T00:00:00+00:00"
        )
        # user stops speaking, then the agent starts -> finalize + emit
        state_handlers["user_state"](
            DummyStateEvent(new_state="listening", created_at=1704067203.0)
        )
        state_handlers["agent_state"](
            DummyStateEvent(new_state="speaking", created_at=1704067204.0)
        )

        self._assert_all_disposed(created)
