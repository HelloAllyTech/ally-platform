/**
 * Published versions kept below the live one. The live version and every
 * candidate are never pruned; sessions record each version's content hash, so
 * the text that ran stays identifiable after its row is gone.
 */
export const PROMPT_VERSION_HISTORY_LIMIT = 20;

/**
 * Prompt code of the system prompt that translates `main_agent`/`branching`
 * prompt templates into Indian languages (seeded by
 * AddAgentTemplateTranslationPrompt). Its `provider`/`model` select the engine.
 */
export const AGENT_TEMPLATE_TRANSLATION_PROMPT_CODE =
  'agent_template_translation';

/** Prompt types whose templates are eligible for auto-translation. */
export const TRANSLATABLE_PROMPT_TYPES = ['main_agent', 'branching'];

/** Total attempts (initial + retries) for one translation before marking failed. */
export const MAX_TRANSLATION_ATTEMPTS = 3;

/**
 * Codes `1980750000000-RemoveUnusedPrompts` deleted. Sync never recreates them:
 * an older service build that still ships one of their files (a container
 * restarted before its new image is deployed, or a rollback) would otherwise
 * bring the row back with that file as its live text. The migration keeps its
 * own copy of the list so it never changes once it has run.
 */
export const REMOVED_PROMPT_CODES: ReadonlySet<string> = new Set([
  'ally_ai_learn_trainee_base',
  'ally_ai_learn_trainee_skilled',
  'ally_ai_learn_trainee_poor',
  'ally_ai_learn_trainee_adversarial',
  'ally_ai_learn_trainee_condition_driven',
  'ally_ai_learn_trainee_full_session',
  'ally_ai_learn_trainee_stagnation_steering',
  'ally_ai_learn_director_system',
  'ally_ai_learn_director_turn_user',
  'ally_ai_learn_judge_system',
  'ally_ai_learn_judge_full_session',
  'ally_ai_learn_judge_test_case',
  'ally_ai_learn_actor_static_prefix',
  'ally_ai_learn_actor_turn_card',
  'ally_ai_learn_filler_delivery_planner',
  'ally_ai_learn_system_client_working_memory',
  'builder_coder_guidance',
  'builder_finalise_guidance',
  'roleplay_copilot_inference_pass',
  'roleplay_copilot_interviewer_system',
  'roleplay_copilot_rehearsal_critique',
  'roleplay_copilot_spec_compiler',
  'roadmap_opportunity_interview',
  'roadmap_release_notes',
  'ally_ai_simulation_simulation_analysis',
  'ally_ai_simulation_simulation_analysis_with_memory',
]);
