"""Typed contracts for this service's prompts: one model per default .txt.

Each model declares the prompt's code and how it shows up in the Skills
Store (`prompt = PromptInfo(...)`), and its fields are the variables the code
supplies. A field without a default is REQUIRED: the prompt text must contain
it and the code must pass it. `Field(title=...)` is the label the Skills
Store shows for a variable. Declaring the class is the whole registration:
`PROMPT_CONTRACTS` collects every subclass of `PromptInputs`.

- Sync sends each prompt's `contract_payload`, details and labelled
  variables to the Skills Store, which refuses a new version that drops a
  required variable (or, for a closed contract, uses one the code doesn't
  supply).
- The resolver logs `[PROMPT_CONTRACT]` at ERROR when the code renders a
  prompt without a required variable.
- The contract tests check every default .txt against its model, and that
  every default has one.

Contracts start OPEN (`extra="allow"`): undeclared variables are accepted.
Close one with `model_config = ConfigDict(extra="forbid")` once its field
list is known to be complete. Bump `contract_version` on a breaking change.
Recipe: ally-be/docs/adding-a-prompt.md (one section per service).
"""

from dataclasses import dataclass
from typing import ClassVar, Mapping, Optional

from pydantic import BaseModel, ConfigDict


@dataclass(frozen=True)
class PromptInfo:
    """A prompt's code and how it shows up in the Skills Store.

    Only `code` is required. Without the rest, sync derives the name,
    description and category from the file's path. Sync writes the
    description and category on every deploy; the name only when the prompt
    is created (a rename in the Skills Store is an admin's to make).
    """

    code: str
    name: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    # Studio wiring for agent prompts (e.g. "main_agent"); most prompts omit it.
    prompt_type: Optional[str] = None
    has_states: Optional[bool] = None


class PromptInputs(BaseModel):
    """Base for every prompt contract."""

    model_config = ConfigDict(extra="allow", protected_namespaces=())

    prompt: ClassVar[PromptInfo]
    contract_version: ClassVar[int] = 1
    # Text the runtime appends after templating, outside the template.
    fragments: ClassVar[list[str]] = []
    # How the code reads the answer: "json" when it parses free text as JSON
    # (CI checks the default produces parseable JSON); "structured" when the
    # provider enforces it (with_structured_output, response_format).
    output_format: ClassVar[Optional[str]] = None


class AnalysisCounselorAnalysisInputs(PromptInputs):
    """`analysis/counselor_analysis.txt`."""

    prompt = PromptInfo(
        code="ally_ai_analysis_counselor_analysis",
        name="Counselor Analysis",
        description="Analyzes counselor's performance and clinical competencies.",
    )

    output_format: ClassVar[Optional[str]] = "structured"

    message: str


class AudioDiarizationInputs(PromptInputs):
    """`audio/diarization.txt`."""

    prompt = PromptInfo(
        code="ally_ai_audio_diarization",
        name="Diarization",
        description="Identifies distinct speakers in audio transcriptions.",
    )

    output_format: ClassVar[Optional[str]] = "structured"

    transcription: str


class HelplineCopilotTurnInputs(PromptInputs):
    """`helpline/copilot_turn.txt`."""

    prompt = PromptInfo(
        code="ally_ai_helpline_copilot_turn",
        name="Helpline Copilot Turn",
        description=(
            "Drafts two or three tentative, validating reply options for the helpline "
            "listener to edit after each talker message, tags each with a helping "
            "skill, names the conversation stage, and optionally gives the listener one"
            " coaching nudge. Staff-only: the listener decides what is sent."
        ),
    )

    output_format: ClassVar[Optional[str]] = "structured"

    conversation: str
    nudge_instruction: str
    risk_instruction: str
    rolling_summary: Optional[str] = None
    talker_language: Optional[str] = None


class HelplineRiskClassifyInputs(PromptInputs):
    """`helpline/risk_classify.txt`."""

    prompt = PromptInfo(
        code="ally_ai_helpline_risk_classify",
        name="Helpline Risk Classifier",
        description=(
            "Reads each message a person sends on the text helpline and decides whether"
            " it signals risk of suicide, self-harm or serious harm (to them, from "
            "others, or to someone they describe), so the listener and supervisors are "
            "alerted. Written for a person in distress, not a worker; biased towards "
            "false positives on purpose."
        ),
    )

    output_format: ClassVar[Optional[str]] = "structured"

    language_name: Optional[str] = None
    message: str
    recent: Optional[str] = None


class KnowledgeCrisisClassifyInputs(PromptInputs):
    """`knowledge/crisis_classify.txt`."""

    prompt = PromptInfo(
        code="ally_ai_knowledge_crisis_classify",
        name="WhatsApp Crisis Classifier",
        description=(
            "Decides whether an inbound WhatsApp message is about a crisis happening "
            "now, so the bot points to a supervisor or crisis line instead of answering"
            " a reference question. Biased towards false positives on purpose."
        ),
    )

    output_format: ClassVar[Optional[str]] = "structured"

    message: str


