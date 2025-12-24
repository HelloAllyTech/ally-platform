from app.core.config import settings
from app.core.queue.sqs import SQSQueue

msg_event_queue = SQSQueue(
    queue_url=settings.SQS_MESSAGE_EVENT_QUEUE_NAME, region_name=settings.AWS_REGION
)
