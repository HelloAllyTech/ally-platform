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

from pydantic import BaseModel, ConfigDict, Field


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


class BranchingChatSummarySystemInputs(PromptInputs):
    """`branching/chat_summary_system.txt`."""

    prompt = PromptInfo(
        code="ally_ai_learn_branching_chat_summary_system",
        name="Chat Summary System Prompt",
        description=(
            "System prompt for the clinical supervisor role that generates a 2-3 "
            "sentence summary of a counselling role-play session, used to resolve "
            "<chat_summary> tags in branching instructions."
        ),
    )

    output_format: ClassVar[Optional[str]] = "structured"


class BranchingLlmResponseSystemInputs(PromptInputs):
    """`branching/llm_response_system.txt`."""

    prompt = PromptInfo(
        code="ally_ai_learn_branching_llm_response_system",
        name="LLM Response Generator System Prompt",
        description=(
            "System prompt for the LLM content generation function used to resolve "
            "<llm_response> tags inside branching instructions."
        ),
    )

    output_format: ClassVar[Optional[str]] = "structured"


class CounselorAntiRepetitionGuidanceInputs(PromptInputs):
    """`counselor/anti_repetition_guidance.txt`."""

    prompt = PromptInfo(
        code="ally_ai_learn_counselor_anti_repetition_guidance",
        name="Anti-Repetition Guidance",
        description=(
            "Permanent guidance appended to the counselor system prompt in report mode,"
            " instructing it to avoid repeating phrases and move the conversation "
            "forward."
        ),
    )


class CounselorConversationGoalReminderInputs(PromptInputs):
    """`counselor/conversation_goal_reminder.txt`."""

    prompt = PromptInfo(
        code="ally_ai_learn_counselor_conversation_goal_reminder",
        name="Conversation Goal Reminder",
        description=(
            "Objective reminder baked into the counselor base prompt in report mode, "
            "keeping focus on exploring emotions and progressing the session forward."
        ),
    )


class CounselorReportGenerationPromptInputs(PromptInputs):
    """`counselor/report_generation_prompt.txt`."""

    prompt = PromptInfo(
        code="ally_ai_learn_counselor_report_generation_prompt",
        name="Report Generation",
        description=(
            "Wrapper for counselor report generation. Enforces output language by code "
            "and optional custom prompt; used when generating reports from the "
            "simulation."
        ),
    )

    custom_prompt: Optional[str] = None
    language_code: Optional[str] = None


class CounselorStagnationSteeringInputs(PromptInputs):
    """`counselor/stagnation_steering.txt`."""

    prompt = PromptInfo(
        code="ally_ai_learn_counselor_stagnation_steering",
        name="Stagnation Steering Injection",
        description=(
            "Short steering fragment injected into the counselor system prompt only "
            "when a repetition loop is detected, redirecting the counselor toward new "
            "questions or coping strategies."
        ),
    )


class EvaluationActorGoalSystemInputs(PromptInputs):
    """`evaluation/actor_goal_system.txt`."""

    prompt = PromptInfo(
        code="ally_ai_learn_evaluation_actor_goal_system",
        name="Actor Goal Evaluator System Prompt",
        description=(
            "LLM-as-a-judge system prompt that scores a real session's roleplay actor "
            "(the AI character, not the trainee) against each superadmin-configured "
            "agent test case on a 0-100 scale, marks the test cases the conversation "
            "gave no occasion to demonstrate as not applicable, and writes a markdown "
            "report for a training supervisor. Runs after the session ends "
            "(POST /scenario-session/actor-evaluation); the transcript is sent as the "
            "user message."
        ),
    )

    output_format: ClassVar[Optional[str]] = "structured"

    goals_block: str = Field(
        title="Agent test cases (one line each: title, category, description)"
    )


