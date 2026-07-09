"""Roleplay Studio v2 voice worker.

A slim sibling of app/worker.py for the spec-driven v2 runtime. It reuses the
v1 building blocks that are transport concerns (STT/TTS factories, silero VAD
+ BVC prewarm, semantic turn detection, the conversation/transcript handler,
turn metrics) and swaps the brain: instead of the v1 scenario graph + event
orchestrator, the persona is an ActorEngine graph behind an LLMAdapter with a
DirectorService refereeing every committed turn off the critical path.

v1 is untouched — this module registers under settings.AGENT_NAME_V2 and only
accepts rooms whose metadata carries the ``engine: 'roleplay_v2'`` marker
(enforced outside LOCAL).

Run:  python -m app.worker_v2 start          (or `dev` for console mode)
"""

import asyncio
import os
import sys
import time
from datetime import datetime, timezone
from types import SimpleNamespace
from typing import Optional, Set

from livekit import agents
from livekit.agents import Agent, AgentSession, JobProcess, RoomInputOptions
from livekit.plugins import noise_cancellation, silero
from livekit.plugins.langchain import LLMAdapter

from app.core.agent.factory import (
    cleanup_background_tasks,
    configure_stt_client,
    configure_tts_client,
)
from app.core.config import settings
from app.core.constants import DEFAULT_VAD_ACTIVATION_THRESHOLD, Environment
from app.core.logger import (
    get_logger,
    make_child_logging_forward_only,
    patch_livekit_parent_logger,
    setup_livekit_logging,
)
from app.core.session_clock import SessionClock
from app.llms import create_llm_client
from app.roleplay_v2 import telemetry
from app.roleplay_v2.actor.engine import ActorEngine
from app.roleplay_v2.actor.graph import build_actor_graph
from app.roleplay_v2.director.emitters import DirectorEmitter
from app.roleplay_v2.director.service import DirectorService
from app.roleplay_v2.spec.models import ScenarioSpec
from app.roleplay_v2.spec.parse import parse_spec_metadata
from app.roleplay_v2.spec.runtime_state import RuntimeStateStore

# Register the multilingual EOU inference runner at MODULE IMPORT (not lazily
# per job) — same rationale and mechanics as app/worker.py: livekit-agents
# only spawns its inference-executor process when a runner is registered at
# Worker.__init__ time, and registration is an import side effect. Gated on
# the same kill-switch so a disabled feature spawns no inference process.
if settings.SEMANTIC_TURN_DETECTION_ENABLED:
    from livekit.plugins.turn_detector import (  # noqa: F401,E501
        multilingual as _eou_multilingual,
    )

logger = get_logger(__name__)
setup_livekit_logging(
    settings.LIVEKIT_LOG_LEVEL,
    devmode=settings.LIVEKIT_LOG_DEV_MODE,
    console=settings.LIVEKIT_LOG_CONSOLE,
)


