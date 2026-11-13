import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import {
  AUTOMATION_LIMITS,
  BACKEND_REVIEW_SYSTEM_PROMPT,
} from '../constants/analytics-automation.constants';
import { clip } from '../util/analytics-automation.util';
import {
  AutomationRunContext,
  describePlatformPeriod,
  runStructuredAgent,
} from './analytics-automation-agent.base';
import { AnalyticsAutomationGithubService } from './analytics-automation-github.service';

const schema = z.object({
  summary: z.string(),
  highlights: z.array(
    z.object({
      area: z.string(),
      change: z.string(),
      risk: z.string().optional(),
    }),
  ),
  commitCount: z.number(),
});

export interface BackendReviewResult {
  summary: string;
  output: Record<string, unknown>;
}

/** Agent 1: describes how `ally-be` changed since the last run. Changes nothing. */
@Injectable()
export class AnalyticsAutomationBackendReviewAgent {
  constructor(private readonly github: AnalyticsAutomationGithubService) {}

  async run(ctx: AutomationRunContext): Promise<BackendReviewResult> {
    const result = await runStructuredAgent({
      systemPrompt: BACKEND_REVIEW_SYSTEM_PROMPT,
      schema,
      tools: await this.github.readTools(),
      input: describePlatformPeriod(ctx),
    });
    return {
      summary: clip(result.summary, AUTOMATION_LIMITS.MAX_SUMMARY_CHARS),
      output: {
        highlights: result.highlights,
        commitCount: result.commitCount,
      },
    };
  }
}
