import atexit
import contextvars
import logging
import logging.config
import logging.handlers
import queue
import time
from logging import LogRecord

from slack_sdk import WebClient
from slack_sdk.errors import SlackApiError

from app.core.config import settings

# Context variable for Trace ID
trace_id_var = contextvars.ContextVar("trace_id", default="N/A")


def get_trace_id():
    """Retrieve the current Trace ID."""
    return trace_id_var.get()


class TraceIdFilter(logging.Filter):
    """Custom logging filter to add Trace ID to log records."""

    def filter(self, record: LogRecord) -> bool:
        record.trace_id = get_trace_id()
        return True


# Severity → Slack emoji, so alerts are scannable at a glance.
_LEVEL_EMOJI = {
    "CRITICAL": ":rotating_light:",
    "ERROR": ":rotating_light:",
    "WARNING": ":warning:",
    "INFO": ":information_source:",
    "DEBUG": ":mag:",
}

# Slack hard-limits a message body at ~40k chars; we keep alerts readable and
# avoid shipping enormous tracebacks verbatim.
_SLACK_MAX_CHARS = 3500


class SlackSdkHandler(logging.Handler):
    """Send log records to a Slack channel using the Slack SDK.

    Runs on the ``QueueListener`` background thread (see ``make_slack_handler``),
    so the synchronous ``chat_postMessage`` never blocks the caller's thread —
    critical here because logging happens on the LiveKit asyncio event loop and a
    blocking network call inside ``emit`` could itself stall a simulation.

    Identical, repeated alerts are throttled within ``dedup_window`` seconds so a
    log storm can neither flood the channel nor back the queue up; the count of
    suppressed duplicates rides on the next message for the same key.
    """

    def __init__(self, token, channel_id, service_name, env, dedup_window=30.0):
        super().__init__()
        self.client = WebClient(token=token)
        self.channel_id = channel_id
        self.service_name = service_name
        self.env = env
        self.dedup_window = dedup_window
        # key -> [last_sent_monotonic, suppressed_count]. Only ever touched on
        # the single listener thread, so no lock is needed.
        self._recent: dict[str, list] = {}

    def _dedup_key(self, record: LogRecord, body: str) -> str:
        # Fold on level + logger + first line so repeated identical failures
        # collapse but distinct ones stay separate.
        first_line = body.split("\n", 1)[0]
        return f"{record.levelno}|{record.name}|{first_line}"

    def _prune(self, now: float) -> None:
        stale = [k for k, v in self._recent.items() if now - v[0] > self.dedup_window]
        for k in stale:
            del self._recent[k]

    def emit(self, record: LogRecord) -> None:
        try:
            body = self.format(record)
            now = time.monotonic()
            key = self._dedup_key(record, body)
            entry = self._recent.get(key)
            if entry is not None and now - entry[0] < self.dedup_window:
                entry[1] += 1  # within window → suppress, surface count later
                return
            suppressed = entry[1] if entry is not None else 0
            self._recent[key] = [now, 0]
            self._prune(now)

            emoji = _LEVEL_EMOJI.get(record.levelname, ":information_source:")
            header = f"{emoji} *{self.service_name}* `{self.env}` [{record.levelname}]"
            if suppressed:
                header += f" _(+{suppressed} more suppressed)_"
            if len(body) > _SLACK_MAX_CHARS:
                body = body[:_SLACK_MAX_CHARS] + "\n…(truncated)"
            self.client.chat_postMessage(
                channel=self.channel_id,
                text=f"{header}\n{body}",
            )
        except SlackApiError as e:
            # Don't log via the logging tree (would recurse into this handler);
            # print so the failure is at least visible on stdout/CloudWatch.
            print(f"[slack-alerts] failed to post: {e.response.get('error')}")
        except Exception as e:  # noqa: BLE001 - logging must never crash the app
            print(f"[slack-alerts] unexpected error posting to Slack: {e!r}")


