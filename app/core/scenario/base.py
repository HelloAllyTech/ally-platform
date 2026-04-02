from enum import Enum
from typing import Any, Dict, List, Mapping, Optional

from pydantic import BaseModel, Field

from app.core.branching_instructions.base import BranchingInstruction
from app.core.config import settings
from app.core.constants import (
    DEFAULT_LANGUAGE_CODE,
    VisibilityType,
    normalize_language_code_for_providers,
)
from app.core.embeddings import BaseEmbeddingClient
from app.core.events.base import BaseEvent
from app.core.events.event_types.guardrail.guardrail_event import GuardrailEvent
from app.core.events.event_types.guardrail.schemas import GuardrailData
from app.core.events.factory import build_events_from_metadata
from app.core.logger import get_logger
from app.core.scenario.simulation_instructions import (
    SimulationBehaviorInstruction,
    SimulationStateInstruction,
)

logger = get_logger(__name__)


class TerminationEvent(BaseModel):
    """Configuration for auto-termination event."""

    id: str = Field(..., description="Event ID that triggers termination")
    termination_message: str = Field(
        ...,
        description="Custom message to speak on termination",
    )
    score: Optional[float] = Field(
        default=None,
        description="Score magnitude for prioritizing termination events",
    )


class ScenarioResponseLength(str, Enum):
    VERY_BRIEF = "VERY_BRIEF"
    BRIEF = "BRIEF"
    MEDIUM = "MEDIUM"
    ELABORATE = "ELABORATE"


class PromptData(BaseModel):
    title: Optional[str] = Field(default=None)
    description: Optional[str] = Field(default=None)
    name: str = Field(...)
    age: str = Field(...)
    gender: str = Field(...)
    role_instructions: Optional[str] = Field(default=None)
    gender_identity: Optional[str] = Field(default=None)
    sexual_orientation: Optional[str] = Field(default=None)
    current_location: str = Field(...)
    profession: Optional[str] = Field(default=None)
    character_profile_text: Optional[str] = Field(default=None)
    context: Optional[str] = Field(default=None)
    session_behavior_guidelines: Optional[str] = Field(default=None)
    life_history_summary: Optional[str] = Field(default=None)
    core_memories: Optional[str] = Field(default=None)
    personality: Optional[str] = Field(default=None)
    starting_state: Optional[str] = Field(default=None)
    emotional_needs: Optional[str] = Field(default=None)
    tone: Optional[str] = Field(default=None)
    opening_statements: List[str] = Field(...)
    agent_goal: Optional[str] = Field(default=None)
    custom_fields: Optional[List[Dict[str, Any]]] = Field(
        default_factory=list, description="Dynamic custom fields"
    )
    prompt: Optional[str] = Field(default=None)
    response_length: Optional[ScenarioResponseLength] = Field(default=None)
    agent_dialogues: Optional[List[str]] = Field(default=None)
    previous_memory: Optional[str] = Field(
        default=None,
        description="Summary from previous session for continuity",
    )
    prompts: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Editable prompt templates from backend (promptData.prompts). "
        "Keys: ally_ai_learn_system_base_role_instruction, ally_ai_learn_prosody_*, "
        "etc. Values may be raw strings or objects with prompt metadata like "
        "{prompt: str, availableVariables: string[]}.",
    )
    competency: Optional[str] = Field(
        default=None,
        description="The counseling competency being trained in this simulation. "
        "When set, the simulation is shaped to help the counselor practice and "
        "learn this specific competency.",
    )
    language_dialogue_samples: Optional[List] = Field(
        default=None,
        description=(
            "Sample utterances for linguistic style in target language. "
            "When present for non-English, injected into prompt; when absent, "
            "no language block is added. Format: "
            '["utterance 1", "utterance 2", ...] or '
            '[{"counselor": "...", "actor": "..."}, ...].'
        ),
    )
    allowed_fillers: Optional[List[str]] = Field(
        default=None,
        description=(
            "Optional discourse particles / filler words allowed for this "
            "session language; injected into multilingual instructions. "
            "From scenario metadata allowedFillerWords for the active language."
        ),
    )
    knowledge_sources: Optional[List[Dict[str, str]]] = Field(
        default=None,
        description=(
            "Key-description pairs for RAG-like retrieval. "
            'Format: [{"key": "topic name", "description": "detailed info"}, ...]. '
            "The system uses an LLM to identify relevant keys per utterance "
            "and injects the corresponding descriptions into the prompt."
        ),
    )


