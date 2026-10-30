"""
Configuration settings for the application.
"""

from typing import Optional

from pydantic import AliasChoices, Field
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

    # Krisp BVC is a LiveKit Cloud feature; app/core/livekit/audio_filters.py
    # also checks the URL the room actually connects to. But a URL is never
    # enough on its own — our LiveKit is self-hosted behind a Cloud-shaped
    # hostname, so the media plane refuses the filter while every hostname
    # test says yes. That is why "audio filter cannot be enabled: LiveKit
    # Cloud is required" kept appearing in prd on 2026-08-26, a full day after
    # the gate was corrected to read the job's media URL: the URL was passing.
    # So this defaults OFF — we don't ask for a filter nobody will run. An
    # operator on a genuine Cloud project with BVC entitlement opts in with
    # LIVEKIT_NOISE_CANCELLATION_ENABLED=True (the URL still has to agree).
    LIVEKIT_NOISE_CANCELLATION_ENABLED: bool = Field(
        default=False,
        description=(
            "Opt in to requesting Krisp BVC noise cancellation. Off by "
            "default because our LiveKit deployment is self-hosted and its "
            "media servers reject the filter, whatever the hostname looks "
            "like; sessions simply run unfiltered. Set True only on a "
            "LiveKit Cloud project that actually has BVC entitlement — the "
            "per-session URL check still has to agree before we ask."
        ),
    )

    OPENAI_API_KEY: Optional[str] = Field(
        default=None,
        description="OpenAI API key. Optional — omit to fall back to Ollama "
        "(see OLLAMA_BASE_URL) for the conversation LLM.",
    )
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
        # Accept the common key names so a plain API key works without gcloud /
        # ADC: GOOGLE_API_KEY (native), GEMINI_API_KEY (used by ally-be/ally-ai),
        # and GOOGLE_GENERATIVE_AI_API_KEY (Vercel/LangChain convention). When
        # set, the Gemini client uses API-key auth (Generative Language API) and
        # does NOT require GOOGLE_APPLICATION_CREDENTIALS / a GCP project.
        validation_alias=AliasChoices(
            "GOOGLE_API_KEY",
            "GEMINI_API_KEY",
            "GOOGLE_GENERATIVE_AI_API_KEY",
        ),
        description=(
            "API key for Gemini LLM (API-key auth, no gcloud/ADC needed). "
            "Falls back to GOOGLE_APPLICATION_CREDENTIALS / ADC when unset."
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

    # ---- Sentence/Semantic Similarity event deprecation ----
    # Both event-detection types are being deprecated product-wide. Semantic
    # Similarity specifically makes a live per-turn OpenAI embeddings API call
    # on the process_events critical path (Sentence Similarity is pure local
    # string matching, no latency cost of its own) — these are the kill-switches
    # for STOPPING DETECTION on already-configured scenarios, independent of
    # whether new events of these types can still be created upstream. Default
    # True (no behavior change) until explicitly flipped per environment; a
    # scenario whose event gets skipped degrades the same way an unrecognized
    # detection type already does (logged, silently never fires) — see
    # factory.py's existing "unknown detection type" path.
    SEMANTIC_SIMILARITY_DETECTION_ENABLED: bool = Field(
        default=True,
        description=(
            "Global kill-switch for Semantic Similarity event detection. When "
            "False, these events are never constructed and never fire — "
            "removes their per-turn embeddings API call from process_events_ms."
        ),
    )
    SENTENCE_SIMILARITY_DETECTION_ENABLED: bool = Field(
        default=True,
        description=(
            "Global kill-switch for Sentence Similarity event detection. When "
            "False, these events are never constructed and never fire. Purely "
            "local string matching today (no latency cost), gated for product "
            "parity with SEMANTIC_SIMILARITY_DETECTION_ENABLED during the "
            "deprecation of both event types."
        ),
    )

    # Legacy provider (unfunded since 2026-10); only needed to read old rows.
    DEEPGRAM_API_KEY: Optional[str] = Field(default=None)

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

    # ---- ECS autoscaling signal (worker → CloudWatch) ----
    # The worker publishes its active-session count to CloudWatch so ECS
    # target-tracking can scale the learn-core task count on real demand. The
    # built-in CPU/Memory metrics are useless here (worker is I/O-bound, ~0.5%
    # CPU; memory is baseline-dominated), so this custom metric is the only
    # usable scaling signal. Best-effort and fully guarded — see
    # app/core/worker_metrics.py. Only emits when ENV == PROD (dev/local never
    # touch the prod scaling namespace).
    ECS_METRICS_ENABLED: bool = Field(
        default=True, description="Emit active-session metric to CloudWatch (PROD only)"
    )
    ECS_METRICS_NAMESPACE: str = Field(
        default="Ally/LearnCore", description="CloudWatch namespace for worker metrics"
    )
    ECS_METRICS_SERVICE: str = Field(
        default="ally-prd-svc-learn-core",
        description="Value of the CloudWatch `Service` dimension (the ECS service)",
    )
    ECS_METRICS_EMIT_INTERVAL_S: float = Field(
        default=60.0,
        description="Minimum seconds between CloudWatch emits (throttle; per task)",
    )

    ELEVEN_API_KEY: str = Field(...)
    SARVAM_API_KEY: str = Field(...)
    SARVAM_TTS_TIMEOUT: float = Field(
        default=30.0,
        description=(
            "Upper limit in seconds to wait for Sarvam TTS response before giving up"
        ),
    )
    TTS_TIMEOUT: float = Field(
        default=30.0,
        description=(
            "Upper limit in seconds to wait for TTS responses before giving up"
        ),
    )
    HUME_API_KEY: str = Field(...)
    CARTESIA_API_KEY: str = Field(...)
    SMALLEST_API_KEY: str = Field(...)

    # Stream the agent's reply token-by-token to TTS instead of waiting for the
    # full LLM response. The LiveKit LLMAdapter already streams (stream_mode=
    # "messages"); the only missing piece is enabling streaming on the chat
    # model. When True, TTS starts on the first tokens of generate_response —
    # the single biggest voice-to-voice latency lever. Default True: the streamed
    # tokens (including inline ElevenLabs v3 audio tags emitted by generate_response
    # itself) go straight to TTS. Set False to fall back to waiting for the full
    # reply.
    STREAM_RESPONSE: bool = Field(
        default=True,
        description=(
            "Enable token streaming of generate_response to TTS (sets "
            "streaming=True on the response chat model). Cuts time-to-first-audio "
            "from full-generation to first-token."
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

    # ---- Session stall watchdog (mid-session freeze detection) ----
    # Detects a wedged session (learner turn finalized but no agent response for
    # SESSION_STALL_THRESHOLD_S), dumps all thread stacks so the hang location is
    # captured, ends the session cleanly, and — if the loop is truly blocked —
    # force-exits the (per-job) process so the room frees. See
    # app/core/session_watchdog.py.
    SESSION_STALL_WATCHDOG_ENABLED: bool = Field(
        default=True, description="Enable the mid-session stall watchdog"
    )
    SESSION_STALL_THRESHOLD_S: float = Field(
        default=75.0,
        description=(
            "Seconds a finalized learner turn may go unanswered before the "
            "session is treated as wedged (well above normal turn latency)."
        ),
    )
    SESSION_STALL_POLL_S: float = Field(
        default=5.0, description="Watchdog poll interval (seconds)"
    )
    SESSION_STALL_FORCE_EXIT_GRACE_S: float = Field(
        default=30.0,
        description=(
            "After a stall is detected and a clean shutdown is requested, wait "
            "this long; if the session hasn't ended (event loop blocked), "
            "force-exit the job process."
        ),
    )
    SESSION_STALL_FORCE_EXIT_ENABLED: bool = Field(
        default=True,
        description="Allow the watchdog to force-exit a wedged job process as a "
        "last resort (kill-switch for the escalation).",
    )

    # ---- Worker health / LiveKit registration ----
    # The agents SDK stops retrying a lost LiveKit connection once max_retry is
    # exhausted and does NOT exit — leaving a resident worker registered with
    # nobody (19h in the 2026-08-09 incident, while four signals read green).
    # See app/core/worker_health.py.
    WORKER_HEALTH_MONITOR_ENABLED: bool = Field(
        default=True,
        description=(
            "Track LiveKit registration state in the worker process and write a "
            "heartbeat the API process's /api/health can read."
        ),
    )
    WORKER_HEALTH_EXIT_ON_CONNECTION_LOST: bool = Field(
        default=True,
        description=(
            "Exit the worker process when the agents SDK permanently gives up "
            "on LiveKit, so start.sh's `wait -n` tears the container down and "
            "the orchestrator replaces the task. Set False to keep the process "
            "up (/api/health still reports unhealthy)."
        ),
    )
    WORKER_HEALTH_FILE: str = Field(
        default="",
        description=(
            "Path of the worker heartbeat file shared between the worker and "
            "API processes. Empty means a file in the system temp dir."
        ),
    )
    WORKER_HEALTH_HEARTBEAT_S: float = Field(
        default=5.0, description="Worker heartbeat write interval (seconds)."
    )
    WORKER_HEALTH_STALE_AFTER_S: float = Field(
        default=45.0,
        description=(
            "How old the worker heartbeat may get before /api/health reports the "
            "worker unreachable. Well above the write interval so a loaded host "
            "cannot produce a false unhealthy."
        ),
    )
    WORKER_HEALTH_STARTUP_GRACE_S: float = Field(
        default=180.0,
        description=(
            "Grace after API-process start during which a missing worker "
            "heartbeat is reported as 'starting' rather than unhealthy. Must "
            "exceed worker boot (model load + registration) or every deploy "
            "crash-loops."
        ),
    )

    # ---- Opening statement ----
    OPENING_STATEMENT_PLAYOUT_TIMEOUT_S: float = Field(
        default=30.0,
        description=(
            "Upper bound on waiting for the scripted opening statement to finish "
            "playing. Unbounded, a stalled opener TTS parked session startup "
            "forever and the stall watchdog could not help (it only arms after a "
            "LEARNER turn). The timeout does NOT interrupt the speech — it only "
            "stops the worker waiting — so overshooting a long opener is free."
        ),
    )

    # ---- STT coherence guard (mis-transcription mitigation) ----
    # STT confidence is unusable for Indian languages, so a live guardrail that
    # asks the learner to repeat is the only mitigation. Without limits it can
    # loop forever; these bound it. See app/core/events/coherence_guard.py.
    STT_COHERENCE_ESCALATE_AFTER: int = Field(
        default=3,
        description=(
            "Consecutive coherence-guard hits before the persona escalates "
            "(acknowledges the difficulty and offers a way forward) instead of "
            "asking the learner to repeat again."
        ),
    )
    STT_COHERENCE_MIN_GAP_S: float = Field(
        default=8.0,
        description=(
            "Minimum seconds between two ordinary repeat requests, so one "
            "garbled stretch producing two STT finalizations cannot produce two "
            "identical requests back to back."
        ),
    )
    STT_COHERENCE_ESCALATION_COOLDOWN_S: float = Field(
        default=90.0,
        description=(
            "Seconds the coherence guard stays silent after escalating, so the "
            "conversation can continue on best-effort transcripts instead of "
            "deadlocking on the guard."
        ),
    )
    STT_COHERENCE_MAX_ESCALATIONS: int = Field(
        default=2,
        description=(
            "Escalations allowed per session before the coherence guard stops "
            "firing entirely. Past this the guard has demonstrably not helped "
            "and further interjections are nagging."
        ),
    )
    STT_COHERENCE_GUARD_DEFAULT_ENABLED: bool = Field(
        default=False,
        description=(
            "Synthesize a platform-default COHERENCE guardrail for scenarios "
            "that declare none, so mis-transcription has a mitigation "
            "everywhere rather than only where an author configured one. OFF by "
            "default because a guardrail is a reply-shaping event: it runs in "
            "process_gating_events, a hard barrier before generate_response, so "
            "this adds an LLM classification to the reply path of every "
            "session. Near-free for scenarios that already run gating "
            "classifiers (detection is parallel); a full extra round-trip per "
            "turn for scenarios with no events. Flip to true to enable "
            "platform-wide."
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
    # still generating. It counts as the turn's first audio for
    # response_latency_ms (it is what the learner hears first) and is emitted as
    # a transcript line; metadata.replyLatencyMs keeps the unmasked time to the
    # real reply. This is the GLOBAL kill-switch; the feature is also
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
    # Only consider a filler if the reply is still pending after a short delay —
    # fast replies leave no awkward gap, so they get no filler. The delay is
    # randomized per turn between MIN and MAX (ms) so it doesn't feel mechanical.
    FILLER_MIN_DELAY_MS: float = Field(
        default=300.0,
        description=(
            "Lower bound (ms) of the randomized wait after the learner stops "
            "before a filler may play; skipped entirely if the reply is ready "
            "first. Set MIN=MAX=0 to consider a filler immediately."
        ),
    )
    FILLER_MAX_DELAY_MS: float = Field(
        default=600.0,
        description=(
            "Upper bound (ms) of the randomized filler wait. A value is picked "
            "uniformly in [FILLER_MIN_DELAY_MS, FILLER_MAX_DELAY_MS] each turn."
        ),
    )
    # Even when there IS a pause, only play a filler this fraction of the time so
    # the agent doesn't fill on every slow turn (more natural). 1.0 = always when
    # there's a gap; 0.0 = never.
    FILLER_PLAY_PROBABILITY: float = Field(
        default=0.6,
        description=(
            "Probability (0-1) of playing a filler on a turn that has a real "
            "pause. Adds natural variation so fillers aren't used every time."
        ),
    )

    # ---- Predicted-gap playback (replaces the fixed wait) ----
    # The filler used to WAIT 300-600ms to find out whether a turn had a gap,
    # spending the very latency it exists to mask. Instead predict it: a session
    # EMA of (llm_ttft_ms + tts_ttfb_ms) from turns already recorded says how
    # long the reply will take, so the decision is immediate — fast turns get no
    # filler and no delay, slow turns get one at once. FILLER_MIN/MAX_DELAY_MS
    # above remain the fallback for when the predictor has no data yet.
    FILLER_GAP_PREDICTION_ENABLED: bool = Field(
        default=True,
        description=(
            "Decide filler playback from the predicted reply latency instead of "
            "waiting out FILLER_MIN/MAX_DELAY_MS. Set False to restore the wait."
        ),
    )
    FILLER_PREDICTED_GAP_MS: float = Field(
        default=700.0,
        description=(
            "Minimum predicted time-to-reply (ms) for a filler to be worth "
            "playing. Below this the turn is fast enough that a filler would "
            "sound inserted rather than natural."
        ),
    )
    FILLER_CERTAIN_GAP_MS: float = Field(
        default=1200.0,
        description=(
            "Predicted gap (ms) above which a filler ALWAYS plays. Between "
            "FILLER_PREDICTED_GAP_MS and this, FILLER_PLAY_PROBABILITY applies."
        ),
    )
    FILLER_GAP_PRIOR_MS: float = Field(
        default=2500.0,
        description=(
            "Assumed reply latency (ms) for the first turns of a session, before "
            "enough real turns exist to estimate from. Was 900, which read every "
            "session's first two turns as fast and left them unmasked; the real "
            "wait from thinking to reply audio is ~2.5-3 s on fixed-speaker "
            "voices (prod p50 3.1 s, v2v 2.5-2.8 s)."
        ),
    )
    GAP_PRIOR_GENERATIVE_MS: float = Field(
        default=4000.0,
        description=(
            "The same prior for ElevenLabs v3 voices, whose first audio byte "
            "alone is ~1.8 s: v2v measured a 3.9-4.4 s wait from thinking."
        ),
    )
    FILLER_MAX_CONSECUTIVE_TURNS: int = Field(
        default=3,
        description=(
            "Cap on filler turns in a row. A character who hesitates before every "
            "single reply reads as broken, however slow the turns are."
        ),
    )
    # Aim the clip to END about when the reply starts: choose from the duration
    # tier nearest (predicted_gap - this margin). Overshooting means the reply
    # cuts the filler off mid-word, so the margin errs short.
    FILLER_TIER_MARGIN_MS: float = Field(
        default=150.0,
        description=(
            "Subtracted from the predicted gap when picking a clip's duration "
            "tier, so the filler finishes just before the real reply begins."
        ),
    )
    # A filler that ends into silence is worse than no filler: play one more, of
    # a DIFFERENT type, if nothing else has started by then. Bounded at two per
    # turn — a third reads as stalling rather than thinking.
    FILLER_CONTINUATION_ENABLED: bool = Field(
        default=False,
        description=(
            "Play a second, different-type filler when the first ends and "
            "neither the interim reply nor the real reply has started."
        ),
    )
    FILLER_CONTINUATION_GAP_MS: float = Field(
        default=450.0,
        description=(
            "Silence (ms) after a filler ends before a continuation filler "
            "plays. Roughly a natural intra-turn pause."
        ),
    )
    FILLER_MAX_PER_TURN: int = Field(
        default=1,
        description=(
            "Hard cap on fillers played within a single turn. One: two fillers "
            "back to back read as stalling (67% of prod filler turns stacked two "
            "before this default changed)."
        ),
    )

    # ---- Filler pool, cache and generation cadence ----
    FILLER_POOL_MAX_CLIPS: int = Field(
        default=40,
        description=(
            "Clips kept in the per-session pool. Accumulating rather than "
            "replacing is what keeps a long session from cycling through five "
            "phrases; the least recently played are evicted first."
        ),
    )
    FILLER_REPEAT_WINDOW_PLAYS: int = Field(
        default=12,
        description=(
            "A phrase played within this many FILLER PLAYS is not reused while "
            "any alternative exists. Counted in plays, not turns, because a turn "
            "can play two (the continuation) — so this covers ~6 turns."
        ),
    )
    FILLER_CLIP_CACHE_MAX: int = Field(
        default=200,
        description=(
            "Rendered clips held in the worker-wide audio cache (~96KB each). "
            "Fillers repeat heavily, so this removes most TTS calls once warm."
        ),
    )
    FILLER_RENDER_VARIANTS: bool = Field(
        default=True,
        description=(
            "Render a second take of a phrase before repeating it, so the same "
            "waveform never plays twice in a session."
        ),
    )
    FILLER_SEED_ON_START: bool = Field(
        default=True,
        description=(
            "Generate a filler batch from the character at session start, so "
            "fillers exist before the learner's first turn."
        ),
    )
    FILLER_REGEN_MIN_GAP_S: float = Field(
        default=8.0,
        description=("Minimum seconds between exchange-driven filler regenerations."),
    )
    FILLER_REGEN_MIN_FRESH: int = Field(
        default=5,
        description=(
            "Skip regeneration while at least this many pool clips are still "
            "unplayed inside the repeat window — most short sessions never "
            "need a second call."
        ),
    )
    # Generating five two-word phrases does not need the roleplay model. A small
    # dedicated model is ~10-20x cheaper per call and reaches first token sooner,
    # so the batch is ready earlier too. Empty provider = use the scenario's own
    # model (the prior behaviour).
    PREDICTIVE_FILLER_MODEL_PROVIDER: str = Field(
        default="openai",
        description=(
            "Provider for the dedicated small model that generates fillers. "
            "Empty string falls back to the scenario's main LLM."
        ),
    )
    PREDICTIVE_FILLER_MODEL: str = Field(
        default="gpt-4o-mini",
        description="Model id for the dedicated filler-generation model.",
    )
    # In-turn generation: the only path that can see what the learner is saying
    # NOW. A timer-driven batch necessarily predates the turn it answers.
    FILLER_IN_TURN_ENABLED: bool = Field(
        default=True,
        description=(
            "Generate fillers from the learner's partial transcript while they "
            "are still speaking, so the played filler fits the current turn."
        ),
    )
    FILLER_IN_TURN_TRIGGER_MS: float = Field(
        default=2000.0,
        description=(
            "How long (ms) the learner must have been speaking before in-turn "
            "filler generation fires."
        ),
    )
    FILLER_IN_TURN_MIN_WORDS: int = Field(
        default=4,
        description=(
            "Minimum words in the partial transcript before in-turn generation "
            "fires — guards against firing on garbage STT."
        ),
    )
    FILLER_IN_TURN_COUNT: int = Field(
        default=3,
        description="How many fillers the in-turn call asks for.",
    )
    FILLER_IN_TURN_TIMEOUT_MS: float = Field(
        default=2500.0,
        description=(
            "Timeout (ms) for in-turn generation. On timeout the turn simply "
            "uses the existing pool."
        ),
    )

    # ---- Early trigger (experimental) ----
    # The largest gap the filler does NOT cover is the endpointing delay itself
    # (0.5-3.0s between VAD end-of-speech and "thinking"). Starting there would
    # mask it — but talking during a mid-thought pause can read as interrupting,
    # so this is off by default and needs an A/B before it goes further.
    FILLER_EARLY_TRIGGER_ENABLED: bool = Field(
        default=False,
        description=(
            "EXPERIMENTAL. Start a very short filler at VAD end-of-speech, "
            "before endpointing completes, instead of at the agent's thinking "
            "state. Cancelled if the learner resumes. Off by default."
        ),
    )
    FILLER_EARLY_TRIGGER_DELAY_MS: float = Field(
        default=250.0,
        description=(
            "Wait (ms) after the learner stops before an early-trigger filler "
            "plays, so a brief mid-sentence pause doesn't get talked over."
        ),
    )

    # ---- Delivery plan: how the character STARTS each reply ----
    # Replaces the generated-filler path (seed / exchange / in-turn batches and
    # the continuation filler) with a plan proposed by client working memory
    # that PICKS from a fixed opener catalog and writes the interim, played
    # under deterministic turn-time rules. Scenarios without working memory
    # get fillers and pauses, plus the interim generator's line when enabled.
    # See app/core/livekit/delivery.py and opener_policy.py. False restores the
    # previous filler path (rollback lever; it plays no interim).
    DELIVERY_PLAN_ENABLED: bool = Field(
        default=True,
        description=(
            "Drive turn openers from the delivery plan + opener catalog instead "
            "of LLM-generated fillers. False restores the legacy filler path."
        ),
    )
    CLIP_SYNTH_CONCURRENCY: int = Field(
        default=3,
        description=(
            "Most clip syntheses in flight at once. Unbounded, a 24-entry opener "
            "catalog drew ElevenLabs 429 bursts at session start."
        ),
    )
    # Persistent clip store (app/core/livekit/clip_store.py): rendered clips in
    # S3, shared by every session and worker, plus the curated takes written by
    # scripts/pregenerate_voice_clips.py. Off when the bucket is empty.
    CLIP_STORE_BUCKET: str = Field(
        default="",
        description="S3 bucket for rendered clips; empty disables the store.",
    )
    CLIP_STORE_PREFIX: str = Field(
        default="voice-clips/v1",
        description="Key prefix inside CLIP_STORE_BUCKET.",
    )
    CLIP_STORE_TIMEOUT_MS: float = Field(
        default=1500.0,
        description=(
            "Per-request S3 timeout. A whole load is bounded at twice this, "
            "after which the session renders what is missing."
        ),
    )
    OPENER_HOLD_MIN_MS: float = Field(
        default=300.0,
        description=(
            "Lower bound of the randomised silence before an opener. Doubles as "
            "a confirmation window: learner speech inside it cancels the opener."
        ),
    )
    OPENER_HOLD_MAX_MS: float = Field(
        default=600.0, description="Upper bound of the randomised pre-opener hold."
    )
    OPENER_LONG_HOLD_MIN_MS: float = Field(
        default=1200.0,
        description=(
            "Hold lower bound when the plan says a pause fits the moment: a real "
            "pause, not a beat. Was 600-1000, and a 'pause' plan still played a "
            "sound 16 of 16 times in prod."
        ),
    )
    OPENER_LONG_HOLD_MAX_MS: float = Field(
        default=2000.0,
        description=(
            "Hold upper bound when the plan says a pause fits. Learners talked "
            "over 41% of replies after 3-4 s of silence, so it stays under 2 s."
        ),
    )
    OPENER_PIECE_GAP_MS: float = Field(
        default=350.0,
        description=(
            "Silence before the first interim piece that follows a sound. Each "
            "later gap is OPENER_PIECE_GAP_GROWTH times the one before, the way "
            "someone thinking aloud slows down."
        ),
    )
    OPENER_PIECE_GAP_GROWTH: float = Field(
        default=1.4, description="How much longer each gap between interim pieces is."
    )
    OPENER_TAIL_MS: float = Field(
        default=500.0,
        description=(
            "Silence left between the last filler or interim piece and the "
            "predicted reply, so the answer doesn't land glued to them."
        ),
    )
    OPENER_MAX_INTERIM_PIECES: int = Field(
        default=3, description="Most interim pieces played before one reply."
    )
    OPENER_MAX_SPEECH_SHARE: float = Field(
        default=0.7,
        description=(
            "Filler plus interim never fill more than this share of the predicted "
            "wait, so some silence always remains."
        ),
    )
    OPENER_PAUSE_ONLY_MAX_GAP_MS: float = Field(
        default=2000.0,
        description=(
            "Scenarios without working memory: below this predicted wait a pause "
            "alone may stand in for the filler."
        ),
    )
    OPENER_BODY_MIN_GAP_TURNS: int = Field(
        default=4,
        description=(
            "A breath or sigh opener plays at most once in this many turns; a "
            "planner that keeps asking for one falls back to a spoken opener."
        ),
    )
    OPENER_REPEAT_WINDOW: int = Field(
        default=4,
        description="Recent openers whose sound family may not be reused.",
    )
    # Deterministic caps on the reply stream (app/core/livekit/reply_shaping.py).
    AUDIO_TAG_MAX_PER_REPLY: int = Field(
        default=1,
        description=(
            "Most inline ElevenLabs v3 audio tags kept per reply; extras are "
            "dropped from the stream. Negative disables the cap."
        ),
    )
    REPLY_TRIM_LEADING_HESITATION: bool = Field(
        default=True,
        description=(
            "When an opener already played this turn, drop a leading hesitation "
            "word or pause tag from the reply stream."
        ),
    )

    # ---- Comfort audio (ambient room tone) ----
    # Perceived-latency lever: play a faint, constant room tone on the shared
    # background-audio track for the whole session, so the dead-silent gap before
    # a reply never sounds "muted"/"disconnected" (telephony comfort noise). Like
    # the filler this does NOT change the measured response_latency_ms — it only
    # masks the perceived gap. This GLOBAL flag (default on) is a kill-switch
    # that GATES the per-simulation setting (PromptData.comfort_audio_enabled,
    # Studio: comfortAudioEnabled): both must be on for the tone to play. Set
    # this False to force it off everywhere regardless of the per-sim toggle.
    COMFORT_AUDIO_ENABLED: bool = Field(
        default=True,
        description=(
            "Global kill-switch for the comfort-audio room tone. Default True: "
            "the tone plays for a session only when this is on AND that "
            "simulation's comfortAudioEnabled resolves true. Set False to "
            "disable everywhere regardless of the per-sim toggle."
        ),
    )
    COMFORT_AUDIO_DEFAULT_ON: bool = Field(
        default=True,
        description=(
            "What comfortAudioEnabled means when a simulation's metadata does "
            "not carry the key AT ALL. Default True: dead silence between turns "
            "reads to users as 'muted'/'disconnected', which is a poor default "
            "for something they experience as a dropped call. An explicit false "
            "in the metadata is always respected, so no existing scenario "
            "changes behaviour. NOTE: inert in production today — ally-be "
            "migration 1798000000000-DisableComfortAudio stamped an explicit "
            "false into every scenario's metadata and Studio re-stamps it on "
            "every save, so the key is never absent. Making comfort audio "
            "genuinely on-by-default needs the ally-be/ally-web half too."
        ),
    )
    COMFORT_AUDIO_VOLUME: float = Field(
        default=0.15,
        description=(
            "Fallback playback volume (0-1) of the comfort-audio room tone, used "
            "when a simulation does not set its own comfort_audio_volume. Kept low "
            "so the synthesized tone sits under speech as barely-there 'air'."
        ),
    )
    COMFORT_AUDIO_FETCH_TIMEOUT_S: float = Field(
        default=4.0,
        description=(
            "Max seconds to fetch + decode a per-simulation uploaded comfort-audio "
            "track before falling back to the synthesized room tone. Bounds the "
            "session-start critical path so a slow/broken URL can't delay the "
            "opening statement."
        ),
    )
    COMFORT_AUDIO_MAX_BYTES: int = Field(
        default=20 * 1024 * 1024,
        description=(
            "Max size (bytes) of an uploaded comfort-audio track the worker will "
            "download + decode. Larger responses are rejected and fall back to the "
            "synthesized tone (memory-budget guard)."
        ),
    )

    # ---- AI video actor (EXPERIMENTAL, off for every roleplay) ----
    # Publishes a synchronized video track alongside the character's voice, so
    # the learner sees a face rather than a static call card. Same shape as
    # comfort audio above — this GLOBAL kill-switch AND the per-roleplay
    # videoActorEnabled must both be on — plus a third gate in ally-be
    # (the `video_actor` admin toggle) deciding which platform admins can even
    # see the per-roleplay switch in Studio.
    #
    # This one defaults ON and the other two default OFF. That is deliberate:
    # the kill-switch's job is to be the thing an operator flips to stop video
    # everywhere in one restart, and it can only do that job if the interesting
    # decision lives in the per-roleplay flag. No roleplay sets that flag, so
    # every session today is byte-for-byte audio-only.
    # Full contract: app/core/livekit/video_actor.py.
    VIDEO_ACTOR_ENABLED: bool = Field(
        default=True,
        description=(
            "Global kill-switch for the AI video actor. Default True — but the "
            "feature is still off everywhere, because the two gates BELOW it "
            "are what actually turn video on and both default off: a roleplay's "
            "own videoActorEnabled (false for every roleplay), and the "
            "video_actor admin toggle that decides who can even see that switch "
            "in Studio (granted to nobody). On means 'the platform permits "
            "video where a roleplay asks for it', not 'video is on'. Set False "
            "to kill it everywhere in one restart without touching a roleplay."
        ),
    )
    VIDEO_ACTOR_PROVIDER: str = Field(
        default="tavus",
        description=(
            "Which renderer serves the video actor. Defaults to 'tavus', the "
            "vendor this platform is wired for: real AI-generated video, needing "
            "VIDEO_ACTOR_API_KEY (or TAVUS_API_KEY) and a replica id. Missing "
            "either, the session falls back to audio-only — which is the point "
            "of defaulting here rather than to the placeholder: a "
            "misconfiguration should cost a learner nothing, not render them a "
            "coloured blob. 'test_pattern' is that placeholder, kept as an "
            "explicit opt-in for exercising the publish path with no vendor "
            "account; it is NOT AI-generated video and must never be pointed at "
            "a real cohort. 'bey', 'anam' and 'simli' work through the same "
            "abstraction but their plugins are not installed."
        ),
    )
    VIDEO_ACTOR_MUTE_VOICE_LAYERS: bool = Field(
        default=True,
        description=(
            "Once the character has a face, keep its VOICE on that face. The "
            "thinking filler, the back-channel and the interim reply all play "
            "on the BackgroundAudioPlayer's own published track, which never "
            "reaches the avatar renderer — so with video on, the learner hears "
            "the character speak while watching a motionless mouth. That is "
            "the one contradiction video cannot absorb: it breaks the very "
            "audio-visual agreement the feature exists to create, and it reads "
            "to a learner as the session being broken rather than as a "
            "naturalness lever. The layers are also less needed here — a "
            "present, visibly listening face already covers a pause, which is "
            "the whole job of a filler. The comfort room tone is NOT affected: "
            "ambient sound has no mouth to disagree with. Applies only while "
            "the avatar is actually carrying the speech, so the layers work "
            "normally for the first 5-12s of a deferred session, when the "
            "character genuinely has no face yet. False keeps every layer "
            "playing regardless."
        ),
    )
    VIDEO_ACTOR_DEFER_ATTACH: bool = Field(
        default=True,
        description=(
            "Bring the avatar up AFTER the session starts talking, instead of "
            "in front of it. A hosted vendor takes 5-12s to render, and in the "
            "blocking order every second of that is a second before the "
            "character says its first word — so the session starts audio-only "
            "and the speech moves onto the avatar once its video is verified "
            "live, the way a video call lets you join with the camera off. It "
            "also removes a failure mode rather than mitigating it: the agent's "
            "audio is never suppressed on the strength of a vendor promise, so "
            "a vendor that accepts the job and renders nothing costs a faceless "
            "session instead of a silent one. Set False to restore the blocking "
            "order in one restart. Does not apply to test_pattern, which "
            "renders in-process in milliseconds."
        ),
    )
    VIDEO_ACTOR_ATTACH_PUBLISH_TIMEOUT_S: float = Field(
        default=30.0,
        description=(
            "Max seconds a DEFERRED attach waits for a hosted avatar to publish "
            "video before giving up and leaving the session faceless. Far more "
            "generous than VIDEO_ACTOR_PUBLISH_TIMEOUT_S because nobody is "
            "waiting on it: the learner is mid-conversation and hearing the "
            "character throughout, so the only cost of a long wait is a face "
            "that arrives late. Only the blocking path needs a tight budget."
        ),
    )
    VIDEO_ACTOR_START_TIMEOUT_S: float = Field(
        default=6.0,
        description=(
            "Max seconds to get the video actor live before giving up and running "
            "the session audio-only. Applies to the BLOCKING path only "
            "(VIDEO_ACTOR_DEFER_ATTACH=false, and test_pattern), where it is the "
            "feature's latency guard: avatar start sits in front of "
            "session.start, so an unbounded wait would delay the opening "
            "statement — the one thing sim-start latency work exists to "
            "protect. A hosted vendor that misses this budget costs a warning "
            "line, not a slow session."
        ),
    )
    VIDEO_ACTOR_PUBLISH_TIMEOUT_S: float = Field(
        default=8.0,
        description=(
            "Max seconds to wait for a hosted avatar to actually PUBLISH video "
            "after its start() returned, before giving up on it and running the "
            "session audio-only. Applies to the BLOCKING path only; the deferred "
            "one uses VIDEO_ACTOR_ATTACH_PUBLISH_TIMEOUT_S. A vendor accepting "
            "the job is not a promise it "
            "renders: observed live with Tavus — conversation active, avatar "
            "joined, zero tracks published — and because the agent's speech has "
            "by then been routed to that avatar, an unverified start leaves the "
            "learner with silence AND no picture, which is worse than never "
            "enabling the feature. Counts on top of VIDEO_ACTOR_START_TIMEOUT_S, "
            "so the worst case a learner waits before the character speaks is "
            "roughly the sum of the two; keep both tight, because that wait is "
            "the feature's real cost."
        ),
    )
    VIDEO_ACTOR_WIDTH: int = Field(
        default=480,
        description=(
            "Video actor frame width in pixels. Kept small deliberately: the "
            "learner sees it in a call card, not full-screen, and every extra "
            "pixel is egress on a self-hosted SFU."
        ),
    )
    VIDEO_ACTOR_HEIGHT: int = Field(
        default=480,
        description="Video actor frame height in pixels. See VIDEO_ACTOR_WIDTH.",
    )
    VIDEO_ACTOR_FPS: float = Field(
        default=15.0,
        description=(
            "Video actor frame rate. 15 is enough for a talking head and roughly "
            "halves the bitrate of 30."
        ),
    )
    VIDEO_ACTOR_SAMPLE_RATE: int = Field(
        default=24000,
        description=(
            "Sample rate (Hz) of the audio the video actor republishes in sync "
            "with its video. Only used by the in-process 'test_pattern' renderer; "
            "hosted providers negotiate their own."
        ),
    )
    VIDEO_ACTOR_AVATAR_ID: Optional[str] = Field(
        default=None,
        description=(
            "Deployment-wide fallback avatar id for hosted providers, used when a "
            "roleplay does not name its own videoActorAvatarId. Ignored by "
            "'test_pattern'. A hosted provider with neither runs audio-only."
        ),
    )
    VIDEO_ACTOR_API_KEY: Optional[str] = Field(
        default=None,
        description=(
            "Vendor API key for the hosted video-actor provider. Left unset, the "
            "plugin falls back to whatever env var it reads itself "
            "(TAVUS_API_KEY for Tavus)."
        ),
    )
    VIDEO_ACTOR_BEY_API_KEY: Optional[str] = Field(
        default=None,
        description=(
            "Beyond Presence API key. Takes precedence over VIDEO_ACTOR_API_KEY "
            "when the session's provider is 'bey'. Exists because a roleplay now "
            "picks its own vendor, so one deployment can need both vendors' keys "
            "live at once — the single VIDEO_ACTOR_API_KEY could only ever serve "
            "one. Left unset, VIDEO_ACTOR_API_KEY is used, which is what keeps a "
            "single-vendor deployment working untouched."
        ),
    )
    VIDEO_ACTOR_TAVUS_API_KEY: Optional[str] = Field(
        default=None,
        description=(
            "Tavus API key. Same contract as VIDEO_ACTOR_BEY_API_KEY above, for "
            "provider 'tavus'."
        ),
    )
    VIDEO_ACTOR_TAVUS_PERSONA_ID: Optional[str] = Field(
        default=None,
        description=(
            "Optional Tavus persona id. Normally leave this UNSET. Tavus falls "
            "back to a stock persona, which is what we want: the character's "
            "personality comes from our own prompt and LLM, and a vendor "
            "persona would put a second, unversioned character definition in "
            "the loop where nobody would think to look for it. Tavus's other "
            "id, the replica (which face to render), comes from the roleplay's "
            "videoActorAvatarId or VIDEO_ACTOR_AVATAR_ID."
        ),
    )

    # ---- Live supervisor notes (in-session coaching hints) ----
    # A second, cheap LLM reads each committed learner turn alongside the actor
    # and occasionally sends the learner a one-line coaching hint, which the
    # client shows in a "Supervisor" tab in the session sidebar. Same persona as
    # the post-session debrief. Entirely off the voice critical path: the call is
    # a tracked fire-and-forget task with a hard timeout, so a slow or failing
    # supervisor can only MISS a note, never delay a reply. This GLOBAL flag
    # (default on) is a kill-switch GATING a per-simulation opt-in
    # (PromptData.supervisor_notes_enabled, Studio: supervisorNotesEnabled,
    # default off): both must be on, so live notes are off for every scenario
    # until an author turns them on.
    SUPERVISOR_NOTES_ENABLED: bool = Field(
        default=True,
        description=(
            "Global kill-switch for live supervisor notes. Default True: notes "
            "are generated for a session only when this is on AND that "
            "simulation has supervisorNotesEnabled set (per-sim opt-in, default "
            "off). Set False to disable everywhere regardless of the per-sim "
            "toggle."
        ),
    )
    SUPERVISOR_NOTES_PROVIDER: str = Field(
        default="openai",
        description=(
            "Inference provider for the live-supervisor LLM. Deliberately "
            "separate from the actor's provider: this runs once per learner turn "
            "in parallel with the conversation, so it is sized for cost and "
            "speed rather than persona quality."
        ),
    )
    SUPERVISOR_NOTES_MODEL: str = Field(
        default="gpt-4o-mini",
        description=(
            "Model for the live-supervisor LLM. Should be a fast, cheap model — "
            "it decides on most turns that no note is warranted, so the common "
            "case must be near-free."
        ),
    )
    SUPERVISOR_NOTES_TIMEOUT_S: float = Field(
        default=6.0,
        description=(
            "Max seconds to wait for one live supervisor note before giving up "
            "on that turn. A timeout is a silently skipped note, never a delayed "
            "reply — the learner's conversation is never blocked on this."
        ),
    )
    SUPERVISOR_NOTES_MAX_PER_SESSION: int = Field(
        default=10,
        description=(
            "Hard cap on live notes per session, enforced in code rather than "
            "left to the prompt. The learner is mid-conversation and can only "
            "read so much: past roughly ten hints the tab becomes noise that "
            "competes with the roleplay for their attention."
        ),
    )
    SUPERVISOR_NOTES_MIN_TURN_GAP: int = Field(
        default=2,
        description=(
            "Minimum learner turns between two live notes. Stops the supervisor "
            "from commenting on consecutive turns, which reads as nagging and "
            "leaves the learner no room to act on the previous hint."
        ),
    )

    # ---- Continuous back-channeling (listener affirmations) ----
    # Naturalness lever: while the LEARNER is still speaking on a long turn, emit
    # brief listener affirmations ("mm-hmm", a soft "yeah") on the background
    # track — the human "I'm listening, go on" signal, distinct from the
    # post-turn thinking-filler. Driven off the user-speaking state and kept
    # sparse (long-utterance gate + randomized gap + probability) so it never
    # interrupts. Language-correct phrases are LLM-generated once at session
    # start from the editable filler/backchannel prompt. GLOBAL flag (default on)
    # with an off switch; no per-scenario opt-in (a baseline listening signal).
    BACKCHANNEL_GLOBALLY_ENABLED: bool = Field(
        default=True,
        description=(
            "Global kill-switch for continuous back-channeling during the "
            "learner's turn. When True (default) brief 'mm-hmm'-style "
            "affirmations play sparsely on the background track while the "
            "learner speaks. Set False to disable everywhere."
        ),
    )
    BACKCHANNEL_COUNT: int = Field(
        default=6,
        description=(
            "How many short back-channel phrases to generate at session start "
            "(the loop picks among them, avoiding back-to-back repeats)."
        ),
    )
    # Long-utterance gate: only back-channel once the learner has held the floor
    # this long. Short turns get nothing (a 'mm-hmm' over a one-liner is noise).
    BACKCHANNEL_MIN_UTTERANCE_MS: float = Field(
        default=4000.0,
        description=(
            "How long (ms) the learner must speak continuously before any "
            "back-channel may play. If they stop first, none plays."
        ),
    )
    # Spacing between consecutive back-channels, randomized per emission so the
    # rhythm doesn't feel mechanical. Kept wide to stay sparse.
    BACKCHANNEL_MIN_GAP_MS: float = Field(
        default=3500.0,
        description=(
            "Lower bound (ms) of the randomized wait between back-channels while "
            "the learner keeps speaking."
        ),
    )
    BACKCHANNEL_MAX_GAP_MS: float = Field(
        default=7000.0,
        description=(
            "Upper bound (ms) of the randomized back-channel gap. A value is "
            "picked uniformly in [BACKCHANNEL_MIN_GAP_MS, BACKCHANNEL_MAX_GAP_MS]."
        ),
    )
    # Even when a back-channel is due, only emit this fraction of the time so the
    # signal stays sparse and natural. 1.0 = every gap; 0.0 = never.
    BACKCHANNEL_PLAY_PROBABILITY: float = Field(
        default=0.5,
        description=(
            "Probability (0-1) of emitting a back-channel when one is due. "
            "Lower keeps it sparser so it never feels like an interruption."
        ),
    )
    BACKCHANNEL_VOLUME: float = Field(
        default=0.6,
        description=(
            "Playback volume (0-1) of back-channel affirmations. Kept below full "
            "so they sit softly under the learner's voice as a listening signal."
        ),
    )

    # ---- Interim generator (scenarios WITHOUT working memory) ----
    # While the learner is STILL speaking on a long turn, snapshot the partial
    # transcript and ask a FAST dedicated model for one short, NON-COMMITTAL
    # holding line, rendered ahead and handed to the OpenerPlayer, which plays
    # it as the turn's interim under the same timing rules as a working-memory
    # interim and tells the reply its words. Working-memory scenarios never run
    # it: the updater writes their interim. Recorded as a CLIENT transcript
    # line. This GLOBAL flag GATES a per-simulation opt-in
    # (PromptData.interim_reply_enabled, Studio: interimReplyEnabled, default
    # off): both must be on. See app/core/livekit/interim_reply.py.
    INTERIM_REPLY_GLOBALLY_ENABLED: bool = Field(
        default=False,
        description=(
            "Global kill-switch for the predictive interim reply. Default False "
            "(opt-in platform-wide). The interim plays for a session only when "
            "this is on AND that simulation has interimReplyEnabled set (per-sim "
            "opt-in, default off)."
        ),
    )
    INTERIM_REPLY_TRIGGER_MS: float = Field(
        default=6000.0,
        description=(
            "How long (ms) the learner must speak continuously before the interim "
            "reply is armed and generation kicks off from the partial transcript. "
            "Inside the 5-10s window so the clip is ready before the turn ends."
        ),
    )
    INTERIM_REPLY_MIN_WORDS: int = Field(
        default=8,
        description=(
            "Minimum word count in the partial transcript before arming. Guards "
            "against firing on a long pause with one word or garbage STT."
        ),
    )
    INTERIM_REPLY_LLM_TIMEOUT_MS: float = Field(
        default=3000.0,
        description=(
            "Timeout (ms) for the fast-model interim-text generation. On timeout "
            "the interim is skipped for the turn (graceful degrade). Was 1500, "
            "which Hindi output exceeded in v2v; generation starts while the "
            "learner is still speaking, so the longer limit adds no latency."
        ),
    )
    INTERIM_REPLY_TTS_TIMEOUT_MS: float = Field(
        default=2500.0,
        description=(
            "Timeout (ms) for synthesizing the interim reply to audio. On timeout "
            "the interim is skipped for the turn."
        ),
    )
    ELEVENLABS_V4_GAIN_DB: float = Field(
        default=8.0,
        description=(
            "Fixed boost applied to ElevenLabs v4-family output (eleven_v4, "
            "eleven_v4_turbo). Measured 2026-10-14: v4 renders 6.6-10.4 dB "
            "quieter than v3 for the same voice (speech RMS -24..-28 dBFS vs "
            "-14..-19) and the API has no loudness control. A peak limiter "
            "keeps the boost from clipping. 0 disables."
        ),
    )
    INTERIM_REPLY_TTS_TIMEOUT_GENERATIVE_MS: float = Field(
        default=6000.0,
        description=(
            "The same timeout for ElevenLabs v3 voices, which take ~3-4 s to "
            "render a whole interim sentence: at 2500 every v3 interim timed "
            "out in v2v. Generation starts while the learner is still talking, "
            "so the longer limit adds no latency; the real reply still cuts it."
        ),
    )
    INTERIM_REPLY_HISTORY_TURNS: int = Field(
        default=4,
        description=(
            "How many recent conversation turns to include in the interim-reply "
            "prompt. Kept small so the fast model stays fast."
        ),
    )
    INTERIM_REPLY_MODEL_PROVIDER: str = Field(
        default="openai",
        description=(
            "Provider for the DEDICATED fast model that generates the interim "
            "reply (separate from the scenario's main LLM). One of the supported "
            "LLM providers (openai/ollama/vllm/gemini)."
        ),
    )
    INTERIM_REPLY_MODEL: str = Field(
        default="gpt-4o-mini",
        description=(
            "Model id for the dedicated fast interim-reply model. Should be "
            "faster/cheaper than the scenario's main reply model."
        ),
    )

    # ---- Semantic turn detection (end-of-utterance model) ----
    # Latency lever for the FRONT of the turn (eou_delay_ms): instead of a fixed
    # VAD silence timeout, the LiveKit multilingual EOU model reads the running
    # transcript and modulates the endpointing delay between MIN and MAX —
    # collapsing toward MIN when the utterance looks grammatically complete (fast
    # reply) and extending toward MAX when the learner is likely mid-thought
    # (fewer barge-ins). The model still rides ON TOP of VAD (never replaces it).
    # IMPORTANT — language coverage: the multilingual model only supports a fixed
    # set (of ours: English and Hindi). For any other language (Tamil, Telugu,
    # etc.) LiveKit transparently falls back to the plain VAD endpointing, i.e.
    # exactly the prior behaviour — no regression, no benefit. This GLOBAL flag is
    # the kill-switch; set False to force the plain VAD timeout everywhere.
    SEMANTIC_TURN_DETECTION_ENABLED: bool = Field(
        default=True,
        description=(
            "Global kill-switch for semantic (EOU-model) turn detection. When "
            "False, the session uses the plain VAD silence timeout (prior "
            "behaviour). Unsupported languages fall back to VAD regardless."
        ),
    )
    TURN_MIN_ENDPOINTING_DELAY: float = Field(
        default=0.5,
        description=(
            "Minimum endpointing delay (s) — the fast path used when the EOU "
            "model is confident the learner finished. LiveKit default 0.5. "
            "Fallback-of-last-resort: ally-be always sends its global "
            "admin-configured value via room metadata (prompt_data."
            "turn_min_endpointing_delay); this default is only used if that "
            "value is missing or fails validation."
        ),
    )
    TURN_MAX_ENDPOINTING_DELAY: float = Field(
        default=3.0,
        description=(
            "Maximum endpointing delay (s) — the ceiling the agent waits when the "
            "learner is likely mid-thought. LiveKit default 3.0. "
            "Fallback-of-last-resort: ally-be always sends its global "
            "admin-configured value via room metadata (prompt_data."
            "turn_max_endpointing_delay); this default is only used if that "
            "value is missing or fails validation."
        ),
    )

    # ---- Conversation-history trimming (prompt shortening) ----
    # Per-scenario opt-in via prompt_data.history_trim_enabled (Studio toggle
    # "Trim History", default off). When on, only the last HISTORY_TRIM_DIALOGUES
    # exchanges are sent to the main LLM, bounding input tokens / latency as the
    # conversation grows. The system prompt (persona/scenario/RAG) is unaffected.
    # This setting is the GLOBAL kill-switch.
    AGENT_MIN_INTERRUPTION_WORDS: int = Field(
        default=2,
        description=(
            "How many words the learner must say before their speech interrupts "
            "the client mid-reply. Below this, the speech neither cuts the reply "
            "nor becomes a turn of its own, so a backchannel ('okay', 'hmm') "
            "doesn't make the client start a fresh reply that skips ahead or "
            "goes back to an old topic (prod session 688069dc). 0 restores "
            "livekit's default: any speech interrupts."
        ),
    )
    HISTORY_TRIM_ENABLED: bool = Field(
        default=True,
        description=(
            "Global kill-switch for conversation-history trimming. When False, "
            "no trimming happens even if a scenario enables it. Per-scenario "
            "opt-in is prompt_data.history_trim_enabled (Studio toggle)."
        ),
    )
    HISTORY_TRIM_DIALOGUES: int = Field(
        default=5,
        description=(
            "How many recent learner turns (and their replies) to keep verbatim "
            "once the conversation grows beyond that. <=0 disables trimming."
        ),
    )

    # ---- Rolling conversation summary (episodic memory) ----
    # Maintains a compact "what has happened so far" summary of the conversation
    # as LangGraph state, updated off the voice-to-voice critical path (after the
    # reply has streamed). generate_response then sends [summary + verbatim tail]
    # instead of the full history, and the summary is appended to the system
    # prompt as the LAST block so the static persona prefix stays byte-stable for
    # provider prompt caching. At session end the final summary is shipped to
    # Core as a `session_memory` SQS message (case-level episodic memory).
    ROLLING_SUMMARY_ENABLED: bool = Field(
        default=True,
        description=(
            "Global switch for the rolling conversation summary (episodic "
            "memory). ON by default (validated via live A/B and automated v2v "
            "baselines: latency-neutral, ~$0.001/session). Set false as the "
            "kill switch: no compaction runs, prompts are unchanged and no "
            "session_memory message is emitted."
        ),
    )
    ROLLING_SUMMARY_EVERY_TURNS: int = Field(
        default=4,
        description=(
            "Compact when at least this many learner turns have accumulated "
            "beyond the already-summarized boundary (excluding the verbatim "
            "tail). Higher = fewer summarizer LLM calls, staler summary."
        ),
    )
    ROLLING_SUMMARY_TAIL_DIALOGUES: int = Field(
        default=6,
        description=(
            "How many recent learner turns (and their replies) are always kept "
            "verbatim and never folded into the rolling summary. The summary "
            "covers everything OLDER than this tail."
        ),
    )
    ROLLING_SUMMARY_TIMEOUT: float = Field(
        default=8.0,
        description=(
            "Seconds to wait for one summarizer LLM call (both the per-turn "
            "compaction and the final compaction at session end). On timeout "
            "the previous summary is kept and compaction retries next turn."
        ),
    )
    ROLLING_SUMMARY_TAIL_MAX_CHARS: int = Field(
        default=4000,
        description=(
            "Character budget for the verbatim tail. Turns are not equal-sized "
            "(a Malayalam monologue can be 10x a one-word reply), so when the "
            "last ROLLING_SUMMARY_TAIL_DIALOGUES learner turns exceed this "
            "budget the tail shrinks to fewer turns (never below 2) to keep "
            "the prompt size flat across languages/verbosity. <=0 disables "
            "the char bound (pure turn-count tail)."
        ),
    )
    ROLLING_SUMMARY_DELTA_TRIGGER_CHARS: int = Field(
        default=3000,
        description=(
            "Compact as soon as the un-summarized text beyond the tail reaches "
            "this many characters, even if fewer than "
            "ROLLING_SUMMARY_EVERY_TURNS learner turns have accumulated — "
            "catches verbose turns early. <=0 disables the char trigger "
            "(pure turn-count cadence)."
        ),
    )
    ROLLING_SUMMARY_EMERGENCY_WINDOW_CHARS: int = Field(
        default=9000,
        description=(
            "Hard ceiling on the verbatim window when a summary is active. "
            "The summary normally SUPERSEDES history trim (nothing is dropped "
            "uncovered), but if compaction stalls (summarizer outage/timeouts) "
            "the boundary stops advancing and the window would grow without "
            "bound. Past this ceiling an emergency mechanical trim applies "
            "(loudly logged, turns dropped WITHOUT summary coverage) — "
            "bounded, observable degradation instead of quiet latency growth. "
            "<=0 disables the safety bound."
        ),
    )
    # ---- Client working memory (docs/client-working-memory-design.md) ----
    # A derived record of the CLIENT's inner state — stance, affect, voice, and
    # the disclosure/thread ledgers — updated by one detached LLM call per turn
    # and rendered as the last block of the prompt. Where the rolling summary
    # answers "what has been said", this answers "who is saying it, and where
    # are they now".
    #
    # There is no CLIENT_WORKING_MEMORY_ENABLED env switch any more. Selecting
    # the main-agent prompt IS the switch: a scenario gets working memory when
    # its selected prompt declares {client_working_memory} or any
    # working_memory_* section placeholder, and loses it by selecting another
    # prompt. The env flag was a second, invisible gate on top of that one —
    # a scenario could be correctly pointed at Main Agent Prompt #3 and still
    # silently run without the feature, which is indistinguishable from the
    # on state in a transcript. Rollback is per-scenario prompt selection,
    # which is also the granularity the feature is actually rolled out at.
    # The settings below tune the feature; none of them turn it on or off.
    CLIENT_WORKING_MEMORY_TIMEOUT: float = Field(
        default=25.0,
        description=(
            "Seconds to wait for one consolidation call. On timeout the "
            "previous memory is kept, the miss is counted, and the next turn's "
            "update is free to commit — a miss costs staleness, not "
            "correctness. "
            "Raised from 8s after the multilingual v2v sweep: nine calls timed "
            "out, four consecutively, so those turns produced no update at all "
            "and the memory silently stopped tracking the conversation. "
            "Measured in isolation the same call takes 2.4-3.1s across English, "
            "Hindi, Kannada and Tamil — so 8s was not too tight for the WORK, "
            "it was too tight for live CONTENTION, where the updater competes "
            "with the agent's own streaming turn calls. The asymmetry decides "
            "the number: the call is detached, so waiting longer costs only "
            "staleness, while giving up costs the whole turn's update."
        ),
    )
    CLIENT_WORKING_MEMORY_EVERY_TURNS: int = Field(
        default=1,
        description=(
            "Consolidate every N learner turns. Default 1 — every turn — "
            "because what the update looks for is a client-side EVENT (a "
            "repair, a rupture, a disclosure) and only the call itself can see "
            "one, so a wider cadence does not save a call so much as miss the "
            "turn the event happened on. Raise it to trade freshness for cost."
        ),
    )
    CLIENT_WORKING_MEMORY_WINDOW_TURNS: int = Field(
        default=6,
        description=(
            "How many recent messages the updater reads. Narrow on purpose: "
            "the rolling summary already carries everything older, and a wider "
            "window makes the updater re-derive state it has already "
            "committed, which is how a stance starts drifting on re-reads."
        ),
    )

    CLIENT_WORKING_MEMORY_MAX_RENDERED_DISCLOSURES: int = Field(
        default=12,
        description=(
            "How many disclosures the block RENDERS each turn. The store keeps "
            "every one (the write-out needs them all); this bounds only what "
            "the prompt shows, most-recent first. "
            "Made configurable to be measured: prod v2v shows the block's "
            "front-loaded saving is spent within one exchange. Turn 1 is 40% "
            "cheaper than the #2 prompt in English (577 vs 961 tokens), but "
            "the ledger re-renders in full every turn and by turn 7 the arm "
            "runs ~20% ABOVE control. The cap is the lever on that curve, so "
            "it has to be an A/B knob rather than a constant someone edits."
        ),
    )

    ROLLING_SUMMARY_COMPACT_ON_PAUSE: bool = Field(
        default=True,
        description=(
            "Opportunistically compact when the learner pauses the session — "
            "free time, nobody is waiting on a reply. Purely ADDITIVE: the "
            "per-turn cadence compaction remains the primary mechanism and "
            "runs regardless of whether the learner ever pauses."
        ),
    )
    ROLLING_SUMMARY_MAX_CHARS: int = Field(
        default=2500,
        description=(
            "Hard cap on the summary characters injected into the system "
            "prompt (defensive bound against a runaway summarizer)."
        ),
    )

    LLM_TEMPERATURE: str = Field(...)

    GOOGLE_APPLICATION_CREDENTIALS: Optional[str] = Field(
        default=None,
        description="Path to Google Cloud credentials JSON file (for Google TTS)",
    )

    # Fallback voice per gender, used only when a session's configured voice
    # cannot be built. Optional Google voice ids (e.g. ``en-IN-Chirp3-HD-Kore``);
    # unset, or any non-Google value left over from the Deepgram era, lets
    # Google pick a voice for the session language.
    DEFAULT_MALE_VOICE_MODEL: Optional[str] = Field(default=None)
    DEFAULT_FEMALE_VOICE_MODEL: Optional[str] = Field(default=None)
    DEFAULT_NON_BINARY_VOICE_MODEL: Optional[str] = Field(default=None)

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
        default=True,
        description=(
            "Latency lever: run detect_behaviors in PARALLEL with the response "
            "instead of gating generate_response on it. Behaviors only drive "
            "scoring + UI feedback (not the reply text), so they join at "
            "send_event_feedback like event feedback already does — removing "
            "the ~1.3s behavior branch from the voice-to-voice critical path. "
            "Branching that DOES shape the reply travels as events through "
            "process_events, whose edge to the sync node is unconditional — it "
            "always gates the response regardless of this flag — so de-gating "
            "behaviors never drops branching. Trade-off: the reply selects its "
            "main-agent state from a score that excludes THIS turn's behavior "
            "delta (events still count); cosmetic and the same race class "
            "already tolerated for RAG state. Behavior scores/feedback still "
            "accumulate every turn. Default True; set False to restore gating. "
            "A/B behaviorsMs / responseLatencyMs and confirm scoring unchanged."
        ),
    )
    BEHAVIORS_DEFER_DETECTION: bool = Field(
        default=True,
        description=(
            "Latency lever (Phase 3 for behaviors, same pattern as "
            "EVENTS_OFF_GATE_DEFER_DETECTION): BEHAVIORS_OFF_GATE already keeps "
            "detect_behaviors off the spoken reply's critical path, but "
            "send_event_feedback still has two incoming edges (detect_behaviors "
            "+ resolve_branching_instruction) and a LangGraph node with multiple "
            "incoming edges waits for ALL of them — so the turn's UI/score push "
            "was still held up by however long behavior classification took. "
            "When True, detect_behaviors spawns detection + its own independent "
            "UI/BE feedback delivery as a genuinely detached asyncio task (via "
            "EventOrchestrator._spawn_background, outside LangGraph's scheduler "
            "entirely — a graph 'parallel' edge is NOT enough, see the "
            "superstep-barrier history on EVENTS_OFF_GATE_DEFER_DETECTION) and "
            "returns empty immediately, so send_event_feedback's fan-in no "
            "longer waits on it either. Trade-off: behaviors_ms (captured via "
            "@instrumented_node wrapping detect_behaviors) reads near-zero once "
            "deferred — the real duration moves to a [BEHAVIOR_TIMING] debug log "
            "instead of the structured per-turn metric, same visibility trade "
            "already accepted for deferred event detection. Behavior scores "
            "still accumulate every turn via ScoreKeeper, unchanged. Default "
            "True as of 2026-08-17 (explicit product decision to ship this "
            "immediately, not gate behind a later flip) — set False to "
            "restore synchronous, graph-node behavior detection."
        ),
    )
    EVENTS_OFF_GATE: bool = Field(
        default=False,
        description=(
            "Latency lever: when events fire, send only the reply-shaping ones "
            "(branching + guardrail + termination) to Core on the voice-to-voice "
            "critical path and fire-and-forget the NON-branching ones (pure "
            "scoring/feedback rows) off it. orchestrate_events makes no LLM "
            "calls, so this sheds the non-branching SQS round-trip; scoring and "
            "termination still run on the FULL event set on the gate, so "
            "reply-state selection, next-turn cascade baseline and the final "
            "score are unchanged. The single registry/cascade pass runs once (we "
            "partition its OUTPUT, never re-call it). No-op in report mode. "
            "Generalizes ORCHESTRATION_ASYNC_SQS, partitioned by branching "
            "status, and takes precedence over it when both are set. In-flight "
            "off-gate sends are drained in the shutdown handler so the last "
            "turn's rows are not dropped. Default False; A/B orchestrationMs / "
            "responseLatencyMs."
        ),
    )
    EVENTS_DEFER_NON_GATING_COMBINATIONS: bool = Field(
        default=False,
        description=(
            "Latency lever on top of EVENTS_OFF_GATE_DEFER_DETECTION: defer the "
            "inputs of combinations that neither branch nor terminate, so their "
            "classifiers leave the reply's critical path. Such a combination "
            "then fires (and scores, and moves state) one turn after its inputs "
            "are detected; a final pass at shutdown covers the last turn. In "
            "prod (2026-09-28..10-01) the busiest scenarios had only non-gating "
            "combinations, yet ~16-20 leaf classifiers held every reply and "
            "process_gating_events went 0.9 -> 1.4-2.2 s p50. Default False."
        ),
    )
    EVENTS_OFF_GATE_DEFER_DETECTION: bool = Field(
        default=False,
        description=(
            "Latency lever (Phase 3): run DETECTION of non-reply-shaping events "
            "off the voice-to-voice critical path. The reply gates only on "
            "detecting branching + guardrail + termination events, plus any event "
            "referenced by a combination expression (deferring a combination "
            "input could make the combination permanently miss). Everything else "
            "(independent non-branching leaf classifiers) is detected, scored and "
            "sent in a parallel node that joins at send_event_feedback — the LLM "
            "no longer waits on those classifier calls. Splits the graph into "
            "process_gating_events (gates) + process_deferred_events (off-gate). "
            "TRADE-OFF: deferred events' scores land off-gate, so in scenarios "
            "using score-based events or score-windowed combinations a branching "
            "outcome can lag ONE turn (same class as BEHAVIORS_OFF_GATE). The "
            "single registry/cascade pass still runs once on the gate; the "
            "deferred path marks + scores + sends only its own events without "
            "re-running combinations/cascade. No-op in report mode. Default "
            "False; A/B and validate scoring before enabling."
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
    KNOWLEDGE_RETRIEVAL_REFRESH_ENABLED: bool = Field(
        default=True,
        description=(
            "Global kill-switch for knowledge-retrieval refresh-cadence "
            "caching. The exact-content-hash cache above rarely hits during "
            "live conversation (conversation content is novel every turn), "
            "so the RAG title-selection LLM call otherwise runs on the "
            "critical path almost every turn. When True, that call only "
            "runs every KNOWLEDGE_RETRIEVAL_REFRESH_TURNS turns, reusing the "
            "previous turn's retrieved_context in between — bounded "
            "staleness (retrieved knowledge can lag the live topic by up to "
            "that many turns) in exchange for skipping the call on most "
            "turns. When False, retrieval runs every turn as before."
        ),
    )
    KNOWLEDGE_RETRIEVAL_REFRESH_TURNS: int = Field(
        default=2,
        description=(
            "How many turns to reuse the previous retrieved_context before "
            "recomputing knowledge retrieval. <=0 disables the cadence "
            "(falls back to running every turn, same as REFRESH_ENABLED=False)."
        ),
    )
    RETRIEVED_CONTEXT_DEFER_TO_SUFFIX: bool = Field(
        default=True,
        description=(
            "Latency lever: move retrieved_context out of the system message and "
            "into a new trailing SystemMessage appended AFTER history in "
            "messages_to_send, so OpenAI prompt caching can extend across the "
            "entire growing conversation history instead of capping at the "
            "system message's volatile suffix (retrieved_context refreshes every "
            "KNOWLEDGE_RETRIEVAL_REFRESH_TURNS turns, and today it sits inside "
            "the system message, which always precedes history — every refresh "
            "wipes the WHOLE accumulated history cache, not just its own "
            "tokens). Only affects non-branching turns (branching swaps templates "
            "and busts the cache regardless — no change there). ragEnabled-gated "
            "blanking of retrieved_context is preserved identically in the "
            "deferred path. Default True as of 2026-08-18 (explicit product "
            "decision to ship this immediately) — set False to restore the old "
            "inline-in-system-message placement. Validate via [PROMPT_CACHE] "
            "hit_rate and Metabase llm_ttft_ms p95 after deploy."
        ),
    )
    KNOWLEDGE_RETRIEVAL_ASYNC: bool = Field(
        default=True,
        description=(
            "Stale-while-revalidate knowledge retrieval: on refresh-due turns "
            "serve the previous context immediately and recompute in a "
            "DETACHED task (same pattern as the episodic-memory compactor), "
            "removing the ~1s title-selection LLM call from the reply gate "
            "entirely. The FIRST computation of a session stays synchronous "
            "so turn 1 keeps its context. Staleness bound is one refresh "
            "cycle — the same trade the refresh cadence already accepted. "
            "False restores in-gate recomputation on refresh turns."
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

    # V2V tester (simulated learner bot; app/v2v_tester)
    V2V_TESTER_ENABLED: bool = Field(
        default=False,
        description=(
            "Kill-switch for the v2v tester bot. Each bot runs inside the "
            "uvicorn process with its own LiveKit connection and STT/LLM/TTS "
            "pipeline, so it competes with API serving for memory. Disabled "
            "by default to shed baseline memory pressure; set to True to "
            "re-enable POST /api/v1/v2v-tester/start."
        ),
    )
    V2V_TESTER_SPEECH_PROVIDER: str = Field(
        default="google",
        description=(
            "The tester's own speech: 'google' (chirp_2 STT + Chirp TTS) or "
            "'sarvam' (saarika STT + bulbul TTS, any language Sarvam covers, "
            "English included)."
        ),
    )
    V2V_TESTER_MAX_CONCURRENT: int = Field(
        default=1,
        description=(
            "Per-process cap on simultaneously running tester bots. One run "
            "costs ~200MB (rtc room + streaming STT/TTS); launches beyond "
            "the cap are rejected with HTTP 429 instead of risking an OOM "
            "of the worker process (which would kill live agent sessions)."
        ),
    )

    # ---- Memory optimization ----
    LAZY_PROVIDER_IMPORTS_ENABLED: bool = Field(
        default=True,
        description=(
            "When True, STT/TTS provider SDKs (Deepgram/ElevenLabs/Google/Sarvam/"
            "Hume) are imported on demand inside the factory branch that actually "
            "uses them, instead of eagerly at module import time. A session only "
            "ever needs one STT + one TTS provider, so this keeps the other 3-4 "
            "SDKs out of every worker process's baseline memory. Set to False to "
            "restore eager imports (rollback/debugging safety net) without a "
            "redeploy."
        ),
    )
    VENDORED_STOPWORDS_ENABLED: bool = Field(
        default=True,
        description=(
            "When True, the similarity-based event stopwords provider uses "
            "small vendored word lists for languages not covered by "
            "stopwordsiso, instead of importing advertools (which pulls in "
            "pandas, ~50MB, purely to read a static dict). Set to False to fall "
            "back to the advertools-backed lookup."
        ),
    )

    # ---- Room-metadata fetch fallback ----
    SPEC_FETCH_MAX_ATTEMPTS: int = Field(
        default=3,
        description=(
            "Retries for the room-metadata fetch fallback, where ally-be points "
            "at a URL instead of inlining metadata that would be oversized "
            "(see app/core/agent/factory.py). Named for the Roleplay Studio v2 "
            "spec fetch it was written for; that runtime is gone, this path is "
            "not."
        ),
    )

    # ---- Ally guide voice worker (app/guide_worker.py) ----
    # A separate deployment from the roleplay agent: speech in and speech out
    # only, every reply comes from ally-be. See docs/guide-voice-worker.md.
    LIVEKIT_GUIDE_AGENT_NAME: Optional[str] = Field(
        default=None,
        description=(
            "LiveKit agent name the guide voice worker registers under. Must "
            "match ally-be's LIVEKIT_GUIDE_AGENT_NAME; both default to "
            "`${AGENT_NAME}Guide`."
        ),
    )
    GUIDE_STT_CONFIG: Optional[str] = Field(
        default=None,
        description=(
            "JSON object: base language code (en, hi, ...) or 'default' -> "
            'STT config ({"provider": ..., "config": {...}}). Unset languages '
            "use DEFAULT_STT_CONFIG."
        ),
    )
    GUIDE_TTS_CONFIG: Optional[str] = Field(
        default=None,
        description=(
            "JSON object: base language code or 'default' -> Ally's TTS config "
            '({"provider": ..., "config": {...}}, the shape scenario voices '
            "use). Unset languages get the Google Chirp 3 HD speaker named by "
            "GUIDE_TTS_GOOGLE_VOICE."
        ),
    )
    GUIDE_TTS_GOOGLE_VOICE: str = Field(
        default="Kore",
        description=(
            "Chirp 3 HD speaker for Ally's default voice, as "
            "`<lang>-IN-Chirp3-HD-<speaker>`. A fixed speaker, so Ally keeps "
            "one voice across replies (Gemini-TTS redraws it per request)."
        ),
    )
    GUIDE_VAD_ENDPOINTING_DELAY: float = Field(
        default=1.2,
        description=(
            "Silence (s) before a turn ends in languages without semantic turn "
            "detection (anything but en and hi), and whenever the EOU model is "
            "unavailable. Longer than TURN_MIN_ENDPOINTING_DELAY so a pause "
            "mid-thought is not taken as the end of the turn."
        ),
    )
    GUIDE_CRISIS_SENTENCE_PAUSE_S: float = Field(
        default=0.6,
        description="Silence between sentences of the fixed crisis message.",
    )
    GUIDE_CRISIS_SPEAKING_RATE: float = Field(
        default=0.85,
        description=(
            "Speaking rate for the fixed crisis message, on voices that expose "
            "one (Google). Others are paced by the sentence pauses alone."
        ),
    )
    GUIDE_SLOW_TURN_LINE_AFTER_S: float = Field(
        default=8.0,
        description=(
            "Seconds without a word from ally-be before Ally says it is taking "
            "a moment (plan §5.12, 'slow turn'). 0 disables."
        ),
    )
    GUIDE_TURN_BUSY_RETRIES: int = Field(
        default=2,
        description=(
            "Retries (fresh clientTurnId) when ally-be answers turn_in_progress "
            "— usually the turn the learner just spoke over still unwinding."
        ),
    )
    GUIDE_TURN_BUSY_RETRY_DELAY_S: float = Field(default=0.4)
    GUIDE_TURN_READ_TIMEOUT_S: float = Field(
        default=60.0,
        description=(
            "Read timeout on the voice turn stream; ally-be's own hard turn "
            "timeout is 45s."
        ),
    )
    GUIDE_PARTICIPANT_JOIN_TIMEOUT_S: float = Field(
        default=60.0,
        description="Leave the room if the learner has not joined by then.",
    )
    GUIDE_ECS_METRICS_SERVICE: str = Field(
        default="ally-prd-svc-learn-guide",
        description=(
            "CloudWatch `Service` dimension for the guide worker's active "
            "sessions, so they never count toward the roleplay fleet's scaling."
        ),
    )


settings = Settings()
