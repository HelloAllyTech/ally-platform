from types import SimpleNamespace

import pytest

from app.core.queue.sqs import SQSQueue


class DummyBotoClient:
    def __init__(
        self,
        *,
        queue_url_map=None,
        send_message_result=None,
        raise_on_send: Exception | None = None,
    ):
        self._queue_url_map = queue_url_map or {}
        self._send_message_result = send_message_result or {"MessageId": "mid-123"}
        self._raise_on_send = raise_on_send
        self.calls = SimpleNamespace(get_queue_url=[], send_message=[])

    # boto3 client API
    def get_queue_url(self, QueueName: str):
        self.calls.get_queue_url.append(QueueName)
        if QueueName not in self._queue_url_map:
            raise RuntimeError("Queue not found")
        return {"QueueUrl": self._queue_url_map[QueueName]}

    def send_message(self, **kwargs):
        self.calls.send_message.append(kwargs)
        if self._raise_on_send:
            raise self._raise_on_send
        return self._send_message_result


@pytest.fixture
def patch_boto(monkeypatch):
    """Patch boto3.client to return our dummy client and expose the
    instance for assertions."""
    holder = {}

    def _factory(return_client: DummyBotoClient):
        def _client(service_name, *args, **kwargs):  # noqa: ARG001
            holder["client"] = return_client
            return return_client

        monkeypatch.setattr("app.core.queue.sqs.boto3.client", _client)
        return holder

    return _factory


@pytest.mark.asyncio
async def test_sqs_queue_resolves_name_and_async_send_success(monkeypatch, patch_boto):
    # Ensure endpoint url is not set so normal client path is used
    monkeypatch.setattr(
        "app.core.queue.sqs.settings.AWS_ENDPOINT_URL", "", raising=False
    )

    dummy = DummyBotoClient(queue_url_map={"my-queue": "https://sqs.aws/123/my-queue"})
    holder = patch_boto(dummy)

    q = SQSQueue("my-queue", region_name="us-east-1")
    assert q.queue_url == "https://sqs.aws/123/my-queue"

    ok = await q.send_message(
        "hello", {"k": {"StringValue": "v", "DataType": "String"}}
    )
    assert ok is True
    # boto send_message called with resolved URL
    assert (
        holder["client"].calls.send_message
        and holder["client"].calls.send_message[0]["QueueUrl"] == q.queue_url
    )


@pytest.mark.asyncio
async def test_sqs_queue_async_send_failure_logs_and_returns_false(
    monkeypatch, patch_boto
):
    monkeypatch.setattr(
        "app.core.queue.sqs.settings.AWS_ENDPOINT_URL", "", raising=False
    )

    dummy = DummyBotoClient(
        queue_url_map={"q": "https://sqs.aws/q"}, raise_on_send=RuntimeError("boom")
    )
    patch_boto(dummy)

    q = SQSQueue("q")
    ok = await q.send_message("body")
    assert ok is False


def test_sqs_queue_sync_send_success_with_custom_endpoint(monkeypatch, patch_boto):
    # Force code path that passes endpoint_url by setting a non-empty AWS_ENDPOINT_URL
    monkeypatch.setattr(
        "app.core.queue.sqs.settings.AWS_ENDPOINT_URL",
        "http://localhost:4566",
        raising=False,
    )
    monkeypatch.setattr(
        "app.core.queue.sqs.settings.AWS_ACCESS_KEY_ID", "ak", raising=False
    )
    monkeypatch.setattr(
        "app.core.queue.sqs.settings.AWS_SECRET_ACCESS_KEY", "sk", raising=False
    )

    dummy = DummyBotoClient(send_message_result={"MessageId": "m-1"})
    patch_boto(dummy)

    # Provide a full URL so resolution is skipped
    q = SQSQueue("http://localhost:4566/000000000000/test-queue")
    ok = q.send_message_sync("hi")
    assert ok is True


def test_sqs_queue_resolution_failure_is_handled(monkeypatch, patch_boto):
    monkeypatch.setattr(
        "app.core.queue.sqs.settings.AWS_ENDPOINT_URL", "", raising=False
    )

    # No mapping -> get_queue_url raises -> init should log and keep original value
    dummy = DummyBotoClient(queue_url_map={})
    patch_boto(dummy)

    q = SQSQueue("non-existent-queue")
    # queue_url should remain as given since resolution failed
    assert q.queue_url == "non-existent-queue"

    # sync send without a proper URL still goes through the client and
    # returns according to dummy
    ok = q.send_message_sync("x")
    assert ok is True
