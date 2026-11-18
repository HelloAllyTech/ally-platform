"""Data shapes for the Scribe v2 note harness (docs/scribe-v2/DESIGN.md §6).

ally-be builds the `NoteSpec` from the tenant's custom field definitions and
sends it, with the budget settings, on the transcribe queue message. The harness
returns a `NoteDraft` whose narrative is an ordered list of time-stamped points
and whose fields carry the transcript turns they rest on.
"""

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field

# Mirrors ally-be's CustomFieldType.
FieldType = Literal[
    "SINGLE_SELECT",
    "MULTI_SELECT",
    "DATE",
    "TEXT",
    "MULTILINE_TEXT",
    "NUMBER",
    "BOOLEAN",
]

SessionMode = Literal["SCRIBE", "DICTATION"]


class NoteFieldOption(BaseModel):
    id: str
    label: str


class NoteField(BaseModel):
    """One field the model fills. Only fillMode=AI definitions are sent."""

    id: str
    label: str
    type: FieldType
    section: Optional[str] = None
    instruction: Optional[str] = None
    options: List[NoteFieldOption] = Field(default_factory=list)


class NoteSpec(BaseModel):
    fields: List[NoteField] = Field(default_factory=list)
    # Language the note is written in; None means English.
    note_language: Optional[str] = None


class BudgetSettings(BaseModel):
    """Tenant-tunable budget knobs, with the platform defaults (DESIGN §6.2)."""

    base_words: int = 200
    per_minute_words: int = 12
    cap_words: int = 1200


class NoteHarnessRequest(BaseModel):
    """What ally-be puts on the transcribe message to ask for a harness run."""

    shadow: bool = True
    note_spec: NoteSpec
    budget_settings: BudgetSettings = Field(default_factory=BudgetSettings)
    # Facts the model must not guess (date, duration, counsellor): rendered
    # verbatim into the prompt, never asked for.
    context: Dict[str, Any] = Field(default_factory=dict)


class Budget(BaseModel):
    transcript_minutes: float
    transcript_words: int
    narrative_words: int
    # Below this the narrative gets one repair pass (60 % of the target,
    # never more than the transcript itself can support).
    min_narrative_words: int
    max_output_tokens: int
    time_budget_s: int


class NoteTurn(BaseModel):
    """A transcript turn as the harness sees it: a stable id and a time."""

    id: int
    speaker: str
    start: float
    text: str


class NarrativePoint(BaseModel):
    t: str
    text: str
    turn_ids: List[int] = Field(default_factory=list)


class FieldValue(BaseModel):
    value: Any
    evidence_turn_ids: List[int] = Field(default_factory=list)


class NoteDraft(BaseModel):
    narrative: List[NarrativePoint] = Field(default_factory=list)
    fields: Dict[str, FieldValue] = Field(default_factory=dict)

    def narrative_words(self) -> int:
        return sum(len(p.text.split()) for p in self.narrative)


class ValidationStats(BaseModel):
    reordered: bool = False
    dropped_points: int = 0
    # field id → why its value was dropped (no PHI: reasons only).
    dropped_fields: Dict[str, str] = Field(default_factory=dict)


class HarnessReport(BaseModel):
    """Everything ally-be stores for one harness run."""

    draft: Optional[NoteDraft] = None
    budget: Optional[Budget] = None
    mode: Optional[str] = None
    path: Optional[Literal["single", "map_reduce"]] = None
    segments: int = 0
    repaired: bool = False
    validation: ValidationStats = Field(default_factory=ValidationStats)
    llm_calls: int = 0
    duration_ms: int = 0
    error: Optional[str] = None
