"""Agent setup and utility functions."""

import asyncio
from datetime import datetime, timezone
from typing import Optional, Set

from livekit import rtc
from livekit.agents import Agent
from livekit.plugins.langchain import LLMAdapter

from app.core.constants import DEFAULT_LANGUAGE_CODE
from app.core.embeddings import OpenAIEmbeddingClient
from app.core.events.event_orchestrator.event_orchestrator import EventOrchestrator
from app.core.graph import agent_graph
from app.core.scenario.base import Scenario
from app.llms import BaseLLMClient, create_llm_client
from app.stt import BaseSTTClient, create_stt_client
from app.tts import BaseTTSClient, Gender, create_tts_client
from app.utils.logger import get_logger

logger = get_logger(__name__)


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

    try:
        return create_llm_client(
            llm_config=llm_config_from_metadata,
            language_code=language_code,
        )
    except Exception as e:
        logger.warning(f"LLM config failed, using default: {e}")
        return create_llm_client(language_code=language_code)


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
