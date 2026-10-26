import { definePrompt } from './define-prompt';

/**
 * The contract of every ally-be prompt, one exported `definePrompt` per
 * default in src/prompts. The code is the file's path under src/prompts with
 * `/` as `_`. Exporting it is the whole registration: `PROMPT_CONTRACTS`
 * (./index.ts) collects every export, and a jest test fails if a default has
 * no contract or a contract has no default.
 *
 * A variable is `'required'` when the code always supplies it and the text
 * depends on it; anything else is `'optional'`. Contracts are open (undeclared
 * variables allowed) until `open: false`. `name`, `description`, `category`,
 * `runtimes` and `defaultModel` are how the prompt shows up in the Skills
 * Store; see `PromptDetails`. Recipe: docs/adding-a-prompt.md.
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
  {
    name: 'Analytics Suggestions: Generate',
    description:
      "System prompt for the admin Analytics -> Suggestions tab. Carries Ally's product-vision context and governs how the model turns one window of platform analytics into at most ten roadmap suggestions: evidence must come from the payload, all-time and unavailable sections must not be misread as window changes, product goals must be copied exactly from the live list, already-proposed and previously-rejected items must not be re-proposed, and returning fewer than ten (or none) is the correct answer when the data supports fewer. The analytics payload is sent as a separate user message, so this prompt has no runtime variables.",
    category: 'Analytics',
    output: 'json',
  },
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
  {
    name: 'Bug Hunter — Classify Repo',
    description:
      'Triages a human-reported bug (no repo attached yet) to the codebase whose fix session should run it.',
    category: 'Bug Hunter',
    output: 'structured',
  },
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
  {
    name: 'Bug Hunter — Review Study',
    description:
      "Reads a fix session's study (how the feature works today, where the value lives, the planned fix) before any code changes, and raises the concerns the session must answer — a parallel mechanism, a header nobody sends, a half-fix across repos.",
    category: 'Bug Hunter',
    output: 'structured',
  },
);

/** src/prompts/builder/interviewer_system.txt */
export const BUILDER_INTERVIEWER_SYSTEM = definePrompt(
  'builder_interviewer_system',
  {},
  {
    name: 'Builder Interviewer — System',
    description:
      'System prompt for the Builder PRD-interview agent: interviews an Ally admin one option-card question at a time, grounding each question in the codebase (GitHub tools + repo knowledge packs) and the product library (Stacks), resolving contradictions between answers, and keeping a living PRD patched to build-readiness for the coding agent to implement.',
    category: 'Builder',
    runtimes: ['ally-be'],
  },
);

/** src/prompts/builder/platform_rules.txt */
export const BUILDER_PLATFORM_RULES = definePrompt(
  'builder_platform_rules',
  {},
  {
    name: 'Builder — Platform Rules',
    description:
      'Standing rules every Builder agent receives — interviewer, technical designer, planner, coder and reviewer: additive API and data changes because released mobile apps lag the backend, never renaming persisted keys, finding every reader before changing a field, reusing existing components, scope and test discipline. Hand-written and authoritative, unlike lessons, which are learned and advisory.',
    category: 'Builder',
    runtimes: ['ally-be'],
  },
);

