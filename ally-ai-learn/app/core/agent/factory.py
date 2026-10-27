"""Agent setup and utility functions."""

import asyncio
import json
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Set

from livekit import rtc
from livekit.agents import Agent, llm
from livekit.plugins.langchain import LLMAdapter

from app.core.agent.glossary_swap import StreamingWordSwapper, swap_table_for
from app.core.config import settings
from app.core.constants import DEFAULT_LANGUAGE_CODE, Environment
from app.core.embeddings import BaseEmbeddingClient, OpenAIEmbeddingClient
from app.core.events.event_orchestrator.event_orchestrator import EventOrchestrator
from app.core.livekit.livekit_models import RoomMetadataEnvelope
from app.core.logger import get_logger
from app.core.metrics import turn_metrics
from app.core.scenario.base import Scenario
from app.core.scoring.score_keeper import ScoreKeeper
from app.llms import BaseLLMClient, create_llm_client
from app.stt import BaseSTTClient, create_stt_client
from app.tts import BaseTTSClient, Gender, create_tts_client

logger = get_logger(__name__)


# ====================================================================
# Metadata Parsing
# ====================================================================


async def resolve_job_metadata(metadata: Optional[str]) -> Optional[str]:
    """Return the full room-metadata JSON for a job, fetching it when the
    dispatch carries only a slim pointer.

    ally-be (LEARN_METADATA_FETCH_ENABLED) sends
    ``{version, metadataFetch: {roomName, url}, scenarioSession?}`` instead of
    the full ~180KB envelope, so the payload no longer rides inside LiveKit's
    availability request (which blew the server's 3s dispatch window over the
    high-RTT server↔worker link). This resolves the pointer via the
    x-api-key-guarded webhook and overlays any slim-envelope
    ``scenarioSession`` fields (e.g. conversationStartedAt injected by the
    participant_joined handler) onto the fetched payload.

    Inline (legacy) payloads — anything without a ``metadataFetch`` key,
    including invalid JSON — pass through unchanged so ``parse_room_metadata``
    keeps owning their error handling. Mirrors roleplay v2's
    ``RoleplaySpecEnvelope.ensure_spec`` fetch/retry contract.
    """
    try:
        parsed = json.loads(metadata or "")
    except json.JSONDecodeError:
        return metadata
    if not isinstance(parsed, dict) or "metadataFetch" not in parsed:
        return metadata

    fetch = parsed.get("metadataFetch") or {}
    url = fetch.get("url")
    room_name = fetch.get("roomName")
    if not url:
        raise ValueError(f"metadataFetch pointer for room {room_name!r} has no url")

    import httpx

    attempts = max(1, int(getattr(settings, "SPEC_FETCH_MAX_ATTEMPTS", 3)))
    last_exc: Optional[Exception] = None
    payload: Any = None
    for attempt in range(1, attempts + 1):
        logger.info(
            "[metadata-fetch] Fetching room metadata room=%s (attempt %d/%d)",
            room_name,
            attempt,
            attempts,
        )
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.get(
                    url,
                    headers={"x-api-key": settings.CORE_SERVICE_API_KEY},
                )
                resp.raise_for_status()
                payload = resp.json()
            break
        except Exception as exc:  # noqa: BLE001 - retried below
            last_exc = exc
            if attempt < attempts:
                await asyncio.sleep(0.5 * (2 ** (attempt - 1)))
    if payload is None:
        raise RuntimeError(
            f"room metadata fetch failed after {attempts} attempt(s) for "
            f"room {room_name!r}: {last_exc}"
        ) from last_exc
    if not isinstance(payload, dict):
        raise ValueError(
            f"room metadata fetch for room {room_name!r} returned "
            f"{type(payload).__name__}, expected object"
        )

    # Dispatch-time scenarioSession fields (conversationStartedAt) are only in
    # the slim envelope — the stored payload predates them. Slim keys win.
    slim_session = parsed.get("scenarioSession")
    if isinstance(slim_session, dict) and slim_session:
        stored_session = payload.get("scenarioSession")
        merged = dict(stored_session) if isinstance(stored_session, dict) else {}
        merged.update(slim_session)
        payload["scenarioSession"] = merged

    return json.dumps(payload)