class EvaluationEvaluatorSystemInputs(PromptInputs):
    """`evaluation/evaluator_system.txt`."""

    prompt = PromptInfo(
        code="ally_ai_learn_evaluation_evaluator_system",
        name="Transcript Evaluator System Prompt",
        description=(
            "LLM-as-a-judge system prompt that scores the client agent's performance "
            "across six metrics (gradual disclosure, difficulty level, colloquialism, "
            "context appropriateness, consistency, resistance) on a 0-100 scale."
        ),
        prompt_type="transcript_evaluator",
    )

    output_format: ClassVar[Optional[str]] = "structured"

    pass


class EventsBehaviorDetectionSystemInputs(PromptInputs):
    """`events/behavior_detection_system.txt`."""

    prompt = PromptInfo(
        code="ally_ai_learn_events_behavior_detection_system",
        name="Behavior Detection System Prompt",
        description=(
            "Binary classifier system prompt that detects if a counselor exhibits "
            "specific SHOULD_DO or SHOULD_NOT_DO behaviors."
        ),
    )

    output_format: ClassVar[Optional[str]] = "structured"

    behaviors: Optional[str] = None


class EventsBehaviorDetectionUserInputs(PromptInputs):
    """`events/behavior_detection_user.txt`."""

    prompt = PromptInfo(
        code="ally_ai_learn_events_behavior_detection_user",
        name="Behavior Detection User Prompt",
        description=(
            "User prompt for behavior detection containing the counselor message text "
            "to be classified."
        ),
    )

    output_format: ClassVar[Optional[str]] = "structured"

    message: str


class EventsBinaryClassifierBatchSystemInputs(PromptInputs):
    """`events/binary_classifier_batch_system.txt`."""

    prompt = PromptInfo(code="ally_ai_learn_events_binary_classifier_batch_system")

    output_format: ClassVar[Optional[str]] = "structured"

    classes_block: str


class EventsBinaryClassifierSystemInputs(PromptInputs):
    """`events/binary_classifier_system.txt`."""

    prompt = PromptInfo(
        code="ally_ai_learn_events_binary_classifier_system",
        name="Binary Classifier System Prompt",
        description=(
            "System prompt for binary classification of text against a named class. "
            "Includes a guardrail against prompt injection and optional few-shot "
            "examples block."
        ),
    )

    output_format: ClassVar[Optional[str]] = "structured"

    class_name: str
    examples_block: Optional[str] = None


class EventsBinaryClassifierUserInputs(PromptInputs):
    """`events/binary_classifier_user.txt`."""

    prompt = PromptInfo(
        code="ally_ai_learn_events_binary_classifier_user",
        name="Binary Classifier User Prompt",
        description=(
            "User-turn prompt wrapping the message to classify inside an XML tag for "
            "the binary classifier."
        ),
    )

    output_format: ClassVar[Optional[str]] = "structured"

    message: str


class EventsCoherenceGuardrailSystemInputs(PromptInputs):
    """`events/coherence_guardrail_system.txt`."""

    prompt = PromptInfo(
        code="ally_ai_learn_events_coherence_guardrail_system",
        name="Coherence Guardrail Classifier System Prompt",
        description=(
            "Dedicated, precision-biased system prompt for SYSTEM coherence guardrails "
            "(gibberish / out-of-context detection). Separate from the shared category-"
            "guardrail classifier."
        ),
    )

    output_format: ClassVar[Optional[str]] = "structured"

    helper_dialogue: str


class EventsCoherenceGuardrailUserInputs(PromptInputs):
    """`events/coherence_guardrail_user.txt`."""

    prompt = PromptInfo(
        code="ally_ai_learn_events_coherence_guardrail_user",
        name="Coherence Guardrail Classifier User Prompt",
        description=(
            "User-turn prompt for SYSTEM coherence guardrails: presents recent "
            "conversation context plus the counselor message to classify."
        ),
    )

    output_format: ClassVar[Optional[str]] = "structured"

    conversation_context: Optional[str] = None
    counselor_message: str


