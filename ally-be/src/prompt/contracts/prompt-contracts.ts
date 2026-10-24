import { definePrompt } from './define-prompt';

/**
 * The contract of every ally-be prompt: the variables its call site supplies.
 * Keyed by prompt code (the path under src/prompts with `/` as `_`).
 *
 * Generated once from the defaults' placeholders, then maintained by hand: when
 * a call site starts or stops passing a variable, change it here in the same
 * PR. Every variable starts `'optional'` and every contract starts open, so
 * nothing that works today is refused; mark a variable `'required'` once the
 * code always supplies it and the text depends on it, and close a contract
 * (`open: false`) once its list is complete.
 */

/** src/prompts/agent_builder/allowed_filler_words.txt */
export const AGENT_BUILDER_ALLOWED_FILLER_WORDS = definePrompt(
  'agent_builder_allowed_filler_words',
  {
    actorDescription: 'required',
    agentTestCases: 'optional',
    competency: 'optional',
    languageCode: 'optional',
    languageName: 'required',
  },
  { output: 'structured' },
);

/** src/prompts/agent_builder/backstory.txt */
export const AGENT_BUILDER_BACKSTORY = definePrompt('agent_builder_backstory', {
  actorDescription: 'required',
  agentTestCases: 'optional',
  competency: 'optional',
});

/** src/prompts/agent_builder/challenge_description.txt */
export const AGENT_BUILDER_CHALLENGE_DESCRIPTION = definePrompt(
  'agent_builder_challenge_description',
  {
    actorDescription: 'required',
    agentTestCases: 'optional',
    competency: 'optional',
  },
);

/** src/prompts/agent_builder/knowledge_sources.txt */
export const AGENT_BUILDER_KNOWLEDGE_SOURCES = definePrompt(
  'agent_builder_knowledge_sources',
  {
    actorDescription: 'required',
    agentTestCases: 'optional',
    competency: 'optional',
    numKnowledgeSources: 'optional',
  },
  { output: 'structured' },
);

/** src/prompts/agent_builder/language_voices.txt */
export const AGENT_BUILDER_LANGUAGE_VOICES = definePrompt(
  'agent_builder_language_voices',
  {
    actorDescription: 'required',
    personaAge: 'optional',
    personaGender: 'optional',
    voiceCandidates: 'optional',
  },
  { output: 'structured' },
);

/** src/prompts/agent_builder/linguistic_style_samples.txt */
export const AGENT_BUILDER_LINGUISTIC_STYLE_SAMPLES = definePrompt(
  'agent_builder_linguistic_style_samples',
  {
    actorDescription: 'required',
    agentTestCases: 'optional',
    competency: 'optional',
    languageCode: 'optional',
    languageName: 'required',
  },
  { output: 'structured' },
);

/** src/prompts/agent_builder/opening_statements.txt */
export const AGENT_BUILDER_OPENING_STATEMENTS = definePrompt(
  'agent_builder_opening_statements',
  {
    actorDescription: 'required',
    agentTestCases: 'optional',
    competency: 'optional',
    languageCode: 'optional',
    languageName: 'required',
  },
);

/** src/prompts/agent_builder/persona.txt */
export const AGENT_BUILDER_PERSONA = definePrompt(
  'agent_builder_persona',
  {
    actorDescription: 'required',
    agentTestCases: 'optional',
    competency: 'optional',
  },
  { output: 'structured' },
);

/** src/prompts/agent_builder/reminders.txt */
export const AGENT_BUILDER_REMINDERS = definePrompt('agent_builder_reminders', {
  actorDescription: 'required',
  agentTestCases: 'optional',
  competency: 'optional',
});

/** src/prompts/agent_builder/role_instruction.txt */
export const AGENT_BUILDER_ROLE_INSTRUCTION = definePrompt(
  'agent_builder_role_instruction',
  {
    actorDescription: 'required',
    agentTestCases: 'optional',
    competency: 'optional',
  },
);

