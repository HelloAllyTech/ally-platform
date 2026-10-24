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


class BranchingChatSummarySystemInputs(PromptInputs):
    """ally_ai_learn_branching_chat_summary_system — Chat Summary System Prompt
    (`branching/chat_summary_system.txt`).
    """

    output_format: ClassVar[Optional[str]] = "structured"


class BranchingLlmResponseSystemInputs(PromptInputs):
    """
    ally_ai_learn_branching_llm_response_system — LLM Response Generator System Prompt
    (`branching/llm_response_system.txt`).
    """

    output_format: ClassVar[Optional[str]] = "structured"


class CounselorAntiRepetitionGuidanceInputs(PromptInputs):
    """ally_ai_learn_counselor_anti_repetition_guidance — Anti-Repetition Guidance
    (`counselor/anti_repetition_guidance.txt`).
    """

    pass


class CounselorConversationGoalReminderInputs(PromptInputs):
    """ally_ai_learn_counselor_conversation_goal_reminder — Conversation Goal Reminder
    (`counselor/conversation_goal_reminder.txt`).
    """

    pass


class CounselorReportGenerationPromptInputs(PromptInputs):
    """ally_ai_learn_counselor_report_generation_prompt — Report Generation
    (`counselor/report_generation_prompt.txt`).
    """

    custom_prompt: Optional[str] = None
    language_code: Optional[str] = None


class CounselorStagnationSteeringInputs(PromptInputs):
    """ally_ai_learn_counselor_stagnation_steering — Stagnation Steering Injection
    (`counselor/stagnation_steering.txt`).
    """

    pass


class EvaluationEvaluatorSystemInputs(PromptInputs):
    """ally_ai_learn_evaluation_evaluator_system — Transcript Evaluator System Prompt
    (`evaluation/evaluator_system.txt`).
    """

    output_format: ClassVar[Optional[str]] = "structured"

    pass


class EventsBehaviorDetectionSystemInputs(PromptInputs):
    """ally_ai_learn_events_behavior_detection_system — Behavior Detection System Prompt
    (`events/behavior_detection_system.txt`).
    """

    output_format: ClassVar[Optional[str]] = "structured"

    behaviors: Optional[str] = None


class EventsBehaviorDetectionUserInputs(PromptInputs):
    """ally_ai_learn_events_behavior_detection_user — Behavior Detection User Prompt
    (`events/behavior_detection_user.txt`).
    """

    output_format: ClassVar[Optional[str]] = "structured"

    message: str


class EventsBinaryClassifierBatchSystemInputs(PromptInputs):
    """
    ally_ai_learn_events_binary_classifier_batch_system — binary classifier batch system
    (`events/binary_classifier_batch_system.txt`).
    """

    output_format: ClassVar[Optional[str]] = "structured"

    classes_block: str


class EventsBinaryClassifierSystemInputs(PromptInputs):
    """ally_ai_learn_events_binary_classifier_system — Binary Classifier System Prompt
    (`events/binary_classifier_system.txt`).
    """

    output_format: ClassVar[Optional[str]] = "structured"

    class_name: str
    examples_block: Optional[str] = None


class EventsBinaryClassifierUserInputs(PromptInputs):
    """ally_ai_learn_events_binary_classifier_user — Binary Classifier User Prompt
    (`events/binary_classifier_user.txt`).
    """

    output_format: ClassVar[Optional[str]] = "structured"

    message: str


class EventsCoherenceGuardrailSystemInputs(PromptInputs):
    """ally_ai_learn_events_coherence_guardrail_system — Coherence Guardrail Classifier
    System Prompt (`events/coherence_guardrail_system.txt`).
    """

    output_format: ClassVar[Optional[str]] = "structured"

    helper_dialogue: str


class EventsCoherenceGuardrailUserInputs(PromptInputs):
    """
    ally_ai_learn_events_coherence_guardrail_user — Coherence Guardrail Classifier User
    Prompt (`events/coherence_guardrail_user.txt`).
    """

    output_format: ClassVar[Optional[str]] = "structured"

    conversation_context: Optional[str] = None
    counselor_message: str