class KnowledgeTranslateQueryInputs(PromptInputs):
    """`knowledge/translate_query.txt`."""

    prompt = PromptInfo(
        code="ally_ai_knowledge_translate_query",
        name="WhatsApp Knowledge Query Translation",
        description=(
            "Detects the language of an inbound WhatsApp question and restates it in "
            "English for embedding, so a non-English question retrieves against the "
            "English corpus."
        ),
    )

    output_format: ClassVar[Optional[str]] = "structured"

    question: str


class KnowledgeWhatsappAnswerInputs(PromptInputs):
    """`knowledge/whatsapp_answer.txt`."""

    prompt = PromptInfo(
        code="ally_ai_knowledge_whatsapp_answer",
        name="WhatsApp Knowledge Answer",
        description=(
            "Answers a mental healthcare worker's WhatsApp question using only the "
            "retrieved corpus passages, in the worker's own language, or declines when "
            "the corpus does not cover it."
        ),
    )

    output_format: ClassVar[Optional[str]] = "structured"

    history: Optional[str] = None
    max_chars: Optional[str] = None
    passages: str
    question: str


class NotesContentEnhanceInputs(PromptInputs):
    """`notes/content_enhance.txt`."""

    prompt = PromptInfo(
        code="ally_ai_notes_content_enhance",
        name="Content Enhancement",
        description="Enhances the provided summary or content.",
    )

    output_format: ClassVar[Optional[str]] = "structured"

    content: str


class NudgeNudgeInputs(PromptInputs):
    """`nudge/nudge.txt`."""

    prompt = PromptInfo(
        code="ally_ai_nudge_nudge",
        name="Generate Nudge",
        description="Generates a nudge to guide the counselor during the session.",
    )

    output_format: ClassVar[Optional[str]] = "structured"

    chat_history: str
    conversation: Optional[str] = None
    suggestion: Optional[str] = None


class ScenarioScenarioEvaluationInputs(PromptInputs):
    """`scenario/scenario_evaluation.txt`."""

    prompt = PromptInfo(
        code="ally_ai_scenario_scenario_evaluation",
        name="Scenario Evaluation",
        description="Evaluates the scenario performance.",
    )

    output_format: ClassVar[Optional[str]] = "structured"

    SCENARIO_BEHAVIOUR_GUIDANCE: Optional[str] = None
    SKILL_COVERAGE_DESCRIPTIONS: Optional[str] = None
    SUPERVISOR_NOTE_SECTION: Optional[str] = None
    chat_history: str


class ScenarioScenarioEvaluationWithMemoryInputs(PromptInputs):
    """`scenario/scenario_evaluation_with_memory.txt`."""

    prompt = PromptInfo(
        code="ally_ai_scenario_scenario_evaluation_with_memory",
        name="Scenario Evaluation with Memory",
        description="Evaluates scenario performance while considering session memory.",
    )

    output_format: ClassVar[Optional[str]] = "structured"

    SCENARIO_BEHAVIOUR_GUIDANCE: Optional[str] = None
    SKILL_COVERAGE_DESCRIPTIONS: Optional[str] = None
    SUPERVISOR_NOTE_SECTION: Optional[str] = None
    chat_history: str
    custom_prompt_section: Optional[str] = None
    previous_summary: Optional[str] = None


class SharedScenarioBehavioursInputs(PromptInputs):
    """`shared/scenario_behaviours.txt`."""

    prompt = PromptInfo(code="ally_ai_shared_scenario_behaviours")

    HELPFUL_BEHAVIOURS_LIST: Optional[str] = None
    UNHELPFUL_BEHAVIOURS_LIST: Optional[str] = None


class SharedSkillCoverageInputs(PromptInputs):
    """`shared/skill_coverage.txt`."""

    prompt = PromptInfo(
        code="ally_ai_shared_skill_coverage",
        name="Skill Coverage",
        description=(
            "Calculates the coverage of specific skills demonstrated in the "
            "conversation."
        ),
    )


class SharedSupervisorNoteInputs(PromptInputs):

    prompt = PromptInfo(code="ally_ai_shared_supervisor_note")

    LEARNER_NAME: Optional[str] = None
    LIVE_NOTES: Optional[str] = None
    SUPERVISOR_MEMORY: Optional[str] = None
    WORKER_TYPE_GUIDANCE: Optional[str] = None


class SharedSupervisorNoteRepairInputs(PromptInputs):
    """`shared/supervisor_note_repair.txt`."""

    prompt = PromptInfo(code="ally_ai_shared_supervisor_note_repair")

    output_format: ClassVar[Optional[str]] = "structured"

    MISSING_SECTIONS: str
    NOTE: str


class SharedWorkerTypeEarlyProfessionalInputs(PromptInputs):
    """`shared/worker_type_early_professional.txt`."""

    prompt = PromptInfo(code="ally_ai_shared_worker_type_early_professional")


class SharedWorkerTypeExperiencedProfessionalInputs(PromptInputs):
    """`shared/worker_type_experienced_professional.txt`."""

    prompt = PromptInfo(code="ally_ai_shared_worker_type_experienced_professional")