class EventsGuardrailSystemInputs(PromptInputs):
    """`events/guardrail_system.txt`."""

    prompt = PromptInfo(
        code="ally_ai_learn_events_guardrail_system",
        name="Guardrail Classifier System Prompt",
        description=(
            "System prompt for detecting if a counselor's utterance violates a "
            "guardrail boundary. Responds with structured JSON indicating a violation "
            "or not."
        ),
    )

    output_format: ClassVar[Optional[str]] = "structured"

    helper_dialogue: str


class EventsGuardrailUserInputs(PromptInputs):
    """`events/guardrail_user.txt`."""

    prompt = PromptInfo(
        code="ally_ai_learn_events_guardrail_user",
        name="Guardrail Classifier User Prompt",
        description=(
            "User-turn prompt presenting the counselor message to the guardrail "
            "classifier."
        ),
    )

    output_format: ClassVar[Optional[str]] = "structured"

    counselor_message: str


class EventsHelperParaphrasedSystemInputs(PromptInputs):
    """`events/helper_paraphrased_system.txt`."""

    prompt = PromptInfo(
        code="ally_ai_learn_events_helper_paraphrased_system",
        name="Helper Paraphrased Detector System Prompt",
        description=(
            "System prompt instructing the LLM to evaluate whether a counselor's "
            "message is a genuine paraphrase of the agent's previous message."
        ),
    )

    output_format: ClassVar[Optional[str]] = "structured"


class EventsHelperParaphrasedUserInputs(PromptInputs):
    """`events/helper_paraphrased_user.txt`."""

    prompt = PromptInfo(
        code="ally_ai_learn_events_helper_paraphrased_user",
        name="Helper Paraphrased Detector User Prompt",
        description=(
            "User-turn prompt presenting the agent and counselor messages for "
            "paraphrase evaluation."
        ),
    )

    output_format: ClassVar[Optional[str]] = "structured"

    agent_message: str
    counselor_message: str


class FillerBackchannelInputs(PromptInputs):
    """`filler/backchannel.txt`."""

    prompt = PromptInfo(
        code="ally_ai_learn_filler_backchannel",
        name="Back-channel Prompt",
        description=(
            "System prompt used once at session start to generate short listener back-"
            "channels ('mm-hmm', a soft 'yeah') that the character utters WHILE the "
            "learner is still speaking on a long turn — a human listening signal, "
            "distinct from the post-turn thinking filler. Generates them in the "
            "scenario's language/native script. Editable under System Skills. "
            "Variables: {scenario_context}, {language_label}, {language_code}, {count}."
        ),
    )

    output_format: ClassVar[Optional[str]] = "structured"

    count: Optional[str] = None
    language_code: Optional[str] = None
    language_label: Optional[str] = None
    scenario_context: Optional[str] = None


class FillerInterimReplyInputs(PromptInputs):
    """`filler/interim_reply.txt`."""

    prompt = PromptInfo(
        code="ally_ai_learn_filler_interim_reply",
        name="Interim Reply Prompt (simulations WITHOUT working memory)",
        description=(
            "Writes the interim — a short, non-committal holding line — for simulations"
            " that do NOT use client working memory. While the learner is still "
            "speaking on a long turn, a fast model reads the partial transcript and "
            "drafts one line; the agent plays it after the thinking filler if it fits "
            "the wait, and the real reply carries on from its words. Simulations WITH "
            "working memory never use this prompt: their interim is written by the "
            "'interim' field of the Client Working Memory Updater prompt. Runs only "
            "when the simulation has interimReplyEnabled on. Variables: "
            "{scenario_context}, {language_label}, {language_code}."
        ),
    )

    output_format: ClassVar[Optional[str]] = "structured"

    language_code: Optional[str] = None
    language_label: Optional[str] = None
    scenario_context: Optional[str] = None


