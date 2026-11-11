import { Injectable, NotFoundException } from '@nestjs/common';
import { PromptSharedService } from 'src/prompt/service/prompt-shared.service';
import { LlmCompletionService } from 'src/llm-agent/service/llm-completion.service';
import { PlanSpendService } from 'src/product-planning/service/plan-spend.service';
import { PlanStage } from 'src/product-planning/enum/product-planning.enum';

/** The planning_* prompt codes (src/prompts/planning/). */
export const PLANNING_PROMPTS = {
  SAFETY_REVIEW: 'planning_safety_review',
  PRIVACY_REVIEW: 'planning_privacy_review',
  AI_QUALITY_REVIEW: 'planning_ai_quality_review',
  OUTCOME_REVIEW: 'planning_outcome_review',
  LAUNCH_PLAN: 'planning_launch_plan',
  RESEARCH_PLAN: 'planning_research_plan',
  SIGNAL_SCOUT: 'planning_signal_scout',
} as const;

const AI_TASK_ID = 'product-planning-ai';

/**
 * Every planning model call goes through here: the prompt row is the system
 * prompt, the payload one user message, JSON out. Each call is priced into the
 * plan's spend ledger AWAITED, so the meter never lags what was spent.
 */
@Injectable()
export class PlanAiService {
  constructor(
    private readonly prompts: PromptSharedService,
    private readonly llm: LlmCompletionService,
    private readonly spend: PlanSpendService,
  ) {}

  async json<T>(input: {
    promptCode: string;
    payload: string;
    maxTokens: number;
    sessionId: string | null;
    stage: PlanStage | null;
    actorUserId: number | null;
    specialist: string;
  }): Promise<T | null> {
    const system = await this.prompts.getPromptByCode(input.promptCode);
    if (!system)
      throw new NotFoundException(`Prompt not found: ${input.promptCode}`);
    const result = await this.llm.complete({
      taskId: AI_TASK_ID,
      task: null,
      promptCode: input.promptCode,
      system,
      prompt: input.payload,
      maxTokens: input.maxTokens,
      jsonMode: true,
      usageMetadata: {
        feature: 'product-planning',
        specialist: input.specialist,
      },
    });
    await this.spend.record({
      sessionId: input.sessionId,
      stage: input.stage,
      actorUserId: input.actorUserId,
      specialist: input.specialist,
      taskId: AI_TASK_ID,
      provider: result.provider,
      model: result.model,
      tokensIn: result.usage?.inputTokens ?? 0,
      tokensOut: result.usage?.outputTokens ?? 0,
      cachedTokens: result.usage?.cachedTokens ?? 0,
      cacheWriteTokens: result.usage?.cacheCreationTokens ?? 0,
    });
    return parseJsonObject<T>(result.text);
  }
}

/** Lenient: strips fences and finds the outermost object. Null when there is none. */
export function parseJsonObject<T>(text: string | null | undefined): T | null {
  if (!text) return null;
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}
