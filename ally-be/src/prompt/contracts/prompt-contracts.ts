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

/** src/prompts/builder/correction_system.txt */
export const BUILDER_CORRECTION_SYSTEM = definePrompt(
  'builder_correction_system',
  {},
  {
    name: 'Builder — Correction Classifier',
    description:
      "Reads one exchange from a Builder interview and decides whether the admin's reply corrected Builder, and of what kind (missing capability, stale doc, platform scope, over-asking), drafting the lesson, reuse line, doc fix and eval checklist line it should teach. Runs daily over recent admin replies.",
    category: 'Builder',
    runtimes: ['ally-be'],
    output: 'structured',
  },
);

/** src/prompts/builder/discovery_plan_system.txt */
export const BUILDER_DISCOVERY_PLAN_SYSTEM = definePrompt(
  'builder_discovery_plan_system',
  {},
  {
    name: 'Builder — Discovery Planner',
    description:
      "Plans the discovery sweep Builder runs before it first replies to an admin: 8–12 one-to-three-word queries over the platform map, docs, wiki, code search and the AI task registry. The server runs the queries; a failure falls back to queries from the request's own words.",
    category: 'Builder',
    runtimes: ['ally-be'],
    output: 'structured',
  },
);

/** src/prompts/builder/epic_system.txt */
export const BUILDER_EPIC_SYSTEM = definePrompt(
  'builder_epic_system',
  {},
  {
    name: 'Builder — Milestone Planner',
    description:
      'Splits a large PRD into an ordered series of milestones, each mergeable on its own, with every requirement in exactly one. Answers with a JSON array; the assignment is validated in code.',
    category: 'Builder',
    runtimes: ['ally-be'],
    output: 'json',
  },
);

/** src/prompts/builder/eval_admin_system.txt */
export const BUILDER_EVAL_ADMIN_SYSTEM = definePrompt(
  'builder_eval_admin_system',
  {},
  {
    name: 'Builder Eval — Simulated Admin',
    description:
      "Plays the admin in a Builder replay eval: answers the sandboxed interviewer from the fixture's recorded admin words and ground-truth checklist, and corrects it wherever the truth contradicts it. Part of the eval's measuring instrument.",
    category: 'Builder',
    runtimes: ['ally-be'],
    output: 'structured',
  },
);

/** src/prompts/builder/eval_judge_system.txt */
export const BUILDER_EVAL_JUDGE_SYSTEM = definePrompt(
  'builder_eval_judge_system',
  {},
  {
    name: 'Builder Eval — Checklist Judge',
    description:
      "Scores a Builder replay's final PRD against the fixture's ground-truth checklist, item by item. Scores only; the eval's deterministic gates decide a pass. Part of the eval's measuring instrument.",
    category: 'Builder',
    runtimes: ['ally-be'],
    output: 'structured',
  },
);

/** src/prompts/builder/exemplar_rank_system.txt */
export const BUILDER_EXEMPLAR_RANK_SYSTEM = definePrompt(
  'builder_exemplar_rank_system',
  {},
  {
    name: 'Builder — Past-Build Ranker',
    description:
      'Picks which past builds are worth showing an agent starting a new one, by overlap of the work rather than of the words. Answers with a JSON array of ids; a failure falls back to the most recent merged builds.',
    category: 'Builder',
    runtimes: ['ally-be'],
    output: 'json',
  },
);

/** src/prompts/builder/exemplar_summary_system.txt */
export const BUILDER_EXEMPLAR_SUMMARY_SYSTEM = definePrompt(
  'builder_exemplar_summary_system',
  {},
  {
    name: 'Builder — Past-Build Note',
    description:
      'Writes the 120–150 word note about a finished build that later builds are shown: what was asked, the approach, and what happened after it shipped.',
    category: 'Builder',
    runtimes: ['ally-be'],
  },
);

/** src/prompts/builder/interview_summary_system.txt */
export const BUILDER_INTERVIEW_SUMMARY_SYSTEM = definePrompt(
  'builder_interview_summary_system',
  {},
  {
    name: 'Builder — Interview Summariser',
    description:
      'Compresses the oldest turns of a long Builder interview into notes the interviewer keeps instead of the full transcript: decisions and reasons, rejected options, stated constraints, open items and unrepaired failures.',
    category: 'Builder',
    runtimes: ['ally-be'],
  },
);

/** src/prompts/builder/lesson_curator_system.txt */
export const BUILDER_LESSON_CURATOR_SYSTEM = definePrompt(
  'builder_lesson_curator_system',
  {},
  {
    name: 'Builder — Lesson Curator',
    description:
      "Folds the lessons a finished build wrote into Builder's capped lesson set, one AGREE / EDIT / ADD / REMOVE operation per candidate. Answers with a JSON array of operations; every guardrail is enforced in code.",
    category: 'Builder',
    runtimes: ['ally-be'],
    output: 'json',
  },
);

