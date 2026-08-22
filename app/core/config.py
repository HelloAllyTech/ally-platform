"""
Configuration settings for the application.
"""

from typing import Optional

from pydantic import AliasChoices, Field, model_validator
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
    HUME_API_KEY: str = Field(...)

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

    # ---- Comfort audio (ambient room tone) ----
    # Perceived-latency lever: play a faint, constant room tone on the shared
    # background-audio track for the whole session, so the dead-silent gap before
    # a reply never sounds "muted"/"disconnected" (telephony comfort noise). Like
    # the filler this does NOT change the measured response_latency_ms — it only
    # masks the perceived gap. This GLOBAL flag (default on) is a kill-switch
    # that GATES a per-simulation opt-in (PromptData.comfort_audio_enabled,
    # Studio: comfortAudioEnabled, default off): both must be on for the tone to
    # play, so comfort audio is off for every scenario unless an author enables
    # it. Set this False to force it off everywhere regardless of the per-sim
    # toggle.
    COMFORT_AUDIO_ENABLED: bool = Field(
        default=True,
        description=(
            "Global kill-switch for the comfort-audio room tone. Default True: "
            "the tone plays for a session only when this is on AND that "
            "simulation has comfortAudioEnabled set (per-sim opt-in, default "
            "off). Set False to disable everywhere regardless of the per-sim "
            "toggle."
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

    # ---- Predictive interim reply (latency mask) ----
    # Perceived-latency lever: while the learner is STILL speaking on a long turn,
    # snapshot the interim transcript and ask a FAST dedicated model for a short,
    # NON-COMMITTAL holding reply (~3-5s spoken), synthesize it to audio, and keep
    # it ready. At the VAD endpoint the thinking-filler plays first (if any), then
    # this interim reply plays on the background track, buying time while the real
    # reply is generated by the normal pipeline. The interim is cut the instant the
    # real reply's TTS begins. Unlike the filler, the interim IS recorded as a
    # CLIENT transcript line (a real, if non-committal, agent turn); the real reply
    # is generated INDEPENDENTLY (it never sees the interim). This GLOBAL flag
    # (default OFF — riskiest layer) GATES a per-simulation opt-in
    # (PromptData.interim_reply_enabled, Studio: interimReplyEnabled, default off):
    # both must be on for the interim to run. See app/core/livekit/interim_reply.py.
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
        default=1500.0,
        description=(
            "Timeout (ms) for the fast-model interim-text generation. On timeout "
            "the interim is skipped for the turn (graceful degrade)."
        ),
    )
    INTERIM_REPLY_TTS_TIMEOUT_MS: float = Field(
        default=2500.0,
        description=(
            "Timeout (ms) for synthesizing the interim reply to audio. On timeout "
            "the interim is skipped for the turn."
        ),
    )
    INTERIM_REPLY_VOLUME: float = Field(
        default=0.9,
        description=(
            "Playback volume (0-1) of the interim reply on the background track. "
            "Louder than back-channel (0.6) since this is a spoken utterance, not "
            "a soft listening signal."
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
            "model is confident the learner finished. LiveKit default 0.5."
        ),
    )
    TURN_MAX_ENDPOINTING_DELAY: float = Field(
        default=3.0,
        description=(
            "Maximum endpointing delay (s) — the ceiling the agent waits when the "
            "learner is likely mid-thought. LiveKit default 3.0."
        ),
    )
    TURN_ENDPOINTING_SCENARIO_OVERRIDE_ENABLED: bool = Field(
        default=True,
        description=(
            "Global kill-switch for prompt_data.turn_max_endpointing_delay "
            "(per-scenario override of TURN_MAX_ENDPOINTING_DELAY). When False, "
            "every scenario uses the global TURN_MAX_ENDPOINTING_DELAY "
            "regardless of its own setting — an instant way to force one "
            "platform-wide value without touching scenario config."
        ),
    )

    # ---- Conversation-history trimming (prompt shortening) ----
    # Per-scenario opt-in via prompt_data.history_trim_enabled (Studio toggle
    # "Trim History", default off). When on, only the last HISTORY_TRIM_DIALOGUES
    # exchanges are sent to the main LLM, bounding input tokens / latency as the
    # conversation grows. The system prompt (persona/scenario/RAG) is unaffected.
    # This setting is the GLOBAL kill-switch.
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

    # ---- Roleplay Studio v2 (spec-driven runtime; app/roleplay_v2) ----
    ROLEPLAY_V2_ENABLED: bool = Field(
        default=True,
        description=(
            "Kill-switch for the v2 runtime. When False, worker_v2 refuses "
            "jobs at the entrypoint. Never affects the v1 worker."
        ),
    )
    AGENT_NAME_V2: Optional[str] = Field(
        default=None,
        description=(
            "LiveKit agent name the v2 worker registers under. Distinct from "
            "AGENT_NAME so ally-be dispatches engine='roleplay_v2' rooms to "
            "the v2 worker pool and everything else to v1. Defaults to "
            "f'{AGENT_NAME}V2' so it inherits the same per-environment "
            "namespacing as the v1 name (avoids 'AgentV2' collisions when "
            "workers share one LiveKit project); set explicitly to override."
        ),
    )

    @model_validator(mode="after")
    def _derive_agent_name_v2(self) -> "Settings":
        """Default the v2 agent name to '<AGENT_NAME>V2' when not set explicitly.

        Mirrors the v1 per-environment naming so ally-be's
        LIVEKIT_ROLEPLAY_AGENT_NAME (which defaults to '<LIVEKIT_AGENT_NAME>V2')
        and this worker register under the *same unique* name on a shared
        LiveKit project, instead of every worker colliding on 'AgentV2'.
        """
        if not self.AGENT_NAME_V2:
            self.AGENT_NAME_V2 = f"{self.AGENT_NAME}V2"
        return self

    ACTOR_DEFAULT_MODEL: str = Field(
        default="gpt-4o-mini",
        description=("Default model for the v2 Actor when the spec has no actorModel."),
    )
    DIRECTOR_PROVIDER: str = Field(
        default="openai",
        description=(
            "Default provider for the v2 Director LLM when the spec has no "
            "directorModel (needs json_mode structured-output support)."
        ),
    )
    DIRECTOR_MODEL: str = Field(
        default="gpt-4o",
        description=(
            "Default model for the v2 Director when the spec has no "
            "directorModel. The Director is the referee (scoring, transitions, "
            "unlocks) and runs OFF the voice critical path, so it can afford a "
            "stronger model than the Actor — accuracy matters more than latency "
            "here. Must support json_mode structured output."
        ),
    )
    DIRECTOR_MIN_CONFIDENCE: float = Field(
        default=0.4,
        description=(
            "Minimum self-reported Director confidence (0..1) required before "
            "IRREVERSIBLE verdict actions — state transitions and disclosure "
            "unlocks — are applied. Behavior scoring is never gated (it is "
            "additive and auditable); only actions that reshape the session "
            "are held back on a low-confidence turn. 0 disables the gate."
        ),
    )
    DIRECTOR_TIMEOUT_S: float = Field(
        default=8.0,
        description=(
            "Hard timeout (seconds) for one Director verdict. The Director "
            "runs OFF the voice critical path, so on timeout the turn simply "
            "goes undirected (a recorded miss) — it never delays the actor."
        ),
    )
    SPEC_FETCH_MAX_ATTEMPTS: int = Field(
        default=3,
        description=(
            "How many times the v2 runtime retries GETting a large spec from "
            "the specFetch webhook (exponential backoff) before failing the "
            "session in configure(). Only the >55KB spec path uses this."
        ),
    )
    DIRECTOR_GRACE_MS: float = Field(
        default=0.0,
        description=(
            "Optional wait (ms) before the actor compiles its turn card, "
            "giving a near-done Director verdict a chance to land and reduce "
            "direction staleness. 0 (default) = never wait; keep small "
            "(<300ms) — it adds directly to voice latency."
        ),
    )
    REHEARSAL_CONCURRENCY_LIMIT: int = Field(
        default=2,
        description=(
            "Maximum number of v2 rehearsals (whole runs) executing "
            "concurrently across the process; excess requests queue. Bounds "
            "cost/memory at the run level; within a run, units fan out up to "
            "REHEARSAL_UNIT_CONCURRENCY_LIMIT."
        ),
    )
    REHEARSAL_UNIT_CONCURRENCY_LIMIT: int = Field(
        default=3,
        description=(
            "Maximum trainee-profile / test-case units executed in parallel "
            "within a single rehearsal run. Units are independent sessions, so "
            "this is the main lever on a run's wall-clock (the 3 default "
            "profiles run concurrently). Bounded to avoid provider rate limits."
        ),
    )
    REHEARSAL_JUDGE_MODEL: str = Field(
        default="gpt-4o-mini",
        description=(
            "Default judge model for rehearsals (config.judge_model in the "
            "request overrides per-run)."
        ),
    )
    REHEARSAL_JUDGE_SAMPLES: int = Field(
        default=1,
        description=(
            "How many times the rehearsal judge is sampled per run. The two "
            "SOFT dimensions with no deterministic backstop — persona_"
            "consistency and difficulty_calibration — are averaged across "
            "samples to reduce single-shot LLM noise; all other fields come "
            "from the first sample. 1 (default) = original single-shot behavior."
        ),
    )
    REHEARSAL_TURNS_DEFAULT: int = Field(
        default=8,
        description=(
            "Default trainee turns per rehearsal profile when the request "
            "omits config.turns_per_profile. Kept in sync with ally-be's "
            "TEST_RUN_DEFAULT_TURNS_PER_CASE (8), which drives test runs and "
            "always sends an explicit value."
        ),
    )
    REHEARSAL_TRAINEE_MODEL: str = Field(
        default="",
        description=(
            "Default trainee model for rehearsals (config.trainee_model in "
            "the request overrides per-run). Empty (default) = use the app's "
            "default LLM client."
        ),
    )


settings = Settings()