def parse_room_metadata(
    metadata,
    embedding_client: Optional[BaseEmbeddingClient] = None,
    branching_llm_config: Optional[Dict[str, Any]] = None,
) -> RoomMetadataEnvelope:
    """
    Parse room metadata JSON into RoomMetadataEnvelope.
    Returns empty envelope on error.

    Args:
        metadata: JSON string containing room metadata
        embedding_client: Optional shared embedding client for
            semantic similarity events
        branching_llm_config: Optional LLM config for branching instruction
            resolution (structured output support)
    """
    try:
        parsed = json.loads(metadata or "")
    except json.JSONDecodeError:
        parsed = None

    if parsed is None:
        if settings.ENV == Environment.LOCAL:
            logger.warning("Missing/invalid metadata in local; using SCENARIO_SAMPLE.")
            from scenario_sample import SCENARIO_SAMPLE

            parsed = SCENARIO_SAMPLE
        else:
            raise ValueError("Metadata missing or invalid.")

    return RoomMetadataEnvelope.create(
        parsed,
        embedding_client=embedding_client,
        branching_llm_config=branching_llm_config,
    )


# ====================================================================
# Client Configuration
# ====================================================================


def configure_stt_client(scenario: Scenario) -> BaseSTTClient:
    """
    Configure STT client from scenario metadata with fallback.

    Args:
        scenario: Scenario instance containing language config

    Returns:
        Configured STT client instance
    """
    language_code = DEFAULT_LANGUAGE_CODE
    stt_config_from_metadata = None
    if scenario.language_config:
        language_code = scenario.language_config.language_code
        stt_config_from_metadata = scenario.language_config.stt_config

    try:
        return create_stt_client(
            stt_config=stt_config_from_metadata, language_code=language_code
        )
    except Exception as e:
        logger.warning(f"STT config failed, using default: {e}")
        return create_stt_client(language_code=language_code)


def tts_config_for_voice(voice) -> Optional[Dict[str, Any]]:
    """The ``create_tts_client`` config for a ``ScenarioVoice``, or None.

    Shared with scripts/pregenerate_voice_clips.py: a pre-rendered clip is
    only found by a session whose client hashes to the same voice
    fingerprint, so both must build the client from the same dict.
    """
    if not voice:
        return None
    logger.debug(
        f"[TTS Config] Building config from scenario.voice: "
        f"provider={voice.provider}, name={voice.name}"
    )
    config = voice.config
    return {
        "provider": voice.provider,
        "name": voice.name,
        "config": {
            "model": config.model,
            "voice_id": config.voice_id,
            "voice": config.voice,
            "speed": config.speed,
            "emotion": config.emotion,
            "speaker": config.speaker,
            "voice_name": config.voice_name,
            "model_name": config.model_name,
            "gender": config.gender,
            "voice_cloning_key": config.voice_cloning_key,
            "instant_mode": config.instant_mode,
            "voice_provider": config.voice_provider,
        },
    }


def configure_tts_client(scenario: Scenario) -> BaseTTSClient:
    """
    Configure TTS client from scenario metadata with fallback.

    Args:
        scenario: Scenario instance containing voice and language config

    Returns:
        Configured TTS client instance

    Raises:
        ValueError: If TTS creation fails and gender is required for fallback
    """
    tts_config_from_metadata = tts_config_for_voice(scenario.voice)

    gender_enum = (
        Gender(scenario.prompt_data.gender.lower())
        if scenario.prompt_data.gender
        else None
    )

    language_code = (
        scenario.language_config.language_code
        if scenario.language_config
        else DEFAULT_LANGUAGE_CODE
    )

    try:
        logger.debug(
            f"[TTS Config] Calling create_tts_client with "
            f"tts_config={tts_config_from_metadata}, "
            f"language_code={language_code}, gender={gender_enum}"
        )
        tts_client = create_tts_client(
            tts_config=tts_config_from_metadata,
            language_code=language_code,
            gender=gender_enum,
        )
        logger.debug(
            f"[TTS Config] Successfully created TTS client: {type(tts_client).__name__}"
        )
        return tts_client
    except Exception as e:
        logger.warning(f"[TTS Config] TTS config failed, using default: {e}")
        if gender_enum:
            logger.debug(
                f"[TTS Config] Falling back to default TTS with gender={gender_enum}"
            )
            return create_tts_client(language_code=language_code, gender=gender_enum)
        else:
            raise ValueError("Cannot create TTS: gender is required for fallback")