/** src/prompts/character_interview/interviewer_system.txt */
export const CHARACTER_INTERVIEW_INTERVIEWER_SYSTEM = definePrompt(
  'character_interview_interviewer_system',
  {},
  {
    name: 'Character Interviewer — System',
    description:
      'System prompt for the Character Library interview agent: runs a ~20-25 question deep-dive interview (identity, life context, inner life, history, speech style, voice pick), every question as an option card with a custom answer, then distils the answers into a complete character draft the admin reviews in the character form.',
    category: 'Character Library',
  },
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
  {
    name: 'Course Copilot — Ally Notes Writer',
    description:
      "Drafts a course's notes for Ally, the AI guide (who the learners are, where the course is emotionally heavy and how to pace it, the ideas it returns to), plus per-item pacing tension overrides where the type-based default is wrong. Never sees answer keys and must never hint at one; the draft is checked against the course's correct answers in code. Called when an admin clicks Draft with Copilot in the builder's Ally notes; nothing is saved server-side. JSON mode.",
    category: 'Course Copilot',
    runtimes: ['ally-be'],
    output: 'structured',
  },
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
  {
    name: 'Course Copilot — Annotated Transcript Writer',
    description:
      "Writes one ANNOTATED_ARTIFACT item: a fictional helper conversation (a worked example), up to 6 helpful/unhelpful labels taken from the brief's confirmed behaviours, and an answer key whose notes explain each line's effect. JSON mode; ids and colours assigned in code.",
    category: 'Course Copilot',
    runtimes: ['ally-be'],
    output: 'structured',
  },
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
  {
    name: 'Course Copilot — Article Writer',
    description:
      'Writes one ARTICLE item for a helper-training course: supportive reading organised around at most 5-7 key points, 600-900 words by default, with optional single-answer inline checks anchored by data-ally-question placeholders. JSON mode; html sanitised and ids re-minted in code.',
    category: 'Course Copilot',
    runtimes: ['ally-be'],
    output: 'structured',
  },
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
  {
    name: 'Course Copilot — Blueprint Planner',
    description:
      "Turns the trainer's interview brief into a course blueprint for approval: sections as simple-to-complex task classes, each item's type, purpose, outcomes, minutes, source (library pick, new, or needs a video link), generation spec and completion rule. Capstone last, worked example before the first roleplay, journal after every practice block, games only as breaks. JSON mode; normalised and limit-checked in code.",
    category: 'Course Copilot',
    runtimes: ['ally-be'],
    output: 'structured',
  },
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
  {
    name: 'Course Copilot — Course Title and Description',
    description:
      "Polishes a built course's title (at most 80 characters, says what the learner will be able to do) and its catalogue description (two short plain-text paragraphs). JSON mode.",
    category: 'Course Copilot',
    runtimes: ['ally-be'],
    output: 'structured',
  },
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
  {
    name: 'Course Copilot — Course Reviewer',
    description:
      'Critic pass after a build: reviews the course outline and inline content against a fixed rubric (outcome coverage, capstone, progression, reflection, answer-key accuracy, duplication, audience fit, safety, publish readiness) and returns at most 10 fix/consider findings, each with an optional one-click edit. JSON mode.',
    category: 'Course Copilot',
    runtimes: ['ally-be'],
    output: 'structured',
  },
);

/** src/prompts/course_copilot/history_summary.txt */
export const COURSE_COPILOT_HISTORY_SUMMARY = definePrompt(
  'course_copilot_history_summary',
  {},
  {
    name: 'Course Copilot — Conversation Summary',
    description:
      'Compresses the oldest turns of a long Course Copilot conversation into notes (decided, rejected, preferences, changes, open) so they can leave the replayed transcript without losing what they settled. Used as the system prompt; the turns go in the user message.',
    category: 'Course Copilot',
    runtimes: ['ally-be'],
  },
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
  {
    name: 'Course Copilot — Image Prompt Writer',
    description:
      'Writes the image-generation prompt for a course cover or an article illustration in the house documentary-photography style: real settings, no text in the image, no identifiable real people, nothing distressing, 16:9. JSON mode; guardrail sentence appended in code.',
    category: 'Course Copilot',
    runtimes: ['ally-be'],
    output: 'structured',
  },
);

