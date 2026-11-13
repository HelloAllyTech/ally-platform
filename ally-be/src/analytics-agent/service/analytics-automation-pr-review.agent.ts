import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import {
  AUTOMATION_LIMITS,
  PR_REVIEW_SYSTEM_PROMPT,
} from '../constants/analytics-automation.constants';
import { clip } from '../util/analytics-automation.util';
import { runStructuredAgent } from './analytics-automation-agent.base';
import {
  AnalyticsAutomationGithubService,
  RepoRef,
} from './analytics-automation-github.service';

const reviewSchema = z.object({
  verdict: z.enum(['approve', 'concerns', 'reject']),
  summary: z.string(),
  issues: z.array(
    z.object({
      severity: z.enum(['high', 'medium', 'low']),
      file: z.string().optional(),
      description: z.string(),
    }),
  ),
});

export type PrReviewResult = z.infer<typeof reviewSchema>;

/** What to check, per kind of pull request an automation agent opens. */
const CHECKLISTS = {
  posthog: [
    'This pull request adds PostHog product-analytics events.',
    '- Each event fires once per user action, from the right place.',
    '- It uses the code base’s existing PostHog client and naming pattern.',
    '- Properties are ids, enums, booleans and counts ONLY. Any name, email, phone, address, free text, message or transcript is a blocking issue.',
    '- Nothing else changes behaviour.',
  ],
  dbt: [
    'This pull request changes the dbt project to follow a change in the platform.',
    '- It follows the project’s layering, naming, and yml docs/tests conventions.',
    '- Every column or table it references exists in its sources.',
    '- It does not rename or drop a mart column other models or dashboards may use, unless the change says so.',
    '- It does not touch project config, CI or packages.',
  ],
} as const;

export type PrReviewKind = keyof typeof CHECKLISTS;

/**
 * The independent reviewer of the pull requests the automation agents open.
 * A fresh agent with read-only tools: it never sees how the author reasoned,
 * only the diff and what the change was meant to do. It posts its verdict on the
 * pull request as a comment and never approves or merges — a person decides.
 */
@Injectable()
export class AnalyticsAutomationPrReviewAgent {
  private readonly logger = new Logger(AnalyticsAutomationPrReviewAgent.name);

  constructor(private readonly github: AnalyticsAutomationGithubService) {}

  async review(input: {
    kind: PrReviewKind;
    repo: RepoRef;
    pullNumber: number;
    intent: string;
  }): Promise<PrReviewResult> {
    const result = await runStructuredAgent({
      label: 'pr-review',
      systemPrompt: PR_REVIEW_SYSTEM_PROMPT,
      schema: reviewSchema,
      tools: await this.github.readTools(),
      input: [
        `Review pull request #${input.pullNumber} in owner "${input.repo.owner}", repo "${input.repo.repo}".`,
        '',
        'What the change is meant to do:',
        `<intent>\n${clip(input.intent, 4_000)}\n</intent>`,
        '',
        'Checklist:',
        ...CHECKLISTS[input.kind],
      ].join('\n'),
    });
    await this.post(input.repo, input.pullNumber, result);
    return result;
  }

  private async post(
    repo: RepoRef,
    pullNumber: number,
    result: PrReviewResult,
  ): Promise<void> {
    const issues = result.issues.length
      ? result.issues
          .map(
            (i) =>
              `- **${i.severity}**${i.file ? ` \`${i.file}\`` : ''}: ${i.description}`,
          )
          .join('\n')
      : '- None.';
    const body = clip(
      [
        `### Automated review: ${result.verdict}`,
        '',
        result.summary,
        '',
        '**Issues**',
        issues,
        '',
        '_Written by the Analytics Automation review agent. It does not approve or merge; a person decides._',
      ].join('\n'),
      AUTOMATION_LIMITS.MAX_BODY_CHARS,
    );
    try {
      await this.github.commentOnPullRequest(repo, pullNumber, body);
    } catch (err) {
      // The verdict is still saved with the run; the comment is a convenience.
      this.logger.warn(
        `Could not post the review on ${repo.owner}/${repo.repo}#${pullNumber}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