/** src/prompts/agent_builder/spoken_languages.txt */
export const AGENT_BUILDER_SPOKEN_LANGUAGES = definePrompt(
  'agent_builder_spoken_languages',
  {
    actorDescription: 'required',
    availableLanguages: 'optional',
  },
  { output: 'structured' },
);

/** src/prompts/agent_builder/states.txt */
export const AGENT_BUILDER_STATES = definePrompt(
  'agent_builder_states',
  {
    actorDescription: 'required',
    agentTestCases: 'optional',
    competency: 'optional',
  },
  { output: 'structured' },
);

/** src/prompts/agent_builder/title.txt */
export const AGENT_BUILDER_TITLE = definePrompt(
  'agent_builder_title',
  {
    actorDescription: 'required',
    agentTestCases: 'optional',
    competency: 'optional',
  },
  { output: 'structured' },
);

/** src/prompts/analytics_suggestions/generate.txt */
export const ANALYTICS_SUGGESTIONS_GENERATE = definePrompt(
  'analytics_suggestions_generate',
  {},
  { output: 'json' },
);

/** src/prompts/bug_hunter/classify_miss.txt */
export const BUG_HUNTER_CLASSIFY_MISS = definePrompt(
  'bug_hunter_classify_miss',
  {},
  { output: 'structured' },
);

/** src/prompts/bug_hunter/classify_repo.txt */
export const BUG_HUNTER_CLASSIFY_REPO = definePrompt(
  'bug_hunter_classify_repo',
  {},
  { output: 'structured' },
);

/** src/prompts/bug_hunter/decide.txt */
export const BUG_HUNTER_DECIDE = definePrompt(
  'bug_hunter_decide',
  {},
  { output: 'structured' },
);

/** src/prompts/bug_hunter/review_study.txt */
export const BUG_HUNTER_REVIEW_STUDY = definePrompt(
  'bug_hunter_review_study',
  {},
  { output: 'structured' },
);

/** src/prompts/builder/interviewer_system.txt */
export const BUILDER_INTERVIEWER_SYSTEM = definePrompt(
  'builder_interviewer_system',
  {},
);

/** src/prompts/builder/platform_rules.txt */
export const BUILDER_PLATFORM_RULES = definePrompt(
  'builder_platform_rules',
  {},
);

/** src/prompts/character_interview/interviewer_system.txt */
export const CHARACTER_INTERVIEW_INTERVIEWER_SYSTEM = definePrompt(
  'character_interview_interviewer_system',
  {},
);

/** src/prompts/course_copilot/ally_notes_writer.txt */
export const COURSE_COPILOT_ALLY_NOTES_WRITER = definePrompt(
  'course_copilot_ally_notes_writer',
  {
    course_description: 'optional',
    course_outline: 'required',
    course_title: 'optional',
    current_notes: 'optional',
    trigger_warnings: 'optional',
  },
  { output: 'structured' },
);

/** src/prompts/course_copilot/annotation_writer.txt */
export const COURSE_COPILOT_ANNOTATION_WRITER = definePrompt(
  'course_copilot_annotation_writer',
  {
    brief_json: 'optional',
    course_outline: 'optional',
    helpful_behaviours: 'optional',
    item_json: 'required',
    label_instruction: 'optional',
    line_count: 'optional',
    max_labels: 'optional',
    next_practice: 'optional',
    objectives: 'optional',
    unhelpful_behaviours: 'optional',
  },
  { output: 'structured' },
);

/** src/prompts/course_copilot/article_writer.txt */
export const COURSE_COPILOT_ARTICLE_WRITER = definePrompt(
  'course_copilot_article_writer',
  {
    brief_json: 'optional',
    course_outline: 'optional',
    image_instruction: 'optional',
    item_json: 'required',
    next_practice: 'optional',
    objectives: 'optional',
    question_count: 'optional',
    word_target: 'optional',
  },
  { output: 'structured' },
);