/** src/prompts/course_copilot/interviewer_system.txt */
export const COURSE_COPILOT_INTERVIEWER_SYSTEM = definePrompt(
  'course_copilot_interviewer_system',
  {},
  {
    name: 'Course Copilot Interviewer — System',
    description:
      'System prompt for Course Copilot: interviews a trainer one option-card question at a time (seed, learners, outcomes, assessment first, shape, practice ladder, look, final check), keeps the course brief patched, proposes a blueprint for approval, and edits the built course on request with course-aware tools. Set the model on this row to change the interview model (Claude Sonnet recommended for tool-use reliability).',
    category: 'Course Copilot',
    runtimes: ['ally-be'],
  },
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
  {
    name: 'Course Copilot — Journal Writer',
    description:
      'Writes the 1-3 reflection prompts of one JOURNAL item as an after-action review of the practice block it follows: what happened, why, and what the learner will do differently. JSON mode.',
    category: 'Course Copilot',
    runtimes: ['ally-be'],
    output: 'structured',
  },
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
  {
    name: 'Course Copilot — Landing Page Writer',
    description:
      "Drafts a course's story-led landing page from the saved course: hook, question, one persona, a first move with three labelled replies, one beat and teaser per section (one hard call), three outcomes and the cast. Never scores the client's outcome or reveals a quiz answer. Called when an admin clicks Draft with Copilot on the builder's Landing page tab; nothing is saved server-side. JSON mode.",
    category: 'Course Copilot',
    runtimes: ['ally-be'],
    output: 'structured',
  },
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
  {
    name: 'Course Copilot — Quiz Writer',
    description:
      "Writes one QUIZ item: mostly forced-choice questions whose distractors are the audience's real misconceptions, every one explained, plus 1-2 rubric-graded open-ended scenario questions when the outcome is about doing. Likert self-rating only when asked. JSON mode; answer keys checked in code.",
    category: 'Course Copilot',
    runtimes: ['ally-be'],
    output: 'structured',
  },
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
  {
    name: 'Course Copilot — Roleplay Brief',
    description:
      'Turns one roleplay slot of an approved Course Copilot blueprint into the actor brief the Agent Builder field chain takes: one fictional client written the way a trainer fills in "Describe roleplay actor", encoding the slot\'s task class (cooperative → ambivalent → distressed; one concern → several), the audience and the behaviours being practised, plus agent test cases, a title, persona gender/age and a difficulty. JSON mode.',
    category: 'Course Copilot',
    runtimes: ['ally-be'],
    output: 'structured',
  },
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
  {
    name: 'Scenario Session Chat',
    description:
      'System prompt for AI supervisor providing feedback and guidance to counselors-in-training after completing a simulated counseling session. Includes role boundaries, evidence rules, evaluation standards, and formatting constraints.',
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
  {
    name: 'Code-Mixed Reexpression (System)',
    description:
      'Re-expresses content as natural spoken language in the target language. Primary native script with limited English (e.g. 80–90% native, 10–20% English); for South Asian code-mixing.',
    output: 'structured',
  },
);

/** src/prompts/openai_translation/general_text_translation.txt */
export const OPENAI_TRANSLATION_GENERAL_TEXT_TRANSLATION = definePrompt(
  'openai_translation_general_text_translation',
  {
    languageName: 'required',
    text: 'required',
  },
  {
    name: 'General Text Translation',
    description:
      'Translates plain text to the target language. Preserves meaning and tone; output is translated text only (no JSON, markdown, or commentary).',
  },
);

/** src/prompts/openai_translation/learn_behavior_instruction.txt */
export const OPENAI_TRANSLATION_LEARN_BEHAVIOR_INSTRUCTION = definePrompt(
  'openai_translation_learn_behavior_instruction',
  {
    inputJson: 'required',
    languageName: 'required',
  },
  {
    name: 'Behavior Instruction Localization',
    description:
      'Localizes behavior instructions for role-play into natural language. Preserves JSON keys, array order, and the "||||" separator; translates instruction text only.',
    output: 'structured',
  },
);

/** src/prompts/openai_translation/session_event.txt */
export const OPENAI_TRANSLATION_SESSION_EVENT = definePrompt(
  'openai_translation_session_event',
  {
    inputJson: 'required',
    languageName: 'required',
  },
  {
    name: 'Session Event Localization',
    description:
      'Localizes session events for role-play into natural language. Preserves JSON structure, HTML tags, placeholders, and notranslate spans; translates all other text.',
    output: 'structured',
  },
);

/** src/prompts/openai_translation/speech_reexpression_user.txt */
export const OPENAI_TRANSLATION_SPEECH_REEXPRESSION_USER = definePrompt(
  'openai_translation_speech_reexpression_user',
  {
    inputJson: 'required',
    languageName: 'required',
  },
  {
    name: 'Speech Reexpression (User)',
    description:
      'Rewrites JSON string values to sound like natural, casual spoken language. Keeps JSON structure and keys; no word-for-word translation—how a native speaker would say it.',
    output: 'structured',
  },
);

/** src/prompts/product_updates/consolidate.txt */
export const PRODUCT_UPDATES_CONSOLIDATE = definePrompt(
  'product_updates_consolidate',
  {},
  {
    name: 'Product updates — consolidate merges',
    description:
      "Turns a batch of clustered merges into feature-level product updates: new, attached to an open update, or noise, with public and team text. Its public text reaches app.helloally.ai/blog/changelog automatically, so edits here change the public changelog's voice.",
    category: 'Product updates',
    runtimes: ['ally-be'],
    defaultModel: { provider: 'openai', model: 'gpt-5' },
    output: 'structured',
  },
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
  {
    name: 'Scribe Voice Note: Field Extraction (System)',
    description:
      "System instructions for the Scribe Create Note voice-dictation feature. Governs which session-note fields the model may fill from a counsellor's spoken transcript, the clinical-safety rules, per-type value formatting, and the JSON-only output contract.",
    category: 'Scribe',
    output: 'json',
  },
);

/** src/prompts/scribe_voice_note/field_extraction_user.txt */
export const SCRIBE_VOICE_NOTE_FIELD_EXTRACTION_USER = definePrompt(
  'scribe_voice_note_field_extraction_user',
  {
    fields: 'required',
    transcript: 'required',
  },
  {
    name: 'Scribe Voice Note: Field Extraction (User)',
    description:
      'User message for the Scribe Create Note voice-dictation feature. The runtime variables {{transcript}} (the dictated speech-to-text transcript) and {{fields}} (a JSON array of the target note fields) are substituted before the extraction call.',
    category: 'Scribe',
    output: 'json',
  },
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
  {
    name: 'Skill Experiment Challenger Generator',
    description:
      'Generates a revised skill prompt based on user feedback (thumbs up/down and comments) to improve debrief quality.',
    output: 'structured',
  },
);

/** src/prompts/skill_experiment/designer.txt */
export const SKILL_EXPERIMENT_DESIGNER = definePrompt(
  'skill_experiment_designer',
  {},
  {
    name: 'Auto-improve — prompt designer',
    description:
      "Drafts the next challenger in an auto-improve experiment from the current best text, the rubric, the judge's reasons and earlier failed attempts. Its draft is validated in code: one that drops, renames or invents a runtime placeholder is rejected and never served. The context arrives as a separate message, so this text has no placeholders.",
    category: 'Auto-improve',
    runtimes: ['ally-be'],
    output: 'structured',
  },
);

/** src/prompts/skill_experiment/judge.txt */
export const SKILL_EXPERIMENT_JUDGE = definePrompt(
  'skill_experiment_judge',
  {},
  {
    name: 'Auto-improve — output judge',
    description:
      "Scores one output of a skill under an auto-improve experiment, 1–5 on each criterion of the admin's rubric, blind to which variant wrote it. The rubric and the output arrive as a separate message, so this text has no placeholders. Editing it changes how every experiment is judged — stop running experiments first, or their scores stop being comparable.",
    category: 'Auto-improve',
    runtimes: ['ally-be'],
    output: 'structured',
  },
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
  {
    name: 'UX Signals: Triage',
    description:
      "System prompt for the UX Signals scan, which reads PostHog telemetry and files what it finds into the Bug Hunter queue and the Analytics Suggestions queue. Governs how the model turns threshold-crossing detector output into at most ten bugs and ten improvements: signals sharing a route or endpoint must be clustered into one item, the detector's bug-vs-improvement prior may be overridden by the evidence, a signal the model cannot explain must be surfaced as an investigation rather than dropped, bug descriptions must stand alone as the brief an engineer receives, severity must not be inflated, product goals must be copied exactly from the live list, and already-open or previously-rejected items must not be re-filed. Detectors see behaviour and never code, so guessing at files or functions is forbidden. The signal payload is sent as a separate user message, so this prompt has no runtime variables.",
    category: 'Analytics',
    output: 'json',
  },
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