/** src/prompts/builder/rule_draft_system.txt */
export const BUILDER_RULE_DRAFT_SYSTEM = definePrompt(
  'builder_rule_draft_system',
  {},
  {
    name: 'Builder — Rule Draft',
    description:
      'Turns one answer the admin gave Builder into a general rule (one sentence) and the area it belongs to, for the admin to edit before saving. Answers in JSON.',
    category: 'Builder',
    runtimes: ['ally-be'],
    output: 'json',
  },
);

/** src/prompts/builder/rule_match_system.txt */
export const BUILDER_RULE_MATCH_SYSTEM = definePrompt(
  'builder_rule_match_system',
  {},
  {
    name: 'Builder — Rule Preview',
    description:
      'Checks a proposed rule against the admin\'s earlier decisions: which it would have answered, and whether it agrees with what was chosen. Powers the rule editor\'s "would have applied to" preview. Answers in JSON.',
    category: 'Builder',
    runtimes: ['ally-be'],
    output: 'json',
  },
);

/** src/prompts/builder/session_ask_system.txt */
export const BUILDER_SESSION_ASK_SYSTEM = definePrompt(
  'builder_session_ask_system',
  {},
  {
    name: 'Builder — Ask a Session',
    description:
      "Answers an admin's read-only question about one Builder session from its PRD, transcript, runs, pull requests, decisions and rules. Never changes the session; may suggest an instruction for the admin to send. Answers in JSON.",
    category: 'Builder',
    runtimes: ['ally-be'],
    output: 'json',
  },
);

/** src/prompts/builder/work_ask_system.txt */
export const BUILDER_WORK_ASK_SYSTEM = definePrompt(
  'builder_work_ask_system',
  {},
  {
    name: 'Builder — Ask About All Work',
    description:
      "Answers an admin's read-only question across every Builder session in progress, the decisions waiting, the admin's rules, recent history and Up next. Answers in JSON.",
    category: 'Builder',
    runtimes: ['ally-be'],
    output: 'json',
  },
);

/** src/prompts/builder/outcome_system.txt */
export const BUILDER_OUTCOME_SYSTEM = definePrompt(
  'builder_outcome_system',
  {},
  {
    name: 'Builder — Outcome Categoriser',
    description:
      'Reads what happened to a finished change — merge, CI, review comments — and returns rework tags, up to three reusable lessons, and the existing lessons that failed to prevent the problem.',
    category: 'Builder',
    runtimes: ['ally-be'],
    output: 'json',
  },
);

/** src/prompts/builder/prd_recheck_system.txt */
export const BUILDER_PRD_RECHECK_SYSTEM = definePrompt(
  'builder_prd_recheck_system',
  {},
  {
    name: 'Builder — PRD Recheck',
    description:
      "The cold PRD reviewer's later passes: judges only the open findings against the changed PRD and can close one but never add one, so the loop converges.",
    category: 'Builder',
    runtimes: ['ally-be'],
    output: 'structured',
  },
);

/** src/prompts/builder/prd_review_system.txt */
export const BUILDER_PRD_REVIEW_SYSTEM = definePrompt(
  'builder_prd_review_system',
  {
    // BUILDER_PRD_REVIEW_SECTION_KEYS joined with '|': the keys the parser accepts.
    sectionKeys: 'optional',
    // BUILDER_PRD_REVIEW_MAX_FINDINGS: the parser keeps no more than this.
    maxFindings: 'optional',
  },
  {
    name: 'Builder — PRD Review',
    description:
      'The cold reviewer that reads a PRD when it first reads ready, against the evidence log, the transcript and the reusable-systems map, and files contradictions, unsupported claims, unapplied corrections, missed reuse and a missing success metric. Findings block readiness until fixed or dismissed.',
    category: 'Builder',
    runtimes: ['ally-be'],
    output: 'structured',
  },
);

