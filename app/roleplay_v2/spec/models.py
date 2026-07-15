"""Pydantic models for the Roleplay Studio v2 ScenarioSpec contract.

The spec document arrives from ally-be as camelCase JSON (either inline in the
room metadata or fetched from ``specFetch.url``). All models accept BOTH
camelCase aliases and snake_case field names (``populate_by_name``) so Python
callers and backend payloads share one schema.

Frozen contract keys (backend → runtime), spec schema version 1.0:

    title, competencyId,
    persona {identityCore, scenarioContext, chunks:[{id, topics, content}]},
    stateMachine {initialStateId, states:[{id, name, emotionalRegister,
        disclosurePosture, resistanceLevel, stateCard, defaultStageDirection,
        prosodyHints, transitions:[{id, toStateId, description,
        whenBehaviorsAny, whenBehaviorsAll, minTurnsInState,
        minCumulativeScore}]}]},
    disclosureLedger {secrets:[{id, topic, content, unlockConditions,
        minStateIds, lockedDeflection, tier}]},
    rubric {behaviors:[{id, name, description, polarity, weight, examples}]},
    engineeredEvents [{id, name, trigger, atSeconds, behaviorIds,
        scoreThreshold, direction, once}],
    voice {languageVoices}, language {languageId, languageCode},
    openingStatement, difficulty, actorModel {provider, config},
    directorModel {provider, config}, ui (ignored by the runtime).

Validation invariants enforced here (fail fast, before any session starts):
- 3-6 states, unique ids, exactly one of them is the initial state;
- no dangling ids: transition targets, behavior references (transition guards
  and engineered events), and secret ``minStateIds`` must all resolve.
"""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from pydantic.alias_generators import to_camel

from app.core.constants import DEFAULT_LANGUAGE_CODE
from app.core.logger import get_logger

# REUSE of the v1 scenario primitives (per contract): voices resolve to the
# same ScenarioVoice/VoiceConfig shape configure_tts_client already reads, and
# language resolves to the LanguageConfig shape configure_stt_client reads.
from app.core.scenario.base import LanguageConfig, ScenarioVoice, VoiceConfig

logger = get_logger(__name__)

MIN_STATES = 3
MAX_STATES = 6

SPEC_ENGINE_MARKER = "roleplay_v2"
SPEC_SCHEMA_VERSION = "1.0"