class SharedWorkerTypeLayInputs(PromptInputs):

    prompt = PromptInfo(code="ally_ai_shared_worker_type_lay")


class SummaryDictationSummaryInputs(PromptInputs):
    """`summary/dictation_summary.txt`."""

    prompt = PromptInfo(
        code="ally_ai_summary_dictation_summary",
        name="Dictation Session Summary",
        description=(
            "Generates a session summary for dictation mode (same structure as scribe "
            "for now)."
        ),
    )

    output_format: ClassVar[Optional[str]] = "structured"

    chat_history: str


class SummaryDynamicSummaryInputs(PromptInputs):
    """`summary/dynamic_summary.txt`."""

    prompt = PromptInfo(
        code="ally_ai_summary_dynamic_summary",
        name="Dynamic Summary",
        description="Generates a summary based on specific dynamic keys.",
    )

    output_format: ClassVar[Optional[str]] = "structured"

    chat_history: str
    key_descriptions: str


class SummarySummaryInputs(PromptInputs):
    """`summary/summary.txt`."""

    prompt = PromptInfo(
        code="ally_ai_summary_summary",
        name="Session Summary",
        description="Generates a standard session summary.",
    )

    output_format: ClassVar[Optional[str]] = "structured"

    chat_history: str


class TagsPositivityRatingInputs(PromptInputs):
    """`tags/positivity_rating.txt`."""

    prompt = PromptInfo(
        code="ally_ai_tags_positivity_rating",
        name="Positivity Rating",
        description="Rates the positivity of tags or statements.",
    )

    output_format: ClassVar[Optional[str]] = "structured"

    tags: str


class UserIdentifyUserInputs(PromptInputs):
    """`user/identify_user.txt`."""

    prompt = PromptInfo(
        code="ally_ai_user_identify_user",
        name="Identify User",
        description="Identifies the speaker/user from the conversation context.",
    )

    output_format: ClassVar[Optional[str]] = "structured"

    conversations: str


def _collect_contracts() -> dict[str, type[PromptInputs]]:
    """Every PromptInputs subclass that declares a prompt, keyed by its code."""
    found: dict[str, type[PromptInputs]] = {}
    pending = list(PromptInputs.__subclasses__())
    while pending:
        model = pending.pop()
        pending.extend(model.__subclasses__())
        info = model.__dict__.get("prompt")
        if not isinstance(info, PromptInfo):
            continue
        if info.code in found:
            raise ValueError(f"Prompt contract {info.code!r} is declared twice")
        found[info.code] = model
    return found


PROMPT_CONTRACTS: dict[str, type[PromptInputs]] = _collect_contracts()


def _names(model: type[PromptInputs], *, required_only: bool) -> list[str]:
    return sorted(
        (field.alias or name)
        for name, field in model.model_fields.items()
        if not required_only or field.is_required()
    )


def required_variables(prompt_code: str) -> list[str]:
    """Variables the prompt must contain and the code must supply."""
    model = PROMPT_CONTRACTS.get(prompt_code)
    return _names(model, required_only=True) if model else []


def is_closed(model: type[PromptInputs]) -> bool:
    return model.model_config.get("extra") == "forbid"


def contract_payload(prompt_code: str) -> Optional[dict]:
    """The contract as the Skills Store receives it at sync, or None."""
    model = PROMPT_CONTRACTS.get(prompt_code)
    if model is None:
        return None
    payload: dict = {
        "variables": _names(model, required_only=False) if is_closed(model) else None,
        "required": _names(model, required_only=True),
        "contractVersion": model.contract_version,
    }
    if model.fragments:
        payload["fragments"] = sorted(model.fragments)
    if model.output_format:
        payload["output"] = model.output_format
    return payload


def missing_required(prompt_code: str, supplied: Mapping[str, object]) -> list[str]:
    """Required variables the caller did not pass at all."""
    return [name for name in required_variables(prompt_code) if name not in supplied]


def available_variables(prompt_code: str) -> list[dict]:
    """The contract's variables as the Skills Store lists them for editors:
    `{name, required}`, plus `label` where the field has a title."""
    model = PROMPT_CONTRACTS.get(prompt_code)
    if model is None:
        return []
    out = []
    for name, field in sorted(model.model_fields.items()):
        entry: dict = {"name": field.alias or name, "required": field.is_required()}
        if field.title:
            entry["label"] = field.title
        out.append(entry)
    return out


def all_contract_payloads() -> dict[str, Optional[dict]]:
    """Every prompt's contract payload, keyed by prompt code."""
    return {code: contract_payload(code) for code in sorted(PROMPT_CONTRACTS)}


if __name__ == "__main__":
    # `python -m app.prompts.contracts`: the contracts as JSON on stdout, for the
    # release check (scripts/prompts/release-check.mjs --contracts <file>).
    import json
    import sys

    json.dump(all_contract_payloads(), sys.stdout, indent=2, sort_keys=True)
    sys.stdout.write("\n")