class FillerPredictiveFillerInputs(PromptInputs):
    """`filler/predictive_filler.txt`."""

    prompt = PromptInfo(
        code="ally_ai_learn_filler_predictive_filler",
        name="Predictive Filler Prompt",
        description=(
            "System prompt for LLM-generated thinking fillers — the short back-channels"
            " a character utters the instant the learner stops, masking the real "
            "reply's latency. Used at three moments: once at session start from the "
            "character alone (so a filler exists before the first turn), after each "
            "exchange from the conversation so far, and mid-utterance from the "
            "learner's partial transcript (the only path whose output has seen the "
            "current turn). Asks for typed, length-varied options: playback rotates "
            "types so the same kind of noise never repeats, and picks a length that "
            "covers the predicted pause. Editable under System Skills. Variables: "
            "{scenario_context}, {character_voice}, {language_label}, {language_code}, "
            "{count}, {filler_types}, {recent_fillers}."
        ),
    )

    output_format: ClassVar[Optional[str]] = "structured"

    character_voice: Optional[str] = None
    count: Optional[str] = None
    filler_types: Optional[str] = None
    language_code: Optional[str] = None
    language_label: Optional[str] = None
    recent_fillers: Optional[str] = None
    scenario_context: Optional[str] = None


class RetrievalMemorySelectorSystemInputs(PromptInputs):
    """`retrieval/memory_selector_system.txt`."""

    prompt = PromptInfo(
        code="ally_ai_learn_retrieval_memory_selector_system",
        name="Memory Selector System Prompt",
        description=(
            "Picks which of the client's memories (the scenario's Knowledge Sources) "
            "are on the client's mind for the counselor's latest message; the chosen "
            "memories' content is added to the persona prompt. Used when the session "
            "has no language glossary sections; with them, the Memory and Glossary "
            "Selector runs instead. Runs on the live turn (refreshed every few turns, "
            "8s timeout) on the scenario's main model; the recent conversation is sent "
            "as the user message."
        ),
    )

    output_format: ClassVar[Optional[str]] = "structured"

    topics_block: str = Field(
        title="The client's memories (one line each: title: preview)"
    )


class RetrievalMemoryGlossarySelectorSystemInputs(PromptInputs):
    """`retrieval/memory_glossary_selector_system.txt`."""

    prompt = PromptInfo(
        code="ally_ai_learn_retrieval_memory_glossary_selector_system",
        name="Memory and Glossary Selector System Prompt",
        description=(
            "Picks which of the client's memories (the scenario's Knowledge Sources) "
            "and which language glossary sections the client needs for its next "
            "reply: memories for what the counselor is asking now, glossary sections "
            "for the vocabulary the reply is about to need. The chosen entries' "
            "content is added to the persona prompt. Used instead of the Memory "
            "Selector when the session has glossary sections. Runs on the live turn "
            "(refreshed every few turns, 8s timeout) on the scenario's main model; "
            "the recent conversation is sent as the user message."
        ),
    )

    output_format: ClassVar[Optional[str]] = "structured"

    topics_block: str = Field(
        title=(
            "Available topics (memories: title: preview; glossary sections: "
            "[bracketed] title with its when-to-retrieve hint)"
        )
    )


class SupervisorLiveNoteInputs(PromptInputs):
    """`supervisor/live_note.txt`."""

    prompt = PromptInfo(
        code="ally_ai_learn_supervisor_live_note",
        name="Live Supervisor Notes — System Prompt",
        description=(
            "Instructions for the live-supervisor LLM, which runs once per committed "
            "learner turn during a roleplay and decides whether to send the learner a "
            "one-line coaching hint (shown in the session sidebar's Supervisor tab). "
            "Heavily biased toward silence: the learner is mid-conversation, so every "
            "note costs them attention. The runtime appends the recent conversation "
            "window manually after this block (load_and_format for LANGUAGE, then "
            "manual assembly) so transcript braces can never break rendering. The note "
            "itself must be written in the session language."
        ),
        prompt_type="supervisor_live_note",
        has_states=False,
    )

    output_format: ClassVar[Optional[str]] = "structured"

    LANGUAGE: str = Field(title="Session language")


