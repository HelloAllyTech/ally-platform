import asyncio
import json
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.core.queue.message_processor import MessageProcessor


class SimpleAsyncMock:
    def __init__(self):
        self._calls = []

    async def __call__(self, *args, **kwargs):
        self._calls.append((args, kwargs))

    @property
    def call_count(self):
        return len(self._calls)

    def assert_awaited_once_with(self, *args, **kwargs):
        assert self.call_count == 1
        assert self._calls[0] == (args, kwargs)


class TestMessageProcessor:
    """Test cases for MessageProcessor."""

    @pytest.fixture
    def mock_queue_service(self):
        """Mock SQS queue service."""
        return AsyncMock()

    @pytest.fixture
    def mock_handler(self):
        """Mock message handler."""
        return AsyncMock()

    @pytest.fixture
    def message_processor(self, mock_queue_service, mock_handler):
        """Create MessageProcessor instance for testing."""
        return MessageProcessor(
            queue_service=mock_queue_service,
            handler=mock_handler,
            queue_url="https://example-queue",
            max_messages=10,
            wait_time_seconds=20,
            visibility_timeout=30,
            polling_interval=0,
            delete_after_processing=True,
        )

    def test_init(self, mock_queue_service, mock_handler):
        """Test MessageProcessor initialization."""
        mp = MessageProcessor(
            queue_service=mock_queue_service,
            handler=mock_handler,
            queue_url="test-queue",
            max_messages=5,
            wait_time_seconds=10,
            visibility_timeout=60,
            polling_interval=5,
            delete_after_processing=False,
        )

        assert mp.queue_service == mock_queue_service
        assert mp.handler == mock_handler
        assert mp.queue_url == "test-queue"
        assert mp.max_messages == 5
        assert mp.wait_time_seconds == 10
        assert mp.visibility_timeout == 60
        assert mp.polling_interval == 5
        assert mp.delete_after_processing is False
        assert mp._running is False
        assert mp._task is None

    @pytest.mark.asyncio
    async def test_process_message_success_deletes_message(
        self, message_processor, mock_handler, mock_queue_service
    ):
        """Test successful message processing with deletion."""
        message = {
            "receipt_handle": "rh-123",
            "body": {"chat_id": "c1", "payload": 42},
        }

        await message_processor.process_message(message)

        mock_handler.assert_awaited_once_with({"chat_id": "c1", "payload": 42})
        mock_queue_service.delete_message.assert_awaited_once_with(
            queue_url="https://example-queue", receipt_handle="rh-123"
        )

    @pytest.mark.asyncio
    async def test_process_message_parses_json_string_body(
        self, mock_queue_service, mock_handler
    ):
        """Test message processing with JSON string body."""
        mp = MessageProcessor(mock_queue_service, mock_handler, "q-url")

        body_dict = {"chat_id": "c2", "x": "y"}
        message = {"receipt_handle": "rh-2", "body": json.dumps(body_dict)}

        await mp.process_message(message)

        mock_handler.assert_awaited_once_with(body_dict)
        mock_queue_service.delete_message.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_process_message_invalid_json_body_skips_handler_but_deletes(
        self, mock_queue_service, mock_handler
    ):
        """Test message processing with invalid JSON body."""
        mp = MessageProcessor(mock_queue_service, mock_handler, "q-url")

        message = {"receipt_handle": "rh-3", "body": "{not-json}"}

        await mp.process_message(message)

        mock_handler.assert_not_awaited()
        mock_queue_service.delete_message.assert_awaited_once_with(
            queue_url="q-url", receipt_handle="rh-3"
        )

    @pytest.mark.asyncio
    async def test_process_message_handler_error_leaves_for_redrive(
        self, mock_queue_service, mock_handler
    ):
        """A handler that raises must NOT have its message deleted, so SQS can
        redeliver it (and eventually route it to the DLQ) instead of silently
        dropping the work."""
        mock_handler.side_effect = RuntimeError("boom")
        mp = MessageProcessor(mock_queue_service, mock_handler, "q-url")

        message = {"receipt_handle": "rh-4", "body": {"chat_id": "c4"}}

        await mp.process_message(message)

        mock_queue_service.delete_message.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_process_message_handler_returns_false_leaves_for_redrive(
        self, mock_queue_service, mock_handler
    ):
        """A handler returning False signals 'leave for redrive' (e.g. the
        result could not be delivered downstream)."""
        mock_handler.return_value = False
        mp = MessageProcessor(mock_queue_service, mock_handler, "q-url")

        message = {"receipt_handle": "rh-4b", "body": {"chat_id": "c4b"}}

        await mp.process_message(message)

        mock_queue_service.delete_message.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_process_message_times_out_and_leaves_for_redrive(
        self, mock_queue_service
    ):
        """A handler that exceeds message_timeout_seconds is cancelled and its
        message is left for SQS redrive (not deleted), so one hung message can't
        block the poll loop indefinitely."""

        async def hang(_body):
            await asyncio.sleep(60)  # never completes within the timeout

        handler = AsyncMock(side_effect=hang)
        mp = MessageProcessor(
            mock_queue_service,
            handler,
            "q-url",
            message_timeout_seconds=0.05,
        )

        message = {"receipt_handle": "rh-to", "body": {"chat_id": "c-to"}}

        # Must return (not hang) and must NOT delete the message.
        await asyncio.wait_for(mp.process_message(message), timeout=5)

        mock_queue_service.delete_message.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_process_message_within_timeout_still_deletes(
        self, mock_queue_service, mock_handler
    ):
        """A handler that finishes within the timeout is processed and deleted
        normally — the timeout doesn't change the happy path."""
        mp = MessageProcessor(
            mock_queue_service,
            mock_handler,
            "q-url",
            message_timeout_seconds=5,
        )

        message = {"receipt_handle": "rh-ok", "body": {"chat_id": "c-ok"}}

        await mp.process_message(message)

        mock_handler.assert_awaited_once_with({"chat_id": "c-ok"})
        mock_queue_service.delete_message.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_process_message_skip_delete_when_flag_false(
        self, mock_queue_service, mock_handler
    ):
        """Test message processing without deletion when flag is False."""
        mp = MessageProcessor(
            mock_queue_service, mock_handler, "q-url", delete_after_processing=False
        )

        message = {"receipt_handle": "rh-5", "body": {"chat_id": "c5"}}

        await mp.process_message(message)

        mock_queue_service.delete_message.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_process_message_no_receipt_handle_skips_delete(
        self, mock_queue_service, mock_handler
    ):
        """Test message processing without receipt handle."""
        mp = MessageProcessor(mock_queue_service, mock_handler, "q-url")

        message = {"body": {"chat_id": "c6"}}

        await mp.process_message(message)

        mock_handler.assert_awaited_once()
        mock_queue_service.delete_message.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_process_message_delete_error_is_logged(
        self, mock_queue_service, mock_handler
    ):
        """Test message processing when deletion fails."""
        mock_queue_service.delete_message.side_effect = RuntimeError("delete-fail")
        mp = MessageProcessor(mock_queue_service, mock_handler, "q-url")

        message = {"receipt_handle": "rh-7", "body": {"chat_id": "c7"}}

        # Should not raise despite delete error
        await mp.process_message(message)

        mock_handler.assert_awaited_once()
        mock_queue_service.delete_message.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_poll_queue_processes_all_messages_concurrently(self):
        """Test polling queue and processing multiple messages."""
        mock_queue_service = MagicMock()
        messages = [
            {"receipt_handle": f"rh-{i}", "body": {"chat_id": f"c-{i}"}}
            for i in range(3)
        ]
        mock_queue_service.receive_messages = AsyncMock(return_value=messages)
        mock_queue_service.delete_message = SimpleAsyncMock()
        # The method under test logs queue depth, so the mock needs get_queue_depth
        mock_queue_service.get_queue_depth = AsyncMock(return_value={})

        mock_handler = SimpleAsyncMock()

        message_processor = MessageProcessor(
            queue_service=mock_queue_service,
            handler=mock_handler,
            queue_url="https://example-queue",
            max_messages=10,
            wait_time_seconds=20,
            visibility_timeout=30,
            polling_interval=0,
            delete_after_processing=True,
        )

        await message_processor.poll_queue()
        # poll_queue returns once the messages have started; wait for them.
        await message_processor.wait_until_idle()

        # Asks for no more than the free slots (3 by default), never the full
        # max_messages: a received message must start at once.
        mock_queue_service.receive_messages.assert_awaited_once_with(
            queue_url="https://example-queue",
            max_messages=3,
            wait_time_seconds=20,
            visibility_timeout=30,
        )

        # Handler called for each message
        assert mock_handler.call_count == 3
        # Deletion attempted for each message
        assert mock_queue_service.delete_message.call_count == 3

    @pytest.mark.asyncio
    async def test_poll_queue_no_messages_received(
        self, message_processor, mock_queue_service, mock_handler
    ):
        """Test polling queue when no messages are received."""
        mock_queue_service.receive_messages.return_value = []

        await message_processor.poll_queue()

        mock_queue_service.receive_messages.assert_awaited_once()
        mock_handler.assert_not_awaited()
        mock_queue_service.delete_message.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_poll_queue_handles_receive_exception(
        self, message_processor, mock_queue_service, mock_handler
    ):
        """Test polling queue when receive_messages raises exception."""
        mock_queue_service.receive_messages.side_effect = RuntimeError("recv-fail")

        # Should not raise
        await message_processor.poll_queue()

        mock_handler.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_start_and_stop_lifecycle(self, mock_queue_service, mock_handler):
        """Test start and stop lifecycle of message processor."""
        # Make poll_queue a quick no-op by returning no messages
        mock_queue_service.receive_messages.return_value = []

        mp = MessageProcessor(
            mock_queue_service,
            mock_handler,
            "q-url",
            polling_interval=1,  # small interval for testing
            wait_time_seconds=0,
        )

        # Verify initial state
        assert mp._running is False
        assert mp._task is None

        # Start background task
        await mp.start()
        assert mp._task is not None
        assert not mp._task.done()

        # Give the run() method time to start and set _running = True
        await asyncio.sleep(0.02)
        assert mp._running is True

        # Stop and ensure task is cancelled/awaited cleanly
        await mp.stop()

        assert mp._running is False
        assert mp._task is not None
        assert mp._task.done()

        # Verify it actually called receive_messages
        mock_queue_service.receive_messages.assert_called()

    @pytest.mark.asyncio
    async def test_start_multiple_times_reuses_task(
        self, mock_queue_service, mock_handler
    ):
        """Test starting message processor multiple times."""
        mock_queue_service.receive_messages.return_value = []

        mp = MessageProcessor(
            mock_queue_service,
            mock_handler,
            "q-url",
            wait_time_seconds=0,
            polling_interval=0.01,
        )

        # Start first time
        await mp.start()
        first_task = mp._task

        # Start again - should reuse if task is still running
        await mp.start()
        second_task = mp._task

        # Clean up
        await mp.stop()

        assert first_task is not None
        assert first_task == second_task  # Should be the same task

    @pytest.mark.asyncio
    async def test_run_with_polling_interval(self, mock_queue_service, mock_handler):
        """Test run method with polling interval."""
        mock_queue_service.receive_messages.return_value = []

        mp = MessageProcessor(
            mock_queue_service,
            mock_handler,
            "q-url",
            polling_interval=0.01,  # Very small interval for testing
            wait_time_seconds=0,
        )

        # Start task
        task = asyncio.create_task(mp.run())
        await asyncio.sleep(0.02)  # Let it run one cycle

        # Stop by setting flag and cancelling
        mp._running = False
        task.cancel()

        try:
            await task
        except asyncio.CancelledError:
            pass  # Expected

        # Should have called receive_messages at least once
        mock_queue_service.receive_messages.assert_awaited()

    @pytest.mark.asyncio
    async def test_run_handles_cancelled_error(self, mock_queue_service, mock_handler):
        """Test run method handles CancelledError gracefully."""
        mock_queue_service.receive_messages.return_value = []

        mp = MessageProcessor(
            mock_queue_service,
            mock_handler,
            "q-url",
            wait_time_seconds=0,
            polling_interval=0.01,
        )

        # Start task and cancel it
        task = asyncio.create_task(mp.run())
        await asyncio.sleep(0.02)  # Let it start
        task.cancel()

        # Should not raise CancelledError
        try:
            await task
        except asyncio.CancelledError:
            pass  # Expected

        # Verify it handled the cancellation gracefully
        assert task.cancelled() or task.done()

    @pytest.mark.asyncio
    async def test_run_continues_on_exception(self, mock_queue_service, mock_handler):
        """Test run method continues running even when poll_queue raises exception."""
        # First call raises exception, second call returns empty to allow graceful exit
        mock_queue_service.receive_messages.side_effect = [
            RuntimeError("poll-error"),
            [],
        ]

        mp = MessageProcessor(
            mock_queue_service,
            mock_handler,
            "q-url",
            wait_time_seconds=0,
            polling_interval=0.01,
        )

        # Start task
        task = asyncio.create_task(mp.run())
        await asyncio.sleep(0.05)  # Let it handle the exception and continue

        # Stop by setting flag and cancelling
        mp._running = False
        task.cancel()

        try:
            await task
        except asyncio.CancelledError:
            pass  # Expected

        # Should have called receive_messages multiple times despite the error
        assert mock_queue_service.receive_messages.await_count >= 1