class EventsGuardrailSystemInputs(PromptInputs):
    """ally_ai_learn_events_guardrail_system — Guardrail Classifier System Prompt
    (`events/guardrail_system.txt`).
    """

    output_format: ClassVar[Optional[str]] = "structured"

    helper_dialogue: str


class EventsGuardrailUserInputs(PromptInputs):
    """ally_ai_learn_events_guardrail_user — Guardrail Classifier User Prompt
    (`events/guardrail_user.txt`).
    """

    output_format: ClassVar[Optional[str]] = "structured"

    counselor_message: str


class EventsHelperParaphrasedSystemInputs(PromptInputs):
    """
    ally_ai_learn_events_helper_paraphrased_system — Helper Paraphrased Detector System
    Prompt (`events/helper_paraphrased_system.txt`).
    """

    output_format: ClassVar[Optional[str]] = "structured"


class EventsHelperParaphrasedUserInputs(PromptInputs):
    """ally_ai_learn_events_helper_paraphrased_user — Helper Paraphrased Detector User
    Prompt (`events/helper_paraphrased_user.txt`).
    """

    output_format: ClassVar[Optional[str]] = "structured"

    agent_message: str
    counselor_message: str


class FillerBackchannelInputs(PromptInputs):
    """
    ally_ai_learn_filler_backchannel — Back-channel Prompt (`filler/backchannel.txt`).
    """

    output_format: ClassVar[Optional[str]] = "structured"

    count: Optional[str] = None
    language_code: Optional[str] = None
    language_label: Optional[str] = None
    scenario_context: Optional[str] = None


class FillerInterimReplyInputs(PromptInputs):
    """ally_ai_learn_filler_interim_reply — Interim Reply Prompt (simulations WITHOUT
    working memory) (`filler/interim_reply.txt`).
    """

    output_format: ClassVar[Optional[str]] = "structured"

    language_code: Optional[str] = None
    language_label: Optional[str] = None
    scenario_context: Optional[str] = None


class FillerPredictiveFillerInputs(PromptInputs):
    """ally_ai_learn_filler_predictive_filler — Predictive Filler Prompt
    (`filler/predictive_filler.txt`).
    """

    output_format: ClassVar[Optional[str]] = "structured"

    character_voice: Optional[str] = None
    count: Optional[str] = None
    filler_types: Optional[str] = None
    language_code: Optional[str] = None
    language_label: Optional[str] = None
    recent_fillers: Optional[str] = None
    scenario_context: Optional[str] = None


class SupervisorLiveNoteInputs(PromptInputs):
    """ally_ai_learn_supervisor_live_note — Live Supervisor Notes — System Prompt
    (`supervisor/live_note.txt`).
    """

    output_format: ClassVar[Optional[str]] = "structured"

    LANGUAGE: str


class SystemAudioTagGuidanceInputs(PromptInputs):
    """ally_ai_learn_system_audio_tag_guidance — Audio Tag Guidance
    (`system/audio_tag_guidance.txt`).
    """

    pass


class SystemBranchingAgentPromptInputs(PromptInputs):
    """ally_ai_learn_system_branching_agent_prompt — Branching Agent Prompt
    (`system/branching_agent_prompt.txt`).
    """

    fragments: ClassVar[list[str]] = [
        "ally_ai_learn_system_audio_tag_guidance",
        "ally_ai_learn_system_text_chat_guidance",
        "language_glossary",
        "retrieved_context",
        "rolling_summary",
    ]
    age: Optional[str] = None
    allowed_fillers: Optional[str] = None
    character_profile_text: Optional[str] = None
    competency: Optional[str] = None
    current_location: Optional[str] = None
    gender: Optional[str] = None
    language_code: Optional[str] = None
    language_glossary: Optional[str] = None
    language_label: Optional[str] = None
    linguistic_samples: Optional[str] = None
    name: Optional[str] = None
    next_instruction: str
    retrieved_context: Optional[str] = None


