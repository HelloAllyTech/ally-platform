from typing import Optional, List, Any, Dict, Mapping

from pydantic import BaseModel, Field

from app.core.events.base import BaseEvent
from app.core.events.factory import build_events_from_metadata
from app.core.language import DEFAULT_LANGUAGE_CODE
from app.core.embeddings import BaseEmbeddingClient
from app.utils import get_logger

logger = get_logger(__name__)

class TerminationEvent(BaseModel):
    """Configuration for auto-termination event."""
    id: str = Field(..., description="Event ID that triggers termination")
    termination_message: str = Field(..., alias="terminationMessage", description="Custom message to speak on termination")

class VoicePromptData(BaseModel):
    name : str = Field(...)
    age : str = Field(...)
    gender : str = Field(...)
    gender_identity : Optional[str] = Field(default=None)
    sexual_orientation : Optional[str] = Field(default=None)
    current_location : str = Field(...)
    profession : Optional[str] = Field(default=None)
    context : str = Field(...)
    session_behavior_guidelines : Optional[str] = Field(default=None)
    life_history_summary : str = Field(...)
    core_memories : Optional[str] = Field(default=None)
    personality : Optional[str] = Field(default=None)
    starting_state : Optional[str] = Field(default=None)
    emotional_needs : Optional[str] = Field(default=None)
    tone : Optional[str] = Field(default=None)
    opening_statements : List[str] = Field(...)
    agent_goal : Optional[str] = Field(default=None)


class VoiceConfig(BaseModel):
    model: Optional[str] = Field(default=None)
    voice_id: Optional[str] = Field(default=None)

    speaker: Optional[str] = Field(default=None)



class ScenarioVoice(BaseModel):
    name: str = Field(alias="name")
    provider : str = Field(alias="provider")
    config : VoiceConfig = Field(alias="config")


class LanguageConfig(BaseModel):
    """Language-specific configuration for STT and LLM providers."""
    language_code: str = Field(default=DEFAULT_LANGUAGE_CODE)
    stt_config: Optional[Dict[str, Any]] = Field(default=None)
    llm_config: Optional[Dict[str, Any]] = Field(default=None)