/** src/prompts/course_copilot/blueprint_planner.txt */
export const COURSE_COPILOT_BLUEPRINT_PLANNER = definePrompt(
  'course_copilot_blueprint_planner',
  {
    brief_json: 'required',
    duration_minutes: 'optional',
    games_json: 'optional',
    item_minutes_json: 'optional',
    library_picks_json: 'optional',
    limits_json: 'optional',
    max_article_questions: 'optional',
    max_labels: 'optional',
    max_new_roleplays: 'optional',
    max_quiz_questions: 'optional',
    objectives_list: 'optional',
    trainer_notes: 'optional',
    video_urls_json: 'optional',
  },
  { output: 'structured' },
);

/** src/prompts/course_copilot/course_meta.txt */
export const COURSE_COPILOT_COURSE_META = definePrompt(
  'course_copilot_course_meta',
  {
    brief_json: 'optional',
    course_outline: 'optional',
    duration_minutes: 'optional',
    working_description: 'optional',
    working_title: 'optional',
  },
  { output: 'structured' },
);

/** src/prompts/course_copilot/course_reviewer.txt */
export const COURSE_COPILOT_COURSE_REVIEWER = definePrompt(
  'course_copilot_course_reviewer',
  {
    allowed_tools: 'optional',
    brief_json: 'optional',
    course_digest: 'required',
    max_findings: 'optional',
  },
  { output: 'structured' },
);

/** src/prompts/course_copilot/history_summary.txt */
export const COURSE_COPILOT_HISTORY_SUMMARY = definePrompt(
  'course_copilot_history_summary',
  {},
);

/** src/prompts/course_copilot/image_prompt.txt */
export const COURSE_COPILOT_IMAGE_PROMPT = definePrompt(
  'course_copilot_image_prompt',
  {
    audience_json: 'optional',
    course_tone: 'optional',
    image_context: 'optional',
    image_purpose: 'optional',
    image_title: 'optional',
  },
  { output: 'structured' },
);

/** src/prompts/course_copilot/interviewer_system.txt */
export const COURSE_COPILOT_INTERVIEWER_SYSTEM = definePrompt(
  'course_copilot_interviewer_system',
  {},
);

/** src/prompts/course_copilot/journal_writer.txt */
export const COURSE_COPILOT_JOURNAL_WRITER = definePrompt(
  'course_copilot_journal_writer',
  {
    brief_json: 'optional',
    course_outline: 'optional',
    item_json: 'required',
    objectives: 'optional',
    preceding_practice: 'optional',
    prompt_count: 'optional',
  },
  { output: 'structured' },
);

/** src/prompts/course_copilot/landing_page_writer.txt */
export const COURSE_COPILOT_LANDING_PAGE_WRITER = definePrompt(
  'course_copilot_landing_page_writer',
  {
    course_description: 'optional',
    course_duration_minutes: 'optional',
    course_outline: 'optional',
    course_title: 'optional',
    current_landing_page: 'optional',
    trigger_warnings: 'optional',
  },
  { output: 'structured' },
);

/** src/prompts/course_copilot/quiz_writer.txt */
export const COURSE_COPILOT_QUIZ_WRITER = definePrompt(
  'course_copilot_quiz_writer',
  {
    blank_token_example: 'optional',
    brief_json: 'optional',
    course_outline: 'optional',
    difficulty: 'optional',
    item_json: 'required',
    likert_instruction: 'optional',
    objectives: 'optional',
    question_count: 'optional',
    type_instruction: 'optional',
  },
  { output: 'structured' },
);

/** src/prompts/course_copilot/roleplay_brief.txt */
export const COURSE_COPILOT_ROLEPLAY_BRIEF = definePrompt(
  'course_copilot_roleplay_brief',
  {
    applicationContext: 'optional',
    audience: 'optional',
    competencies: 'optional',
    courseNotes: 'optional',
    courseTitle: 'optional',
    helpfulBehaviours: 'optional',
    itemOutcomes: 'optional',
    itemPurpose: 'optional',
    itemTitle: 'optional',
    personaBrief: 'optional',
    practiceSequence: 'optional',
    priorExperience: 'optional',
    revisionNotes: 'optional',
    sectionPurpose: 'optional',
    sectionTitle: 'optional',
    sensitiveThemes: 'optional',
    taskClass: 'optional',
    terminalOutcome: 'optional',
    unhelpfulBehaviours: 'optional',
  },
  { output: 'structured' },
);