# Prompt code for the main response agent. A scenario may select a variant via
# prompt_data.selected_main_prompt_code; otherwise this default is used to look
# up a prompt-level model/temperature override.
DEFAULT_MAIN_AGENT_PROMPT_CODE = "ally_ai_learn_system_main_agent_prompt"


def _clamp_prompt_temperature(value: Any) -> Optional[float]:
    """Coerce a prompt-level temperature to a float in [0, 2]; None on invalid.

    Mirrors PromptData's own validator so a bad value sent on a prompt entry
    falls back to the provider/global default instead of breaking the call.
    """
    if value is None or value == "":
        return None
    try:
        temp = float(value)
    except (TypeError, ValueError):
        logger.warning("Ignoring invalid prompt-level temperature=%r", value)
        return None
    return min(2.0, max(0.0, temp))


def get_prompt_llm_overrides(
    prompt_data: Any, prompt_code: Optional[str]
) -> tuple[Optional[str], Optional[str], Optional[float]]:
    """Return (provider, model, temperature) overrides for a prompt code, read
    from ``prompt_data.prompts[prompt_code]`` (shipped by ally-be). Returns
    ``(None, None, None)`` when the prompt has no entry or no overrides set.
    `provider` is explicit (no model-name inference) when ally-be sets it.
    """
    if not prompt_code or prompt_data is None:
        return (None, None, None)
    prompts = getattr(prompt_data, "prompts", None) or {}
    entry = prompts.get(prompt_code)
    if not isinstance(entry, dict):
        return (None, None, None)
    provider = entry.get("provider") or None
    model = entry.get("model") or None
    temperature = _clamp_prompt_temperature(entry.get("temperature"))
    return (provider, model, temperature)


def build_llm_client_for_prompt(
    scenario: Scenario,
    prompt_code: Optional[str],
    *,
    base_llm_config: Optional[Dict[str, Any]] = None,
    language_code: str = DEFAULT_LANGUAGE_CODE,
    simulation_temperature: Optional[float] = None,
) -> BaseLLMClient:
    """Build an LLM client for a prompt/skill, applying the precedence chain:

        code default → language ``base_llm_config`` → prompt-level → simulation

    - model/provider: a prompt-level model wins over the base/code model (no
      simulation model exists). The provider is the explicit prompt provider
      when set, else re-derived from the model name in ``create_llm_client``.
    - temperature: the simulation override wins when provided (main agent
      only); otherwise the prompt-level value; otherwise the base/code default
      resolved inside ``create_llm_client``.
    """
    prompt_data = getattr(scenario, "prompt_data", None)
    provider, model, prompt_temperature = get_prompt_llm_overrides(
        prompt_data, prompt_code
    )
    effective_temperature = (
        simulation_temperature
        if simulation_temperature is not None
        else prompt_temperature
    )
    if model or effective_temperature is not None:
        logger.info(
            "[LLM] prompt=%s applying overrides provider=%s model=%s temperature=%s",
            prompt_code,
            provider,
            model,
            effective_temperature,
        )
    return create_llm_client(
        llm_config=base_llm_config,
        language_code=language_code,
        temperature=effective_temperature,
        model=model,
        provider_override=provider,
    )


