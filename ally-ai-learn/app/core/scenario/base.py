from datetime import datetime as _datetime
from datetime import timezone
from enum import Enum
from typing import Any, Dict, List, Mapping, Optional

from pydantic import BaseModel, Field, field_validator

from app.core.branching_instructions.base import BranchingInstruction
from app.core.config import settings
from app.core.constants import (
    DEFAULT_LANGUAGE_CODE,
    VisibilityType,
    normalize_language_code_for_providers,
)
from app.core.embeddings import BaseEmbeddingClient
from app.core.events.base import BaseEvent, DetectionConfig
from app.core.events.event_types.guardrail.guardrail_event import GuardrailEvent
from app.core.events.event_types.guardrail.schemas import GuardrailData
from app.core.events.factory import build_events_from_metadata
from app.core.logger import get_logger
from app.core.scenario.interaction_mode import (
    INTERACTION_MODE_TEXT,
    INTERACTION_MODE_VOICE,
    parse_interaction_mode,
)
from app.core.scenario.simulation_instructions import (
    SimulationBehaviorInstruction,
    SimulationStateInstruction,
)

logger = get_logger(__name__)


def _resolve_comfort_audio_enabled(prompt_data_dict: Mapping[str, Any]) -> bool:
    """Per-simulation comfort-audio setting, defaulting ON when unspecified.

    Three cases, and the middle one is the point of this function:

    * key present and truthy  -> True  (author turned it on)
    * key present and falsy   -> False (author turned it OFF; always respected,
      so no existing scenario config changes behaviour)
    * key ABSENT              -> settings.COMFORT_AUDIO_DEFAULT_ON (True)

    The old expression was ``bool(d.get("comfortAudioEnabled") or False)``,
    which collapsed "absent" and "off" into off, making an opt-in-only feature
    out of one whose absence the learner experiences as a dead line.
    """
    raw = prompt_data_dict.get("comfortAudioEnabled")
    if raw is None:
        raw = prompt_data_dict.get("comfort_audio_enabled")
    if raw is None:
        return bool(getattr(settings, "COMFORT_AUDIO_DEFAULT_ON", True))
    return bool(raw)


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
    # name/age/gender/current_location are optional: studio scenarios are no
    # longer required to fill the character demographics (only title,
    # competency and role instructions are mandatory upstream). Every
    # consumer guards these (truthiness checks / `getattr(..., "") or ""`),
    # so leaving them None renders an empty section rather than crashing.
    name: Optional[str] = Field(default=None)
    age: Optional[str] = Field(default=None)
    gender: Optional[str] = Field(default=None)
    role_instructions: Optional[str] = Field(default=None)
    gender_identity: Optional[str] = Field(default=None)
    sexual_orientation: Optional[str] = Field(default=None)
    current_location: Optional[str] = Field(default=None)
    profession: Optional[str] = Field(default=None)
    character_profile_text: Optional[str] = Field(default=None)
    context: Optional[str] = Field(default=None)
    opening_statements: List[str] = Field(default_factory=list)
    custom_fields: Optional[List[Dict[str, Any]]] = Field(
        default_factory=list, description="Dynamic custom fields"
    )
    previous_memory: Optional[str] = Field(
        default=None,
        description="Summary from previous session for continuity",
    )
    prompts: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Editable prompt templates from backend (promptData.prompts). "
        "Keys: ally_ai_learn_system_main_agent_prompt, etc. Values may be "
        "raw strings or objects with prompt metadata like "
        "{prompt: str, availableVariables: string[]}.",
    )
    competency: Optional[str] = Field(
        default=None,
        description="The counseling competency being trained in this simulation. "
        "When set, the simulation is shaped to help the counselor practice and "
        "learn this specific competency.",
    )
    temperature: Optional[float] = Field(
        default=None,
        description=(
            "Roleplay-level sampling temperature for the main response LLM "
            "(Studio: temperature). When set, it overrides the provider-level "
            "`llm.config.temperature` and the global LLM_TEMPERATURE default for "
            "this simulation only. Lower values (e.g. 0.2-0.4) keep the persona "
            "tightly consistent with the brief; higher values add variety. "
            "Valid range 0.0-2.0; out-of-range values are clamped and a warning "
            "is logged. None falls back to the existing temperature resolution."
        ),
    )

    @field_validator("temperature", mode="before")
    @classmethod
    def _validate_temperature(cls, v: Any) -> Optional[float]:
        """Coerce and clamp the roleplay temperature without ever crashing parse.

        Bad/unparseable values become None (fall back to provider/global default)
        rather than nulling out the whole PromptData. Out-of-range values clamp to
        [0.0, 2.0] (the range both OpenAI and Gemini accept) with a warning so the
        misconfiguration is visible in logs.
        """
        if v is None or v == "":
            return None
        try:
            temperature = float(v)
        except (TypeError, ValueError):
            logger.warning(
                "Ignoring invalid promptData.temperature=%r (not a number); "
                "falling back to provider/global temperature",
                v,
            )
            return None
        clamped = min(2.0, max(0.0, temperature))
        if clamped != temperature:
            logger.warning(
                "Clamping promptData.temperature %s -> %s (valid range 0.0-2.0)",
                temperature,
                clamped,
            )
        return clamped

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
    language_label: Optional[str] = Field(
        default=None,
        description=(
            "Human-readable language name with region (e.g. 'Tamil (India)'). "
            "Injected into the multilingual instructions block alongside the "
            "BCP-47 code; gives the LLM a stronger dialect signal than the "
            "raw code alone."
        ),
    )
    language_characteristics: Optional[str] = Field(
        default=None,
        description=(
            "Free-text per-scenario-per-language style guidance authored in "
            "studio (e.g. 'Speaks simple, colloquial Chennai Tamil; "
            "code-mixes with English'). Optional; when present, rendered as "
            "a character-specific style section inside the multilingual "
            "block. Lets the same language sound different across scenarios."
        ),
    )
    language_glossary: Optional[str] = Field(
        default=None,
        description=(
            "Compiled Tier 0 language-glossary 'style card' for the session "
            "language (register policy, pronoun/kinship agreement rules, "
            "do/don't term pairs). Language-level (not per-scenario), compiled "
            "by ally-be from published glossary sections and injected into "
            "every turn's system prompt via the {language_glossary} "
            "placeholder. Empty/absent for English sessions or languages "
            "without a published glossary."
        ),
    )
    glossary_sections: Optional[List[Dict[str, str]]] = Field(
        default=None,
        description=(
            "Tier 1 language-glossary sections for knowledge-retrieval title "
            "selection: [{'title', 'content', 'retrievalHint'}, ...]. Titles "
            "arrive pre-prefixed by ally-be (e.g. '[Tamil (India) glossary] "
            "Clinical terms'). Merged into the retrieval knowledge map; "
            "retrievalHint tells the selector when to pull a section (the "
            "agent's NEXT reply needs it — production-side relevance, not "
            "discussion-topic relevance)."
        ),
    )
    glossary_meta: Optional[Dict[str, Any]] = Field(
        default=None,
        description=(
            "Glossary provenance stamped by ally-be at session start: "
            "{'versions': {sectionCode: version}, 'tier0Tokens': int} over "
            "the published sections (both tiers) this session was served. "
            "Echoed into start_metrics metadata so judged outcomes can be "
            "grouped by the exact glossary a session ran with."
        ),
    )
    glossary_swaps: Optional[List[Dict[str, str]]] = Field(
        default=None,
        description=(
            "Word swaps enforced on the agent's output: [{'avoid', 'say', "
            "'sectionCode'}]. ally-be sends only published canonical glossary "
            "rules whose both sides are one word and which are not address "
            "forms (app/core/agent/glossary_swap.py)."
        ),
    )
    memories: Optional[List[Dict[str, Any]]] = Field(
        default=None,
        description=(
            "The client's memories for Stage Director prompts (those using "
            "{memories}). Same shape as knowledge_sources. Every unlocked one is "
            "in the prompt on every turn, with no retrieval; one with "
            "unlocksFromStateId shows only its title until the session reaches "
            "that state (app/core/stage_director/memories.py). Kept separately "
            "from knowledge_sources so switching a scenario between prompts "
            "loses neither."
        ),
    )
    knowledge_sources: Optional[List[Dict[str, Any]]] = Field(
        default=None,
        description=(
            "The client's memories, for RAG-like retrieval. "
            'Format: [{"id": ..., "title": "topic name", "content": "detailed info", '
            '"unlocksFromStateId": <state id, optional>}, ...]. '
            "The system uses an LLM to identify relevant titles per utterance "
            "and injects the corresponding content into the prompt. A source with "
            "unlocksFromStateId stays out of retrieval until the session reaches "
            "that state (app/core/graph/knowledge_locks.py)."
        ),
    )
    filler_enabled: bool = Field(
        default=False,
        description=(
            "Per-simulation toggle (Studio: fillerEnabled) for the "
            "thinking-filler back-channel — a short acknowledgement played the "
            "instant the user stops speaking, to mask turn latency. Default "
            "False (opt-in) so existing scenarios are unchanged. The filler is "
            "the agent's first words, so it counts as first-audio for "
            "response_latency_ms and appears in the transcript. When "
            "enabled, the agent plays LLM-generated predictive fillers, falling "
            "back to allowed filler words (see app/core/livekit/fillers.py)."
        ),
    )
    comfort_audio_enabled: bool = Field(
        default=False,
        description=(
            "Per-simulation toggle (Studio: comfortAudioEnabled) for comfort "
            "audio — a faint, constant room tone looped on the shared "
            "background-audio track so the line never sounds dead/'muted' "
            "between turns (telephony comfort noise). Does NOT change the "
            "measured response_latency_ms — it only masks the perceived gap. "
            "Default False (opt-in) so existing scenarios are unchanged. Gated "
            "by settings.COMFORT_AUDIO_ENABLED (a global kill-switch): both "
            "must be on for the tone to play. See "
            "app/core/livekit/comfort_audio.py."
        ),
    )
    supervisor_notes_enabled: bool = Field(
        default=False,
        description=(
            "Per-simulation toggle (Studio: supervisorNotesEnabled) for live "
            "supervisor notes — short coaching hints an AI supervisor sends the "
            "learner DURING the session, shown in a 'Supervisor' tab in the "
            "session sidebar. Generated by a separate cheap LLM off the voice "
            "critical path, so it can never delay a reply. Default False "
            "(opt-in) so existing scenarios are unchanged, and because "
            "mid-session feedback changes the character of the practice: it "
            "helps a novice but breaks the authentic pressure an experienced "
            "learner is there for. Gated by settings.SUPERVISOR_NOTES_ENABLED "
            "(a global kill-switch): both must be on. See "
            "app/core/supervisor/service.py."
        ),
    )
    comfort_audio_url: Optional[str] = Field(
        default=None,
        description=(
            "Per-simulation URL (Studio: comfortAudioUrl) of a superadmin-uploaded "
            "comfort-audio track to play instead of the synthesized room tone. The "
            "worker fetches + decodes it into the in-memory ambient loop; on any "
            "fetch/decode failure it falls back to the synthesized tone. Only used "
            "when comfort_audio_enabled is on."
        ),
    )
    comfort_audio_volume: Optional[float] = Field(
        default=None,
        description=(
            "Per-simulation comfort-audio playback volume (Studio: "
            "comfortAudioVolume), 0..1. When None, falls back to "
            "settings.COMFORT_AUDIO_VOLUME."
        ),
    )
    video_actor_enabled: bool = Field(
        default=False,
        description=(
            "Per-roleplay toggle (Studio: videoActorEnabled) for the EXPERIMENTAL "
            "AI video actor — a synchronized video track published alongside the "
            "character's voice, so the learner sees a face instead of a static "
            "call card. Default False (opt-in) so every roleplay that predates "
            "the feature is byte-for-byte unchanged. Gated by "
            "settings.VIDEO_ACTOR_ENABLED (a global kill-switch, itself default "
            "False): both must be on. Any failure to start the actor falls back "
            "to today's audio-only session. See app/core/livekit/video_actor.py."
        ),
    )
    video_actor_avatar_id: Optional[str] = Field(
        default=None,
        description=(
            "Per-roleplay avatar id (Studio: videoActorAvatarId) naming which "
            "face a hosted video-actor provider should render. When None, falls "
            "back to settings.VIDEO_ACTOR_AVATAR_ID. Ignored by the in-process "
            "'test_pattern' provider, which derives its tint from the character "
            "name instead."
        ),
    )
    video_actor_provider: Optional[str] = Field(
        default=None,
        description=(
            "Per-roleplay video-actor vendor (Studio: videoActorProvider) — "
            "'bey' or 'tavus'. When None, falls back to "
            "settings.VIDEO_ACTOR_PROVIDER, so a roleplay that never picked one "
            "behaves exactly as it did before this field existed. A face id is "
            "NOT portable between vendors, so this and video_actor_avatar_id "
            "have to be set together or not at all: a Tavus replica id handed "
            "to Beyond Presence resolves to nothing and the session runs "
            "audio-only."
        ),
    )
    continuous_backchanneling: bool = Field(
        default=False,
        description=(
            "Per-simulation toggle (Studio: continuousBackchanneling) for "
            "continuous back-channeling — brief 'mm-hmm'-style listener "
            "affirmations played sparsely while the learner is still speaking "
            "on a long turn. Default False (opt-in) so existing scenarios are "
            "unchanged. Gated by settings.BACKCHANNEL_GLOBALLY_ENABLED (a "
            "global kill-switch): both must be on for back-channels to play. "
            "See app/core/livekit/backchannel.py."
        ),
    )
    interim_reply_setting: Optional[bool] = Field(
        default=None,
        description=(
            "interimReplyEnabled exactly as the author set it: None when never "
            "set. Stage Director prompts read it so their interim is on by "
            "default (app/core/livekit/interim_reply.py)."
        ),
    )
    interim_reply_enabled: bool = Field(
        default=False,
        description=(
            "Per-simulation toggle (Studio: interimReplyEnabled) for the "
            "predictive interim reply — while the learner is still speaking on a "
            "long turn, a fast dedicated model generates a short, non-committal "
            "holding reply from the partial transcript; it is pre-synthesized and "
            "played at the VAD endpoint to mask the real reply's latency, then cut "
            "when the real reply begins. Like the filler, the interim is recorded as "
            "a CLIENT transcript line and counts as first-audio for "
            "response_latency_ms; the real reply is generated independently. "
            "Default False (opt-in). Gated by settings.INTERIM_REPLY_GLOBALLY_ENABLED "
            "(a global kill-switch): both must be on. See "
            "app/core/livekit/interim_reply.py."
        ),
    )
    history_trim_enabled: bool = Field(
        default=False,
        description=(
            "Per-simulation toggle (Studio: historyTrimEnabled) to trim the "
            "dialogue history sent to the main LLM to the last few exchanges, "
            "bounding input tokens / latency as the conversation grows. Default "
            "False (opt-in). The system prompt is never trimmed. See "
            "settings.HISTORY_TRIM_* and app/core/graph/nodes.py."
        ),
    )
    # Populated by ally-be on every v1 session from its global admin-configured
    # Settings-page value (not a per-sim override) — see app/worker.py's
    # _apply_configured_endpointing for how it's applied and validated.
    turn_min_endpointing_delay: Optional[float] = Field(
        default=None,
        description=(
            "ally-be's globally admin-configured value (seconds) for the fast "
            "path taken when the EOU model is confident the learner finished, "
            "mirroring settings.TURN_MIN_ENDPOINTING_DELAY. None falls back to "
            "the local default. Only applied when SEMANTIC_TURN_DETECTION_ENABLED "
            "and the pair is valid (0 < min < max); see "
            "app/worker.py:_resolve_turn_detection."
        ),
    )
    turn_max_endpointing_delay: Optional[float] = Field(
        default=None,
        description=(
            "ally-be's globally admin-configured value (seconds) for how long "
            "turn detection waits for a learner who seems mid-thought before "
            "replying anyway, mirroring settings.TURN_MAX_ENDPOINTING_DELAY. "
            "None falls back to the local default. Same gating as "
            "turn_min_endpointing_delay."
        ),
    )
    selected_main_prompt_code: Optional[str] = Field(
        default=None,
        description=(
            "promptCode of the main-agent prompt variant this simulation "
            "uses (e.g. 'ally_ai_learn_system_main_agent_prompt_v2'). "
            "When set, the runtime resolves the main agent prompt by this "
            "code (via PromptData.prompts metadata or local fallback). "
            "When unset, falls back to the default "
            "'ally_ai_learn_system_main_agent_prompt'. Branching and "
            "multilingual prompts are not variant-selectable and remain "
            "singletons shared by every variant."
        ),
    )
    states: Optional[List[Dict[str, Any]]] = Field(
        default=None,
        description=(
            "Per-simulation states used by main-agent prompt variants with "
            "`hasStates: true`. Each entry has `id`, `name`, `guidelines`, "
            "`scoreLower` (int|None), `scoreUpper` (int|None), `ragEnabled`. "
            "Pre-sorted by scoreLower (ascending) by ally-be. The starting "
            "state is emergent — the resolver picks the state whose range "
            "contains 0 (the session's opening score). Distinct from "
            "`behaviorInstructions`-based state guidance, which continues to "
            "operate in parallel."
        ),
    )
    helpful_behaviours: Optional[List[str]] = Field(
        default=None,
        description=(
            "Behaviour class names where category=SHOULD_DO, pre-computed "
            "by ally-be from behaviorInstructions. Injected as "
            "{helpful_behaviours} into the prompt."
        ),
    )
    unhelpful_behaviours: Optional[List[str]] = Field(
        default=None,
        description=(
            "Behaviour class names where category=SHOULD_NOT_DO, "
            "pre-computed by ally-be from behaviorInstructions. Injected "
            "as {unhelpful_behaviours} into the prompt."
        ),
    )