class SystemClientWorkingMemoryUpdaterInputs(PromptInputs):
    """
    ally_ai_learn_system_client_working_memory_updater — Client Working Memory Updater
    (writes what Main Agent Prompt #3 reads)
    (`system/client_working_memory_updater.txt`).
    """

    output_format: ClassVar[Optional[str]] = "structured"

    current_state: str
    language_label: str
    opener_catalog: str
    state_ladder: str


class SystemMainAgentPromptInputs(PromptInputs):
    """ally_ai_learn_system_main_agent_prompt — Main Agent Prompt
    (`system/main_agent_prompt.txt`).
    """

    fragments: ClassVar[list[str]] = [
        "ally_ai_learn_system_audio_tag_guidance",
        "ally_ai_learn_system_text_chat_guidance",
        "language_glossary",
        "retrieved_context",
        "rolling_summary",
    ]
    age: Optional[str] = None
    allowed_fillers: Optional[str] = None
    behavior_instructions_json: Optional[str] = None
    character_profile_text: Optional[str] = None
    competency: Optional[str] = None
    current_location: Optional[str] = None
    custom_fields_text: Optional[str] = None
    dialogue_length_instruction: Optional[str] = None
    gender: Optional[str] = None
    gender_identity: Optional[str] = None
    language_code: str
    language_glossary: Optional[str] = None
    language_label: str
    linguistic_samples: Optional[str] = None
    name: Optional[str] = None
    previous_memory: Optional[str] = None
    profession: Optional[str] = None
    role_instructions: str
    sexual_orientation: Optional[str] = None


class SystemMainAgentPromptFullInputs(PromptInputs):
    """ally_ai_learn_system_main_agent_prompt_full — Main Agent Prompt #2
    (`system/main_agent_prompt_full.txt`).
    """

    fragments: ClassVar[list[str]] = [
        "ally_ai_learn_system_audio_tag_guidance",
        "ally_ai_learn_system_text_chat_guidance",
        "language_glossary",
        "retrieved_context",
        "rolling_summary",
    ]
    age: Optional[str] = None
    allowed_fillers: Optional[str] = None
    character_profile_text: Optional[str] = None
    current_location: Optional[str] = None
    gender: Optional[str] = None
    gender_identity: Optional[str] = None
    language_code: str
    language_glossary: Optional[str] = None
    language_label: str
    linguistic_samples: Optional[str] = None
    name: Optional[str] = None
    profession: Optional[str] = None
    retrieved_context: Optional[str] = None
    role_instructions: str
    sexual_orientation: Optional[str] = None
    state_x_guidelines: Optional[str] = None


class SystemMainAgentPromptWorkingMemorySplitInputs(PromptInputs):
    """
    ally_ai_learn_system_main_agent_prompt_working_memory_split — Main Agent Prompt #3
    (`system/main_agent_prompt_working_memory_split.txt`).
    """

    fragments: ClassVar[list[str]] = [
        "ally_ai_learn_system_audio_tag_guidance",
        "ally_ai_learn_system_text_chat_guidance",
        "language_glossary",
        "retrieved_context",
        "rolling_summary",
    ]
    age: Optional[str] = None
    allowed_fillers: Optional[str] = None
    current_location: Optional[str] = None
    gender: Optional[str] = None
    gender_identity: Optional[str] = None
    language_code: str
    language_glossary: Optional[str] = None
    language_label: str
    linguistic_samples: Optional[str] = None
    name: Optional[str] = None
    profession: Optional[str] = None
    role_instructions: str
    sexual_orientation: Optional[str] = None
    state_x_guidelines: Optional[str] = None
    working_memory_disclosed: Optional[str] = None
    working_memory_register: Optional[str] = None
    working_memory_salient: Optional[str] = None
    working_memory_speech_fragments: Optional[str] = None
    working_memory_stance: Optional[str] = None
    working_memory_unresolved: Optional[str] = None
    working_memory_withheld: Optional[str] = None