def configure_llm_client(scenario: Scenario) -> BaseLLMClient:
    """
    Configure the main roleplay-agent LLM client from scenario metadata.

    Precedence: code default → per-language llm_config → main-agent prompt
    (model + temperature) → simulation-level temperature override.

    Args:
        scenario: Scenario instance containing language config + prompt_data

    Returns:
        Configured LLM client instance
    """
    llm_config_from_metadata = None
    if scenario.language_config:
        llm_config_from_metadata = scenario.language_config.llm_config

    language_code = (
        scenario.language_config.language_code
        if scenario.language_config
        else DEFAULT_LANGUAGE_CODE
    )

    # Simulation-level temperature (promptData.temperature) — main agent only.
    roleplay_temperature = getattr(scenario.prompt_data, "temperature", None)

    # The main-agent prompt (or its selected variant) may carry its own
    # model/temperature default, which sits below the simulation override.
    main_prompt_code = (
        getattr(scenario.prompt_data, "selected_main_prompt_code", None)
        or DEFAULT_MAIN_AGENT_PROMPT_CODE
    )

    if llm_config_from_metadata:
        logger.info(
            f"Using LLM config from scenario metadata: "
            f"provider={llm_config_from_metadata.get('provider')}, "
            f"config={llm_config_from_metadata.get('config')}"
        )
    else:
        logger.info("No LLM config in scenario metadata, using defaults")

    try:
        llm_client = build_llm_client_for_prompt(
            scenario,
            main_prompt_code,
            base_llm_config=llm_config_from_metadata,
            language_code=language_code,
            simulation_temperature=roleplay_temperature,
        )
        logger.info(f"Successfully created LLM client: {type(llm_client).__name__}")
        return llm_client
    except Exception as e:
        logger.warning(f"LLM config failed, using default: {e}")
        logger.info("Falling back to default LLM configuration")
        # Deliberately DROP the prompt-level model override on fallback: if an
        # unrunnable model (e.g. a provider with no API key, or a model the key
        # can't access) is what failed, retrying with it would fail again and
        # break the session. Keep only the safe code default + simulation
        # temperature so the roleplay degrades gracefully instead of dying.
        return create_llm_client(
            language_code=language_code,
            temperature=roleplay_temperature,
        )


# ====================================================================
# Agent Creation
# ====================================================================


class GlossarySwapAgent(Agent):
    """The session's Agent, shaping its reply stream before TTS.

    Rewrites the LLM stream at ``llm_node`` — upstream of the tee into TTS and
    the transcript — so the counsellor hears, the transcript records and the
    judge scores the same text. Three streaming stages, each optional:

    * the leading-hesitation trim (``LeadingHesitationTrimmer``), only on a
      turn where an opener already played (read from ``TurnDelivery``);
    * the v3 audio-tag cap (``AudioTagLimiter``), for tag-capable voices;
    * the glossary's word swaps (``StreamingWordSwapper``). The graph state
      gets the same swap in ``generate_response``.

    With no stage active this is a pass-through.
    """

    def __init__(
        self,
        *,
        swap_table: dict[str, str],
        room_name: str,
        turn_delivery=None,
        audio_tag_cap: Optional[int] = None,
        **kwargs,
    ):
        super().__init__(**kwargs)
        self._swap_table = swap_table
        self._room_name = room_name
        self._turn_delivery = turn_delivery
        self._audio_tag_cap = audio_tag_cap

    def _reply_stages(self) -> list:
        """Fresh per-reply stages: held-back text dies with an interrupted reply."""
        from app.core.livekit.reply_shaping import (
            AudioTagLimiter,
            LeadingHesitationTrimmer,
        )

        stages: list = []
        turn_delivery = self._turn_delivery
        if turn_delivery is not None and getattr(
            settings, "REPLY_TRIM_LEADING_HESITATION", True
        ):
            # Lazy on purpose: whether an opener played is read at the FIRST
            # token, because llm_node can open before this turn's opener is
            # decided. Before the tag cap, so a leading pause tag it removes
            # does not use up the reply's tag budget.
            def _opener():
                return getattr(turn_delivery, "opener", None)

            stages.append(
                LeadingHesitationTrimmer(
                    is_active=lambda: bool(_opener() and _opener().made_a_sound),
                    # The filler's words and each interim piece: a reply that
                    # restates "I just feel…" as "I just feel like…" is heard
                    # as a restart. It read a field that no longer existed, so
                    # in prod V2V (2026-10-16) the interim was never trimmed.
                    phrases=lambda: [
                        p
                        for p in (
                            getattr(_opener(), "spoken", None),
                            *(getattr(_opener(), "interim", None) or ()),
                        )
                        if p
                    ],
                )
            )
        if self._audio_tag_cap is not None and self._audio_tag_cap >= 0:
            stages.append(AudioTagLimiter(self._audio_tag_cap))
        return stages

    async def llm_node(self, chat_ctx, tools, model_settings):
        stream = Agent.default.llm_node(self, chat_ctx, tools, model_settings)
        stages = self._reply_stages()
        swapper = StreamingWordSwapper(self._swap_table) if self._swap_table else None
        if swapper is not None:
            stages.append(swapper)
        if not stages:
            async for chunk in stream:
                yield chunk
            return

        def feed(text: str) -> str:
            for stage in stages:
                text = stage.feed(text) if text else text
            return text

        def flush() -> str:
            # Each stage takes the previous stage's tail, then releases its own.
            carry = ""
            for stage in stages:
                carry = (stage.feed(carry) if carry else "") + stage.flush()
            return carry

        last_chunk = None
        async for chunk in stream:
            if isinstance(chunk, str):
                out = feed(chunk)
                if out:
                    yield out
                continue
            delta = getattr(chunk, "delta", None)
            content = getattr(delta, "content", None) if delta else None
            if not content:
                yield chunk
                continue
            last_chunk = chunk
            # Copy rather than mutate: the chunk object may be shared with the
            # adapter's own bookkeeping.
            yield chunk.model_copy(
                update={"delta": delta.model_copy(update={"content": feed(content)})}
            )
        tail = flush()
        if tail:
            if last_chunk is not None:
                yield llm.ChatChunk(
                    id=last_chunk.id,
                    delta=llm.ChoiceDelta(role="assistant", content=tail),
                )
            else:
                yield tail
        summary = swapper.swap_summary() if swapper is not None else None
        if summary:
            turn_metrics.record(self._room_name, metadata={"glossary_swaps": summary})
            logger.info(
                "[GLOSSARY_SWAP] room=%s swaps=%s",
                self._room_name,
                ",".join(f"{r['avoid']}→{r['say']}×{r['count']}" for r in summary),
            )