def _queue_service(batches):
    """A queue whose receive_messages returns each batch in turn, then []."""
    qs = MagicMock()
    batches = list(batches)
    qs.receive_messages = AsyncMock(
        side_effect=lambda **_: batches.pop(0) if batches else []
    )
    qs.delete_message = AsyncMock()
    qs.get_queue_depth = AsyncMock(return_value={})
    return qs


def _msg(chat_id):
    return {"receipt_handle": f"rh-{chat_id}", "body": {"chat_id": chat_id}}


class TestNoBatchWait:
    """A finished message frees its slot at once (no waiting for its batch)."""

    @pytest.mark.asyncio
    async def test_a_slow_message_does_not_hold_back_the_next_one(self):
        release_slow = asyncio.Event()
        done = []

        async def handler(body):
            if body["chat_id"] == "slow":
                await release_slow.wait()
            done.append(body["chat_id"])

        qs = _queue_service([[_msg("slow"), _msg("fast")], [_msg("next")]])
        mp = MessageProcessor(
            qs, handler, "q", max_messages=2, max_concurrent_messages=2
        )

        await mp.poll_queue()  # starts slow + fast
        await asyncio.sleep(0)  # fast finishes, slow is still running
        await asyncio.sleep(0)
        assert done == ["fast"]

        await mp.poll_queue()  # the freed slot is filled straight away
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        # Before, "next" waited until "slow" finished (the batch's slowest).
        assert done == ["fast", "next"]
        assert qs.receive_messages.await_args_list[1].kwargs["max_messages"] == 1

        release_slow.set()
        await mp.wait_until_idle()
        assert done == ["fast", "next", "slow"]
        assert qs.delete_message.await_count == 3

    @pytest.mark.asyncio
    async def test_never_receives_while_every_slot_is_busy(self):
        release = asyncio.Event()

        async def handler(body):
            await release.wait()

        qs = _queue_service([[_msg("a"), _msg("b")]])
        mp = MessageProcessor(
            qs, handler, "q", max_messages=5, max_concurrent_messages=2
        )

        await mp.poll_queue()
        assert mp.free_slots == 0
        assert qs.receive_messages.await_args_list[0].kwargs["max_messages"] == 2

        # Full: the next poll waits for a slot instead of fetching messages
        # that would sit invisible with their visibility clock running.
        waiting = asyncio.create_task(mp.poll_queue())
        await asyncio.sleep(0.01)
        assert not waiting.done()
        assert qs.receive_messages.await_count == 1

        release.set()
        await waiting
        assert qs.receive_messages.await_count == 1
        await mp.wait_until_idle()

    @pytest.mark.asyncio
    async def test_stop_cancels_messages_still_processing_and_keeps_them(self):
        started = asyncio.Event()

        async def handler(body):
            started.set()
            await asyncio.sleep(3600)

        qs = _queue_service([[_msg("a")]])
        mp = MessageProcessor(
            qs,
            handler,
            "q",
            wait_time_seconds=0,
            polling_interval=0.01,
            max_concurrent_messages=2,
        )

        await mp.start()
        await asyncio.wait_for(started.wait(), 1)
        await mp.stop()

        assert not mp._in_flight
        # Not deleted: SQS redelivers it to the next worker.
        qs.delete_message.assert_not_awaited()


