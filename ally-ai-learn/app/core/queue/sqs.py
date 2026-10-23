import asyncio
from typing import Any, Dict, Optional

import boto3

from app.core.config import settings
from app.core.logger import get_logger

logger = get_logger(__name__)


class SQSQueue:
    def __init__(self, queue_url: str, region_name: str = "us-east-1"):
        self.queue_url = queue_url
        if settings.AWS_ENDPOINT_URL:
            self.sqs = boto3.client(
                "sqs",
                aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
                aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
                region_name=region_name,
                endpoint_url=settings.AWS_ENDPOINT_URL,
            )
        else:
            self.sqs = boto3.client("sqs", region_name=region_name)

        # If a queue name was provided instead of a full URL, resolve it.
        if not self.queue_url.startswith("http://") and not self.queue_url.startswith(
            "https://"
        ):
            try:
                resp = self.sqs.get_queue_url(QueueName=self.queue_url)
                resolved_url = resp.get("QueueUrl")
                if resolved_url:
                    logger.debug(
                        "Resolved SQS queue name to URL",
                        extra={"queue_name": self.queue_url, "queue_url": resolved_url},
                    )
                    self.queue_url = resolved_url
            except Exception as e:
                logger.error(
                    f"Failed to resolve SQS queue URL for name "
                    f"'{self.queue_url}': {type(e).__name__}"
                )

    async def send_message(
        self,
        message_body: str,
        message_attributes: Optional[Dict[str, Any]] = None,
    ) -> bool:
        """Send a message to the SQS queue asynchronously using boto3
        inside a thread."""
        try:
            response = await asyncio.to_thread(
                self.sqs.send_message,
                QueueUrl=self.queue_url,
                MessageBody=message_body,
                MessageAttributes=message_attributes or {},
            )
            if response.get("MessageId"):
                logger.debug(
                    "SQS async send_message succeeded",
                    extra={
                        "message_id": response.get("MessageId"),
                        "queue_url": self.queue_url,
                    },
                )
            return response.get("MessageId") is not None
        except Exception as e:
            logger.error(f"Failed to send message: {type(e).__name__}")
            return False

    def send_message_sync(
        self,
        message_body: str,
        message_attributes: Optional[Dict[str, Any]] = None,
    ) -> bool:
        """Send a message to the SQS queue synchronously using boto3."""
        try:
            response = self.sqs.send_message(
                QueueUrl=self.queue_url,
                MessageBody=message_body,
                MessageAttributes=message_attributes or {},
            )
            if response.get("MessageId"):
                logger.debug(
                    "SQS sync send_message succeeded",
                    extra={
                        "message_id": response.get("MessageId"),
                        "queue_url": self.queue_url,
                    },
                )
            return response.get("MessageId") is not None
        except Exception as e:
            logger.error(f"Failed to send message: {type(e).__name__}")
            return False
