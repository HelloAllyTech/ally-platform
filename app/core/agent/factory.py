"""Agent setup and utility functions."""

import asyncio
import json
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Set

from livekit import rtc
from livekit.agents import Agent
from livekit.plugins.langchain import LLMAdapter

from app.core.config import settings
from app.core.constants import DEFAULT_LANGUAGE_CODE, Environment
from app.core.embeddings import BaseEmbeddingClient, OpenAIEmbeddingClient
from app.core.events.event_orchestrator.event_orchestrator import EventOrchestrator
from app.core.livekit.livekit_models import RoomMetadataEnvelope
from app.core.logger import get_logger
from app.core.scenario.base import Scenario
from app.core.scoring.score_keeper import ScoreKeeper
from app.llms import BaseLLMClient, create_llm_client
from app.stt import BaseSTTClient, create_stt_client
from app.tts import BaseTTSClient, Gender, create_tts_client

logger = get_logger(__name__)


# ====================================================================
# Metadata Parsing
# ====================================================================


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
    tts_config_from_metadata = None
    if scenario.voice:
        logger.debug(
            f"[TTS Config] Building config from scenario.voice: "
            f"provider={scenario.voice.provider}, name={scenario.voice.name}"
        )
        logger.debug(
            f"[TTS Config] Voice config: model={scenario.voice.config.model}, "
            f"voice_id={scenario.voice.config.voice_id}"
        )
        tts_config_from_metadata = {
            "provider": scenario.voice.provider,
            "name": scenario.voice.name,
            "config": {
                "model": scenario.voice.config.model,
                "voice_id": scenario.voice.config.voice_id,
                "speaker": scenario.voice.config.speaker,
                "voice_name": scenario.voice.config.voice_name,
                "model_name": scenario.voice.config.model_name,
                "gender": scenario.voice.config.gender,
                "voice_cloning_key": scenario.voice.config.voice_cloning_key,
                "instant_mode": scenario.voice.config.instant_mode,
                "voice_provider": scenario.voice.config.voice_provider,
            },
        }
        logger.debug(
            f"[TTS Config] Built tts_config_from_metadata: {tts_config_from_metadata}"
        )

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


def configure_llm_client(scenario: Scenario) -> BaseLLMClient:
    """
    Configure LLM client from scenario metadata with fallback.

    Args:
        scenario: Scenario instance containing language config

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

    # Roleplay-level temperature override (promptData.temperature). When set, it
    # takes precedence over llm.config.temperature and the global default; lets a
    # persona that needs tight consistency run cooler than the platform default.
    roleplay_temperature = getattr(scenario.prompt_data, "temperature", None)

    # Log LLM config for debugging
    if llm_config_from_metadata:
        logger.info(
            f"Using LLM config from scenario metadata: "
            f"provider={llm_config_from_metadata.get('provider')}, "
            f"config={llm_config_from_metadata.get('config')}"
        )
    else:
        logger.info("No LLM config in scenario metadata, using defaults")

    if roleplay_temperature is not None:
        logger.info(
            "Applying roleplay-level temperature override: %s", roleplay_temperature
        )

    try:
        llm_client = create_llm_client(
            llm_config=llm_config_from_metadata,
            language_code=language_code,
            temperature=roleplay_temperature,
        )
        logger.info(f"Successfully created LLM client: {type(llm_client).__name__}")
        return llm_client
    except Exception as e:
        logger.warning(f"LLM config failed, using default: {e}")
        logger.info("Falling back to default LLM configuration")
        return create_llm_client(
            language_code=language_code,
            temperature=roleplay_temperature,
        )


# ====================================================================
# Agent Creation
# ====================================================================


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

    # Lazy import to avoid circular dependency
    from app.core.graph import agent_graph

    agent_adapter = LLMAdapter(
        graph=agent_graph,
        config={"configurable": configurable},
    )

    # Create agent
    # instructions is required by LiveKit Agent class
    # Using empty string since behavior is controlled by the LLM adapter/graph
    return Agent(llm=agent_adapter, instructions="")


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
