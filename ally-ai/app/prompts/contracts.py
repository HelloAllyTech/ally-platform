"""Typed contracts for this service's prompts: one model per default .txt.

Each model declares the prompt's code and how it shows up in the Skills
Store (`prompt = PromptInfo(...)`), and its fields are the variables the code
supplies. A field without a default is REQUIRED: the prompt text must contain
it and the code must pass it. Declaring the class is the whole registration:
`PROMPT_CONTRACTS` collects every subclass of `PromptInputs`.

- Sync (scripts/sync_prompts.py) sends each prompt's `contract_payload` and
  details, with `availableVariables` as the bare placeholder names parsed
  from the .txt by regex. The Skills Store refuses a new version that drops a
  required variable (or, for a closed contract, uses one the code doesn't
  supply). `available_variables()` (`{name, required, label?}` per field,
  label from `Field(title=...)`) is not sent by sync; it exists for parity
  with ally-ai-learn's contracts module.
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


class AnalyticsAnswerInputs(PromptInputs):
    """`analytics/answer.txt`."""

    prompt = PromptInfo(
        code="ally_ai_analytics_answer",
        name="Analytics Agent Answer",
        description=(
            "Turns the rows an Analytics Agent query returned into the answer a "
            "platform administrator reads: the number first, caveats that hold for "
            "this result, a chart choice and suggested follow-up questions."
        ),
    )

    output_format: ClassVar[Optional[str]] = "structured"

    # Earlier turns of the conversation, built in code; empty on a first question.
    history_block: Optional[str] = None
    question: str
    # The result: columns, rows returned (with a truncation note when the rows
    # are a sample) and the rows as CSV, or "(no rows)". Built in code.
    result_block: str
    sql: str


class AnalyticsPlannerInputs(PromptInputs):
    """`analytics/planner.txt`."""

    prompt = PromptInfo(
        code="ally_ai_analytics_planner",
        name="Analytics Agent Planner",
        description=(
            "Translates an administrator's analytics question into one read-only "
            "PostgreSQL query over the schema catalogue ally-be allows, or asks a "
            "clarifying question, or refuses when the data is not there."
        ),
    )

    output_format: ClassVar[Optional[str]] = "structured"

    # Earlier turns (question, SQL, answer), built in code; empty on a first
    # question.
    history_block: Optional[str] = None
    question: str
    row_limit: int
    schema_catalog: str
    today: str


class AudioDiarizationInputs(PromptInputs):
    """`audio/diarization.txt`."""

    prompt = PromptInfo(
        code="ally_ai_audio_diarization",
        name="Diarization",
        description="Identifies distinct speakers in audio transcriptions.",
    )

    output_format: ClassVar[Optional[str]] = "structured"

    transcription: str


class AudioGeminiTranscriptionInputs(PromptInputs):
    """`audio/gemini_transcription.txt`."""

    prompt = PromptInfo(
        code="ally_ai_audio_gemini_transcription",
        name="Gemini Transcription",
        description=(
            "Instructs Gemini to transcribe one segment of a recorded counselling "
            "call verbatim, in the languages spoken, as timestamped utterances for "
            "the diarization step."
        ),
    )

    output_format: ClassVar[Optional[str]] = "structured"


class HelplineCopilotNudgeRequestedInputs(PromptInputs):
    """`helpline/copilot_nudge_requested.txt`."""

    prompt = PromptInfo(
        code="ally_ai_helpline_copilot_nudge_requested",
        name="Helpline Copilot Nudge Instruction",
        description=(
            "The sentence inserted into the Helpline Copilot Turn prompt (as "
            "{nudge_instruction}) when the listener's coaching nudge is due: what a "
            "good nudge is and what it must never suggest."
        ),
    )


class HelplineCopilotRiskFlaggedInputs(PromptInputs):
    """`helpline/copilot_risk_flagged.txt`."""

    prompt = PromptInfo(
        code="ally_ai_helpline_copilot_risk_flagged",
        name="Helpline Copilot Risk-Flagged Instruction",
        description=(
            "The sentence inserted into the Helpline Copilot Turn prompt (as "
            "{risk_instruction}) when the platform's risk screen has flagged the "
            "conversation: the first suggestion must ask directly about safety."
        ),
    )

    # ", about someone else the talker knows" when the risk is to another person.
    about: Optional[str] = None
    # The flagged level: "elevated" or "high".
    level: str


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


class KnowledgeAnswerGeneralInputs(PromptInputs):
    """`knowledge/answer_general.txt`."""

    prompt = PromptInfo(
        code="ally_ai_knowledge_answer_general",
        name="Chatbot Answer (documents + general knowledge)",
        description=(
            "Answers a chatbot question from the bot's documents first and, when "
            "they do not cover it, from general knowledge, saying so. Used only by "
            "bots set to 'Documents + general knowledge'."
        ),
    )

    output_format: ClassVar[Optional[str]] = "structured"

    history: Optional[str] = None
    max_chars: Optional[str] = None
    passages: str
    question: str


class AgentSystemInputs(PromptInputs):
    """`agent/system.txt`."""

    prompt = PromptInfo(
        code="ally_ai_agent_system",
        name="Chatbot Agent: Instructions",
        description=(
            "For chatbots in Agent mode: the agent's rules (safety, grounding, what "
            "needs no source), how it searches and declines, how it should sound, "
            "what it covers, the conversation, the passages and its tools. Each call "
            "reads the turn and returns either a tool call or the reply. The "
            "chatbot's persona is prepended in code."
        ),
    )

    output_format: ClassVar[Optional[str]] = "structured"

    answer_scope: Optional[str] = None
    decline_text: Optional[str] = None
    feedback: Optional[str] = None
    history: Optional[str] = None
    knowledge_topics: Optional[str] = None
    max_chars: Optional[str] = None
    message: str
    passages: str
    searches: Optional[str] = None
    tool_budget: Optional[str] = None
    tools: Optional[str] = None


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


class SummaryCondenseChunkInputs(PromptInputs):
    """`summary/condense_chunk.txt`."""

    prompt = PromptInfo(
        code="ally_ai_summary_condense_chunk",
        name="Summary Transcript Condense",
        description=(
            "Condenses one part of a long session transcript into plain text before "
            "the session summary runs, so a long session fits the summary prompt."
        ),
    )

    chunk: str
    part_count: Optional[int] = None
    part_number: Optional[int] = None


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


class BuilderChangeInputs(PromptInputs):
    """`builder/change.txt`."""

    prompt = PromptInfo(
        code="ally_ai_builder_change",
        name="Assistant Home: Change by Chat",
        description=(
            'Turns an owner\'s request ("make it more formal", "don\'t discuss '
            "prices\") into a proposed change to their assistant's settings (chunk "
            "20a-2). Code builds the before and after; ally-be applies it only when "
            "the owner confirms. Safety can't be weakened: the model refuses, and code "
            "never lets a change reach the safety pack."
        ),
    )

    output_format: ClassVar[Optional[str]] = "structured"

    current: str
    safety: str
    request: str


class CheckupJudgeInputs(PromptInputs):
    """`checkup/judge.txt`."""

    prompt = PromptInfo(
        code="ally_ai_checkup_judge",
        name="Checkup: Judge a Reply",
        description=(
            "Checks one assistant reply for meaning in a checkup (chunk 20a-2): the "
            "expected facts, what it must not say, and anything made up. Automatic "
            "checks decide the rest; this judge can fail a case, never pass one."
        ),
    )

    output_format: ClassVar[Optional[str]] = "structured"

    question: str
    history: str
    expected: str
    facts: str
    must_not: str
    also_ok: str
    sources: str
    reply: str


class CheckupQuestionsInputs(PromptInputs):
    """`checkup/questions.txt`."""

    prompt = PromptInfo(
        code="ally_ai_checkup_questions",
        name="Checkup: Write Test Questions",
        description=(
            "Writes an assistant's checkup questions from what we learned about the "
            "business (chunk 20a-2), each answered by one or two learned details. Code "
            "keeps each question's details as its expected facts and source, and drops "
            "a question that names a detail it wasn't given."
        ),
    )

    output_format: ClassVar[Optional[str]] = "structured"

    audience: str
    business: str
    facts: str
    count: str
    language: str


class BuilderSystemInputs(PromptInputs):
    """`builder/system.txt`."""

    prompt = PromptInfo(
        code="ally_ai_builder_system",
        name="Onboarding Builder: Conversation",
        description=(
            "The setup guide new customers talk to when they create an assistant "
            "(chunk 20a). One call per owner message: it replies, offers quick "
            "replies and proposes changes to the draft, which ally-be checks and "
            "applies. It never chooses the safety pack."
        ),
    )

    output_format: ClassVar[Optional[str]] = "structured"

    answers: str
    draft: str
    history: str
    learned: str
    message: str
    pages: str
    pending: str
    safety_pack: str
    step: str
    step_guide: str


class BuilderExtractInputs(PromptInputs):
    """`builder/extract.txt`."""

    prompt = PromptInfo(
        code="ally_ai_builder_extract",
        name="Onboarding Builder: Extract Facts",
        description=(
            "Reads a batch of crawled website pages and returns the details the "
            "assistant needs, each tied to the page it came from. Details without a "
            "valid page are dropped in code."
        ),
    )

    output_format: ClassVar[Optional[str]] = "structured"

    known: str
    pages: str


class BuilderClassifyInputs(PromptInputs):
    """`builder/classify.txt`."""

    prompt = PromptInfo(
        code="ally_ai_builder_classify",
        name="Onboarding Builder: Classify Industry",
        description=(
            "Chooses the business's industry from a fixed list. ally-be maps the "
            "industry to its safety pack in code; the model never picks the pack."
        ),
    )

    output_format: ClassVar[Optional[str]] = "structured"

    description: str
    learned: str
    pages: str


class BuilderGapsInputs(PromptInputs):
    """`builder/gaps.txt`."""

    prompt = PromptInfo(
        code="ally_ai_builder_gaps",
        name="Onboarding Builder: Find Gaps",
        description=(
            "Checks what we learned against the industry's fixed checklist and the "
            "site's own content, and lists what the owner should be asked."
        ),
    )

    output_format: ClassVar[Optional[str]] = "structured"

    answers: str
    checklist: str
    learned: str
    pages: str


class BuilderDesignsInputs(PromptInputs):
    """`builder/designs.txt`."""

    prompt = PromptInfo(
        code="ally_ai_builder_designs",
        name="Onboarding Builder: Propose Designs",
        description=(
            "Proposes 2–3 designs that work today (guide, enquiries, support) with a "
            "title and sample exchange. What each will and won't do is fixed in code; "
            "booking and orders are always a coming-soon card."
        ),
    )

    output_format: ClassVar[Optional[str]] = "structured"

    audience: str
    learned: str
    offered: str


class BuilderDraftInputs(PromptInputs):
    """`builder/draft.txt`."""

    prompt = PromptInfo(
        code="ally_ai_builder_draft",
        name="Onboarding Builder: Draft the Assistant",
        description=(
            "Writes the assistant's introduction, instructions, tone, topics, "
            "suggested questions, pre-chat questions and decline wording from what "
            "we learned and the owner's answers."
        ),
    )

    output_format: ClassVar[Optional[str]] = "structured"

    answers: str
    decline_hint: str
    design: str
    learned: str
    prechat_rule: str
    safety_pack: str
    tone_hint: str


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