/** src/prompts/cover_image_generation.txt */
export const COVER_IMAGE_GENERATION = definePrompt('cover_image_generation', {
  age: 'optional',
  currentLocation: 'optional',
  name: 'optional',
  profession: 'optional',
  styleHints: 'optional',
});

/** src/prompts/enhance_field.txt */
export const ENHANCE_FIELD = definePrompt('enhance_field', {
  currentValue: 'required',
  fieldLabel: 'optional',
  guidance: 'required',
});

/** src/prompts/enhance_state.txt */
export const ENHANCE_STATE = definePrompt(
  'enhance_state',
  {
    currentGuidelines: 'optional',
    currentName: 'optional',
    guidance: 'required',
  },
  { output: 'structured' },
);

/** src/prompts/event_builder/branch_instruction.txt */
export const EVENT_BUILDER_BRANCH_INSTRUCTION = definePrompt(
  'event_builder_branch_instruction',
  {
    className: 'optional',
    competency: 'optional',
    eventDescription: 'required',
    simulationContext: 'optional',
  },
);

/** src/prompts/event_builder/classifier.txt */
export const EVENT_BUILDER_CLASSIFIER = definePrompt(
  'event_builder_classifier',
  {
    competency: 'optional',
    eventDescription: 'required',
    simulationContext: 'optional',
  },
  { output: 'structured' },
);

/** src/prompts/event_builder/examples.txt */
export const EVENT_BUILDER_EXAMPLES = definePrompt(
  'event_builder_examples',
  {
    className: 'optional',
    competency: 'optional',
    eventDescription: 'required',
    numExamples: 'optional',
    simulationContext: 'optional',
  },
  { output: 'structured' },
);

/** src/prompts/event_builder/feedback.txt */
export const EVENT_BUILDER_FEEDBACK = definePrompt(
  'event_builder_feedback',
  {
    className: 'optional',
    competency: 'optional',
    eventDescription: 'required',
    simulationContext: 'optional',
  },
  { output: 'structured' },
);

/** src/prompts/event_builder/tags.txt */
export const EVENT_BUILDER_TAGS = definePrompt(
  'event_builder_tags',
  {
    className: 'optional',
    competency: 'optional',
    eventDescription: 'required',
    simulationContext: 'optional',
  },
  { output: 'structured' },
);

/** src/prompts/mobile_release_whats_new.txt */
export const MOBILE_RELEASE_WHATS_NEW = definePrompt(
  'mobile_release_whats_new',
  {
    commits: 'required',
  },
);

/** src/prompts/openai_scenario_session/chat.txt */
export const OPENAI_SCENARIO_SESSION_CHAT = definePrompt(
  'openai_scenario_session_chat',
  {
    callDuration: 'optional',
    learnerName: 'optional',
    scenarioDescription: 'optional',
    scenarioDifficulty: 'optional',
    scenarioTitle: 'optional',
    sessionEndedAt: 'optional',
    sessionScore: 'optional',
    sessionStartedAt: 'optional',
    sessionSummary: 'optional',
    sessionTranscript: 'optional',
    supervisorNote: 'optional',
    workerTypeGuidance: 'optional',
  },
);

/** src/prompts/openai_translation/code_mixed_system.txt */
export const OPENAI_TRANSLATION_CODE_MIXED_SYSTEM = definePrompt(
  'openai_translation_code_mixed_system',
  {
    fullContext: 'optional',
    languageName: 'required',
    preserveWords: 'optional',
    toneGuidance: 'optional',
  },
  { output: 'structured' },
);

/** src/prompts/openai_translation/general_text_translation.txt */
export const OPENAI_TRANSLATION_GENERAL_TEXT_TRANSLATION = definePrompt(
  'openai_translation_general_text_translation',
  {
    languageName: 'required',
    text: 'required',
  },
);