class SystemAudioTagGuidanceInputs(PromptInputs):
    """`system/audio_tag_guidance.txt`."""

    prompt = PromptInfo(
        code="ally_ai_learn_system_audio_tag_guidance",
        name="Audio Tag Guidance",
        description=(
            "Inline ElevenLabs v3 audio-tag guidance ([pause], [sighs], [empathetic], "
            "...). Appended to the persona prompt by generate_response so tag-capable "
            "(v3) voices emit voice tags inline while streaming. No template variables."
        ),
        prompt_type="audio_tag_guidance",
        has_states=False,
    )


class SystemBranchingAgentPromptInputs(PromptInputs):
    """`system/branching_agent_prompt.txt`."""

    prompt = PromptInfo(
        code="ally_ai_learn_system_branching_agent_prompt",
        name="Branching Agent Prompt",
        description=(
            "Minimal branching prompt that keeps direct editable wording in the top-"
            "level template."
        ),
        prompt_type="branching",
    )

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
    description: Optional[str] = None
    gender: Optional[str] = None
    language_code: Optional[str] = None
    language_glossary: Optional[str] = None
    language_label: Optional[str] = None
    linguistic_samples: Optional[str] = None
    name: Optional[str] = None
    next_instruction: str
    retrieved_context: Optional[str] = None
    samples: Optional[str] = None
    title: Optional[str] = None


class SystemClientWorkingMemoryUpdaterInputs(PromptInputs):
    """`system/client_working_memory_updater.txt`."""

    prompt = PromptInfo(
        code="ally_ai_learn_system_client_working_memory_updater",
        name="Client Working Memory Updater (writes what Main Agent Prompt #3 reads)",
        description=(
            "The WRITER half of the client working memory. It never speaks "
            "to anyone: it reads the newest turns and reports what changed "
            "in the client's inner state as structured fields, which are "
            "validated, committed to the store, and rendered into the "
            "actor's prompt by Main Agent Prompt #3 (the READER half). "
            "Read the two together — this one fills the sections that one "
            "displays.\n\nGLOBAL, unlike Prompt #3. Prompt #3 is chosen "
            "per simulation, so editing it affects only scenarios pointing "
            "at it. There is no per-scenario selection for this prompt: "
            "every session with working memory engaged uses this one "
            "copy.\n\nWHERE EACH FIELD COMES OUT IN PROMPT #3\n  "
            "register          -> {working_memory_register}\n  "
            "speech_fragments  -> {working_memory_speech_fragments}\n  "
            "disclosed         -> {working_memory_disclosed}\n  "
            "affect            -> appended to {working_memory_stance}, not "
            "a section of its own\n  withheld_topics + "
            "withheld_deflections -> composed into the one "
            "{working_memory_withheld} section, paired positionally\n  "
            "opened_threads + closed_threads        -> applied as deltas "
            "to the one {working_memory_unresolved} section, which shows "
            "the net still-open set\n\ndelivery -> not rendered to the "
            "actor; it becomes the delivery plan for how the NEXT reply "
            "starts: a pause, a catalog filler, and the interim (a few "
            "holding words, played piece by piece while the reply is being "
            "prepared). The actor is told the interim's exact words so its "
            "reply carries on from them. This is the ONLY place the "
            "interim is written: scenarios without working memory get "
            "fillers and pauses, never an interim. {opener_catalog} lists "
            "the filler ids this session can play.\n\nTHREE ASYMMETRIES, "
            "ALL DELIBERATE — do not read them as omissions\n  appraisal "
            "is never rendered to the actor at all. It is the private "
            "reason behind the affect, kept for telemetry and debugging, "
            "and deliberately not an instruction.\n  retrieve_cues is not "
            "rendered either. It drives recall against the character "
            "corpus, and what recall selects is what surfaces as "
            "{working_memory_salient}.\n  {working_memory_salient} "
            "therefore has NO field here to fill. Nothing you write in "
            "this prompt populates it.\n\nThe stages in {state_ladder} and "
            "the stage in {current_state} are the scenario author's own "
            "states — the same ones Prompt #3 renders through "
            "{state_x_guidelines}. They are supplied as data; this prompt "
            "never paraphrases them. Whether the client is ready to "
            "disclose something is the author's decision, expressed in "
            "those states, and never this prompt's.\n\nThe field names "
            "above are the contract with `ProposedUpdate` in "
            "app/core/working_memory/proposal.py, enforced by a test — "
            "renaming one here without renaming it there fails the build "
            "rather than silently returning an empty field."
        ),
    )

    output_format: ClassVar[Optional[str]] = "structured"

    current_state: str = Field(title="Currently Resolved State")
    language_label: str = Field(title="Conversation Language Label")
    opener_catalog: str = Field(
        title="Opener Catalog For This Session (id, kind, words)"
    )
    state_ladder: str = Field(
        title="Authored States, In Order (with the author's guidelines)"
    )


