/**
 * The Ally guide's rows in the AI task registry
 * (src/llm/constants/ai-task-registry.constants.ts), by id. Every guide model
 * call passes one of these as `aiTaskId`, so a usage row leads straight back
 * to the registry row that documents it.
 */
export const GUIDE_AI_TASKS = {
  ORCHESTRATOR: 'guide-orchestrator',
  SENTINEL: 'guide-sentinel',
  TUTOR: 'guide-tutor',
  OUTREACH: 'guide-outreach',
  ASSESSOR: 'guide-assessor',
  COACH: 'guide-coach',
  // The learning loop (src/guide-learning).
  EVALUATOR_CRITIC: 'guide-evaluator-critic',
  EVALUATOR_VERIFIER: 'guide-evaluator-verifier',
  RED_TEAM: 'guide-red-team',
  MEMORY_CURATOR: 'guide-memory-curator',
} as const;