def make_slack_handler(token, channel_id, service_name, env):
    """Build a non-blocking Slack logging handler.

    Returns a ``QueueHandler`` that loggers attach to: emitting only enqueues the
    (already-formatted) record and never touches the network, while a background
    ``QueueListener`` thread drains the queue into the real ``SlackSdkHandler``.
    This is what keeps a WARNING log from blocking the event loop.

    ``dictConfig`` applies the ``level``/``formatter``/``filters`` keys to the
    returned ``QueueHandler``, so they are intentionally not parameters here.
    """
    sender = SlackSdkHandler(token, channel_id, service_name, env)
    log_queue: "queue.Queue" = queue.Queue(maxsize=1000)
    queue_handler = logging.handlers.QueueHandler(log_queue)
    listener = logging.handlers.QueueListener(
        log_queue, sender, respect_handler_level=True
    )
    listener.start()

    def _stop_listener() -> None:
        # Needed so the (non-daemon) listener thread doesn't block interpreter
        # exit. Guarded because QueueListener.stop() isn't idempotent — stop()
        # nulls _thread, so a second call would raise.
        if getattr(listener, "_thread", None) is not None:
            listener.stop()

    atexit.register(_stop_listener)
    # Keep strong refs so GC can't tear the listener/sender down underneath us.
    queue_handler._slack_listener = listener  # type: ignore[attr-defined]
    queue_handler._slack_sender = sender  # type: ignore[attr-defined]
    return queue_handler


handlers = {
    "stdout": {
        "class": "logging.StreamHandler",
        "formatter": "simple",
        "filters": ["trace_id"],
        "stream": "ext://sys.stdout",
    },
}

loggers = {
    "root": {"level": settings.LOG_LEVEL, "handlers": ["stdout"]},
    "lifeline-ai": {
        "level": settings.LOG_LEVEL,
        "handlers": ["stdout"],
        "propagate": False,
    },
    # Parent of every per-module logger created via get_logger(__name__)
    # ("app.core.queue.sqs", "app.core.scenario_report.service", ...). Most of
    # the app logs through these, so the slack_alerts handler MUST be attached
    # here — otherwise their WARNING+/ERROR records would propagate to root
    # (which has no Slack handler) and silently never reach the channel.
    # Scoped to "app" so noisy third-party libraries (httpx, openai, boto3, …)
    # that propagate to root are NOT forwarded to Slack.
    "app": {
        "level": settings.LOG_LEVEL,
        "handlers": ["stdout"],
        "propagate": False,
    },
    "uvicorn": {
        "level": settings.LOG_LEVEL,
        "handlers": ["stdout"],
        "propagate": False,
    },
    "uvicorn.access": {"level": "WARNING", "handlers": ["stdout"], "propagate": False},
    "slack": {"level": settings.LOG_LEVEL, "handlers": ["stdout"], "propagate": False},
    # Route LiveKit's own logger through our handlers so its WARNING+ events
    # (notably job_memory_warn_mb breaches and process timeouts) reach Slack
    # instead of dying silently on stdout.
    "livekit": {"level": settings.LOG_LEVEL, "handlers": ["stdout"], "propagate": False},
    "livekit.agents": {
        "level": settings.LOG_LEVEL,
        "handlers": ["stdout"],
        "propagate": False,
    },
}

if settings.SLACK_ALERTS_ENABLED:
    handlers["slack_alerts"] = {
        "()": make_slack_handler,
        "token": settings.SLACK_ALERTS_API_TOKEN,
        "channel_id": settings.SLACK_ALERTS_CHANNEL_ID,
        "service_name": "ally-ai-learn",
        "env": settings.ENV.value,
        "level": settings.SLACK_ALERTS_LOG_LEVEL,
        "formatter": "simple",
        "filters": ["trace_id"],
    }
    for logger_name in loggers:
        if logger_name != "root":  # do not add slack alerts to the root logger.
            loggers[logger_name]["handlers"].append("slack_alerts")

logging_config = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "simple": {
            "format": (
                "[%(asctime)s] [%(levelname)s] [%(name)s] "
                "[%(filename)s:%(lineno)d] [TraceID:%(trace_id)s] - %(message)s"
            ),
            "datefmt": "%Y-%m-%dT%H:%M:%S%z",
        },
    },
    "filters": {
        "trace_id": {
            "()": TraceIdFilter,
        },
    },
    "handlers": handlers,
    "loggers": loggers,
}

logging.config.dictConfig(logging_config)
logger = logging.getLogger("lifeline-ai")


def get_logger(logger_name: str) -> logging.Logger:
    """Returns a logger with the specified name."""
    return logging.getLogger(logger_name)