class SystemMainAgentPromptInputs(PromptInputs):
    """`system/main_agent_prompt.txt`."""

    prompt = PromptInfo(
        code="ally_ai_learn_system_main_agent_prompt",
        name="Main Agent Prompt",
        description=(
            "Top-level behavior-mode prompt with editable persona and guidance wording "
            "owned directly in the prompt file."
        ),
        prompt_type="main_agent",
        has_states=False,
    )

    fragments: ClassVar[list[str]] = [
        "ally_ai_learn_system_audio_tag_guidance",
        "ally_ai_learn_system_text_chat_guidance",
        "language_glossary",
        "retrieved_context",
        "rolling_summary",
    ]
    age: Optional[str] = Field(None, title="Age")
    allowed_fillers: Optional[str] = Field(None, title="Allowed Filler Words")
    behavior_instructions_json: Optional[str] = Field(
        None, title="Behavior Rules (JSON)"
    )
    character_profile_text: Optional[str] = Field(None, title="Character Profile")
    competency: Optional[str] = Field(None, title="Competency")
    current_location: Optional[str] = Field(None, title="Current Location")
    custom_fields_text: Optional[str] = None
    dialogue_length_instruction: Optional[str] = None
    gender: Optional[str] = Field(None, title="Gender")
    gender_identity: Optional[str] = Field(None, title="Gender Identity")
    language_code: str = Field(title="Output Language Code")
    language_glossary: Optional[str] = Field(
        None, title="Language Glossary (Tier 0 style card)"
    )
    language_label: str = Field(title="Output Language Label")
    linguistic_samples: Optional[str] = Field(None, title="Tone & Style Samples")
    name: Optional[str] = Field(None, title="Name")
    previous_memory: Optional[str] = Field(None, title="Previous Session Memory")
    profession: Optional[str] = Field(None, title="Profession")
    role_instructions: str = Field(title="Role Instructions")
    sexual_orientation: Optional[str] = Field(None, title="Sexual Orientation")
    title: Optional[str] = Field(None, title="Title")
    challenge_description: Optional[str] = Field(None, title="Challenge Description")
    helpful_behaviours: Optional[str] = Field(None, title="Helpful Behaviours")
    unhelpful_behaviours: Optional[str] = Field(None, title="Unhelpful Behaviours")