/** src/prompts/openai_translation/learn_behavior_instruction.txt */
export const OPENAI_TRANSLATION_LEARN_BEHAVIOR_INSTRUCTION = definePrompt(
  'openai_translation_learn_behavior_instruction',
  {
    inputJson: 'required',
    languageName: 'required',
  },
  { output: 'structured' },
);

/** src/prompts/openai_translation/session_event.txt */
export const OPENAI_TRANSLATION_SESSION_EVENT = definePrompt(
  'openai_translation_session_event',
  {
    inputJson: 'required',
    languageName: 'required',
  },
  { output: 'structured' },
);

/** src/prompts/openai_translation/speech_reexpression_user.txt */
export const OPENAI_TRANSLATION_SPEECH_REEXPRESSION_USER = definePrompt(
  'openai_translation_speech_reexpression_user',
  {
    inputJson: 'required',
    languageName: 'required',
  },
  { output: 'structured' },
);

/** src/prompts/product_updates/consolidate.txt */
export const PRODUCT_UPDATES_CONSOLIDATE = definePrompt(
  'product_updates_consolidate',
  {},
  { output: 'structured' },
);

/** src/prompts/roadmap/classify_goal.txt */
export const ROADMAP_CLASSIFY_GOAL = definePrompt(
  'roadmap_classify_goal',
  {},
  { output: 'json' },
);

/** src/prompts/roadmap/duplicate_check.txt */
export const ROADMAP_DUPLICATE_CHECK = definePrompt(
  'roadmap_duplicate_check',
  {},
  { output: 'json' },
);

/** src/prompts/roadmap/generate_claude_prompt.txt */
export const ROADMAP_GENERATE_CLAUDE_PROMPT = definePrompt(
  'roadmap_generate_claude_prompt',
  {},
);

/** src/prompts/roadmap/goal_impact.txt */
export const ROADMAP_GOAL_IMPACT = definePrompt(
  'roadmap_goal_impact',
  {},
  { output: 'json' },
);

/** src/prompts/roadmap/opportunity_copilot.txt */
export const ROADMAP_OPPORTUNITY_COPILOT = definePrompt(
  'roadmap_opportunity_copilot',
  {},
);

/** src/prompts/roadmap/summarise_interview.txt */
export const ROADMAP_SUMMARISE_INTERVIEW = definePrompt(
  'roadmap_summarise_interview',
  {},
);

/** src/prompts/scribe_voice_note/field_extraction_system.txt */
export const SCRIBE_VOICE_NOTE_FIELD_EXTRACTION_SYSTEM = definePrompt(
  'scribe_voice_note_field_extraction_system',
  {},
  { output: 'json' },
);

/** src/prompts/scribe_voice_note/field_extraction_user.txt */
export const SCRIBE_VOICE_NOTE_FIELD_EXTRACTION_USER = definePrompt(
  'scribe_voice_note_field_extraction_user',
  {
    fields: 'required',
    transcript: 'required',
  },
  { output: 'json' },
);

/** src/prompts/skill_experiment/challenger_generator.txt */
export const SKILL_EXPERIMENT_CHALLENGER_GENERATOR = definePrompt(
  'skill_experiment_challenger_generator',
  {
    championPrompt: 'required',
    feedback: 'required',
    learnerName: 'optional',
    rubric: 'optional',
    transcript: 'optional',
  },
  { output: 'structured' },
);

/** src/prompts/skill_experiment/designer.txt */
export const SKILL_EXPERIMENT_DESIGNER = definePrompt(
  'skill_experiment_designer',
  {},
  { output: 'structured' },
);

/** src/prompts/skill_experiment/judge.txt */
export const SKILL_EXPERIMENT_JUDGE = definePrompt(
  'skill_experiment_judge',
  {},
  { output: 'structured' },
);

/** src/prompts/track_memory/facts.txt */
export const TRACK_MEMORY_FACTS = definePrompt(
  'track_memory_facts',
  {
    existingFacts: 'optional',
    newDisclosures: 'required',
  },
  { output: 'json' },
);