/** src/prompts/builder/research_system.txt */
export const BUILDER_RESEARCH_SYSTEM = definePrompt(
  'builder_research_system',
  {},
  {
    name: 'Builder — Research Pass',
    description:
      "System prompt for the unattended research pass that reads the codebase with the interview's tools and writes what it finds into the PRD (a technical plan, or a first draft). The platform rules are appended to it.",
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
  {
    name: 'Agent Template Translation Prompt',
    description:
      'System prompt to translate main_agent/branching prompt templates into Indian languages (Gemini). Preserves {…} placeholders and [audio tags].',
  },
);

/** src/prompts/drift_judge/conversation_rubric.txt */
export const DRIFT_JUDGE_CONVERSATION_RUBRIC = definePrompt(
  'drift_judge_conversation_rubric',
  {},
  {
    name: 'Conversation Drift Judge Rubric',
    description:
      'Static rubric for the conversation drift judge (see drift-metrics-spec.md). The judge composes the session transcript/persona/language around this text.',
    category: 'evaluation',
    output: 'structured',
  },
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
  {
    name: 'Glossary adjudication',
    description:
      'Decides queued glossary proposals: accepts language rules, rejects persona/behaviour rules, restatements, and rules that fight real usage. Rule FORM is checked deterministically before this prompt runs.',
    output: 'json',
  },
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
  {
    name: 'Language Glossary Consolidation Prompt',
    description:
      'System prompt that clusters language-judge error annotations into proposed glossary entries (term pairs, rules, patterns). Output: strict JSON consumed by the consolidation job.',
    output: 'json',
  },
);

/** src/prompts/glossary/generation.txt */
export const GLOSSARY_GENERATION = definePrompt(
  'glossary_generation',
  {
    evalConfig: 'optional',
    languageCode: 'optional',
    languageName: 'required',
  },
  {
    name: 'Language Glossary Generation Prompt',
    description:
      'System prompt that generates draft glossary sections (term pairs, rules, patterns) for a language. Output: strict JSON consumed by the glossary seed job.',
    output: 'json',
  },
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
  {
    name: 'Language Glossary Lexeme Pairing Prompt',
    description:
      'Pairs words the role-play agent over-uses (vs counsellor speech) with their colloquial equivalents, or keeps them. Output: strict JSON consumed by the lexeme-mining job.',
    output: 'json',
  },
);

/** src/prompts/feedback_groundedness/rubric.txt */
export const FEEDBACK_GROUNDEDNESS_RUBRIC = definePrompt(
  'feedback_groundedness_rubric',
  {},
  {
    name: 'Feedback Groundedness Judge Rubric',
    description:
      "Static rubric for the feedback-groundedness judge: is each claim in a learner's feedback supported by the transcript? The judge composes the transcript and the claims around this text.",
    category: 'evaluation',
    output: 'structured',
  },
);

/** src/prompts/debrief_quality/rubric.txt */
export const DEBRIEF_QUALITY_RUBRIC = definePrompt(
  'debrief_quality_rubric',
  {},
  {
    name: 'Debrief Quality Judge Rubric',
    description:
      "Static rubric for the debrief-quality judge: scores a learner's whole debrief on eight dimensions and lists hard fails. The judge composes the transcript and the debrief around this text.",
    category: 'evaluation',
    output: 'structured',
  },
);

/** src/prompts/debrief/safety_reader_system.txt */
export const DEBRIEF_SAFETY_READER_SYSTEM = definePrompt(
  'debrief_safety_reader_system',
  {},
  {
    name: 'Debrief Safety Reader',
    description:
      "The debrief agent's mandatory safety step: finds the client's risk cues (and how the learner responded) and the learner's own distress. The step composes the transcript around this text. Pinned: change it only after the safety recall gate passes.",
    category: 'evaluation',
    output: 'structured',
  },
);

/** src/prompts/debrief/analyst_system.txt */
export const DEBRIEF_ANALYST_SYSTEM = definePrompt(
  'debrief_analyst_system',
  {},
  {
    name: 'Debrief Analyst',
    description:
      "The debrief agent's Analyst: builds the evidence map (each behaviour's opportunity, observed/partial/missed, confidence, importance and exact quote; pivotal moments; emotional arc; AI faults). The step composes the transcript, scenario and expected behaviours around this text. Release-only: a new version reaches learners through an approved release.",
    category: 'evaluation',
    output: 'structured',
  },
);

/** src/prompts/debrief/progress_reader_system.txt */
export const DEBRIEF_PROGRESS_READER_SYSTEM = definePrompt(
  'debrief_progress_reader_system',
  {},
  {
    name: 'Debrief Progress Reader',
    description:
      "The debrief agent's Progress reader: compares the latest evidence map with the learner's past Work-on-this points and says only what the evidence supports. Release-only.",
    category: 'evaluation',
    output: 'structured',
  },
);

/** src/prompts/debrief/writer_system.txt */
export const DEBRIEF_WRITER_SYSTEM = definePrompt(
  'debrief_writer_system',
  {},
  {
    name: 'Debrief Writer',
    description:
      "The debrief agent's Writer: writes the learner's cards in the session's language from the evidence map, safety reading, guidance and progress. Every client risk cue is covered: the most serious by the important moment, each other one in its `others`. Never sees the rubric. Release-only.",
    category: 'evaluation',
    output: 'structured',
  },
);

/** src/prompts/debrief/reviser_system.txt */
export const DEBRIEF_REVISER_SYSTEM = definePrompt(
  'debrief_reviser_system',
  {},
  {
    name: 'Debrief Reviser',
    description:
      "The debrief agent's Reviser: edits only the sections the checks or the Evaluator flagged, adding any uncovered risk cue to the important moment's `others`. Release-only.",
    category: 'evaluation',
    output: 'structured',
  },
);

/** src/prompts/debrief/improver_system.txt */
export const DEBRIEF_IMPROVER_SYSTEM = definePrompt(
  'debrief_improver_system',
  {},
  {
    name: 'Debrief Improver',
    description:
      "The Improver's instructions: reads aggregate signals from debrief runs, writes the weekly report and proposes ideas. Its own skill; changes go through a person.",
    category: 'evaluation',
    output: 'structured',
  },
);

/** src/prompts/filler_quality_judge/rubric.txt */
export const FILLER_QUALITY_JUDGE_RUBRIC = definePrompt(
  'filler_quality_judge_rubric',
  {},
  {
    name: 'Filler Quality Judge Rubric',
    description:
      'Static rubric for the filler-quality judge (see filler-eval-judge-schema.md). The judge composes the language, style exemplars, allowed fillers, persona and each filler around this text.',
    category: 'evaluation',
    output: 'structured',
  },
);

/** src/prompts/rag_quality/rubric.txt */
export const RAG_QUALITY_RUBRIC = definePrompt(
  'rag_quality_rubric',
  {},
  {
    name: 'Knowledge Retrieval Quality Judge Rubric',
    description:
      "Static rubric for the retrieval-quality judge: were the passages retrieved for a query relevant? The judge composes the corpus's purpose, the query, the similarity floor and the passages around this text.",
    category: 'evaluation',
    output: 'structured',
  },
);

/** src/prompts/recall_quality/rubric.txt */
export const RECALL_QUALITY_RUBRIC = definePrompt(
  'recall_quality_rubric',
  {},
  {
    name: 'Memory Recall Quality Judge Rubric',
    description:
      "Static rubric for the recall-quality judge: did the client's reply use the memories it should have? The judge composes the counsellor and client turns and the facts around this text.",
    category: 'evaluation',
    output: 'structured',
  },
);

/** src/prompts/language_quality_judge/rubric.txt */
export const LANGUAGE_QUALITY_JUDGE_RUBRIC = definePrompt(
  'language_quality_judge_rubric',
  {},
  {
    name: 'Language Quality Judge Rubric',
    description:
      'Static rubric for the language-quality judge (see language-eval-judge-schema.md). The judge composes the per-language parameter block, persona and transcript around this text.',
    category: 'evaluation',
    output: 'structured',
  },
);

/** src/prompts/openai_translation/tooltip_translation.txt */
export const OPENAI_TRANSLATION_TOOLTIP_TRANSLATION = definePrompt(
  'openai_translation_tooltip_translation',
  {
    inputJson: 'required',
    languageName: 'required',
  },
  {
    name: 'OpenAI Tooltip Translation Prompt',
    description:
      'Localizes tooltip UI text into natural, concise target-language phrasing while preserving JSON structure, HTML tags, and notranslate spans.',
    output: 'structured',
  },
);

/** src/prompts/agent_memory/curator_system.txt */
export const AGENT_MEMORY_CURATOR_SYSTEM = definePrompt(
  'agent_memory_curator_system',
  {},
  {
    name: 'Agent Memory — Notebook Curator',
    description:
      "Folds the notes an autonomous agent wrote at the end of a run into its capped notebook, one AGREE / EDIT / ADD / REMOVE operation per candidate, never overriding a person's pinned entry. Bug Hunter today.",
    category: 'Bug Hunter',
    runtimes: ['ally-be'],
    output: 'json',
  },
);

/** src/prompts/debrief_chat/summary_system.txt */
export const DEBRIEF_CHAT_SUMMARY_SYSTEM = definePrompt(
  'debrief_chat_summary_system',
  {},
  {
    name: 'Debrief Chat — History Summary',
    description:
      'Folds older debrief-chat messages into a running third-person summary under 300 words, so the history sent with each reply stays bounded.',
    runtimes: ['ally-be'],
  },
);

/** src/prompts/openai_track/content_translation.txt */
export const OPENAI_TRACK_CONTENT_TRANSLATION = definePrompt(
  'openai_track_content_translation',
  {
    inputJson: 'required',
    languageName: 'required',
    toneGuidance: 'optional',
    glossary: 'optional',
    // Rendered into the <blankToken> marker as the literal placeholder text.
    blankToken: 'optional',
  },
  {
    name: 'Course Content Translation',
    description:
      "Localises a course's keyed strings (titles, prose, HTML, fill-blank templates, marking keys, rubrics, speakers) into one language, per-field rules by kind. Answers with a JSON object keyed like the input; placeholders and HTML are validated in code.",
    output: 'structured',
  },
);