class TestDrain:
    """SIGTERM on a deploy: finish what fits, put the rest straight back."""

    @pytest.mark.asyncio
    async def test_finishes_quick_messages_and_releases_the_unfinished(self):
        release_quick = asyncio.Event()

        async def handler(body):
            if body["chat_id"] == "quick":
                await release_quick.wait()
            else:
                await asyncio.sleep(3600)  # a long summary

        qs = _queue_service([[_msg("quick"), _msg("long")]])
        qs.release_message = AsyncMock()
        mp = MessageProcessor(
            qs,
            handler,
            "q",
            wait_time_seconds=0,
            polling_interval=0.01,
            max_concurrent_messages=2,
        )
        await mp.start()
        await asyncio.sleep(0.02)
        assert len(mp._in_flight) == 2

        drain = asyncio.create_task(mp.drain(timeout=0.2))
        await asyncio.sleep(0.01)
        release_quick.set()  # finishes inside the drain window
        await drain

        assert not mp._in_flight
        assert mp._task.done()
        # The quick one was handled and deleted as normal...
        qs.delete_message.assert_awaited_once_with(
            queue_url="q", receipt_handle="rh-quick"
        )
        # ...the long one was put back at once, not left hidden for 900s.
        qs.release_message.assert_awaited_once_with(
            queue_url="q", receipt_handle="rh-long"
        )

    @pytest.mark.asyncio
    async def test_takes_no_new_messages_once_draining(self):
        qs = _queue_service([])
        qs.release_message = AsyncMock()
        mp = MessageProcessor(
            qs, AsyncMock(), "q", wait_time_seconds=0, polling_interval=0.01
        )
        await mp.start()
        await asyncio.sleep(0.02)

        await mp.drain(timeout=1)
        received = qs.receive_messages.await_count
        await asyncio.sleep(0.05)

        assert mp._task.done()
        assert qs.receive_messages.await_count == received
        qs.release_message.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_a_failed_release_is_logged_not_raised(self):
        async def handler(body):
            await asyncio.sleep(3600)

        qs = _queue_service([[_msg("long")]])
        qs.release_message = AsyncMock(side_effect=RuntimeError("sqs down"))
        mp = MessageProcessor(
            qs, handler, "q", wait_time_seconds=0, polling_interval=0.01
        )
        await mp.start()
        await asyncio.sleep(0.02)

        await mp.drain(timeout=0.05)  # must not raise

        assert not mp._in_flight
