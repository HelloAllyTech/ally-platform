import { AI_TASK_REGISTRY } from '../../llm/constants/ai-task-registry.constants';
import {
  DebriefProvider,
  providerOfModel,
} from '../constants/debrief-release.constants';

/** The AI task registry row of today's debrief (ally-ai `summary/scenario/evaluate`). */
export const TODAYS_DEBRIEF_TASK_ID = 'scenario-evaluation';

/**
 * The provider today's debrief runs on, from its AI task registry row, so a
 * learner of an organisation that does not allow it is never sent there
 * when the Debrief agent's debrief cannot be had (plan §8.9, FR-57). Null
 * when the row or its model is unknown.
 */
export function todaysDebriefProvider(): DebriefProvider | null {
  const row = AI_TASK_REGISTRY.find((r) => r.id === TODAYS_DEBRIEF_TASK_ID);
  const model = row?.defaultModel;
  return model ? providerOfModel(model) : null;
}