/** src/prompts/track_memory/fold.txt */
export const TRACK_MEMORY_FOLD = definePrompt('track_memory_fold', {
  sessionMemories: 'required',
});

/** src/prompts/track_quiz/open_ended_grading_user.txt */
export const TRACK_QUIZ_OPEN_ENDED_GRADING_USER = definePrompt(
  'track_quiz_open_ended_grading_user',
  {
    answer: 'required',
    criteria: 'optional',
    guidance: 'required',
    maxScore: 'required',
    question: 'required',
  },
  { output: 'json' },
);

/** src/prompts/ux_signals/triage.txt */
export const UX_SIGNALS_TRIAGE = definePrompt(
  'ux_signals_triage',
  {},
  { output: 'json' },
);

/** Every contract, by prompt code. */
/** src/prompts/agent_template_translation.txt */
export const AGENT_TEMPLATE_TRANSLATION = definePrompt(
  'agent_template_translation',
  {
    age: 'optional',
    behavior_instructions_json: 'optional',
    languageName: 'required',
    language_label: 'optional',
    linguistic_samples: 'optional',
    name: 'optional',
    next_instruction: 'optional',
  },
);

/** src/prompts/drift_judge/conversation_rubric.txt */
export const DRIFT_JUDGE_CONVERSATION_RUBRIC = definePrompt(
  'drift_judge_conversation_rubric',
  {},
  { output: 'structured' },
);

/** src/prompts/glossary/adjudication.txt */
export const GLOSSARY_ADJUDICATION = definePrompt(
  'glossary_adjudication',
  {
    existingGlossary: 'optional',
    languageCode: 'optional',
    languageName: 'required',
    proposals: 'required',
  },
  { output: 'json' },
);

/** src/prompts/glossary/consolidation.txt */
export const GLOSSARY_CONSOLIDATION = definePrompt(
  'glossary_consolidation',
  {
    annotations: 'required',
    existingGlossary: 'optional',
    languageCode: 'optional',
    languageName: 'required',
  },
  { output: 'json' },
);

/** src/prompts/glossary/generation.txt */
export const GLOSSARY_GENERATION = definePrompt(
  'glossary_generation',
  {
    evalConfig: 'optional',
    languageCode: 'optional',
    languageName: 'required',
  },
  { output: 'json' },
);

/** src/prompts/glossary/lexeme_pairing.txt */
export const GLOSSARY_LEXEME_PAIRING = definePrompt(
  'glossary_lexeme_pairing',
  {
    candidates: 'required',
    existingGlossary: 'optional',
    languageCode: 'optional',
    languageName: 'required',
    learnerLexicon: 'optional',
  },
  { output: 'json' },
);

/** src/prompts/language_quality_judge/rubric.txt */
export const LANGUAGE_QUALITY_JUDGE_RUBRIC = definePrompt(
  'language_quality_judge_rubric',
  {},
  { output: 'structured' },
);

/** src/prompts/openai_translation/tooltip_translation.txt */
export const OPENAI_TRANSLATION_TOOLTIP_TRANSLATION = definePrompt(
  'openai_translation_tooltip_translation',
  {
    inputJson: 'required',
    languageName: 'required',
  },
  { output: 'structured' },
);