class VoiceConfig(BaseModel):
    model: Optional[str] = Field(default=None)
    voice_id: Optional[str] = Field(default=None)
    speaker: Optional[str] = Field(default=None)
    voice_name: Optional[str] = Field(default=None)  # For Google TTS
    # Google TTS only: optional override for livekit.plugins.google.TTS model_name
    # (chirp_3, gemini-2.5-flash-tts, …). Unset = client uses same rules as the plugin.
    model_name: Optional[str] = Field(default=None)
    gender: Optional[str] = Field(
        default=None
    )  # For Google TTS ("male", "female", "neutral")
    voice_cloning_key: Optional[str] = Field(
        default=None
    )  # For Google TTS custom voices
    instant_mode: Optional[bool] = Field(default=None)  # For Hume TTS
    voice_provider: Optional[str] = Field(
        default=None
    )  # For Hume TTS: "HUME_AI" (pre-existing) or "CUSTOM_VOICE" (custom)


class ScenarioVoice(BaseModel):
    name: str = Field(alias="name")
    provider: str = Field(alias="provider")
    config: VoiceConfig = Field(alias="config")


class LanguageConfig(BaseModel):
    """Language-specific configuration for STT and LLM providers."""

    language_code: str = Field(default=DEFAULT_LANGUAGE_CODE)
    stt_config: Optional[Dict[str, Any]] = Field(default=None)
    llm_config: Optional[Dict[str, Any]] = Field(default=None)
    branching_llm_config: Optional[Dict[str, Any]] = Field(
        default=None,
        description="LLM config for branching instruction resolution "
        "(structured output)",
    )