class SpecBase(BaseModel):
    """Base for all spec models: camelCase aliases in, snake_case in Python."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        extra="ignore",
        # ally-be sends some ID fields (languageId, session.userId) as JSON
        # numbers, but we model them as strings. Coerce numbers→str so the
        # envelope validates instead of throwing a ValidationError in the v2
        # entrypoint's configure() (which would leave the agent unable to join).
        # Only affects str-typed fields; int/float fields are unaffected.
        coerce_numbers_to_str=True,
    )


# ---------------------------------------------------------------------------
# Persona
# ---------------------------------------------------------------------------


class PersonaChunk(SpecBase):
    """A retrievable slice of the persona bible (L5 context)."""

    id: str
    topics: List[str] = Field(default_factory=list)
    content: str


class Persona(SpecBase):
    identity_core: str
    scenario_context: str = ""
    chunks: List[PersonaChunk] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# State machine
# ---------------------------------------------------------------------------


class StateTransition(SpecBase):
    """A guarded edge out of a state; the Director cites it when moving."""

    id: str
    to_state_id: str
    description: str = ""
    when_behaviors_any: List[str] = Field(default_factory=list)
    when_behaviors_all: List[str] = Field(default_factory=list)
    min_turns_in_state: int = 0
    min_cumulative_score: Optional[float] = None


class SpecState(SpecBase):
    id: str
    name: str
    emotional_register: str = ""
    disclosure_posture: str = ""
    resistance_level: str = ""
    state_card: str = ""
    default_stage_direction: str = ""
    prosody_hints: str = ""
    transitions: List[StateTransition] = Field(default_factory=list)

    @field_validator("resistance_level", "prosody_hints", mode="before")
    @classmethod
    def _coerce_to_text(cls, v: Any) -> str:
        """Tolerate numeric resistance levels and list-shaped prosody hints."""
        if v is None:
            return ""
        if isinstance(v, (list, tuple)):
            return "; ".join(str(item) for item in v if item is not None)
        return str(v)


class StateMachine(SpecBase):
    initial_state_id: str
    states: List[SpecState]

    @model_validator(mode="after")
    def _validate_machine(self) -> "StateMachine":
        n = len(self.states)
        if not (MIN_STATES <= n <= MAX_STATES):
            raise ValueError(
                f"stateMachine must define {MIN_STATES}-{MAX_STATES} states, got {n}"
            )
        ids = [s.id for s in self.states]
        if len(set(ids)) != len(ids):
            raise ValueError(f"stateMachine has duplicate state ids: {ids}")
        initial_matches = [s for s in self.states if s.id == self.initial_state_id]
        if len(initial_matches) != 1:
            raise ValueError(
                f"initialStateId {self.initial_state_id!r} must match exactly one "
                f"state (matched {len(initial_matches)})"
            )
        id_set = set(ids)
        for state in self.states:
            for t in state.transitions:
                if t.to_state_id not in id_set:
                    raise ValueError(
                        f"transition {t.id!r} in state {state.id!r} targets "
                        f"unknown state {t.to_state_id!r}"
                    )
        return self

    def get_state(self, state_id: str) -> Optional[SpecState]:
        for state in self.states:
            if state.id == state_id:
                return state
        return None

    @property
    def initial_state(self) -> SpecState:
        state = self.get_state(self.initial_state_id)
        assert state is not None  # guaranteed by _validate_machine
        return state


# ---------------------------------------------------------------------------
# Disclosure ledger
# ---------------------------------------------------------------------------


class UnlockCondition(SpecBase):
    id: str
    description: str = ""
    behavior_ids: List[str] = Field(default_factory=list)


class Secret(SpecBase):
    id: str
    topic: str
    content: str
    unlock_conditions: List[UnlockCondition] = Field(default_factory=list)
    min_state_ids: List[str] = Field(default_factory=list)
    locked_deflection: str = ""
    tier: Optional[Union[int, str]] = None

    @field_validator("unlock_conditions", mode="before")
    @classmethod
    def _coerce_conditions(cls, v: Any) -> Any:
        """Accept bare-string unlock conditions from older spec authors."""
        if not isinstance(v, list):
            return v
        coerced = []
        for i, item in enumerate(v):
            if isinstance(item, str):
                coerced.append({"id": f"cond-{i + 1}", "description": item})
            else:
                coerced.append(item)
        return coerced


class DisclosureLedger(SpecBase):
    secrets: List[Secret] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Rubric
# ---------------------------------------------------------------------------

Polarity = Literal["helpful", "unhelpful"]


class RubricBehavior(SpecBase):
    id: str
    name: str
    description: str = ""
    polarity: Polarity
    weight: float = 1.0
    examples: List[str] = Field(default_factory=list)

    @property
    def signed_weight(self) -> float:
        """weight × polarity — the score delta for one observation."""
        return self.weight if self.polarity == "helpful" else -self.weight


class Rubric(SpecBase):
    behaviors: List[RubricBehavior] = Field(default_factory=list)

    def get_behavior(self, behavior_id: str) -> Optional[RubricBehavior]:
        for b in self.behaviors:
            if b.id == behavior_id:
                return b
        return None


# ---------------------------------------------------------------------------
# Engineered events
# ---------------------------------------------------------------------------

EventTrigger = Literal["time", "behavior", "score"]


class EngineeredEvent(SpecBase):
    id: str
    name: str = ""
    trigger: EventTrigger
    at_seconds: Optional[float] = None
    behavior_ids: List[str] = Field(default_factory=list)
    score_threshold: Optional[float] = None
    direction: str = ""
    once: bool = True

    @model_validator(mode="after")
    def _validate_trigger_params(self) -> "EngineeredEvent":
        if self.trigger == "time" and self.at_seconds is None:
            raise ValueError(f"time-trigger event {self.id!r} requires atSeconds")
        if self.trigger == "behavior" and not self.behavior_ids:
            raise ValueError(f"behavior-trigger event {self.id!r} requires behaviorIds")
        if self.trigger == "score" and self.score_threshold is None:
            raise ValueError(f"score-trigger event {self.id!r} requires scoreThreshold")
        return self


# ---------------------------------------------------------------------------
# Models / language / voice
# ---------------------------------------------------------------------------


class ModelSpec(SpecBase):
    """LLM selection for the actor or director ({provider, config})."""

    provider: str
    config: Dict[str, Any] = Field(default_factory=dict)

    def to_llm_config(self) -> Dict[str, Any]:
        """Shape expected by app.llms.factory.create_llm_client."""
        return {"provider": self.provider, "config": dict(self.config)}


class SpecLanguage(SpecBase):
    language_id: Optional[str] = None
    language_code: str = DEFAULT_LANGUAGE_CODE

    @model_validator(mode="before")
    @classmethod
    def _coerce_bare_code(cls, v: Any) -> Any:
        """Accept a bare BCP-47 string ('ta-IN') as the whole language object."""
        if isinstance(v, str):
            return {"languageCode": v}
        return v

    def to_language_config(self) -> LanguageConfig:
        return LanguageConfig(language_code=self.language_code or DEFAULT_LANGUAGE_CODE)


def parse_scenario_voice(raw: Any) -> Optional[ScenarioVoice]:
    """Parse a backend voice dict into the v1 ScenarioVoice (reused shape).

    Tolerates both camelCase (voiceId) and snake_case (voice_id) config keys.
    Returns None on missing/invalid input (callers fall back to defaults).
    """
    if isinstance(raw, ScenarioVoice):
        return raw
    if not isinstance(raw, dict) or not raw:
        return None
    try:
        config_meta = raw.get("config") or {}
        voice_config = VoiceConfig(
            model=config_meta.get("model"),
            voice_id=config_meta.get("voice_id") or config_meta.get("voiceId"),
            speaker=config_meta.get("speaker"),
            voice_name=config_meta.get("voice_name") or config_meta.get("voiceName"),
            model_name=config_meta.get("model_name") or config_meta.get("modelName"),
            gender=config_meta.get("gender"),
            voice_cloning_key=config_meta.get("voice_cloning_key")
            or config_meta.get("voiceCloningKey"),
            instant_mode=config_meta.get("instant_mode")
            or config_meta.get("instantMode"),
            voice_provider=config_meta.get("voice_provider")
            or config_meta.get("voiceProvider"),
        )
        return ScenarioVoice(
            name=raw.get("name", ""),
            provider=(raw.get("provider") or "").lower(),
            config=voice_config,
        )
    except Exception as e:  # noqa: BLE001 - voice is optional; never fail parse
        logger.warning("[roleplay_v2] Could not parse voice config: %s", e)
        return None


class SpecVoice(SpecBase):
    """Per-language voice table from the spec ({languageVoices})."""

    language_voices: Dict[str, Any] = Field(default_factory=dict)

    def resolve(self, language_id: Optional[str]) -> Optional[ScenarioVoice]:
        """Voice for a language id, falling back to the only/first entry."""
        raw = None
        if language_id and language_id in self.language_voices:
            raw = self.language_voices[language_id]
        elif self.language_voices:
            raw = next(iter(self.language_voices.values()))
        return parse_scenario_voice(raw)


# ---------------------------------------------------------------------------
# The spec itself
# ---------------------------------------------------------------------------


class ScenarioSpec(SpecBase):
    title: str
    # Primary competency (kept for back-compat). competency_ids/_names carry the
    # first-class multi-select; camelCase aliases accepted via SpecBase.
    competency_id: Optional[str] = None
    competency_ids: Optional[List[str]] = None
    competency_names: Optional[List[str]] = None
    persona: Persona
    state_machine: StateMachine
    disclosure_ledger: DisclosureLedger = Field(default_factory=DisclosureLedger)
    rubric: Rubric = Field(default_factory=Rubric)
    engineered_events: List[EngineeredEvent] = Field(default_factory=list)
    voice: Optional[SpecVoice] = None
    language: Optional[SpecLanguage] = None
    opening_statement: Optional[str] = None
    difficulty: Optional[str] = None
    # Voice-naturalness / latency-masking runtime toggles (mirror Roleplay Studio
    # 1 metadata flags). camelCase aliases (fillerEnabled, ...) accepted via the
    # SpecBase to_camel alias generator. Honored by the naturalness controller.
    filler_enabled: bool = False
    comfort_audio_enabled: bool = False
    # Uploaded comfort-audio track URL + playback volume (0..1). camelCase
    # aliases comfortAudioUrl / comfortAudioVolume accepted via SpecBase.
    comfort_audio_url: Optional[str] = None
    comfort_audio_volume: Optional[float] = None
    continuous_backchanneling: bool = False
    interim_reply_enabled: bool = True
    actor_model: Optional[ModelSpec] = None
    director_model: Optional[ModelSpec] = None
    # `ui` is authoring-only; accepted and ignored so the runtime never breaks
    # on studio-side additions.
    ui: Optional[Dict[str, Any]] = None

    @property
    def competency_label(self) -> Optional[str]:
        """Human-readable competency string for actor/trainee/director prompts.

        Prefers the resolved names of the multi-select (joined), then the ids,
        then the legacy scalar competency_id — so old single-competency specs
        keep working while multi-competency specs name every competency.
        """
        names = [n for n in (self.competency_names or []) if n and n.strip()]
        if names:
            return ", ".join(names)
        ids = [i for i in (self.competency_ids or []) if i and i.strip()]
        if ids:
            return ", ".join(ids)
        return self.competency_id

    @model_validator(mode="after")
    def _validate_cross_references(self) -> "ScenarioSpec":
        state_ids = {s.id for s in self.state_machine.states}
        behavior_ids = [b.id for b in self.rubric.behaviors]
        if len(set(behavior_ids)) != len(behavior_ids):
            raise ValueError(f"rubric has duplicate behavior ids: {behavior_ids}")
        behavior_id_set = set(behavior_ids)

        for state in self.state_machine.states:
            for t in state.transitions:
                for bid in list(t.when_behaviors_any) + list(t.when_behaviors_all):
                    if bid not in behavior_id_set:
                        raise ValueError(
                            f"transition {t.id!r} references unknown behavior "
                            f"{bid!r}"
                        )

        secret_ids = [s.id for s in self.disclosure_ledger.secrets]
        if len(set(secret_ids)) != len(secret_ids):
            raise ValueError(f"disclosureLedger has duplicate secret ids: {secret_ids}")
        for secret in self.disclosure_ledger.secrets:
            for sid in secret.min_state_ids:
                if sid not in state_ids:
                    raise ValueError(
                        f"secret {secret.id!r} references unknown state {sid!r} "
                        "in minStateIds"
                    )
            for cond in secret.unlock_conditions:
                for bid in cond.behavior_ids:
                    if bid not in behavior_id_set:
                        raise ValueError(
                            f"unlock condition {cond.id!r} on secret "
                            f"{secret.id!r} references unknown behavior {bid!r}"
                        )

        event_ids = [e.id for e in self.engineered_events]
        if len(set(event_ids)) != len(event_ids):
            raise ValueError(f"engineeredEvents has duplicate ids: {event_ids}")
        for event in self.engineered_events:
            for bid in event.behavior_ids:
                if bid not in behavior_id_set:
                    raise ValueError(
                        f"engineered event {event.id!r} references unknown "
                        f"behavior {bid!r}"
                    )
        return self

    # ----- convenience accessors used across the runtime -----

    def get_state(self, state_id: str) -> Optional[SpecState]:
        return self.state_machine.get_state(state_id)

    def get_secret(self, secret_id: str) -> Optional[Secret]:
        for s in self.disclosure_ledger.secrets:
            if s.id == secret_id:
                return s
        return None

    def get_event(self, event_id: str) -> Optional[EngineeredEvent]:
        for e in self.engineered_events:
            if e.id == event_id:
                return e
        return None

    @property
    def language_code(self) -> str:
        return (
            self.language.language_code if self.language else DEFAULT_LANGUAGE_CODE
        ) or DEFAULT_LANGUAGE_CODE


# ---------------------------------------------------------------------------
# Room-metadata envelope
# ---------------------------------------------------------------------------


class SpecSessionInfo(SpecBase):
    scenario_session_id: Optional[str] = None
    spec_id: Optional[str] = None
    spec_version_id: Optional[str] = None
    user_id: Optional[str] = None


class SpecFetch(SpecBase):
    version_id: Optional[str] = None
    url: str


class RoleplaySpecEnvelope(SpecBase):
    """The v2 room-metadata document.

    ``{engine:'roleplay_v2', specSchemaVersion:'1.0', spec|null,
      specFetch:{versionId,url}|null, session:{...}, language, voice}``
    """

    engine: Optional[str] = None
    spec_schema_version: Optional[str] = None
    spec: Optional[ScenarioSpec] = None
    spec_fetch: Optional[SpecFetch] = None
    session: SpecSessionInfo = Field(default_factory=SpecSessionInfo)
    language: Optional[SpecLanguage] = None
    voice: Optional[Dict[str, Any]] = None

    @property
    def is_roleplay_v2(self) -> bool:
        return self.engine == SPEC_ENGINE_MARKER

    def resolve_language(self) -> SpecLanguage:
        """Session-selected language wins over the spec's default."""
        if self.language is not None:
            return self.language
        if self.spec is not None and self.spec.language is not None:
            return self.spec.language
        return SpecLanguage()

    def resolve_voice(self) -> Optional[ScenarioVoice]:
        """Session-selected voice wins over the spec's languageVoices table."""
        voice = parse_scenario_voice(self.voice)
        if voice is not None:
            return voice
        if self.spec is not None and self.spec.voice is not None:
            return self.spec.voice.resolve(self.resolve_language().language_id)
        return None

    async def ensure_spec(self) -> ScenarioSpec:
        """Return the inline spec, fetching from specFetch.url when absent."""
        if self.spec is not None:
            return self.spec
        if self.spec_fetch is None:
            raise ValueError(
                "roleplay_v2 metadata has neither an inline spec nor a specFetch"
            )
        # Deferred import: httpx is only needed on the fetch path.
        import httpx

        from app.core.config import settings

        logger.info(
            "[roleplay_v2] Fetching spec version=%s from %s",
            self.spec_fetch.version_id,
            self.spec_fetch.url,
        )
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(
                self.spec_fetch.url,
                headers={"x-api-key": settings.CORE_SERVICE_API_KEY},
            )
            resp.raise_for_status()
            payload = resp.json()
        # The fetch endpoint may return either the bare spec document or a
        # wrapper with a `spec` key; accept both.
        if isinstance(payload, dict) and "spec" in payload and "title" not in payload:
            payload = payload["spec"]
        self.spec = ScenarioSpec.model_validate(payload)
        return self.spec