export const PROMPT_CONTRACTS = Object.fromEntries(
  [
    AGENT_BUILDER_ALLOWED_FILLER_WORDS,
    AGENT_BUILDER_BACKSTORY,
    AGENT_BUILDER_CHALLENGE_DESCRIPTION,
    AGENT_BUILDER_KNOWLEDGE_SOURCES,
    AGENT_BUILDER_LANGUAGE_VOICES,
    AGENT_BUILDER_LINGUISTIC_STYLE_SAMPLES,
    AGENT_BUILDER_OPENING_STATEMENTS,
    AGENT_BUILDER_PERSONA,
    AGENT_BUILDER_REMINDERS,
    AGENT_BUILDER_ROLE_INSTRUCTION,
    AGENT_BUILDER_SPOKEN_LANGUAGES,
    AGENT_BUILDER_STATES,
    AGENT_BUILDER_TITLE,
    ANALYTICS_SUGGESTIONS_GENERATE,
    BUG_HUNTER_CLASSIFY_MISS,
    BUG_HUNTER_CLASSIFY_REPO,
    BUG_HUNTER_DECIDE,
    BUG_HUNTER_REVIEW_STUDY,
    BUILDER_INTERVIEWER_SYSTEM,
    BUILDER_PLATFORM_RULES,
    CHARACTER_INTERVIEW_INTERVIEWER_SYSTEM,
    COURSE_COPILOT_ALLY_NOTES_WRITER,
    COURSE_COPILOT_ANNOTATION_WRITER,
    COURSE_COPILOT_ARTICLE_WRITER,
    COURSE_COPILOT_BLUEPRINT_PLANNER,
    COURSE_COPILOT_COURSE_META,
    COURSE_COPILOT_COURSE_REVIEWER,
    COURSE_COPILOT_HISTORY_SUMMARY,
    COURSE_COPILOT_IMAGE_PROMPT,
    COURSE_COPILOT_INTERVIEWER_SYSTEM,
    COURSE_COPILOT_JOURNAL_WRITER,
    COURSE_COPILOT_LANDING_PAGE_WRITER,
    COURSE_COPILOT_QUIZ_WRITER,
    COURSE_COPILOT_ROLEPLAY_BRIEF,
    COVER_IMAGE_GENERATION,
    ENHANCE_FIELD,
    ENHANCE_STATE,
    EVENT_BUILDER_BRANCH_INSTRUCTION,
    EVENT_BUILDER_CLASSIFIER,
    EVENT_BUILDER_EXAMPLES,
    EVENT_BUILDER_FEEDBACK,
    EVENT_BUILDER_TAGS,
    MOBILE_RELEASE_WHATS_NEW,
    OPENAI_SCENARIO_SESSION_CHAT,
    OPENAI_TRANSLATION_CODE_MIXED_SYSTEM,
    OPENAI_TRANSLATION_GENERAL_TEXT_TRANSLATION,
    OPENAI_TRANSLATION_LEARN_BEHAVIOR_INSTRUCTION,
    OPENAI_TRANSLATION_SESSION_EVENT,
    OPENAI_TRANSLATION_SPEECH_REEXPRESSION_USER,
    PRODUCT_UPDATES_CONSOLIDATE,
    ROADMAP_CLASSIFY_GOAL,
    ROADMAP_DUPLICATE_CHECK,
    ROADMAP_GENERATE_CLAUDE_PROMPT,
    ROADMAP_GOAL_IMPACT,
    ROADMAP_OPPORTUNITY_COPILOT,
    ROADMAP_SUMMARISE_INTERVIEW,
    SCRIBE_VOICE_NOTE_FIELD_EXTRACTION_SYSTEM,
    SCRIBE_VOICE_NOTE_FIELD_EXTRACTION_USER,
    SKILL_EXPERIMENT_CHALLENGER_GENERATOR,
    SKILL_EXPERIMENT_DESIGNER,
    SKILL_EXPERIMENT_JUDGE,
    TRACK_MEMORY_FACTS,
    TRACK_MEMORY_FOLD,
    TRACK_QUIZ_OPEN_ENDED_GRADING_USER,
    UX_SIGNALS_TRIAGE,
    AGENT_TEMPLATE_TRANSLATION,
    DRIFT_JUDGE_CONVERSATION_RUBRIC,
    GLOSSARY_ADJUDICATION,
    GLOSSARY_CONSOLIDATION,
    GLOSSARY_GENERATION,
    GLOSSARY_LEXEME_PAIRING,
    LANGUAGE_QUALITY_JUDGE_RUBRIC,
    OPENAI_TRANSLATION_TOOLTIP_TRANSLATION,
  ].map((d) => [d.code, d]),
) as Readonly<Record<string, ReturnType<typeof definePrompt>>>;