class Scenario(BaseModel):
    """
    Parsed scenario ready for runtime.
    - Accepts BE keys via aliases (e.g., `scenarioName`, `lifeHistory`).
    - `events` contains instantiated BaseEvent subclasses (from your registry).
    """

    name: str = Field(alias="scenarioName")
    events: List[BaseEvent] = Field(default_factory=list)
    trigger_events: List[str] = Field(
        default_factory=list,
        description="List of event IDs that should be sent to UI/Core",
    )
    termination_events: List[TerminationEvent] = Field(
        default_factory=list,
        description="List of auto-termination event configurations",
    )
    metadata: Dict[str, Any] = Field(default_factory=dict)
    voice: Optional[ScenarioVoice] = Field(default=None)
    prompt_data: PromptData = Field(default_factory=PromptData)
    language_config: Optional[LanguageConfig] = Field(default=None)
    behavior_instructions: Optional[List[SimulationBehaviorInstruction]] = Field(
        default=None,
        description="Behavior guidelines for what helper should/shouldn't do",
    )
    state_instructions: Optional[List[SimulationStateInstruction]] = Field(
        default=None,
        description="Ordered agent states with instructions and dialogues",
    )

    model_config = {
        "populate_by_name": True,  # allow both alias and field name on input
        "arbitrary_types_allowed": True,
    }

    # ---------------------------
    # Public constructor
    # ---------------------------
    @classmethod
    def create(
        cls,
        payload: Mapping[str, Any],
        embedding_client: Optional[BaseEmbeddingClient] = None,
        branching_llm_config: Optional[Dict[str, Any]] = None,
    ) -> "Scenario":
        """
        Build a Scenario from:
          - a top-level BE payload: {"version": "...", "scenario": {...}}
          - or a bare scenario dict: {"id": "...", "scenarioName": "...", ...}

        Ensures `events` are BaseEvent instances resolved via your registry.
        (Only events whose `id` exists in the registry are instantiated.)

        Args:
            payload: Scenario metadata
            embedding_client: Optional shared embedding client for
                semantic similarity events
            branching_llm_config: Optional LLM config for branching instruction
                resolution (structured output support)
        """
        raw = cls._extract_scenario_section(payload)
        normalized = cls._normalize_top_level_fields(raw)
        # built_events = cls._build_events(raw)
        built_events = build_events_from_metadata(
            raw,
            embedding_client=embedding_client,
        )
        # Build voice from metadata (if present)
        voice_obj = cls._build_voice(raw)
        prompt_data = cls._build_prompt_data(raw)
        language_config = cls._build_language_config(
            raw, branching_llm_config=branching_llm_config
        )
        # Extract trigger_events (list of event IDs that should be sent).
        trigger_events = raw.get("triggerEvents") or []
        # Extract termination event configuration (supports both old and new keys)
        termination_events = cls._build_termination_events(raw)

        # Parse simulation instructions (same level as events)
        behavior_instructions = raw.get("behaviorInstructions")
        state_instructions = raw.get("stateInstructions")

        # Parse guardrails array and build one GuardrailEvent per entry
        guardrail_events = []
        guardrails_raw = raw.get("guardrails") or []
        if isinstance(guardrails_raw, list):
            for i, g in enumerate(guardrails_raw):
                try:
                    helper_dialogue = g.get("helperDialogue", "")
                    actor_dialogue = g.get("actorDialogue", "")

                    if not helper_dialogue or not actor_dialogue:
                        logger.warning(
                            f"Skipping guardrail at index {i}: "
                            f"missing helperDialogue or actorDialogue"
                        )
                        continue

                    # Determine LLM base URL for guardrail classification
                    # Use Ollama if configured, otherwise default to OpenAI
                    guardrail_llm_base_url = None
                    if settings.OLLAMA_BASE_URL and settings.LOCAL_LLM_MODEL:
                        guardrail_llm_base_url = settings.OLLAMA_BASE_URL
                        guardrail_model = settings.LOCAL_LLM_MODEL
                    else:
                        guardrail_model = "gpt-4o-mini"

                    # Then in GuardrailEvent.create():
                    g_event = GuardrailEvent.create(
                        event_id=f"guardrail-{i}",
                        data=GuardrailData(
                            helper_dialogue=helper_dialogue,
                            actor_dialogue=actor_dialogue,
                        ),
                        model=guardrail_model,
                        llm_base_url=guardrail_llm_base_url,
                        branching_instruction=BranchingInstruction.create(
                            actor_dialogue, prompt_data=None
                        ),
                        score=0,
                        visibility_type=VisibilityType.PASSIVE,
                        emoji=None,
                        emoji_message=None,
                    )
                    guardrail_events.append(g_event)

                except Exception as e:
                    logger.warning(f"Failed to build guardrail event at index {i}: {e}")

            if guardrail_events:
                logger.info(f"Built {len(guardrail_events)} guardrail events")
                built_events = built_events + guardrail_events
                trigger_events = list(trigger_events) + [
                    e.event_id for e in guardrail_events
                ]

        return cls(
            scenarioName=normalized["scenarioName"],
            metadata=normalized.get("metadata", {}),
            events=built_events,
            trigger_events=trigger_events,
            termination_events=termination_events,
            voice=voice_obj,
            prompt_data=prompt_data,
            language_config=language_config,
            behavior_instructions=behavior_instructions,
            state_instructions=state_instructions,
        )

    # ---------------------------
    # Internal helpers
    # ---------------------------
    @staticmethod
    def _extract_scenario_section(payload: Mapping[str, Any]) -> Mapping[str, Any]:
        """Return the inner scenario dict from an envelope or the payload itself."""
        return payload.get("scenario", payload)

    @staticmethod
    def _normalize_top_level_fields(raw: Mapping[str, Any]) -> Dict[str, Any]:
        """
        Normalize BE keys to what Scenario expects (compatible with aliases).
        """
        return {
            "scenarioName": raw.get("title") or "",
            "metadata": raw.get("metadata", {}),
        }

    @staticmethod
    def _build_voice(raw: Mapping[str, Any]) -> Optional[ScenarioVoice]:
        """Extract voice config from scenario-level `voice` key."""
        voice_meta = raw.get("voice")
        if not voice_meta:
            return None

        config_meta = voice_meta.get("config", {}) or {}

        voice_config = VoiceConfig(
            model=config_meta.get("model"),
            voice_id=config_meta.get("voice_id") or config_meta.get("voiceId"),
            speaker=config_meta.get("speaker"),
            voice_name=config_meta.get("voice_name"),
            model_name=config_meta.get("model_name"),
            gender=config_meta.get("gender"),
            voice_cloning_key=config_meta.get("voice_cloning_key"),
            instant_mode=config_meta.get("instant_mode"),
            voice_provider=config_meta.get("voice_provider"),
        )

        return ScenarioVoice(
            name=voice_meta.get("name", ""),
            provider=voice_meta.get("provider", "").lower(),
            config=voice_config,
        )

    @staticmethod
    def _build_prompt_data(raw: Mapping[str, Any]) -> PromptData:
        """
        Parses the raw input dictionary, maps keys, and creates a
        PromptData object.
        """
        prompt_data_dict = raw.get("promptData")

        if not prompt_data_dict:
            logger.error("Error: 'promptData' key not found in raw data.")
            return None

        try:
            mapped_data = {
                "title": prompt_data_dict.get("title") or raw.get("title"),
                "description": prompt_data_dict.get("description")
                or raw.get("description"),
                "name": prompt_data_dict.get("name"),
                "age": str(prompt_data_dict.get("age")),
                "gender": prompt_data_dict.get("gender"),
                "role_instructions": prompt_data_dict.get("roleInstructions", None),
                "gender_identity": prompt_data_dict.get("genderIdentity", None),
                "sexual_orientation": prompt_data_dict.get("sexualOrientation", None),
                "current_location": prompt_data_dict.get("currentLocation"),
                "profession": prompt_data_dict.get("profession", None),
                "character_profile_text": prompt_data_dict.get(
                    "characterProfileText", None
                ),
                "context": prompt_data_dict.get("context"),
                "session_behavior_guidelines": prompt_data_dict.get(
                    "sessionBehaviorGuidelines", None
                ),
                "life_history_summary": prompt_data_dict.get("lifeHistory"),
                "core_memories": prompt_data_dict.get("coreMemories", None),
                "personality": prompt_data_dict.get("personality", None),
                "starting_state": prompt_data_dict.get("startingState", None),
                "emotional_needs": prompt_data_dict.get("emotionalNeeds", None),
                "tone": prompt_data_dict.get("tone", None),
                "opening_statements": prompt_data_dict.get("openingStatements") or [],
                "agent_goal": prompt_data_dict.get("agentGoal"),
                "custom_fields": prompt_data_dict.get("customFields"),
                # Legacy: backend may send at scenario.prompt or promptData.prompt
                "prompt": prompt_data_dict.get("prompt") or raw.get("prompt"),
                "response_length": prompt_data_dict.get("responseLength"),
                "agent_dialogues": prompt_data_dict.get("agentDialogues"),
                "previous_memory": prompt_data_dict.get("previousMemory", None),
                "prompts": prompt_data_dict.get("prompts"),
                "competency": prompt_data_dict.get("competency", None),
                "language_dialogue_samples": prompt_data_dict.get(
                    "languageDialogueSamples"
                )
                or prompt_data_dict.get("language_dialogue_samples"),
                "allowed_fillers": prompt_data_dict.get("allowedFillerWords")
                or prompt_data_dict.get("allowedFillers")
                or prompt_data_dict.get("allowed_fillers"),
                "knowledge_sources": prompt_data_dict.get("knowledgeSources"),
            }

            prompt_data_obj = PromptData(**mapped_data)
            return prompt_data_obj
        except Exception as e:
            logger.error(f"Error instantiating PromptData from mapped data: {e}")
            return None

    @staticmethod
    def _normalize_termination_event_data(event_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Normalize termination event data from BE camelCase to Python snake_case.

        Args:
            event_data: Raw termination event data from metadata

        Returns:
            Normalized dict with snake_case keys
        """
        return {
            "id": event_data.get("id"),
            "termination_message": event_data.get("terminationMessage"),
            "score": event_data.get("score"),
        }

    @staticmethod
    def _build_termination_events(raw: Mapping[str, Any]) -> List[TerminationEvent]:
        """
        Extract termination event configurations from scenario metadata.

        Supports both BE metadata keys for backward compatibility:
        - `autoTerminationEvent` (deprecated, single event)
        - `autoTerminationEvents` (new, list of events)

        Returns:
            List of TerminationEvent objects combined from both keys
        """
        termination_events: List[TerminationEvent] = []

        # Handle deprecated autoTerminationEvent (single event from BE)
        termination_event_data = raw.get("autoTerminationEvent")
        if termination_event_data:
            try:
                normalized_data = Scenario._normalize_termination_event_data(
                    termination_event_data
                )

                # Validate required fields before creating TerminationEvent
                if not normalized_data.get("id"):
                    logger.error(
                        f"autoTerminationEvent is missing required 'id' field. "
                        f"Event data: {termination_event_data}"
                    )
                elif not normalized_data.get("termination_message"):
                    logger.error(
                        f"autoTerminationEvent '{normalized_data.get('id')}' "
                        f"is missing required 'terminationMessage' field. "
                        f"Event data: {termination_event_data}"
                    )
                else:
                    event = TerminationEvent(**normalized_data)
                    termination_events.append(event)
                    logger.debug(
                        f"Successfully parsed termination event '{event.id}' "
                        f"with message length: {len(event.termination_message)}"
                    )
            except Exception as e:
                normalized_data_str = (
                    normalized_data if "normalized_data" in locals() else "N/A"
                )
                logger.error(
                    f"Error instantiating TerminationEvent from "
                    f"autoTerminationEvent: {e}. "
                    f"Event data: {termination_event_data}. "
                    f"Normalized data: {normalized_data_str}"
                )

        # Handle new autoTerminationEvents (list of events)
        termination_events_data = raw.get("autoTerminationEvents", [])
        if termination_events_data and isinstance(termination_events_data, list):
            for idx, event_data in enumerate(termination_events_data):
                normalized_data = None
                try:
                    normalized_data = Scenario._normalize_termination_event_data(
                        event_data
                    )

                    # Validate required fields before creating TerminationEvent
                    if not normalized_data.get("id"):
                        logger.error(
                            f"Termination event at index {idx} is missing "
                            f"required 'id' field. Event data: {event_data}"
                        )
                        continue

                    if not normalized_data.get("termination_message"):
                        logger.error(
                            f"Termination event '{normalized_data.get('id')}' "
                            f"is missing required 'terminationMessage' field. "
                            f"Event data: {event_data}"
                        )
                        continue

                    event = TerminationEvent(**normalized_data)
                    termination_events.append(event)
                    logger.debug(
                        f"Successfully parsed termination event '{event.id}' "
                        f"with message length: {len(event.termination_message)}"
                    )
                except Exception as e:
                    normalized_data_str = normalized_data if normalized_data else "N/A"
                    logger.error(
                        f"Error instantiating TerminationEvent from "
                        f"autoTerminationEvents at index {idx}: {e}. "
                        f"Event data: {event_data}. "
                        f"Normalized data: {normalized_data_str}"
                    )

        # Log summary of parsed termination events
        if termination_events:
            logger.info(
                f"Successfully parsed {len(termination_events)} termination event(s): "
                f"{[te.id for te in termination_events]}"
            )
        else:
            logger.debug("No termination events configured in scenario")

        return termination_events

    @staticmethod
    def _build_language_config(
        raw: Mapping[str, Any],
        branching_llm_config: Optional[Dict[str, Any]] = None,
    ) -> LanguageConfig:
        """
        Extract language configuration from metadata.

        Parses:
        - languageCode: BCP 47 language code (defaults to "en-IN")
        - stt: Optional STT provider configuration (currently unused -
          uses language registry)
        - llm: Optional LLM provider configuration (currently unused -
          uses language registry)
        - branching_llm_config: Optional LLM config for branching instruction
          resolution (passed from worker)

        Args:
            raw: Raw scenario dictionary from metadata
            branching_llm_config: Optional LLM config for branching (structured output)

        Returns:
            LanguageConfig object with language code and optional STT/LLM overrides
        """
        language_code = normalize_language_code_for_providers(
            raw.get("languageCode", DEFAULT_LANGUAGE_CODE)
        )
        stt_config = raw.get("stt")
        llm_config = raw.get("llm")

        return LanguageConfig(
            language_code=language_code,
            stt_config=stt_config,
            llm_config=llm_config,
            branching_llm_config=branching_llm_config,
        )