class VoiceConfig(BaseModel):
    model: Optional[str] = Field(default=None)
    voice_id: Optional[str] = Field(default=None)
    # Cartesia keeps its voice id under `voice`, not `voice_id` — that is what
    # ally-be's VOICE_CONFIG_SCHEMA stores and what the preview endpoint reads.
    # This model is a fixed whitelist, so a key that is missing here is dropped
    # on the way to the TTS factory; the provider then fails its required-field
    # check and create_tts_client() silently falls back to the default Google
    # voice for the session language instead of the configured one.
    voice: Optional[str] = Field(default=None)
    speed: Optional[Any] = Field(default=None)  # Cartesia, Smallest.ai
    emotion: Optional[Any] = Field(default=None)  # Cartesia
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
    conversation_started_at: Optional[str] = Field(
        default=None,
        description="ISO timestamp (UTC) when the conversation started, sourced from "
        "the backend conversationStartedAt field. When present, used as the agent "
        "joined time instead of the current clock time.",
    )
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
    interaction_mode: str = Field(
        default=INTERACTION_MODE_VOICE,
        alias="interactionMode",
        description="VOICE (default) or TEXT. TEXT runs the same persona, events "
        "and scoring with audio switched off: the learner types and the reply is "
        "published as text. ally-be sends the key only for text-chat sessions.",
    )
    timer_mode: bool = Field(
        default=False,
        alias="timerMode",
        description="Whether a scenario time limit is enforced.",
    )
    max_time_value: Optional[str] = Field(
        default=None,
        alias="maxTimeValue",
        description="Scenario time limit as HH:MM:SS (used when timer_mode is on).",
    )
    pause_enabled: Optional[bool] = Field(
        default=None,
        alias="pauseEnabled",
        description="Whether pause/resume is allowed. Opt-out: only an explicit "
        "False disables it (None/True → enabled).",
    )

    model_config = {
        "populate_by_name": True,  # allow both alias and field name on input
        "arbitrary_types_allowed": True,
    }

    @property
    def is_text_chat(self) -> bool:
        """True for a text-chat roleplay: no STT, no TTS, no audio either way."""
        return self.interaction_mode == INTERACTION_MODE_TEXT

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

        scenario_session = payload.get("scenarioSession") or {}
        conversation_started_at = cls._parse_conversation_started_at(
            scenario_session.get("conversationStartedAt")
        )
        interaction_mode = parse_interaction_mode(raw.get("interactionMode"))
        is_text_chat = interaction_mode == INTERACTION_MODE_TEXT

        # Parse guardrails array and build one GuardrailEvent per entry
        guardrail_events = []
        guardrails_raw = raw.get("guardrails") or []
        if isinstance(guardrails_raw, list):
            for i, g in enumerate(guardrails_raw):
                try:
                    helper_dialogue = g.get("helperDialogue", "")
                    actor_dialogue = g.get("actorDialogue", "")
                    # detectorType selects the classifier: COHERENCE -> dedicated
                    # coherence classifier; CATEGORY (default) -> shared one.
                    guard_detector_type = g.get("detectorType", "CATEGORY")

                    # COHERENCE exists to catch speech the STT mangled and ask
                    # the learner to repeat. A typed message is exactly what the
                    # learner meant, so in a text chat that guard could only
                    # ever misfire — "sorry, I didn't catch that" to a sentence
                    # on screen. The same scenario keeps it for voice.
                    if is_text_chat and guard_detector_type == "COHERENCE":
                        logger.info(
                            "Skipping COHERENCE guardrail at index %s: "
                            "text-chat session has no STT to repair",
                            i,
                        )
                        continue

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

                    # COHERENCE guardrails get a detection cooldown. They were
                    # built with DetectionConfig() defaults (no min_gap_time, no
                    # max_occurrences) while GUARDRAIL is in the orchestrator's
                    # always-resend set, so a learner the STT keeps mismatching
                    # could be asked to repeat with no gap and no end. The
                    # consecutive-miss counting and the escalation live in
                    # GuardrailEvent._apply_coherence_policy; this is just the
                    # belt-and-braces gap enforced by is_event_eligible.
                    # CATEGORY guardrails are left exactly as they were.
                    guard_detection_config = None
                    if guard_detector_type == "COHERENCE":
                        from app.core.events.coherence_guard import min_gap_s

                        guard_detection_config = DetectionConfig(
                            min_gap_time=min_gap_s()
                        )

                    # Then in GuardrailEvent.create():
                    g_event = GuardrailEvent.create(
                        event_id=f"guardrail-{i}",
                        data=GuardrailData(
                            helper_dialogue=helper_dialogue,
                            actor_dialogue=actor_dialogue,
                        ),
                        model=guardrail_model,
                        llm_base_url=guardrail_llm_base_url,
                        detector_type=guard_detector_type,
                        branching_instruction=BranchingInstruction.create(
                            actor_dialogue, prompt_data=None
                        ),
                        prompt_data=prompt_data,
                        score=0,
                        visibility_type=VisibilityType.PASSIVE,
                        emoji=None,
                        emoji_message=None,
                        **(
                            {"detection_config": guard_detection_config}
                            if guard_detection_config is not None
                            else {}
                        ),
                    )
                    guardrail_events.append(g_event)

                except Exception as e:
                    logger.warning(f"Failed to build guardrail event at index {i}: {e}")

        # Platform-level default: a scenario with no COHERENCE guardrail has NO
        # mitigation for mis-transcription at all (STT confidence is unusable
        # for Indian languages), so the learner can only be misheard silently.
        # Synthesized only when the author declared none, so every existing
        # scenario config is preserved verbatim. Gated by
        # STT_COHERENCE_GUARD_DEFAULT_ENABLED — see default_guard_enabled() for
        # why that currently defaults to off.
        try:
            from app.core.events.coherence_guard import (
                build_default_coherence_guardrail,
                default_guard_enabled,
            )

            has_coherence_guard = any(
                getattr(e, "detector_type", None) == "COHERENCE"
                for e in guardrail_events
            )
            if default_guard_enabled() and not has_coherence_guard and not is_text_chat:
                # Match the provider selection used for authored guardrails.
                if settings.OLLAMA_BASE_URL and settings.LOCAL_LLM_MODEL:
                    _def_url = settings.OLLAMA_BASE_URL
                    _def_model = settings.LOCAL_LLM_MODEL
                else:
                    _def_url = None
                    _def_model = "gpt-4o-mini"
                default_guard = build_default_coherence_guardrail(
                    model=_def_model, llm_base_url=_def_url, prompt_data=prompt_data
                )
                if default_guard is not None:
                    guardrail_events.append(default_guard)
                    logger.info(
                        "Added platform-default STT coherence guardrail "
                        "(scenario declared none)"
                    )
        except Exception as e:  # noqa: BLE001 - never fail scenario load over this
            logger.warning(f"Could not add default coherence guardrail: {e}")

        if guardrail_events:
            logger.info(f"Built {len(guardrail_events)} guardrail events")
            built_events = built_events + guardrail_events
            trigger_events = list(trigger_events) + [
                e.event_id for e in guardrail_events
            ]

        return cls(
            scenarioName=normalized["scenarioName"],
            metadata=normalized.get("metadata", {}),
            timer_mode=bool(raw.get("timerMode", False)),
            max_time_value=raw.get("maxTimeValue"),
            pause_enabled=raw.get("pauseEnabled"),
            interaction_mode=interaction_mode,
            conversation_started_at=conversation_started_at,
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
    def _parse_conversation_started_at(raw_value: Optional[str]) -> Optional[str]:
        """
        Parse and normalise the conversationStartedAt field from the backend.

        Converts the value to a UTC-aware ISO string using ``+00:00`` offset
        (consistent with ``datetime.now(timezone.utc).isoformat()``).
        Returns ``None`` when the value is absent or cannot be parsed.

        Args:
            raw_value: Raw ISO string from backend (e.g. ``"2026-03-23T07:01:44.447Z"``)

        Returns:
            Normalised ISO string or ``None``
        """
        if not raw_value:
            return None
        try:
            parsed = _datetime.fromisoformat(raw_value.replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            return parsed.isoformat()
        except (ValueError, AttributeError):
            logger.warning(
                f"Failed to parse conversationStartedAt: {raw_value!r}; "
                "falling back to current time"
            )
            return None

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
            "scenarioName": raw.get("scenarioName") or raw.get("title") or "",
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
            voice=config_meta.get("voice"),
            speed=config_meta.get("speed"),
            emotion=config_meta.get("emotion"),
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

        # Absent AND empty both land here, and both used to `return None` —
        # which `Scenario.create` then handed to the non-optional
        # `prompt_data: PromptData` field, so the whole scenario failed
        # pydantic validation and the agent never started. Every PromptData
        # field is optional or defaulted, so falling through with an empty
        # dict is strictly better than a dead worker: the session runs with a
        # default persona, the scenario-level title/description/prompt
        # fallbacks below still apply (so `{}` behaves the same as a promptData
        # that merely omits them), and the gap is visible in the logs.
        if not prompt_data_dict:
            logger.warning(
                "No 'promptData' in scenario metadata (missing or empty); "
                "falling back to default PromptData."
            )
            prompt_data_dict = {}

        mapped_data: Dict[str, Any] = {}
        try:
            mapped_data = {
                "title": prompt_data_dict.get("title") or raw.get("title"),
                "description": prompt_data_dict.get("description")
                or raw.get("description"),
                "name": prompt_data_dict.get("name"),
                # Coerce to str only when present — str(None) would store the
                # literal "None" and defeat downstream truthiness guards now
                # that age is optional.
                "age": (
                    str(prompt_data_dict.get("age"))
                    if prompt_data_dict.get("age") is not None
                    else None
                ),
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
                "opening_statements": prompt_data_dict.get("openingStatements") or [],
                "custom_fields": prompt_data_dict.get("customFields"),
                "previous_memory": prompt_data_dict.get("previousMemory", None),
                "prompts": prompt_data_dict.get("prompts"),
                "competency": prompt_data_dict.get("competency", None),
                "temperature": prompt_data_dict.get("temperature"),
                "language_dialogue_samples": prompt_data_dict.get(
                    "languageDialogueSamples"
                )
                or prompt_data_dict.get("language_dialogue_samples"),
                "allowed_fillers": prompt_data_dict.get("allowedFillerWords")
                or prompt_data_dict.get("allowedFillers")
                or prompt_data_dict.get("allowed_fillers"),
                "language_label": prompt_data_dict.get("languageLabel")
                or prompt_data_dict.get("language_label"),
                "language_characteristics": prompt_data_dict.get(
                    "languageCharacteristics"
                )
                or prompt_data_dict.get("language_characteristics"),
                "language_glossary": prompt_data_dict.get("languageGlossary")
                or prompt_data_dict.get("language_glossary"),
                "glossary_sections": prompt_data_dict.get("glossarySections")
                or prompt_data_dict.get("glossary_sections"),
                "glossary_meta": prompt_data_dict.get("glossaryMeta")
                or prompt_data_dict.get("glossary_meta"),
                "glossary_swaps": prompt_data_dict.get("glossarySwaps")
                or prompt_data_dict.get("glossary_swaps"),
                "knowledge_sources": prompt_data_dict.get("knowledgeSources"),
                "memories": prompt_data_dict.get("memories"),
                "filler_enabled": bool(prompt_data_dict.get("fillerEnabled") or False),
                # Comfort audio: ABSENT and EXPLICITLY FALSE are now different
                # things. Silence between turns reads to users as
                # "muted"/"disconnected" (see app/core/livekit/comfort_audio.py),
                # so the platform default for a simulation that has never
                # expressed a preference is ON, while an author who deliberately
                # switched it off keeps it off.
                #
                # NOTE this is currently INERT in production: ally-be migration
                # 1798000000000-DisableComfortAudio writes
                # {"comfortAudioEnabled": false} into every scenario's metadata,
                # and Studio re-stamps an explicit false on every save. So the
                # key is never absent for an existing simulation and the branch
                # below only affects scenarios created outside Studio (or with
                # NULL metadata). Flipping the effective default needs the
                # ally-be/ally-web half too — deliberately not done from here.
                "comfort_audio_enabled": _resolve_comfort_audio_enabled(
                    prompt_data_dict
                ),
                "supervisor_notes_enabled": bool(
                    prompt_data_dict.get("supervisorNotesEnabled")
                    or prompt_data_dict.get("supervisor_notes_enabled")
                    or False
                ),
                "comfort_audio_url": prompt_data_dict.get("comfortAudioUrl")
                or prompt_data_dict.get("comfort_audio_url"),
                "comfort_audio_volume": (
                    prompt_data_dict.get("comfortAudioVolume")
                    if prompt_data_dict.get("comfortAudioVolume") is not None
                    else prompt_data_dict.get("comfort_audio_volume")
                ),
                # Video actor: strictly opt-in, and unlike comfort audio above
                # ABSENT and EXPLICITLY FALSE mean the same thing. Every roleplay
                # in existence today omits this key, and every one of them must
                # keep running audio-only, so there is no "never expressed a
                # preference" default to reach for — absence IS the preference.
                "video_actor_enabled": bool(
                    prompt_data_dict.get("videoActorEnabled")
                    or prompt_data_dict.get("video_actor_enabled")
                    or False
                ),
                "video_actor_avatar_id": prompt_data_dict.get("videoActorAvatarId")
                or prompt_data_dict.get("video_actor_avatar_id"),
                "video_actor_provider": prompt_data_dict.get("videoActorProvider")
                or prompt_data_dict.get("video_actor_provider"),
                "continuous_backchanneling": bool(
                    prompt_data_dict.get("continuousBackchanneling") or False
                ),
                "interim_reply_enabled": bool(
                    prompt_data_dict.get("interimReplyEnabled") or False
                ),
                # Absent and explicitly off differ for Stage Director prompts,
                # whose interim is on unless an author switched it off.
                "interim_reply_setting": (
                    prompt_data_dict.get("interimReplyEnabled")
                    if isinstance(prompt_data_dict.get("interimReplyEnabled"), bool)
                    else None
                ),
                "history_trim_enabled": bool(
                    prompt_data_dict.get("historyTrimEnabled") or False
                ),
                # PromptData is built from this hand-maintained dict, NOT a
                # generic camelCase->snake_case conversion, so these two lines
                # are what actually gets ally-be's globally configured
                # endpointing pair onto every session; tests/unit/scenario
                # guards the mapping.
                "turn_min_endpointing_delay": (
                    prompt_data_dict.get("turnMinEndpointingDelay")
                    if prompt_data_dict.get("turnMinEndpointingDelay") is not None
                    else prompt_data_dict.get("turn_min_endpointing_delay")
                ),
                "turn_max_endpointing_delay": (
                    prompt_data_dict.get("turnMaxEndpointingDelay")
                    if prompt_data_dict.get("turnMaxEndpointingDelay") is not None
                    else prompt_data_dict.get("turn_max_endpointing_delay")
                ),
                "selected_main_prompt_code": prompt_data_dict.get(
                    "selectedMainPromptCode"
                ),
                "states": prompt_data_dict.get("states"),
                "helpful_behaviours": prompt_data_dict.get("helpfulBehaviours"),
                "unhelpful_behaviours": prompt_data_dict.get("unhelpfulBehaviours"),
            }

            prompt_data_obj = PromptData(**mapped_data)
            # Session-start glossary visibility (LANGUAGE_GLOSSARY_DESIGN.md §10):
            # one line per session proving whether the Tier 0 card / Tier 1
            # sections arrived, and flagging the gap when a non-English session
            # has neither. Logs can't show the system prompt, so this is the
            # ground truth for "did the glossary reach the agent".
            tier0 = mapped_data.get("language_glossary")
            tier1 = mapped_data.get("glossary_sections")
            label = mapped_data.get("language_label")
            if tier0 or tier1:
                logger.info(
                    "[GLOSSARY] prompt data language=%s "
                    "tier0_chars=%d tier1_sections=%d",
                    label,
                    len(tier0) if isinstance(tier0, str) else 0,
                    len(tier1) if isinstance(tier1, list) else 0,
                )
            elif label and not str(label).startswith("English"):
                logger.info(
                    "[GLOSSARY] prompt data language=%s has no glossary "
                    "(nothing published?)",
                    label,
                )
            return prompt_data_obj
        except Exception as e:
            # One malformed field must not throw away the rest, least of all
            # the Skills Store prompts: without them every prompt falls back to
            # the minimal local default. Keep each field that is valid on its
            # own and drop only the bad ones.
            kept: Dict[str, Any] = {}
            dropped = []
            for key, value in mapped_data.items():
                try:
                    PromptData(**{key: value})
                    kept[key] = value
                except Exception:  # noqa: BLE001 - field-level salvage
                    dropped.append(key)
            logger.error(
                "[PROMPT_DATA] promptData failed validation (%s); dropped %s, "
                "kept the other %d fields%s",
                e,
                dropped or "nothing it could isolate",
                len(kept),
                " including the Skills Store prompts" if kept.get("prompts") else "",
            )
            try:
                return PromptData(**kept)
            except Exception:  # noqa: BLE001
                return PromptData()

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
        # The backend sends the active BCP-47 code under "languageCode", but it
        # is added to the scenario section *conditionally* — fall back to the
        # always-present "language" field before defaulting, so a non-English
        # session never silently collapses to en-IN. (An empty string also
        # falls through, since normalize_*() would otherwise treat it as the
        # default.)
        raw_language_code = (
            raw.get("languageCode")
            or raw.get("language")
            or raw.get("language_code")
            or DEFAULT_LANGUAGE_CODE
        )
        language_code = normalize_language_code_for_providers(raw_language_code)
        # WARNING on purpose: a temporary diagnostic that must appear even when
        # LOG_LEVEL=WARNING. Downgrade/remove once the language flow is verified.
        logger.warning(
            "[LANGUAGE] resolved language_code=%s (languageCode=%r language=%r "
            "raw_keys=%s)",
            language_code,
            raw.get("languageCode"),
            raw.get("language"),
            list(raw.keys())[:30],
        )
        stt_config = raw.get("stt")
        llm_config = raw.get("llm")

        return LanguageConfig(
            language_code=language_code,
            stt_config=stt_config,
            llm_config=llm_config,
            branching_llm_config=branching_llm_config,
        )