def create_agent_with_adapter(
    thread_id: str,
    room: rtc.Room,
    scenario: Scenario,
    agent_joined_at: str,
    llm_client: BaseLLMClient,
    embedding_client: OpenAIEmbeddingClient,
    event_orchestrator: EventOrchestrator,
    tts_client: Optional[BaseTTSClient] = None,
    score_keeper: Optional[ScoreKeeper] = None,
    session_clock=None,
    rolling_summary_store=None,
    retrieved_context_store=None,
    client_working_memory_store=None,
    turn_delivery=None,
) -> Agent:
    """
    Create LLM adapter and agent instance.

    Args:
        thread_id: Thread identifier (usually room name)
        room: LiveKit room instance
        scenario: Scenario instance
        agent_joined_at: ISO timestamp when agent joined
        llm_client: LLM client instance
        embedding_client: Embedding client instance
        event_orchestrator: EventOrchestrator instance
        tts_client: Optional TTS client for voice expressions
        score_keeper: Optional ScoreKeeper instance for behavior score tracking

    Returns:
        Agent instance with LLM adapter
    """
    # Create LLM adapter (event_orchestrator will be set after it's created)
    configurable = {
        "thread_id": thread_id,
        "room": room,
        "scenario": scenario,
        "agent_joined_at": agent_joined_at,
        "event_orchestrator": event_orchestrator,
        "llm_client": llm_client,
        "embedding_client": embedding_client,
    }

    # Add TTS client if provided
    if tts_client:
        configurable["tts_client"] = tts_client

    # Add ScoreKeeper if provided
    if score_keeper:
        configurable["score_keeper"] = score_keeper

    # Add pause-aware session clock if provided (drives active-elapsed time and
    # the paused-state gate read by the graph nodes).
    if session_clock is not None:
        configurable["session_clock"] = session_clock

    # Rolling-summary store (episodic memory): worker-owned holder read by
    # generate_response and written by compact_history's background task.
    if rolling_summary_store is not None:
        configurable["rolling_summary_store"] = rolling_summary_store

    # Retrieved-context store (async knowledge retrieval): worker-owned
    # holder for stale-while-revalidate refreshes (KNOWLEDGE_RETRIEVAL_ASYNC).
    if retrieved_context_store is not None:
        configurable["retrieved_context_store"] = retrieved_context_store

    # The client's working memory. Presence in the config is what lets a graph
    # node no-op cleanly when it is absent — which is how the report graph
    # degrades, since it has no worker and therefore no store.
    if client_working_memory_store is not None:
        configurable["client_working_memory_store"] = client_working_memory_store

    # How each reply starts (app/core/livekit/delivery.py): the worker records
    # the opener it played here and the working-memory updater writes the next
    # plan.
    if turn_delivery is not None:
        configurable["turn_delivery"] = turn_delivery

    # Lazy import to avoid circular dependency
    from app.core.graph import agent_graph

    agent_adapter = LLMAdapter(
        graph=agent_graph,
        config={"configurable": configurable},
    )

    # Create agent
    # instructions is required by LiveKit Agent class
    # Using empty string since behavior is controlled by the LLM adapter/graph
    swap_table = swap_table_for(scenario)
    if swap_table:
        logger.info(
            "[GLOSSARY_SWAP] room=%s enabled pairs=%d", room.name, len(swap_table)
        )
    return GlossarySwapAgent(
        llm=agent_adapter,
        instructions="",
        swap_table=swap_table,
        room_name=room.name,
        turn_delivery=turn_delivery,
        audio_tag_cap=_audio_tag_cap(tts_client),
    )