class SystemMainAgentPromptFullInputs(PromptInputs):
    """`system/main_agent_prompt_full.txt`."""

    prompt = PromptInfo(
        code="ally_ai_learn_system_main_agent_prompt_full",
        name="Main Agent Prompt #2",
        description=(
            "Second main-agent variant. The file body is a lean template, but the "
            "variable list below advertises every dynamic field the prompt builder can "
            "inject (persona, style, language, runtime state, RAG, behavior rules). "
            "Studio authors can reference any of these as {placeholder} when "
            "customising the prompt — unused ones are silently ignored at render time."
        ),
        prompt_type="main_agent",
        has_states=True,
    )

    fragments: ClassVar[list[str]] = [
        "ally_ai_learn_system_audio_tag_guidance",
        "ally_ai_learn_system_text_chat_guidance",
        "language_glossary",
        "retrieved_context",
        "rolling_summary",
    ]
    age: Optional[str] = Field(None, title="Age")
    allowed_fillers: Optional[str] = Field(None, title="Allowed Filler Words")
    character_profile_text: Optional[str] = Field(None, title="Character Profile")
    current_location: Optional[str] = Field(None, title="Current Location")
    gender: Optional[str] = Field(None, title="Gender")
    gender_identity: Optional[str] = Field(None, title="Gender Identity")
    language_code: str = Field(title="Output Language Code")
    language_glossary: Optional[str] = Field(
        None, title="Language Glossary (Tier 0 style card)"
    )
    language_label: str = Field(title="Output Language Label")
    linguistic_samples: Optional[str] = Field(None, title="Tone & Style Samples")
    name: Optional[str] = Field(None, title="Name")
    profession: Optional[str] = Field(None, title="Profession")
    retrieved_context: Optional[str] = Field(None, title="Retrieved Knowledge Context")
    role_instructions: str = Field(title="Role Instructions")
    sexual_orientation: Optional[str] = Field(None, title="Sexual Orientation")
    state_x_guidelines: Optional[str] = Field(None, title="Active State Guidelines")
    title: Optional[str] = Field(None, title="Title")
    challenge_description: Optional[str] = Field(None, title="Challenge Description")
    previous_memory: Optional[str] = Field(None, title="Previous Memory")
    custom_fields_text: Optional[str] = Field(None, title="Custom Fields")
    helpful_behaviours: Optional[str] = Field(None, title="Helpful Behaviours")
    unhelpful_behaviours: Optional[str] = Field(None, title="Unhelpful Behaviours")


