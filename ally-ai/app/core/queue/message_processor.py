import asyncio
import json
from typing import Any, Awaitable, Callable, Dict

from app.core.phi_events import PHIEvents
from app.core.phi_logger import PHILogEvent, phi_logger
from app.core.queue.sqs_queue_service import SQSQueueService
from app.utils.logger import get_logger

logger = get_logger(__name__)


class MessageProcessor:
    """
    Simplified message processor for continuously polling a queue for messages and
    processing them.
    """

    def __init__(
        self,
        queue_service: SQSQueueService,
        handler: Callable[[Dict[str, Any]], Awaitable[None]],
        queue_url: str,
        max_messages: int = 10,
        wait_time_seconds: int = 20,
        visibility_timeout: int = 30,
        polling_interval: int = 0,
        delete_after_processing: bool = True,
        max_concurrent_messages: int = 3,
        message_timeout_seconds: int | None = None,
    ):
        """
        Initialize the message processor.

        Parameters:
            queue_service (SQSQueueService): The queue service to use.
            handler (Callable): The handler function to process messages.
            queue_url (str): The URL of the queue to poll.
            max_messages (int): The maximum number of messages to receive in each batch.
            wait_time_seconds (int): The duration (in seconds) for which the call
                waits for a message to arrive.
            visibility_timeout (int): The duration (in seconds) that the received
                messages are hidden from subsequent retrieve requests.
            polling_interval (int): The interval (in seconds) between polling
                attempts. 0 means continuous polling.
            delete_after_processing (bool): Whether to automatically delete messages
            after successful processing.
            max_concurrent_messages (int): Upper bound on messages processed in
                parallel per poll cycle. Each processed message may hold an
                audio blob + LLM call in memory; without this bound the worker
                memory-spikes linearly with max_messages.
        """
        self.queue_service = queue_service
        self.handler = handler
        self.queue_url = queue_url
        self.max_messages = max_messages
        self.wait_time_seconds = wait_time_seconds
        self.visibility_timeout = visibility_timeout
        self.polling_interval = polling_interval
        self.delete_after_processing = delete_after_processing
        self.max_concurrent_messages = max(1, max_concurrent_messages)
        # Per-message hard timeout. None disables it (legacy behaviour). When
        # set, a handler that runs longer is cancelled and the message is left
        # for SQS redrive, so one hung message can't block the poll loop.
        self.message_timeout_seconds = message_timeout_seconds
        self._running = False
        self._task = None
        # Messages being processed right now. A finished message frees its
        # slot at once and the loop fetches the next one; it no longer waits
        # for the whole batch it came in with (see poll_queue).
        self._in_flight: set[asyncio.Task] = set()
        # The message each in-flight task is processing, so drain() can put
        # unfinished ones back on the queue.
        self._task_messages: dict[asyncio.Task, Dict[str, Any]] = {}

    async def process_message(self, message: Dict[str, Any]) -> None:
        """
        Process a single message.

        Parameters:
            message (Dict[str, Any]): The message to process.
        """
        chat_id = None
        receipt_handle = message.get("receipt_handle")
        # Whether the message was fully handled and is safe to delete. A handler
        # may return False to signal "leave for SQS redrive" (e.g. the result
        # could not be delivered to the downstream service); a handler that
        # returns None/True (or has no opinion) is treated as handled. An
        # unhandled exception leaves this False so the message redrives.
        handled = False

        try:
            # Extract the message body
            body = message.get("body", {})

            # Extract chat_id early, before any processing
            if not isinstance(body, dict):
                try:
                    body = json.loads(body)
                except json.JSONDecodeError:
                    # Set chat_id to unknown if JSON parsing fails
                    chat_id = "unknown"
                    logger.error("Failed to parse message body as JSON")
                    await phi_logger.log(
                        PHILogEvent(
                            event_type=PHIEvents.SYSTEM_ERROR,
                            chat_id=chat_id,
                            audit_id=None,  # Will be set by external service
                            details={
                                "error": "Failed to parse message body as JSON",
                                "message_id": message.get("message_id", "unknown"),
                                "receipt_handle": (
                                    receipt_handle[:20] + "..."
                                    if receipt_handle
                                    else None
                                ),
                                "queue_url": self.queue_url,
                            },
                        )
                    )

            # Proceed only if body is a valid dict; otherwise skip handler
            if isinstance(body, dict):
                # Extract chat_id from valid body
                chat_id = body.get("chat_id", "unknown")
                correlation_id = body.get("correlation_id")
                logger.info(
                    f"Processing message for chat_id: {chat_id} "
                    f"correlation_id={correlation_id}"
                )

                # Process the message using the handler, bounded by a hard
                # timeout so a hung STT/LLM call can't block the poll loop (and
                # thus starve every other queued chat) indefinitely.
                if self.message_timeout_seconds is not None:
                    result = await asyncio.wait_for(
                        self.handler(body),
                        timeout=self.message_timeout_seconds,
                    )
                else:
                    result = await self.handler(body)
                # Only an explicit False means "leave for redrive".
                handled = result is not False
            else:
                # Malformed body (already logged above): nothing to retry, drop
                # it so it doesn't loop forever.
                handled = True

        except asyncio.TimeoutError:
            # The handler blew past MESSAGE_PROCESSING_TIMEOUT and was cancelled.
            # Leave the message for SQS redrive (handled stays False) and — most
            # importantly — free the concurrency slot so the poll loop can keep
            # draining the queue instead of stalling behind this one message.
            chat_id = (
                body.get("chat_id", "unknown") if "body" in locals() else "unknown"
            )
            logger.error(
                f"Timed out processing message for chat_id {chat_id} after "
                f"{self.message_timeout_seconds}s; leaving for redrive"
            )
            await phi_logger.log(
                PHILogEvent(
                    event_type=PHIEvents.SYSTEM_ERROR,
                    chat_id=chat_id,
                    audit_id=None,
                    details={
                        "error": (
                            f"Timed out processing message for chat_id {chat_id} "
                            f"after {self.message_timeout_seconds}s"
                        ),
                        "chat_id": chat_id,
                        "exception_type": "TimeoutError",
                        "message_id": message.get("message_id", "unknown"),
                        "queue_url": self.queue_url,
                    },
                )
            )

        except Exception as e:
            chat_id = (
                body.get("chat_id", "unknown") if "body" in locals() else "unknown"
            )
            logger.exception(
                f"Error processing message for chat_id {chat_id}: {type(e).__name__}"
            )
            await phi_logger.log(
                PHILogEvent(
                    event_type=PHIEvents.SYSTEM_ERROR,
                    chat_id=chat_id,
                    audit_id=None,  # Will be set by external service
                    details={
                        "error": (
                            f"Error processing message for chat_id {chat_id}: "
                            f"{type(e).__name__}"
                        ),
                        "chat_id": chat_id,
                        "exception_type": type(e).__name__,
                        "message_id": message.get("message_id", "unknown"),
                        "receipt_handle": (
                            receipt_handle[:20] + "..." if receipt_handle else None
                        ),
                        "queue_url": self.queue_url,
                    },
                )
            )

        finally:
            # Delete only when the message was fully handled. An unhandled
            # failure (handler returned False or raised) is left on the queue so
            # SQS redelivers it after the visibility timeout and, after
            # maxReceiveCount, routes it to the DLQ — instead of silently
            # dropping work, which is what the old unconditional delete did.
            if not handled and receipt_handle:
                logger.warning(
                    f"Leaving message on queue for redrive (chat_id={chat_id}); "
                    f"not deleting after a failed/incomplete handling"
                )
            if self.delete_after_processing and receipt_handle and handled:
                try:
                    await self.queue_service.delete_message(
                        queue_url=self.queue_url, receipt_handle=receipt_handle
                    )
                    logger.info(f"Message deleted from queue for chat_id: {chat_id}")
                except Exception as delete_error:
                    logger.error(
                        f"Failed to delete message from queue for chat_id {chat_id}: "
                        f"{delete_error}"
                    )
                    await phi_logger.log(
                        PHILogEvent(
                            event_type=PHIEvents.SYSTEM_ERROR,
                            chat_id=chat_id,
                            audit_id=None,  # Will be set by external service
                            details={
                                "error": f"Failed to delete message from queue: {str(delete_error)}",  # noqa: E501
                                "chat_id": chat_id,
                                "message_id": message.get("message_id", "unknown"),
                                "queue_url": self.queue_url,
                            },
                        )
                    )

    @property
    def free_slots(self) -> int:
        """How many more messages can start processing right now."""
        return self.max_concurrent_messages - len(self._in_flight)

    async def wait_until_idle(self) -> None:
        """Wait for every message that has started to finish."""
        while self._in_flight:
            await asyncio.gather(*list(self._in_flight), return_exceptions=True)

    def _start_processing(self, message: Dict[str, Any]) -> None:
        task = asyncio.create_task(self.process_message(message))
        self._in_flight.add(task)
        self._task_messages[task] = message

        def _done(t: asyncio.Task) -> None:
            self._in_flight.discard(t)
            self._task_messages.pop(t, None)

        task.add_done_callback(_done)

    async def poll_queue(self) -> None:
        """
        Fetch as many messages as there are free slots and start them.

        Returns once they have STARTED, not finished. This used to receive a
        batch and await all of it before polling again, so one slow recording
        held every other slot idle: with 10 calls ending together, the second
        five waited for the slowest of the first five (summaries in 84-285s).
        Now each finished message frees its slot and the next poll fills it.

        Never receives more than the free slots: SQS starts every received
        message's visibility clock at once, so a message that waited for a slot
        could time out and be redelivered (see SQSWorkerConstants).
        """
        try:
            if self.free_slots <= 0:
                # Every slot is busy: wait for one to free up, then poll.
                await asyncio.wait(
                    list(self._in_flight), return_when=asyncio.FIRST_COMPLETED
                )
                return
            messages = await self.queue_service.receive_messages(
                queue_url=self.queue_url,
                max_messages=min(self.max_messages, self.free_slots),
                wait_time_seconds=self.wait_time_seconds,
                visibility_timeout=self.visibility_timeout,
            )

            if messages:
                # Concurrency/backlog visibility: how big was this batch, how
                # many are we allowed to run at once, and what is the queue
                # depth behind us. This is what surfaces concurrency-driven
                # backlog (the "2-3 recording at once" scenario) in the logs.
                depth = {}
                get_depth = getattr(self.queue_service, "get_queue_depth", None)
                if callable(get_depth):
                    depth = await get_depth(self.queue_url)
                logger.info(
                    "poll: received batch_size=%s already_processing=%s "
                    "max_concurrent=%s queue_visible=%s queue_in_flight=%s queue=%s",
                    len(messages),
                    len(self._in_flight),
                    self.max_concurrent_messages,
                    depth.get("visible", "n/a"),
                    depth.get("in_flight", "n/a"),
                    self.queue_url,
                )
                # Bounded by free_slots above: each processed message may hold
                # an audio blob and an LLM call in memory.
                for message in messages:
                    self._start_processing(message)
                if self.free_slots <= 0:
                    # Saturation is visible, not silent: more recordings than
                    # slots are waiting in the queue, not in this process.
                    logger.info(
                        "All %s concurrency slots busy", self.max_concurrent_messages
                    )

        except Exception as e:
            logger.exception(f"Error polling queue: {type(e).__name__}")
            await phi_logger.log(
                PHILogEvent(
                    event_type=PHIEvents.SYSTEM_ERROR,
                    chat_id=None,  # No specific chat for polling errors
                    audit_id=None,  # Will be set by external service
                    details={
                        "error": f"Error polling queue: {type(e).__name__}",
                        "exception_type": type(e).__name__,
                        "queue_url": self.queue_url,
                        "max_messages": self.max_messages,
                        "wait_time_seconds": self.wait_time_seconds,
                        "visibility_timeout": self.visibility_timeout,
                    },
                )
            )

    async def run(self) -> None:
        """
        Run the message processor continuously.
        """
        self._running = True
        logger.info(f"Starting message processor for queue: {self.queue_url}")

        while self._running:
            try:
                await self.poll_queue()

                # Add polling interval if specified
                if self.polling_interval > 0:
                    await asyncio.sleep(self.polling_interval)

            except asyncio.CancelledError:
                logger.info("Message processor cancelled")
                break
            except Exception as e:
                logger.exception(f"Error in message processor: {type(e).__name__}")
                await phi_logger.log(
                    PHILogEvent(
                        event_type=PHIEvents.SYSTEM_ERROR,
                        chat_id=None,  # No specific chat for system errors
                        audit_id=None,  # Will be set by external service
                        details={
                            "error": f"Error in message processor: {type(e).__name__}",
                            "exception_type": type(e).__name__,
                            "queue_url": self.queue_url,
                        },
                    )
                )
                # Continue running even if there's an error
                await asyncio.sleep(1)

        logger.info(f"Message processor stopped for queue: {self.queue_url}")

    async def start(self) -> None:
        """
        Start the message processor in the background.
        """
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self.run())
            logger.info("Message processor started")

    async def drain(self, timeout: float) -> None:
        """
        Shut down without losing or delaying work (SIGTERM on a deploy).

        Stops taking messages, lets the ones in progress finish for up to
        `timeout` seconds, then cancels the rest and makes them visible on the
        queue again at once, so the new container picks them up instead of
        SQS hiding them for the rest of their visibility timeout.
        """
        loop = asyncio.get_running_loop()
        deadline = loop.time() + timeout
        self._running = False
        logger.info(
            "Draining: no new messages; %s in progress get up to %ss",
            len(self._in_flight),
            timeout,
        )
        # Let the poll loop exit by itself rather than cancel it mid-receive:
        # messages a cancelled receive had already taken would be lost until
        # their visibility timeout. A receive returns within wait_time_seconds;
        # past that the loop is only waiting for a free slot, safe to cancel.
        if self._task and not self._task.done():
            await asyncio.wait(
                {self._task},
                timeout=min(
                    self.wait_time_seconds + 2, max(0.0, deadline - loop.time())
                ),
            )
            if not self._task.done():
                self._task.cancel()
                await asyncio.gather(self._task, return_exceptions=True)

        if self._in_flight:
            await asyncio.wait(
                list(self._in_flight), timeout=max(0.0, deadline - loop.time())
            )
        unfinished = [(t, self._task_messages.get(t)) for t in list(self._in_flight)]
        for task, _ in unfinished:
            task.cancel()
        await asyncio.gather(*(t for t, _ in unfinished), return_exceptions=True)
        for _, message in unfinished:
            receipt_handle = (message or {}).get("receipt_handle")
            if not receipt_handle:
                continue
            try:
                await self.queue_service.release_message(
                    queue_url=self.queue_url, receipt_handle=receipt_handle
                )
            except Exception as e:
                logger.error(
                    f"Could not put an unfinished message back on the queue: "
                    f"{type(e).__name__}; SQS redelivers it after its visibility "
                    f"timeout"
                )
        logger.info(
            "Drained: %s unfinished message(s) put back on the queue", len(unfinished)
        )

    async def stop(self) -> None:
        """
        Stop the message processor.
        """
        self._running = False
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        # As before, stopping cancels messages still being processed; they
        # are not deleted, so SQS redelivers them.
        for task in list(self._in_flight):
            task.cancel()
        await asyncio.gather(*list(self._in_flight), return_exceptions=True)
        logger.info("Message processor stopped")
