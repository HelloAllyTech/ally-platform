from typing import Optional, List, Any, Dict, Mapping

from pydantic import BaseModel, Field

from app.core.constants import VisibilityType, TTSProvider
from app.core.events.base import BaseEvent
from app.core.events.factory import build_events_from_metadata
from app.core.events.registry import get_event_class

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
    opening_statements : str = Field(...)
    agent_goal : Optional[str] = Field(default=None)


class VoiceConfig(BaseModel):
    model: Optional[str] = Field(default=None)
    voice_id: Optional[str] = Field(default=None)

    speaker: Optional[str] = Field(default=None)



class ScenarioVoice(BaseModel):
    name: str = Field(alias="name")
    provider : str = Field(alias="provider")
    config : VoiceConfig = Field(alias="config")



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
    metadata: Dict[str, Any] = Field(default_factory=dict)
    voice: ScenarioVoice = Field(default_factory=ScenarioVoice)
    prompt_data : VoicePromptData = Field(default_factory=VoicePromptData)

    model_config = {
        "populate_by_name": True,     # allow both alias and field name on input
        "arbitrary_types_allowed": True,
    }

    # ---------------------------
    # Public constructor
    # ---------------------------
    @classmethod
    def create(cls, payload: Mapping[str, Any]) -> "Scenario":
        """
        Build a Scenario from:
          - a top-level BE payload: {"version": "...", "scenario": {...}}
          - or a bare scenario dict: {"id": "...", "scenarioName": "...", ...}

        Ensures `events` are BaseEvent instances resolved via your registry.
        (Only events whose `id` exists in the registry are instantiated.)
        """
        raw = cls._extract_scenario_section(payload)
        normalized = cls._normalize_top_level_fields(raw)
        # built_events = cls._build_events(raw)
        built_events = build_events_from_metadata(raw)
        # Build voice from metadata (if present)
        voice_obj = cls._build_voice(raw)
        prompt_data = cls._build_prompt_data(raw)

        return cls(
            scenarioName=normalized["scenarioName"],
            learningObjective=normalized["learningObjective"],
            prompt=normalized["prompt"],
            metadata=normalized.get("metadata", {}),
            events=built_events,
            voice=voice_obj,
            prompt_data=prompt_data
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
    def _build_events(raw: Mapping[str, Any]) -> List[BaseEvent]:
        """
        Convert BE event dicts to instantiated BaseEvent objects using the registry.
        - Adds score, emoji, message -> emoji_message, conversationInstruction -> conversation_instruction
        - Skips events that have no registered class.
        """
        instances: List[BaseEvent] = []
        for e in (raw.get("events") or []):
            ev_cls = get_event_class(e.get("id", ""))
            if ev_cls is None:
                # No registered class for this id; skip silently (or log if desired)
                continue

            kwargs = {
                "score": e.get("score", None),
                "emoji": e.get("emoji", None),
                "emoji_message": e.get("message", None),  # map BE `message` -> BaseEvent.emoji_message
                "branching_instruction": e.get("branchingInstruction", None),
                "visibility_type": e.get("visibilityType", VisibilityType.ACTIVE)
            }
            instances.append(ev_cls(**kwargs))

        return instances

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
            print("Error: 'promptData' key not found in raw data.")
            return None

        try:
            mapped_data = {
                "name": prompt_data_dict.get("name"),
                "age": prompt_data_dict.get("age"),
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
            print(f"Error instantiating VoicePromptData from mapped data: {e}")
            return None