class SystemRollingSummaryInputs(PromptInputs):
    """ally_ai_learn_system_rolling_summary — Rolling Summary System Prompt
    (`system/rolling_summary.txt`).
    """

    output_format: ClassVar[Optional[str]] = "structured"


class SystemTextChatGuidanceInputs(PromptInputs):
    """ally_ai_learn_system_text_chat_guidance — Text Chat Guidance
    (`system/text_chat_guidance.txt`).
    """

    pass


PROMPT_CONTRACTS: dict[str, type[PromptInputs]] = {
    "ally_ai_learn_branching_chat_summary_system": BranchingChatSummarySystemInputs,
    "ally_ai_learn_branching_llm_response_system": BranchingLlmResponseSystemInputs,
    "ally_ai_learn_counselor_anti_repetition_guidance": CounselorAntiRepetitionGuidanceInputs,  # noqa: E501
    "ally_ai_learn_counselor_conversation_goal_reminder": CounselorConversationGoalReminderInputs,  # noqa: E501
    "ally_ai_learn_counselor_report_generation_prompt": CounselorReportGenerationPromptInputs,  # noqa: E501
    "ally_ai_learn_counselor_stagnation_steering": CounselorStagnationSteeringInputs,
    "ally_ai_learn_evaluation_evaluator_system": EvaluationEvaluatorSystemInputs,
    "ally_ai_learn_events_behavior_detection_system": EventsBehaviorDetectionSystemInputs,  # noqa: E501
    "ally_ai_learn_events_behavior_detection_user": EventsBehaviorDetectionUserInputs,
    "ally_ai_learn_events_binary_classifier_batch_system": EventsBinaryClassifierBatchSystemInputs,  # noqa: E501
    "ally_ai_learn_events_binary_classifier_system": EventsBinaryClassifierSystemInputs,
    "ally_ai_learn_events_binary_classifier_user": EventsBinaryClassifierUserInputs,
    "ally_ai_learn_events_coherence_guardrail_system": EventsCoherenceGuardrailSystemInputs,  # noqa: E501
    "ally_ai_learn_events_coherence_guardrail_user": EventsCoherenceGuardrailUserInputs,
    "ally_ai_learn_events_guardrail_system": EventsGuardrailSystemInputs,
    "ally_ai_learn_events_guardrail_user": EventsGuardrailUserInputs,
    "ally_ai_learn_events_helper_paraphrased_system": EventsHelperParaphrasedSystemInputs,  # noqa: E501
    "ally_ai_learn_events_helper_paraphrased_user": EventsHelperParaphrasedUserInputs,
    "ally_ai_learn_filler_backchannel": FillerBackchannelInputs,
    "ally_ai_learn_filler_interim_reply": FillerInterimReplyInputs,
    "ally_ai_learn_filler_predictive_filler": FillerPredictiveFillerInputs,
    "ally_ai_learn_supervisor_live_note": SupervisorLiveNoteInputs,
    "ally_ai_learn_system_audio_tag_guidance": SystemAudioTagGuidanceInputs,
    "ally_ai_learn_system_branching_agent_prompt": SystemBranchingAgentPromptInputs,
    "ally_ai_learn_system_client_working_memory_updater": SystemClientWorkingMemoryUpdaterInputs,  # noqa: E501
    "ally_ai_learn_system_main_agent_prompt": SystemMainAgentPromptInputs,
    "ally_ai_learn_system_main_agent_prompt_full": SystemMainAgentPromptFullInputs,
    "ally_ai_learn_system_main_agent_prompt_working_memory_split": SystemMainAgentPromptWorkingMemorySplitInputs,  # noqa: E501
    "ally_ai_learn_system_rolling_summary": SystemRollingSummaryInputs,
    "ally_ai_learn_system_text_chat_guidance": SystemTextChatGuidanceInputs,
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
