"""Typed input contracts for this service's prompts.

One model per prompt, keyed by its full prompt code. A model's fields are
the variables the code supplies to that prompt; a field without a default
is REQUIRED: the prompt text must contain it and the code must pass it.

- Sync sends each prompt's `contract_payload` to the Skills Store, which
  refuses a new version that drops a required variable (or, for a closed
  contract, uses one the code doesn't supply).
- The resolver logs `[PROMPT_CONTRACT]` at ERROR when the code renders a
  prompt without a required variable.
- tests/unit/test_prompt_contracts.py checks every default .txt against
  its model.

Contracts start OPEN (`extra="allow"`): undeclared variables are
accepted. Close one with `model_config = ConfigDict(extra="forbid")`
once its field list is known to be complete. Bump `contract_version` on
a breaking change.
"""

from typing import ClassVar, Mapping, Optional

from pydantic import BaseModel, ConfigDict


class PromptInputs(BaseModel):
    """Base for every prompt contract."""

    model_config = ConfigDict(extra="allow", protected_namespaces=())

    contract_version: ClassVar[int] = 1
    # Text the runtime appends after templating, outside the template.
    fragments: ClassVar[list[str]] = []
    # How the code reads the answer: "json" when it parses free text as JSON
    # (CI checks the default produces parseable JSON); "structured" when the
    # provider enforces it (with_structured_output, response_format).
    output_format: ClassVar[Optional[str]] = None


class AnalysisCounselorAnalysisInputs(PromptInputs):
    """ally_ai_analysis_counselor_analysis — Counselor Analysis
    (`analysis/counselor_analysis.txt`).
    """

    output_format: ClassVar[Optional[str]] = "structured"

    message: str


class AudioDiarizationInputs(PromptInputs):
    """ally_ai_audio_diarization — Diarization (`audio/diarization.txt`)."""

    output_format: ClassVar[Optional[str]] = "structured"

    transcription: str


class HelplineCopilotTurnInputs(PromptInputs):
    """
    ally_ai_helpline_copilot_turn — Helpline Copilot Turn (`helpline/copilot_turn.txt`).
    """

    output_format: ClassVar[Optional[str]] = "structured"

    conversation: str
    nudge_instruction: str
    risk_instruction: str
    rolling_summary: Optional[str] = None
    talker_language: Optional[str] = None


class HelplineRiskClassifyInputs(PromptInputs):
    """ally_ai_helpline_risk_classify — Helpline Risk Classifier
    (`helpline/risk_classify.txt`).
    """

    output_format: ClassVar[Optional[str]] = "structured"

    language_name: Optional[str] = None
    message: str
    recent: Optional[str] = None


class KnowledgeCrisisClassifyInputs(PromptInputs):
    """ally_ai_knowledge_crisis_classify — WhatsApp Crisis Classifier
    (`knowledge/crisis_classify.txt`).
    """

    output_format: ClassVar[Optional[str]] = "structured"

    message: str


class KnowledgeTranslateQueryInputs(PromptInputs):
    """ally_ai_knowledge_translate_query — WhatsApp Knowledge Query Translation
    (`knowledge/translate_query.txt`).
    """

    output_format: ClassVar[Optional[str]] = "structured"

    question: str


class KnowledgeWhatsappAnswerInputs(PromptInputs):
    """ally_ai_knowledge_whatsapp_answer — WhatsApp Knowledge Answer
    (`knowledge/whatsapp_answer.txt`).
    """

    output_format: ClassVar[Optional[str]] = "structured"

    history: Optional[str] = None
    max_chars: Optional[str] = None
    passages: str
    question: str


class NotesContentEnhanceInputs(PromptInputs):
    """
    ally_ai_notes_content_enhance — Content Enhancement (`notes/content_enhance.txt`).
    """

    output_format: ClassVar[Optional[str]] = "structured"

    content: str


class NudgeNudgeInputs(PromptInputs):
    """ally_ai_nudge_nudge — Generate Nudge (`nudge/nudge.txt`)."""

    output_format: ClassVar[Optional[str]] = "structured"

    chat_history: str
    conversation: Optional[str] = None
    suggestion: Optional[str] = None


class ScenarioScenarioEvaluationInputs(PromptInputs):
    """ally_ai_scenario_scenario_evaluation — Scenario Evaluation
    (`scenario/scenario_evaluation.txt`).
    """

    output_format: ClassVar[Optional[str]] = "structured"

    SCENARIO_BEHAVIOUR_GUIDANCE: Optional[str] = None
    SKILL_COVERAGE_DESCRIPTIONS: Optional[str] = None
    SUPERVISOR_NOTE_SECTION: Optional[str] = None
    chat_history: str


class ScenarioScenarioEvaluationWithMemoryInputs(PromptInputs):
    """
    ally_ai_scenario_scenario_evaluation_with_memory — Scenario Evaluation with Memory
    (`scenario/scenario_evaluation_with_memory.txt`).
    """

    output_format: ClassVar[Optional[str]] = "structured"

    SCENARIO_BEHAVIOUR_GUIDANCE: Optional[str] = None
    SKILL_COVERAGE_DESCRIPTIONS: Optional[str] = None
    SUPERVISOR_NOTE_SECTION: Optional[str] = None
    chat_history: str
    custom_prompt_section: Optional[str] = None
    previous_summary: Optional[str] = None