class AgentWorkerV2:
    """Lifecycle: configure → initialize → start (mirrors AgentWorker)."""

    def __init__(self, ctx: agents.JobContext):
        self.ctx = ctx

        # ---- Configuration state (configure()) ----
        self.spec: Optional[ScenarioSpec] = None
        self.envelope = None
        self.stt_client = None
        self.tts_client = None
        self.actor_llm_client = None
        self.director_llm_client = None
        self.joined_iso: Optional[str] = None

        # ---- Runtime components (initialize()) ----
        self.session: Optional[AgentSession] = None
        self.agent: Optional[Agent] = None
        self.state_store: Optional[RuntimeStateStore] = None
        self.emitter: Optional[DirectorEmitter] = None
        self.director: Optional[DirectorService] = None
        self.actor_engine: Optional[ActorEngine] = None
        self.session_clock: Optional[SessionClock] = None

        # Voice-naturalness levers (comfort audio / thinking filler / continuous
        # back-channeling / interim reply). The scenario shim is a duck-typed
        # object the shared controller reads flags + persona context off.
        self._naturalness = None
        self._naturalness_scenario = None

        self._background_tasks: Set[asyncio.Task] = set()
        self._room_disconnected_event: Optional[asyncio.Event] = None
        self._summary_sent = False
        self._timing: dict[str, float] = {}

    # ------------------------------------------------------------------
    # Phase 1 — configure
    # ------------------------------------------------------------------

    async def configure(self):
        """Parse + validate the spec envelope and build all clients."""
        self.envelope = parse_spec_metadata(self.ctx.job.metadata)

        # Refuse anything that isn't a v2 job: outside LOCAL a wrong or
        # missing engine marker means the room was dispatched to the wrong
        # worker — fail loudly rather than misplay a v1 scenario.
        if not self.envelope.is_roleplay_v2:
            if settings.ENV == Environment.LOCAL:
                logger.warning(
                    "[AgentWorkerV2] Metadata lacks engine='roleplay_v2' "
                    "marker; proceeding because ENV=LOCAL."
                )
            else:
                raise ValueError(
                    "worker_v2 received a job without the engine='roleplay_v2' "
                    f"marker (engine={self.envelope.engine!r}); refusing."
                )

        self.spec = await self.envelope.ensure_spec()
        language = self.envelope.resolve_language()
        language_config = language.to_language_config()
        language_code = language_config.language_code
        voice = self.envelope.resolve_voice()
        logger.info(
            "[AgentWorkerV2] Configured spec %r (schema %s): states=%d "
            "secrets=%d behaviors=%d language=%s",
            self.spec.title,
            self.envelope.spec_schema_version,
            len(self.spec.state_machine.states),
            len(self.spec.disclosure_ledger.secrets),
            len(self.spec.rubric.behaviors),
            language_code,
        )

        # configure_stt_client / configure_tts_client are duck-typed over the
        # v1 Scenario: they read .language_config, .voice, and
        # .prompt_data.gender — provide exactly that shape.
        shim = SimpleNamespace(
            language_config=language_config,
            voice=voice,
            prompt_data=SimpleNamespace(gender=None),
        )
        self.stt_client = configure_stt_client(shim)
        try:
            self.tts_client = configure_tts_client(shim)
        except ValueError:
            # No voice in the spec AND no gender to pick a default by —
            # fall back to a neutral default voice rather than failing.
            from app.tts import Gender, create_tts_client

            logger.warning("[AgentWorkerV2] No usable voice config; using default TTS")
            self.tts_client = create_tts_client(
                language_code=language_code, gender=Gender.FEMALE
            )

        actor_config = (
            self.spec.actor_model.to_llm_config()
            if self.spec.actor_model
            else {
                "provider": "openai",
                "config": {"model": settings.ACTOR_DEFAULT_MODEL},
            }
        )
        self.actor_llm_client = create_llm_client(
            llm_config=actor_config, language_code=language_code
        )
        director_config = (
            self.spec.director_model.to_llm_config()
            if self.spec.director_model
            else {
                "provider": settings.DIRECTOR_PROVIDER,
                "config": {"model": settings.DIRECTOR_MODEL, "temperature": 0},
            }
        )
        self.director_llm_client = create_llm_client(
            llm_config=director_config, language_code=language_code
        )

        # Duck-typed scenario for the naturalness controller: the gating +
        # phrase-generation helpers read .prompt_data (flags + persona context),
        # .language_config and .voice — mirror the v1 Scenario shape so the
        # shared controller works unchanged. camelCase spec keys were already
        # normalized to snake_case flags on ScenarioSpec.
        persona = self.spec.persona
        naturalness_prompt_data = SimpleNamespace(
            filler_enabled=self.spec.filler_enabled,
            comfort_audio_enabled=self.spec.comfort_audio_enabled,
            comfort_audio_url=self.spec.comfort_audio_url,
            comfort_audio_volume=self.spec.comfort_audio_volume,
            continuous_backchanneling=self.spec.continuous_backchanneling,
            interim_reply_enabled=self.spec.interim_reply_enabled,
            gender=None,
            # No Studio-authored static filler phrases for v2 — thinking filler
            # relies on predictive fillers (needs history + PREDICTIVE_FILLER_ENABLED).
            allowed_fillers=None,
            language_label=language_code,
            # Persona grounding for back-channel / interim / predictive phrase gen.
            title=self.spec.title,
            name=None,
            profession=None,
            description=self.spec.difficulty or None,
            context=getattr(persona, "scenario_context", None),
            role_instructions=getattr(persona, "identity_core", None),
        )
        self._naturalness_scenario = SimpleNamespace(
            prompt_data=naturalness_prompt_data,
            language_config=language_config,
            voice=voice,
        )

        self.joined_iso = datetime.now(timezone.utc).isoformat()
        logger.info("[AgentWorkerV2] Configuration phase complete")

    # ------------------------------------------------------------------
    # Phase 2 — initialize
    # ------------------------------------------------------------------

    async def initialize(self):
        """Create the session, runtime state, Director, and Agent."""
        self._create_session()
        self.session_clock = SessionClock.from_iso(self.joined_iso)

        room_name = self.ctx.room.name
        self.state_store = RuntimeStateStore(self.spec)
        self.emitter = DirectorEmitter(room_name, room=self.ctx.room)
        self.director = DirectorService(
            self.spec,
            self.state_store,
            self.director_llm_client.llm_instance,
            self.emitter,
            session_clock=self.session_clock,
            timeout_s=settings.DIRECTOR_TIMEOUT_S,
        )

        # Inline audio-tag guidance when the TTS provider supports it —
        # appended STATICALLY to the actor prefix (stays cacheable).
        audio_tag_instructions = None
        try:
            if self.tts_client.supports_text_enhancement():
                from app.prompts.resolver import load_template

                audio_tag_instructions = (
                    load_template("system/audio_tag_guidance") or None
                )
        except Exception:  # noqa: BLE001 - tags are a nice-to-have
            logger.debug("[AgentWorkerV2] audio-tag probe failed", exc_info=True)

        self.actor_engine = ActorEngine(
            self.spec,
            self.state_store,
            self.actor_llm_client.llm_instance,
            audio_tag_instructions=audio_tag_instructions,
        )
        actor_graph = build_actor_graph(self.actor_engine)

        # on_turn: the actor graph hands each committed (trainee, actor)
        # pair to the Director — fire-and-forget, off the voice path.
        def on_turn(turn_index: int, trainee_text: str, actor_text: str) -> None:
            self.director.on_turn_committed(turn_index, trainee_text, actor_text)

        adapter = LLMAdapter(
            graph=actor_graph,
            config={"configurable": {"thread_id": room_name, "on_turn": on_turn}},
        )
        self.agent = Agent(llm=adapter, instructions="")

        self._register_callbacks()
        logger.info("[AgentWorkerV2] Initialization phase complete")

    def _create_session(self):
        """AgentSession with STT/TTS/VAD + semantic turn detection."""
        vad = self.ctx.proc.userdata.get("vad")
        turn_detection, endpointing_kwargs = self._resolve_turn_detection(vad)
        self.session = AgentSession(
            stt=self.stt_client.stt_instance,
            tts=self.tts_client.tts_instance,
            vad=vad,
            turn_detection=turn_detection,
            **endpointing_kwargs,
        )

    def _resolve_turn_detection(self, vad) -> tuple[object, dict]:
        """Copy of AgentWorker._resolve_turn_detection (see app/worker.py).

        Semantic EOU layered on VAD when enabled; plain VAD timeout as the
        universal fallback so a session never fails to start over turn
        detection.
        """
        if not vad:
            return None, {}
        if not getattr(settings, "SEMANTIC_TURN_DETECTION_ENABLED", True):
            return "vad", {}
        try:
            from livekit.plugins.turn_detector.multilingual import MultilingualModel

            min_delay = float(getattr(settings, "TURN_MIN_ENDPOINTING_DELAY", 0.5))
            max_delay = float(getattr(settings, "TURN_MAX_ENDPOINTING_DELAY", 3.0))
            _eou_t0 = time.monotonic()
            detector = MultilingualModel()
            self._timing["eou_load_ms"] = (time.monotonic() - _eou_t0) * 1000
            logger.info(
                "[AgentWorkerV2] semantic EOU enabled (min=%.2fs max=%.2fs)",
                min_delay,
                max_delay,
            )
            return detector, {
                "min_endpointing_delay": min_delay,
                "max_endpointing_delay": max_delay,
            }
        except Exception as e:  # noqa: BLE001 - never fail a session over EOU
            logger.warning(
                "[AgentWorkerV2] semantic EOU unavailable (%s); VAD fallback", e
            )
            return "vad", {}

    def _register_callbacks(self):
        """Transcript handler, metrics hook, disconnect + shutdown wiring."""
        from livekit import rtc

        from app.core.events.handlers import create_conversation_handler

        room_name = self.ctx.room.name

        # Reuse the v1 conversation handler verbatim: it ships `message`
        # transcript rows over SQS and drives per-turn latency metrics —
        # the v1 processors keep persisting v2 sessions unchanged.
        conversation_handler, state_handlers, cleanup_conversation = (
            create_conversation_handler(room_name, self.joined_iso)
        )
        self.session.on("conversation_item_added")(conversation_handler)
        self.session.on("agent_state_changed")(state_handlers["agent_state"])
        self.session.on("user_state_changed")(state_handlers["user_state"])
        self._cleanup_conversation_handler = cleanup_conversation

        # LiveKit component metrics (EOU/TTFT/TTFB) + STT/TTS AI-cost emits.
        stt_provider, stt_model = self._resolve_stt_meta()
        tts_provider, tts_model = self._resolve_tts_meta()
        self.session.on("metrics_collected")(
            telemetry.create_metrics_hook(
                room_name,
                stt_provider=stt_provider,
                stt_model=stt_model,
                tts_provider=tts_provider,
                tts_model=tts_model,
            )
        )

        @self.ctx.room.on("connection_state_changed")
        def on_connection_state_changed(state: rtc.ConnectionState):
            if state == rtc.ConnectionState.CONN_DISCONNECTED:
                if self._room_disconnected_event is not None:
                    self._room_disconnected_event.set()

        self.ctx.add_shutdown_callback(self._shutdown_handler)

    def _resolve_stt_meta(self) -> tuple[str, str]:
        """(provider, model) for AI-cost tagging, read off the built client.

        The v2 spec carries no STT override (the language registry picks the
        provider), so introspect the configured client defensively.
        """
        try:
            client = self.stt_client
            provider = type(client).__name__.replace("STTClient", "").lower()
            instance = getattr(client, "stt_instance", None)
            model = (
                getattr(instance, "model", None)
                or getattr(getattr(instance, "_opts", None), "model", None)
                or "unknown"
            )
            return provider or "unknown", str(model)
        except Exception:  # noqa: BLE001
            return "unknown", "unknown"

    def _resolve_tts_meta(self) -> tuple[str, str]:
        try:
            voice = self.envelope.resolve_voice()
            if voice is not None:
                model = (
                    getattr(voice.config, "model", None)
                    or getattr(voice.config, "model_name", None)
                    or voice.name
                    or "unknown"
                )
                return str(voice.provider or "unknown"), str(model)
        except Exception:  # noqa: BLE001
            pass
        return "unknown", "unknown"

    def _read_naturalness_history(self) -> list:
        """Recent-turns snapshot for predictive fillers / interim context.

        The v2 actor graph runs with NO checkpointer (the LLMAdapter passes the
        full chat context each turn), so — unlike v1 — there is no graph state to
        read. Best-effort convert the AgentSession's chat history to LangChain
        messages; return [] on any mismatch. Interim reply degrades gracefully
        without history (it still uses the partial transcript + persona context);
        only predictive-filler refresh needs it.
        """
        try:
            from langchain_core.messages import AIMessage, HumanMessage

            hist = getattr(self.session, "history", None)
            items = getattr(hist, "items", None) if hist is not None else None
            if not items:
                return []
            messages: list = []
            for item in items:
                if getattr(item, "type", "message") != "message":
                    continue
                role = getattr(item, "role", None)
                content = getattr(item, "text_content", None)
                if content is None:
                    content = getattr(item, "content", None)
                if isinstance(content, (list, tuple)):
                    content = " ".join(str(c) for c in content if c)
                if not content or not str(content).strip():
                    continue
                if role == "user":
                    messages.append(HumanMessage(content=str(content)))
                elif role == "assistant":
                    messages.append(AIMessage(content=str(content)))
            return messages
        except Exception as e:  # noqa: BLE001 - best-effort; history is optional
            logger.debug("[AgentWorkerV2] read history failed: %s", e)
            return []

    # ------------------------------------------------------------------
    # Phase 3 — start
    # ------------------------------------------------------------------

    async def start(self):
        """Connect, arm background jobs, and speak the opening line."""
        self._room_disconnected_event = asyncio.Event()

        _connect_t0 = time.monotonic()
        # Prefer the process-prewarmed BVC instance (see prewarm()).
        userdata = getattr(getattr(self.ctx, "proc", None), "userdata", {}) or {}
        bvc = userdata.get("bvc") or noise_cancellation.BVC()
        await self.session.start(
            room=self.ctx.room,
            agent=self.agent,
            room_input_options=RoomInputOptions(noise_cancellation=bvc),
        )
        await self.ctx.connect()
        self._timing["connect_ms"] = (time.monotonic() - _connect_t0) * 1000
        logger.info("[AgentWorkerV2] Connected to room %s", self.ctx.room.name)

        # Orphan deadline: exit if no human joins (mirrors v1).
        orphan_task = asyncio.create_task(self._arm_orphan_deadline(30.0))
        self._background_tasks.add(orphan_task)
        orphan_task.add_done_callback(self._background_tasks.discard)

        # Code-owned time-triggered engineered events (pause-aware clock).
        self.director.start_time_events()

        # Voice-naturalness track (comfort tone + thinking filler + back-channel
        # + interim reply). Publishes the shared background-audio track now and
        # defers synthesis off the opening path — mirrors v1. Best-effort: never
        # blocks or breaks the session.
        try:
            from app.core.livekit.naturalness import NaturalnessController

            self._naturalness = NaturalnessController(
                room=self.ctx.room,
                session=self.session,
                tts_client=self.tts_client,
                llm_client=self.actor_llm_client,
                scenario=self._naturalness_scenario,
                joined_iso=self.joined_iso,
                background_tasks=self._background_tasks,
                read_history=self._read_naturalness_history,
            )
            await self._naturalness.start()
        except Exception as e:  # noqa: BLE001 - naturalness must never break start
            logger.warning("[AgentWorkerV2] naturalness setup failed: %s", e)
            self._naturalness = None

        # Opening: the spec's scripted statement wins; otherwise let the
        # actor graph open the conversation.
        if self.spec.opening_statement:
            logger.info("[AgentWorkerV2] Saying scripted opening statement")
            try:
                handler = self.session.say(self.spec.opening_statement)
                await handler.wait_for_playout()
            except Exception as e:  # noqa: BLE001 - session may be closing
                logger.warning("[AgentWorkerV2] Skipped opening statement: %s", e)
        else:
            logger.info("[AgentWorkerV2] No opening statement; generate_reply()")
            try:
                self.session.generate_reply()
            except Exception as e:  # noqa: BLE001
                logger.warning(
                    "[AgentWorkerV2] Auto-start generate_reply() failed: %s", e
                )

        self._emit_start_metrics()

    async def _arm_orphan_deadline(self, timeout: float) -> None:
        await asyncio.sleep(timeout)
        if not self.ctx.room.remote_participants:
            logger.warning(
                "[AgentWorkerV2] No human joined within %.0fs — shutting down",
                timeout,
            )
            self.ctx.shutdown("orphaned_no_human")

    def _emit_start_metrics(self) -> None:
        """Best-effort start-latency emit (same message type as v1)."""
        try:
            from app.core.events.handlers import send_event_to_queue
            from app.core.events.schemas import CoreEventMessageType, StartMetricsData

            def _ms(key: str):
                v = self._timing.get(key)
                return int(round(v)) if v is not None else None

            segments = [
                s
                for s in (_ms("configure_ms"), _ms("initialize_ms"), _ms("connect_ms"))
                if s
            ]
            if not segments:
                return
            data = StartMetricsData(
                start_latency_ms=sum(segments),
                configure_ms=_ms("configure_ms"),
                initialize_ms=_ms("initialize_ms"),
                connect_ms=_ms("connect_ms"),
                language=self.spec.language_code if self.spec else None,
                env=settings.ENV.value,
            )
            message = CoreEventMessageType.create_start_metrics(
                self.ctx.room.name, data
            )
            task = asyncio.create_task(send_event_to_queue(message.model_dump_json()))
            self._background_tasks.add(task)
            task.add_done_callback(self._background_tasks.discard)
        except Exception:  # noqa: BLE001 - metrics must never break a session
            logger.exception("[AgentWorkerV2] start-metrics emit failed")

    # ------------------------------------------------------------------
    # Shutdown
    # ------------------------------------------------------------------

    async def _shutdown_handler(self):
        """Flush the Director, ship the session summary, drop metrics state."""
        logger.info("[AgentWorkerV2] Shutting down session %s", self.ctx.room.name)
        try:
            self._cleanup_conversation_handler()
        except Exception:  # noqa: BLE001
            pass
        if self._naturalness is not None:
            try:
                await self._naturalness.aclose()
            except Exception:  # noqa: BLE001 - never block room teardown
                logger.debug(
                    "[AgentWorkerV2] naturalness teardown failed", exc_info=True
                )
        try:
            if self.director is not None:
                await self.director.flush()
                if not self._summary_sent:
                    self._summary_sent = True
                    await self.director.emit_session_summary()
        except Exception:  # noqa: BLE001 - never block room teardown
            logger.exception("[AgentWorkerV2] director shutdown flush failed")
        telemetry.discard(self.ctx.room.name)
        await cleanup_background_tasks(self._background_tasks)
        logger.info("[AgentWorkerV2] Shutdown complete")

    async def wait_until_done(self):
        """Keep the entrypoint alive until the room disconnects."""
        if self._room_disconnected_event is not None:
            await self._room_disconnected_event.wait()


