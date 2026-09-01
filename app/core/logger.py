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


class BenignNoiseCancellationFilter(logging.Filter):
    """Demote the Rust FFI's Krisp-BVC-rejection log to INFO.

    Krisp BVC is a LiveKit Cloud feature (see
    ``app/core/livekit/audio_filters.py``): on our self-hosted deployment the
    Rust FFI refuses it and reports that refusal through
    ``logging.getLogger("livekit")`` (the bridge in
    ``livekit.rtc._ffi_client.ffi_event_callback``) at ERROR/WARNING, even
    though the session simply runs unfiltered — no user-facing impact. Our own
    gate already avoids requesting the filter by default, but an operator can
    still opt in on a deployment that cannot honor it, and that config choice
    shouldn't page as an internal error every session. Scoped to this exact,
    known FFI message so any other "livekit" ERROR still alerts normally.
    """

    _BENIGN_SNIPPETS = (
        "audio filter cannot be enabled",
        "failed to initialize the audio filter",
    )

    def filter(self, record: LogRecord) -> bool:
        if record.levelno >= logging.WARNING and any(
            snippet in record.getMessage() for snippet in self._BENIGN_SNIPPETS
        ):
            record.levelno = logging.INFO
            record.levelname = "INFO"
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
    # the app logs through these, so the slack_alerts handler is attached here
    # (via the loop below) — otherwise their WARNING+/ERROR records would reach
    # only root (which has no Slack handler) and silently never alert. Scoped to
    # "app" so noisy third-party libraries (httpx, openai, boto3, …) are NOT
    # forwarded to Slack.
    #
    # No stdout handler + propagate=True: stdout is emitted exactly once by the
    # root logger (avoiding duplicate lines), and propagation keeps pytest's
    # caplog — which captures at root — working for app.* loggers.
    "app": {
        "level": settings.LOG_LEVEL,
        "handlers": [],
        "propagate": True,
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
    # instead of dying silently on stdout. The noise-cancellation filter runs
    # here too, ahead of every handler, so the benign Krisp-rejection line
    # never reaches Slack as an ERROR either.
    "livekit": {
        "level": settings.LOG_LEVEL,
        "handlers": ["stdout"],
        "filters": ["benign_noise_cancellation"],
        "propagate": False,
    },
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
        "benign_noise_cancellation": {
            "()": BenignNoiseCancellationFilter,
        },
    },
    "handlers": handlers,
    "loggers": loggers,
}

logging.config.dictConfig(logging_config)

# Tag the handlers we just installed so the LiveKit-dedup helpers below can tell
# "ours" from the stdout handlers LiveKit adds to root (whose formatter varies:
# JsonFormatter in prod, ColoredFormatter in devmode). Tagging is format-agnostic.
for _h in logging.getLogger().handlers:
    _h._ally_primary = True  # type: ignore[attr-defined]

logger = logging.getLogger("lifeline-ai")


def get_logger(logger_name: str) -> logging.Logger:
    """Returns a logger with the specified name."""
    return logging.getLogger(logger_name)


def _strip_foreign_root_handlers() -> None:
    """Keep only OUR own tagged stdout handler and LiveKit's ``LogQueueHandler``
    forwarder on root; drop any other handler LiveKit adds (its JSON handler in
    prod, its ColoredFormatter handler in devmode). Tag-based rather than
    formatter-based so it is robust across log modes. Best-effort — never raise
    from logging setup.
    """
    try:
        from livekit.agents.ipc.log_queue import LogQueueHandler
    except Exception:  # noqa: BLE001
        LogQueueHandler = ()  # type: ignore[assignment]
    root = logging.getLogger()
    root.handlers[:] = [
        h
        for h in root.handlers
        if getattr(h, "_ally_primary", False) or isinstance(h, LogQueueHandler)
    ]


def setup_livekit_logging(log_level: str, devmode: bool, console: bool) -> None:
    """Run LiveKit's ``setup_logging`` for its side effects (silencing noisy
    third-party loggers, setting plugin log levels) without leaving its JSON
    stdout handler on root — our bracketed dictConfig handler stays the single
    sink.

    Called at module import in the worker, so it runs in BOTH the main process
    and each re-imported job subprocess. It only covers ``setup_logging``'s
    handler; the other two dedup points are ``patch_livekit_parent_logger``
    (the run_app JSON handler in the parent) and
    ``make_child_logging_forward_only`` (the child's local stdout emit). See
    those for the full picture of LiveKit's multi-process log duplication.
    """
    from livekit.agents.cli.log import setup_logging as _livekit_setup_logging

    _livekit_setup_logging(log_level, devmode=devmode, console=console)
    _strip_foreign_root_handlers()


def patch_livekit_parent_logger() -> None:
    """Stop ``run_app``'s ``cli._configure_logger`` from adding a SECOND JSON
    stdout handler to the root logger in the main process. It runs inside
    ``run_app`` — after our import-time setup — so we cannot strip it
    afterwards, and LiveKit exposes no WorkerOptions flag to disable it. Replace
    the private hook with a level-only version (LiveKit is version-pinned). Call
    in the ``__main__`` block BEFORE ``run_app``. Best-effort — a rename in a
    LiveKit upgrade degrades to the old duplication, not a crash.
    """
    try:
        import livekit.agents.cli.cli as _lkcli

        def _level_only(c, log_level):  # noqa: ANN001 - matches _configure_logger
            logging.getLogger().setLevel(log_level)

        _lkcli._configure_logger = _level_only
    except Exception:  # noqa: BLE001
        pass


def make_child_logging_forward_only() -> None:
    """Make a job/prewarm subprocess forward-only. LiveKit installs a
    ``LogQueueHandler`` on the child root that ships records to the parent,
    which emits them once — the intended design. But our worker-module re-import
    also left our stdout handler on the child root, so each child record was
    emitted locally AND re-emitted by the parent. Drop everything except the
    forwarder so the child forwards and the parent emits exactly once. Call at
    the top of ``prewarm`` (runs in the child). No-op when no forwarder is
    present (e.g. local console mode) so stdout logging still works there.
    """
    try:
        from livekit.agents.ipc.log_queue import LogQueueHandler
    except Exception:  # noqa: BLE001
        return
    root = logging.getLogger()
    forwarders = [h for h in root.handlers if isinstance(h, LogQueueHandler)]
    if forwarders:
        root.handlers[:] = forwarders