class SharedScenarioBehavioursInputs(PromptInputs):
    """ally_ai_shared_scenario_behaviours — scenario behaviours
    (`shared/scenario_behaviours.txt`).
    """

    HELPFUL_BEHAVIOURS_LIST: Optional[str] = None
    UNHELPFUL_BEHAVIOURS_LIST: Optional[str] = None


class SharedSkillCoverageInputs(PromptInputs):
    """ally_ai_shared_skill_coverage — Skill Coverage (`shared/skill_coverage.txt`)."""

    pass


class SharedSupervisorNoteInputs(PromptInputs):
    """ally_ai_shared_supervisor_note — supervisor note.

    `shared/supervisor_note.txt`
    """

    LEARNER_NAME: Optional[str] = None
    LIVE_NOTES: Optional[str] = None
    SUPERVISOR_MEMORY: Optional[str] = None
    WORKER_TYPE_GUIDANCE: Optional[str] = None


class SharedSupervisorNoteRepairInputs(PromptInputs):
    """ally_ai_shared_supervisor_note_repair — supervisor note repair
    (`shared/supervisor_note_repair.txt`).
    """

    output_format: ClassVar[Optional[str]] = "structured"

    MISSING_SECTIONS: str
    NOTE: str


class SharedWorkerTypeEarlyProfessionalInputs(PromptInputs):
    """ally_ai_shared_worker_type_early_professional — worker type early professional
    (`shared/worker_type_early_professional.txt`).
    """

    pass


class SharedWorkerTypeExperiencedProfessionalInputs(PromptInputs):
    """ally_ai_shared_worker_type_experienced_professional — worker type experienced
    professional (`shared/worker_type_experienced_professional.txt`).
    """

    pass


class SharedWorkerTypeLayInputs(PromptInputs):
    """ally_ai_shared_worker_type_lay — worker type lay.

    `shared/worker_type_lay.txt`
    """

    pass


class SummaryDictationSummaryInputs(PromptInputs):
    """ally_ai_summary_dictation_summary — Dictation Session Summary
    (`summary/dictation_summary.txt`).
    """

    output_format: ClassVar[Optional[str]] = "structured"

    chat_history: str


class SummaryDynamicSummaryInputs(PromptInputs):
    """
    ally_ai_summary_dynamic_summary — Dynamic Summary (`summary/dynamic_summary.txt`).
    """

    output_format: ClassVar[Optional[str]] = "structured"

    chat_history: str
    key_descriptions: str


class SummarySummaryInputs(PromptInputs):
    """ally_ai_summary_summary — Session Summary (`summary/summary.txt`)."""

    output_format: ClassVar[Optional[str]] = "structured"

    chat_history: str


class TagsPositivityRatingInputs(PromptInputs):
    """
    ally_ai_tags_positivity_rating — Positivity Rating (`tags/positivity_rating.txt`).
    """

    output_format: ClassVar[Optional[str]] = "structured"

    tags: str


class UserIdentifyUserInputs(PromptInputs):
    """ally_ai_user_identify_user — Identify User (`user/identify_user.txt`)."""

    output_format: ClassVar[Optional[str]] = "structured"

    conversations: str


PROMPT_CONTRACTS: dict[str, type[PromptInputs]] = {
    "ally_ai_analysis_counselor_analysis": AnalysisCounselorAnalysisInputs,
    "ally_ai_audio_diarization": AudioDiarizationInputs,
    "ally_ai_helpline_copilot_turn": HelplineCopilotTurnInputs,
    "ally_ai_helpline_risk_classify": HelplineRiskClassifyInputs,
    "ally_ai_knowledge_crisis_classify": KnowledgeCrisisClassifyInputs,
    "ally_ai_knowledge_translate_query": KnowledgeTranslateQueryInputs,
    "ally_ai_knowledge_whatsapp_answer": KnowledgeWhatsappAnswerInputs,
    "ally_ai_notes_content_enhance": NotesContentEnhanceInputs,
    "ally_ai_nudge_nudge": NudgeNudgeInputs,
    "ally_ai_scenario_scenario_evaluation": ScenarioScenarioEvaluationInputs,
    "ally_ai_scenario_scenario_evaluation_with_memory": ScenarioScenarioEvaluationWithMemoryInputs,  # noqa: E501
    "ally_ai_shared_scenario_behaviours": SharedScenarioBehavioursInputs,
    "ally_ai_shared_skill_coverage": SharedSkillCoverageInputs,
    "ally_ai_shared_supervisor_note": SharedSupervisorNoteInputs,
    "ally_ai_shared_supervisor_note_repair": SharedSupervisorNoteRepairInputs,
    "ally_ai_shared_worker_type_early_professional": SharedWorkerTypeEarlyProfessionalInputs,  # noqa: E501
    "ally_ai_shared_worker_type_experienced_professional": SharedWorkerTypeExperiencedProfessionalInputs,  # noqa: E501
    "ally_ai_shared_worker_type_lay": SharedWorkerTypeLayInputs,
    "ally_ai_summary_dictation_summary": SummaryDictationSummaryInputs,
    "ally_ai_summary_dynamic_summary": SummaryDynamicSummaryInputs,
    "ally_ai_summary_summary": SummarySummaryInputs,
    "ally_ai_tags_positivity_rating": TagsPositivityRatingInputs,
    "ally_ai_user_identify_user": UserIdentifyUserInputs,
}


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