class Scenario(BaseModel):
    """
    Parsed scenario ready for runtime.
    - Accepts BE keys via aliases (e.g., `scenarioName`, `lifeHistory`).
    - `events` contains instantiated BaseEvent subclasses (from your registry).
    """
    name: str = Field(alias="scenarioName")
    learning_objective: str = Field(alias="learningObjective")
    prompt: str
    events: List[BaseEvent] = Field(default_factory=list)
    trigger_events: List[str] = Field(default_factory=list, description="List of event IDs that should be sent to UI/Core")
    termination_event: Optional[TerminationEvent] = Field(default=None, alias="terminationEvent", description="Configuration for auto-termination event")
    metadata: Dict[str, Any] = Field(default_factory=dict)
    voice: Optional[ScenarioVoice] = Field(default=None)
    prompt_data : VoicePromptData = Field(default_factory=VoicePromptData)
    language_config: Optional[LanguageConfig] = Field(default=None)

    model_config = {
        "populate_by_name": True,     # allow both alias and field name on input
        "arbitrary_types_allowed": True,
    }

    # ---------------------------
    # Public constructor
    # ---------------------------
    @classmethod
    def create(cls, payload: Mapping[str, Any], embedding_client: Optional[BaseEmbeddingClient] = None) -> "Scenario":
        """
        Build a Scenario from:
          - a top-level BE payload: {"version": "...", "scenario": {...}}
          - or a bare scenario dict: {"id": "...", "scenarioName": "...", ...}

        Ensures `events` are BaseEvent instances resolved via your registry.
        (Only events whose `id` exists in the registry are instantiated.)

        Args:
            payload: Scenario metadata
            embedding_client: Optional shared embedding client for semantic similarity events
        """
        raw = cls._extract_scenario_section(payload)
        normalized = cls._normalize_top_level_fields(raw)
        # built_events = cls._build_events(raw)
        built_events = build_events_from_metadata(raw, embedding_client=embedding_client)
        # Build voice from metadata (if present)
        voice_obj = cls._build_voice(raw)
        prompt_data = cls._build_prompt_data(raw)
        language_config = cls._build_language_config(raw)
        # Extract trigger_events (list of event IDs that should be sent)
        trigger_events = raw.get("trigger_events") or []
        # Extract termination event configuration
        termination_event = cls._build_termination_event(raw)

        return cls(
            scenarioName=normalized["scenarioName"],
            learningObjective=normalized["learningObjective"],
            prompt=normalized["prompt"],
            metadata=normalized.get("metadata", {}),
            events=built_events,
            trigger_events=trigger_events if isinstance(trigger_events, list) else [],
            terminationEvent=termination_event,
            voice=voice_obj,
            prompt_data=prompt_data,
            language_config=language_config
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
            "learningObjective": raw.get("description") or "",
            "prompt": raw.get("prompt") or "",
            "metadata": raw.get("metadata", {})
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
            voice_id=config_meta.get("voice_id"),
            speaker=config_meta.get("speaker"),
        )

        return ScenarioVoice(
            name=voice_meta.get("name", ""),
            provider=voice_meta.get("provider", "").lower(),
            config=voice_config,
        )

    @staticmethod
    def _build_prompt_data(raw: Mapping[str, Any]) -> VoicePromptData:
        """
        Parses the raw input dictionary, maps keys, and creates a VoicePromptData object.
        """
        prompt_data_dict = raw.get("promptData")

        if not prompt_data_dict:
            logger.error("Error: 'promptData' key not found in raw data.")
            return None

        try:
            mapped_data = {
                "name": prompt_data_dict.get("name"),
                "age": str(prompt_data_dict.get("age")),
                "gender": prompt_data_dict.get("gender"),
                "gender_identity": prompt_data_dict.get("genderIdentity",None),
                "sexual_orientation": prompt_data_dict.get("sexualOrientation",None),
                "current_location": prompt_data_dict.get("currentLocation"),
                "profession": prompt_data_dict.get("profession",None),
                "context": prompt_data_dict.get("context"),
                "session_behavior_guidelines": prompt_data_dict.get("sessionBehaviorGuidelines",None),
                "life_history_summary": prompt_data_dict.get("lifeHistory"),
                "core_memories": prompt_data_dict.get("coreMemories",None),
                "personality": prompt_data_dict.get("personality",None),
                "starting_state": prompt_data_dict.get("startingState",None),
                "emotional_needs": prompt_data_dict.get("emotionalNeeds",None),
                "tone": prompt_data_dict.get("tone",None),
                "opening_statements": prompt_data_dict.get("openingStatements"),
                "agent_goal": prompt_data_dict.get("agentGoal"),
            }

            prompt_data_obj = VoicePromptData(**mapped_data)
            return prompt_data_obj
        except Exception as e:
            logger.error(f"Error instantiating VoicePromptData from mapped data: {e}")
            return None

    @staticmethod
    def _build_termination_event(raw: Mapping[str, Any]) -> Optional[TerminationEvent]:
        """Extract termination event configuration from scenario-level `autoTerminationEvent` key."""
        termination_event_data = raw.get("autoTerminationEvent")
        if not termination_event_data:
            return None

        try:
            return TerminationEvent(**termination_event_data)
        except Exception as e:
            logger.error(f"Error instantiating TerminationEvent from data: {e}")
            return None

    @staticmethod
    def _build_language_config(raw: Mapping[str, Any]) -> LanguageConfig:
        """
        Extract language configuration from metadata.

        Parses:
        - languageCode: BCP 47 language code (defaults to "en-IN")
        - stt: Optional STT provider override {provider: "...", config: {...}}
        - llm: Optional LLM provider override {provider: "...", model: "...", temperature: ..., config: {...}}

        Args:
            raw: Raw scenario dictionary from metadata

        Returns:
            LanguageConfig object with language code and optional STT/LLM overrides
        """
        language_code = raw.get("languageCode", DEFAULT_LANGUAGE_CODE)
        stt_config = raw.get("stt")
        llm_config = raw.get("llm")

        return LanguageConfig(
            language_code=language_code,
            stt_config=stt_config,
            llm_config=llm_config
        )