class SystemMainAgentPromptWorkingMemorySplitInputs(PromptInputs):
    """`system/main_agent_prompt_working_memory_split.txt`."""

    prompt = PromptInfo(
        code="ally_ai_learn_system_main_agent_prompt_working_memory_split",
        name="Main Agent Prompt #3",
        description=(
            "Main-agent variant driven by the derived client working "
            "memory (docs/client-working-memory-design.md). The memory is "
            "exposed as one placeholder PER SECTION, so a curator can read "
            "the prompt to see what is being fed to the model, and can "
            "reorder, relocate or drop an individual section to "
            "experiment. Selecting this prompt is the entire opt-in; "
            "re-selecting another prompt is the whole rollback. There is "
            "no env flag to set as well — the "
            "CLIENT_WORKING_MEMORY_ENABLED switch was removed, so pointing "
            "a scenario here is sufficient on its own.\n\nThe "
            "single-placeholder `{client_working_memory}` form this "
            "replaced is still supported by the runtime, and a prompt "
            "declaring BOTH forms renders that block and leaves these "
            "section headings bare — so do not add it here.\n\nTwo things "
            "a reader should not mistake for omissions. "
            "{state_x_guidelines} is present and authored by you: the "
            "older single-block form swallowed it, this one does not. "
            "{retrieved_context} is absent because it is blank in EVERY "
            "prompt fleet-wide — RETRIEVED_CONTEXT_DEFER_TO_SUFFIX "
            "delivers knowledge sources as a trailing message after the "
            "conversation history instead, so adding the placeholder back "
            "would render nothing and imply retrieval had broken. "
            "{character_profile_text} IS genuinely dropped: recalled "
            "backstory arrives a few facts at a time through 'What is on "
            "your mind from your own life' rather than as the whole "
            "profile every turn.\n\nTHE OTHER HALF. Every "
            "{working_memory_*} section below is FILLED by a separate "
            'prompt — "Client Working Memory Updater" — which reads the '
            "newest turns and reports what changed. This prompt only "
            "displays what that one records, so a section that reads wrong "
            "is usually authored there, not here. That prompt's sidecar "
            "carries the field-to-placeholder map, including the three "
            "places the two do not line up one-to-one: `affect` lands "
            "inside {working_memory_stance} rather than getting a section; "
            "the two withheld lists compose into "
            "{working_memory_withheld}; and opened/closed threads are "
            "deltas against the net set shown by "
            "{working_memory_unresolved}. {working_memory_salient} is "
            "filled by recall, not by the updater at all.\n\nNote the "
            "asymmetry in blast radius before editing either: this prompt "
            "is selected per simulation, so an edit here reaches only "
            "scenarios pointing at it. The updater is global — one copy, "
            "every working-memory session."
        ),
        prompt_type="main_agent",
        has_states=True,
    )

    fragments: ClassVar[list[str]] = [
        "ally_ai_learn_system_audio_tag_guidance",
        "ally_ai_learn_system_text_chat_guidance",
        "language_glossary",
        "retrieved_context",
        "rolling_summary",
    ]
    age: Optional[str] = Field(None, title="Age")
    allowed_fillers: Optional[str] = Field(None, title="Allowed Filler Words")
    current_location: Optional[str] = Field(None, title="Current Location")
    gender: Optional[str] = Field(None, title="Gender")
    gender_identity: Optional[str] = Field(None, title="Gender Identity")
    language_code: str = Field(title="Output Language Code")
    language_glossary: Optional[str] = Field(None, title="Language Glossary")
    language_label: str = Field(title="Output Language Label")
    linguistic_samples: Optional[str] = Field(None, title="Tone & Style Samples")
    name: Optional[str] = Field(None, title="Name")
    profession: Optional[str] = Field(None, title="Profession")
    role_instructions: str = Field(title="Role Instructions")
    sexual_orientation: Optional[str] = Field(None, title="Sexual Orientation")
    state_x_guidelines: Optional[str] = Field(None, title="Active State Guidelines")
    working_memory_disclosed: Optional[str] = Field(
        None, title="Working Memory — Already Told Them"
    )
    working_memory_register: Optional[str] = Field(
        None, title="Working Memory — How You Are Speaking"
    )
    working_memory_salient: Optional[str] = Field(
        None, title="Working Memory — On Your Mind"
    )
    working_memory_speech_fragments: Optional[str] = Field(
        None, title="Working Memory — Your Recent Words"
    )
    working_memory_stance: Optional[str] = Field(
        None, title="Working Memory — Where You Are"
    )
    working_memory_unresolved: Optional[str] = Field(
        None, title="Working Memory — Still Unfinished"
    )
    working_memory_withheld: Optional[str] = Field(
        None, title="Working Memory — Not Ready To Talk About"
    )


class SystemRollingSummaryInputs(PromptInputs):
    """`system/rolling_summary.txt`."""

    prompt = PromptInfo(
        code="ally_ai_learn_system_rolling_summary",
        name="Rolling Summary System Prompt",
        description=(
            "System prompt for the incremental rolling-summary (episodic memory) "
            "compactor: merges the newest conversation turns into the maintained "
            "session summary that is injected into the persona prompt and shipped to "
            "Core as session memory at session end."
        ),
    )

    output_format: ClassVar[Optional[str]] = "structured"


class SystemTextChatGuidanceInputs(PromptInputs):
    """`system/text_chat_guidance.txt`."""

    prompt = PromptInfo(
        code="ally_ai_learn_system_text_chat_guidance",
        name="Text Chat Guidance",
        description=(
            "How the client writes in a text-chat roleplay (typed both ways, no audio)."
            " Appended to the persona prompt by generate_response only when the "
            "session's interactionMode is TEXT, so it re-frames the voice-oriented main"
            " prompt ('how you speak', filler words) as typing. Voice sessions never "
            "see it. No template variables."
        ),
        prompt_type="text_chat_guidance",
        has_states=False,
    )


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