async def entrypoint(ctx: agents.JobContext):
    logger.info("[AgentWorkerV2] ENTRYPOINT for job %s", ctx.job.id)
    if not settings.ROLEPLAY_V2_ENABLED:
        raise RuntimeError("ROLEPLAY_V2_ENABLED is off — refusing v2 job")

    worker = AgentWorkerV2(ctx)
    _t0 = time.monotonic()
    await worker.configure()
    worker._timing["configure_ms"] = (time.monotonic() - _t0) * 1000
    _t0 = time.monotonic()
    await worker.initialize()
    worker._timing["initialize_ms"] = (time.monotonic() - _t0) * 1000
    await worker.start()

    logger.info(
        "[AgentWorkerV2] START_TIMING configure=%.0fms initialize=%.0fms "
        "connect=%.0fms eou_load=%.0fms",
        worker._timing.get("configure_ms", 0.0),
        worker._timing.get("initialize_ms", 0.0),
        worker._timing.get("connect_ms", 0.0),
        worker._timing.get("eou_load_ms", 0.0),
    )

    # Keep the job alive for the conversation; skip the wait under pytest
    # (mirrors app/worker.py's guard so imports/tests never hang).
    is_test_env = "pytest" in sys.modules or "PYTEST_CURRENT_TEST" in os.environ
    if not is_test_env:
        try:
            await worker.wait_until_done()
        finally:
            logger.info("[AgentWorkerV2] Entrypoint returning. Job finished.")