def _audio_tag_cap(tts_client: Optional[BaseTTSClient]) -> Optional[int]:
    """Per-reply inline-tag cap for tag-capable (v3) voices; None otherwise."""
    try:
        if tts_client is None or not tts_client.supports_text_enhancement():
            return None
    except Exception:  # noqa: BLE001 - a capability probe must not break setup
        return None
    cap = int(getattr(settings, "AUDIO_TAG_MAX_PER_REPLY", 1))
    return cap if cap >= 0 else None


# ====================================================================
# Agent State Management
# ====================================================================


def initialize_agent_state(thread_id: str, scenario: Scenario) -> str:
    """
    Initialize agent graph state.

    Args:
        thread_id: Thread identifier (usually room name)
        scenario: Scenario instance containing events

    Returns:
        ISO timestamp string of when agent joined
    """
    # Lazy import to avoid circular dependency
    from app.core.graph import agent_graph

    agent_graph.update_state(
        {"configurable": {"thread_id": thread_id}},
        values={
            "messages": [],
            "permitted_events": scenario.events,
            "events_accumulator": [],
            "new_events": [],
            "current_score": 0,
            "branching_instructions": [],
        },
    )
    return datetime.now(timezone.utc).isoformat()


def should_say_opening_statement(
    scenario: Scenario,
    event_orchestrator: EventOrchestrator,
) -> bool:
    """
    Check if opening statement should be said.

    Args:
        scenario: Scenario instance
        event_orchestrator: EventOrchestrator instance

    Returns:
        True if opening statement should be said, False otherwise
    """
    return (
        scenario is not None
        and scenario.prompt_data is not None
        and scenario.prompt_data.opening_statements is not None
        and len(scenario.prompt_data.opening_statements) > 0
        and not event_orchestrator.is_termination_initiated()
    )


def should_auto_start_conversation(
    scenario: Scenario,
    event_orchestrator: EventOrchestrator,
) -> bool:
    """
    Decide whether the agent should open the conversation itself, via an
    LLM-generated turn, because there's no scripted opening statement.

    Opening statements are optional. When a scenario has none, we don't want
    the character to sit silent waiting for the counselor — the agent loop
    should start automatically so the character speaks first (the caller
    triggers `session.generate_reply()`).

    Returns True only when the session is otherwise ready to talk: a scenario
    exists and termination hasn't already been initiated. Mutually exclusive
    with `should_say_opening_statement` — that one wins whenever opening
    statements are present.

    Args:
        scenario: Scenario instance
        event_orchestrator: EventOrchestrator instance

    Returns:
        True if the agent should auto-start the conversation, False otherwise.
    """
    if scenario is None or event_orchestrator.is_termination_initiated():
        return False

    opening_statements = getattr(scenario.prompt_data, "opening_statements", None)
    return not opening_statements


# ====================================================================
# Cleanup
# ====================================================================


async def cleanup_background_tasks(background_tasks: Set[asyncio.Task]) -> None:
    """
    Cancel and await all background tasks.

    Args:
        background_tasks: Set of asyncio tasks to clean up
    """
    # Cancel all background tasks
    for task in background_tasks:
        if not task.done():
            task.cancel()

    # Wait for tasks to complete
    if background_tasks:
        await asyncio.gather(*background_tasks, return_exceptions=True)

    background_tasks.clear()
    logger.debug("Background tasks cleaned up")
