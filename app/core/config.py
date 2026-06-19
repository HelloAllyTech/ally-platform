"""
Configuration settings for the application.
"""

from typing import Optional

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.core.constants import Environment


class Settings(BaseSettings):
    """Application settings."""

    model_config = SettingsConfigDict(
        env_file=[".env", "./.env", "../.env"],
        # Ignore unknown environment variables
        # (e.g., double-underscore vars from S3)
        extra="ignore",
    )

    # Log settings
    ENV: Environment = Field(default=Environment.DEV, description="App environment")

    LOG_LEVEL: str = "INFO"

    SLACK_ALERTS_ENABLED: bool = False
    SLACK_ALERTS_API_TOKEN: str = Field(...)
    SLACK_ALERTS_CHANNEL_ID: str = Field(...)
    SLACK_ALERTS_LOG_LEVEL: str = "WARNING"
    LIVEKIT_LOG_LEVEL: str = Field(...)
    LIVEKIT_LOG_DEV_MODE: bool = Field(default=False)
    LIVEKIT_LOG_CONSOLE: bool = Field(default=False)

    LIVEKIT_API_KEY: str = Field(...)
    LIVEKIT_API_SECRET: str = Field(...)
    LIVEKIT_URL: str = Field(...)
    AGENT_NAME: str = Field(default="Agent", description="Agent name for LiveKit")

    OPENAI_API_KEY: str = Field(...)
    OPENAI_MODEL: str = Field(
        default="gpt-4o-mini", description="OpenAI model to use for LLM responses"
    )
    OPENAI_EMBEDDING_MODEL: str = Field(
        default="text-embedding-3-small",
        description="OpenAI model to use for embeddings",
    )

    # Open-source LLM settings (Ollama / vLLM)
    OLLAMA_BASE_URL: Optional[str] = Field(
        default="http://host.docker.internal:11434/v1",
        description="Base URL for Ollama's OpenAI-compatible API",
    )
    VLLM_BASE_URL: Optional[str] = Field(
        default=None,
        description="Base URL for vLLM's OpenAI-compatible API",
    )
    LOCAL_LLM_MODEL: Optional[str] = Field(
        default=None,
        description="Default model for local LLM providers (e.g., llama3.2)",
    )

    GOOGLE_API_KEY: Optional[str] = Field(
        default=None,
        description=(
            "Google API key for Gemini LLM "
            "(can also use GOOGLE_APPLICATION_CREDENTIALS)"
        ),
    )

    # Semantic similarity settings
    SEMANTIC_SIMILARITY_THRESHOLD: float = Field(
        default=0.6,
        description=(
            "Similarity threshold for cosine similarity (0-1 range). "
            "Higher threshold means stricter matching"
        ),
    )

    DEEPGRAM_API_KEY: str = Field(...)

    # AWS SES settings
    AWS_ACCESS_KEY_ID: str = Field(...)
    AWS_SECRET_ACCESS_KEY: str = Field(...)
    AWS_REGION: str = Field(default="us-east-1")
    AWS_ENDPOINT_URL: Optional[str] = Field(
        default=None, description="AWS endpoint URL (for LocalStack)"
    )
    SQS_MESSAGE_EVENT_QUEUE_NAME: str = Field(
        ..., description="SQS queue name for message and events"
    )

    ELEVEN_API_KEY: str = Field(...)
    SARVAM_API_KEY: str = Field(...)
    SARVAM_TTS_TIMEOUT: float = Field(
        default=30.0,
        description=(
            "Upper limit in seconds to wait for Sarvam TTS response before giving up"
        ),
    )
    HUME_API_KEY: str = Field(...)

    # Stream the agent's reply token-by-token to TTS instead of waiting for the
    # full LLM response. The LiveKit LLMAdapter already streams (stream_mode=
    # "messages"); the only missing piece is enabling streaming on the chat
    # model. When True, TTS starts on the first tokens of generate_response —
    # the single biggest voice-to-voice latency lever. Default False (no change);
    # flip in dev to verify no double-speak, then A/B in prod.
    STREAM_RESPONSE: bool = Field(
        default=False,
        description=(
            "Enable token streaming of generate_response to TTS (sets "
            "streaming=True on the response chat model). Cuts time-to-first-audio "
            "from full-generation to first-token. Verify in dev before prod."
        ),
    )

    # Timeouts for LLM-bound turn-processing nodes. These prevent the LiveKit
    # agent from getting stuck in "thinking" state if an upstream provider
    # (OpenAI, Gemini, etc.) hangs indefinitely.
    LLM_RESPONSE_TIMEOUT: float = Field(
        default=30.0,
        description=(
            "Upper limit in seconds for the main LLM ainvoke() call in "
            "generate_response. On timeout, a safe fallback message is returned."
        ),
    )

    # ---- Pause / resume tuning (overridable via env; defaults shown) ----
    PAUSE_CAP_SECONDS: float = Field(
        default=600.0,
        description="Max single continuous pause (seconds) before the session "
        "auto-ends. Default 10 min.",
    )
    PAUSE_WARNING_LEAD_SECONDS: float = Field(
        default=30.0,
        description="How many seconds before a pause auto-ends to warn the " "client.",
    )
    MAX_TOTAL_PAUSE_SECONDS: float = Field(
        default=1800.0,
        description="Hard ceiling on cumulative paused time per session "
        "(seconds). Bounds the wall-clock a session can be parked via repeated "
        "pauses. Default 30 min.",
    )
    MAX_DURATION_GRACE_SECONDS: float = Field(
        default=2.0,
        description="Seconds past the scenario time limit before the agent "
        "authoritatively ends the session (lets the client countdown reach "
        "zero first).",
    )
    PROSODY_GENERATION_TIMEOUT: float = Field(
        default=3.0,
        description=(
            "Upper limit in seconds for prosody / voice-expression LLM call in "
            "apply_voice_expressions. On timeout, the original text is used. "
            "Prosody is on the serial critical path before first audio, so this "
            "is kept tight (was 15s): a slow prosody call falls back to raw text "
            "quickly instead of blocking the turn. Measured by prosodyMs."
        ),
    )
    ORCHESTRATION_TIMEOUT: float = Field(
        default=20.0,
        description=(
            "Upper limit in seconds for event orchestration "
            "(orchestrator.orchestrate_events). On timeout, empty results are "
            "returned so generate_response still fires."
        ),
    )
    ORCHESTRATION_ASYNC_SQS: bool = Field(
        default=False,
        description=(
            "Latency lever: send detected events to Core (SQS) as a "
            "fire-and-forget background task instead of awaiting them inside "
            "process_events. The SQS round-trip is on the fan-in critical path "
            "before generate_response, but the spoken reply does not depend on "
            "it. Branching data, score commit and termination handling stay "
            "synchronous. Trade-off: backend event/score updates land a moment "
            "later and a send still in flight can be dropped on abrupt worker "
            "shutdown (termination events are unaffected — already deferred to "
            "the shutdown handler). Default False; flip in dev, then A/B in "
            "prod against orchestrationMs / responseLatencyMs."
        ),
    )

    # Perceived-latency lever: play a short thinking back-channel ("Mm-hmm.",
    # "Right...") the instant the user stops speaking, while the real reply is
    # still generating. Masks the voice-to-voice gap without changing the
    # measured response_latency_ms (the filler is excluded from that metric and
    # from the transcript). This is the GLOBAL kill-switch; the feature is also
    # gated per-scenario by prompt_data.filler_enabled (Studio toggle, default
    # off), so platform-wide it stays off until a scenario opts in. Set False to
    # disable everywhere regardless of scenario config.
    FILLER_GLOBALLY_ENABLED: bool = Field(
        default=True,
        description=(
            "Global kill-switch for the thinking-filler back-channel. When "
            "False, no filler plays even if a scenario sets fillerEnabled. "
            "Per-scenario opt-in is prompt_data.filler_enabled (default off)."
        ),
    )

    # ---- Predictive (LLM-generated) thinking-filler ----
    # A background job refreshes the filler phrases from the live conversation
    # every PREDICTIVE_FILLER_INTERVAL_SECONDS, so the agent prefers fresh,
    # context-aware fillers over the static Studio set. Subordinate to the
    # thinking-filler gate: it only runs when the filler is enabled for the
    # session (FILLER_GLOBALLY_ENABLED + prompt_data.filler_enabled). This flag
    # is the global kill-switch for the predictive layer specifically.
    PREDICTIVE_FILLER_ENABLED: bool = Field(
        default=True,
        description=(
            "Global kill-switch for LLM-generated predictive fillers. When "
            "False, the filler still plays but only from the static Studio set."
        ),
    )
    PREDICTIVE_FILLER_INTERVAL_SECONDS: float = Field(
        default=10.0,
        description="How often the background job regenerates predictive fillers.",
    )
    PREDICTIVE_FILLER_COUNT: int = Field(
        default=5,
        description="How many predictive filler phrases to generate per refresh.",
    )

    LLM_TEMPERATURE: str = Field(...)

    GOOGLE_APPLICATION_CREDENTIALS: Optional[str] = Field(
        default=None,
        description="Path to Google Cloud credentials JSON file (for Google TTS)",
    )

    DEFAULT_MALE_VOICE_MODEL: Optional[str] = Field(...)
    DEFAULT_FEMALE_VOICE_MODEL: Optional[str] = Field(...)
    DEFAULT_NON_BINARY_VOICE_MODEL: Optional[str] = Field(...)

    # Core service
    CORE_SERVICE_BASE_URL: str = Field(
        default="http://localhost:8000",
        description=(
            "Base URL of the core backend service "
            "(e.g., https://api.dev.helloally.ai)"
        ),
    )
    CORE_SERVICE_API_KEY: str = Field(
        default="dummy-key",
        description="API key sent as x-api-key header when calling the core service",
    )
    PROMPT_SERVICE_API_KEY: str = Field(
        default="dummy-key",
        description="Key used specifically for prompt synchronization and retrieval",
    )
    X_API_KEY: str = Field(
        default="dummy-key",
        description=(
            "API key for validating incoming requests to this service "
            "(callers must send this value in the x-api-key header)"
        ),
    )

    # CORS
    ALLOWED_ORIGINS: str = Field(
        default="*",
        description="Comma-separated list of allowed CORS origins",
    )

    # Multilingual settings
    MULTILINGUAL_METHOD: str = Field(
        default="none",
        description=(
            "Method to use: 'cotr', 'rag', 'prompt_engineering', "
            "'back_translation', 'none'"
        ),
    )
    EVALUATION_LOG_DIR: Optional[str] = Field(
        default="evaluation_logs",
        description="Directory to store evaluation logs",
    )
    EVALUATION_LOGGING_ENABLED: bool = Field(
        default=False,
        description=(
            "Enable conversation logging for evaluation "
            "(always logs if enabled, regardless of multilingual settings)"
        ),
    )
    LLM_USAGE_ENABLED: bool = Field(
        default=True,
        description=(
            "Emit per-turn LLM token-usage events to Core for the "
            "token-consumption (cost by model & task) dashboard."
        ),
    )

    # Event processing feature flags
    ENABLE_EVENT_DETECTION_OPTIMIZATIONS: bool = Field(
        default=True,
        description=(
            "Enable all event processing optimizations. "
            "When True: "
            "- Parallel processing: branching events sequential, "
            "non-branching events async "
            "- Input embedding cache: avoids duplicate API calls "
            "- Timeout handling: 10s timeout prevents blocking "
            "When False: all events processed sequentially, "
            "no cache, no timeout (old behavior)."
        ),
    )
    BEHAVIORS_OFF_GATE: bool = Field(
        default=False,
        description=(
            "Latency lever: run detect_behaviors in PARALLEL with the response "
            "instead of gating generate_response on it. Behaviors only drive "
            "scoring + UI feedback (not the reply text), so they join at "
            "send_event_feedback like event feedback already does — removing "
            "the ~1.3s behavior branch from the voice-to-voice critical path. "
            "Trade-off: the reply selects its main-agent state from a score "
            "that excludes THIS turn's behavior delta (events still count); "
            "cosmetic and the same race class already tolerated for RAG state. "
            "Behavior scores/feedback still accumulate every turn. Default "
            "False; flip in dev, confirm scoring + feedback unchanged, then A/B."
        ),
    )
    BATCH_EVENT_CLASSIFIERS: bool = Field(
        default=False,
        description=(
            "Latency lever: when 2+ BinaryClassifier events are eligible on a "
            "turn, classify the counselor message against all their classes in "
            "a SINGLE LLM call (one label per event_id) instead of one call per "
            "event. Collapses N round-trips on the process_events critical path "
            "into 1. Other event types keep their per-event path; any batch "
            "error/timeout falls back to per-event detection so behavior never "
            "regresses. Default False; flip in dev and A/B the detection rate "
            "against the per-event path before prod (one combined prompt can "
            "classify slightly differently than isolated prompts)."
        ),
    )
    EVENT_DETECTION_CONCURRENCY_LIMIT: int = Field(
        default=8,
        description=(
            "Maximum number of event or behavior detection coroutines to run "
            "concurrently. Prevents remote model and embedding requests from "
            "spiking tail latency under heavy scenarios."
        ),
    )
    KNOWLEDGE_RETRIEVAL_CACHE_SIZE: int = Field(
        default=256,
        description=(
            "Maximum number of recent knowledge retrieval results to cache in "
            "memory per worker process."
        ),
    )

    # Scenario report generation settings
    REPORT_CONCURRENCY_LIMIT: int = Field(
        default=3,
        description=(
            "Maximum number of scenario reports that can run concurrently. "
            "Prevents memory spikes from too many simultaneous long-running tasks. "
            "Requests beyond this limit will queue until a slot opens."
        ),
    )

    # Speech prosody skip thresholds (reduce latency when under pressure)
    # When skipped, TTS keeps last params instead of running prosody LLM call
    PROSDY_FORCE_SKIP: bool = Field(
        default=False,
        description=(
            "Latency kill-switch: when True, prosody is skipped unconditionally "
            "so the (streamed) generate_response reply goes straight to TTS "
            "instead of waiting on the prosody LLM call. Trades voice "
            "expressiveness for the lowest voice-to-voice latency. Default False "
            "(no change); flip to True in prod to A/B against the prosodyMs / "
            "responseLatencyMs metrics."
        ),
    )
    PROSDY_SKIP_ENABLED: bool = Field(
        default=True,
        description=(
            "Enable skip-when-under-pressure logic. "
            "When False, always run prosody (no skip)."
        ),
    )
    PROSDY_SKIP_MIN_RESPONSE_LENGTH: int = Field(
        default=50,
        description=(
            "Skip prosody when response is shorter than this (chars). "
            "Short responses have low prosody impact."
        ),
    )
    PROSDY_SKIP_MAX_RESPONSE_LENGTH: int = Field(
        default=0,
        description=(
            "Skip prosody when response is longer than this (chars). "
            "0 = disabled. Avoids compounding latency on long responses."
        ),
    )
    PROSDY_SKIP_WHEN_EVENTS_DETECTED: bool = Field(
        default=True,
        description=(
            "Skip prosody when events detected this turn. "
            "Prioritizes responsiveness over voice expression."
        ),
    )


settings = Settings()