def prewarm(proc: JobProcess):
    """Per-process prewarm: silero VAD + BVC (mirrors app/worker.py)."""
    # Keep only LiveKit's log forwarder in the child so records emit once. See
    # logger.py.
    make_child_logging_forward_only()
    proc.userdata["vad"] = silero.VAD.load(
        activation_threshold=DEFAULT_VAD_ACTIVATION_THRESHOLD
    )
    try:
        proc.userdata["bvc"] = noise_cancellation.BVC()
        logger.info("[AgentWorkerV2] BVC prewarmed")
    except Exception as e:  # noqa: BLE001 - best-effort; falls back per-job
        logger.warning("[AgentWorkerV2] BVC prewarm skipped: %s", e)


if __name__ == "__main__":
    # Prevent run_app's _configure_logger from adding a second JSON stdout
    # handler to root in this (parent) process. See logger.py.
    patch_livekit_parent_logger()
    agent_name = "" if settings.ENV == Environment.LOCAL else settings.AGENT_NAME_V2
    agents.cli.run_app(
        agents.WorkerOptions(
            agent_name=agent_name,
            entrypoint_fnc=entrypoint,
            prewarm_fnc=prewarm,
            # Each idle process prewarms silero VAD + BVC (~hundreds of MB), so
            # every extra spare is pure baseline memory. One spare keeps session
            # start instant for the common case; a same-instant second session
            # just waits a few seconds for a cold job process to spawn.
            num_idle_processes=1,
            api_key=settings.LIVEKIT_API_KEY,
            api_secret=settings.LIVEKIT_API_SECRET,
            ws_url=settings.LIVEKIT_URL,
            drain_timeout=600,
            job_memory_warn_mb=650,
            initialize_process_timeout=120,
        )
    )
