import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import {
  AUTOMATION_LIMITS,
  AUTOMATION_WRITE_PATHS,
  DBT_ANALYSIS_SYSTEM_PROMPT,
  DBT_CHANGES_SYSTEM_PROMPT,
} from '../constants/analytics-automation.constants';
import {
  automationBranch,
  clip,
  fingerprint,
} from '../util/analytics-automation.util';
import {
  AutomationPrSink,
  AutomationRunContext,
  describePlatformPeriod,
  runStructuredAgent,
} from './analytics-automation-agent.base';
import { AnalyticsAutomationGithubService } from './analytics-automation-github.service';
import { AnalyticsAutomationPrReviewAgent } from './analytics-automation-pr-review.agent';
import type { AutomationFindingInput } from './analytics-automation-posthog.agent';

const analysisSchema = z.object({
  needsChanges: z.boolean(),
  summary: z.string(),
  items: z.array(
    z.object({
      key: z.string(),
      kind: z.enum([
        'new_event',
        'new_source_table',
        'new_column',
        'enum_change',
        'definition_change',
        'other',
      ]),
      title: z.string(),
      description: z.string(),
      dbtFiles: z.array(z.string()),
      sourcePaths: z.array(z.string()),
    }),
  ),
});

const changesSchema = z.object({
  summary: z.string(),
  skipped: z.array(z.object({ key: z.string(), reason: z.string() })),
});

/** An event that was merged this week, as the dbt agent is told about it. */
export interface MergedEvent {
  name: string;
  properties: string[];
  rationale: string;
}

/** One proposed dbt change, as stored on the agent run for the approver. */
export type DbtProposalItem = z.infer<typeof analysisSchema>['items'][number];

export interface DbtAnalysisResult {
  summary: string;
  needsChanges: boolean;
  items: DbtProposalItem[];
  findings: AutomationFindingInput[];
}

export interface DbtApplyResult {
  summary: string;
  pr: { number: number; url: string } | null;
  skipped: { key: string; reason: string }[];
}

/**
 * Agent 3: works out what Ally's dbt project needs because of how the platform
 * changed (`analyse`), and — only after a person approves that proposal —
 * makes those changes in the dbt repo as a pull request (`apply`).
 *
 * Like the PostHog agent, it holds guarded GitHub write tools (confined in code
 * to the dbt repo, an `automation/` branch and the dbt folders). Nothing is
 * edited before approval.
 */
@Injectable()
export class AnalyticsAutomationDbtAgent {
  constructor(
    private readonly github: AnalyticsAutomationGithubService,
    private readonly reviewer: AnalyticsAutomationPrReviewAgent,
  ) {}

  async analyse(
    ctx: AutomationRunContext,
    input: {
      /** Events merged this week, or null when none are to be considered. */
      events: MergedEvent[] | null;
      /** Keys of items a person already rejected: do not raise them again. */
      rejectedKeys: string[];
    },
  ): Promise<DbtAnalysisResult> {
    const events = input.events?.length
      ? [
          'These PostHog events were merged and are now in the code:',
          ...input.events.map(
            (e) =>
              `- ${e.name} (${e.properties.join(', ') || 'no properties'}): ${e.rationale}`,
          ),
        ].join('\n')
      : 'No new PostHog events are to be considered this week.';
    const rejected = input.rejectedKeys.length
      ? `Already rejected by a person, do not propose again:\n${input.rejectedKeys.map((k) => `- ${k}`).join('\n')}`
      : 'Nothing has been rejected before.';

    const result = await runStructuredAgent({
      label: 'dbt-analysis',
      systemPrompt: DBT_ANALYSIS_SYSTEM_PROMPT,
      schema: analysisSchema,
      tools: await this.github.readTools(),
      input: [
        describePlatformPeriod(ctx),
        `dbt repo: owner "${ctx.dbt.owner}", repo "${ctx.dbt.repo}" (default branch "${ctx.dbt.base}", head ${ctx.shas.dbt.head}).`,
        '',
        events,
        '',
        rejected,
      ].join('\n'),
    });

    // The model was told, but the server enforces it.
    const rejectedPrints = new Set(
      input.rejectedKeys.map((key) => fingerprint('dbt_change', key)),
    );
    const items = result.items.filter(
      (item) => !rejectedPrints.has(fingerprint('dbt_change', item.key)),
    );
    const needsChanges = result.needsChanges && items.length > 0;

    return {
      summary: clip(result.summary, AUTOMATION_LIMITS.MAX_SUMMARY_CHARS),
      needsChanges,
      items: needsChanges ? items : [],
      findings: needsChanges
        ? items.map((item) => ({
            kind: 'dbt_change' as const,
            title: clip(item.title, 200),
            detail: item.description,
            payload: {
              key: item.key,
              kind: item.kind,
              dbtFiles: item.dbtFiles,
              sourcePaths: item.sourcePaths,
            },
            fingerprint: fingerprint('dbt_change', item.key),
            status: 'proposed' as const,
          }))
        : [],
    };
  }

  async apply(
    ctx: AutomationRunContext,
    items: DbtProposalItem[],
    sink: AutomationPrSink,
  ): Promise<DbtApplyResult> {
    const approved = items
      .map(
        (item) =>
          `- [${item.key}] ${item.title}: ${item.description} (dbt files: ${item.dbtFiles.join(', ') || 'unknown'}; platform files: ${item.sourcePaths.join(', ') || 'unknown'})`,
      )
      .join('\n');
    const branch = automationBranch(ctx.runId, 'dbt-changes');
    const opened: { pr?: { number: number; url: string } } = {};

    const writeTools = await this.github.guardedWriteTools(
      {
        ...ctx.dbt,
        branchPrefix: `automation/${ctx.runId.slice(0, 8)}/`,
        allowedPrefixes: AUTOMATION_WRITE_PATHS.dbt,
        maxFiles: AUTOMATION_LIMITS.MAX_FILES_PER_PR,
        maxFileBytes: AUTOMATION_LIMITS.MAX_FILE_BYTES,
      },
      async (pr) => {
        opened.pr = pr;
        await sink.savePullRequest({
          repo: `${ctx.dbt.owner}/${ctx.dbt.repo}`,
          ...pr,
        });
      },
    );

    const authored = await runStructuredAgent({
      label: 'dbt-changes',
      systemPrompt: DBT_CHANGES_SYSTEM_PROMPT,
      schema: changesSchema,
      tools: [...(await this.github.readTools()), ...writeTools],
      input: [
        `Write to the dbt repo only: owner "${ctx.dbt.owner}", repo "${ctx.dbt.repo}".`,
        `Your branch: "${branch}". Pull request base: "${ctx.dbt.base}".`,
        `Platform repo (read-only, for the source code the items refer to): owner "${ctx.platform.owner}", repo "${ctx.platform.repo}".`,
        '',
        'Approved items:',
        approved,
      ].join('\n'),
    });

    const skippedNote = authored.skipped.length
      ? '\n\n**Not done**\n' +
        authored.skipped.map((s) => `- \`${s.key}\` — ${s.reason}`).join('\n')
      : '';
    const pr = opened.pr;
    if (!pr) {
      return {
        summary: clip(
          `**No pull request opened.** ${authored.summary}${skippedNote}`,
          AUTOMATION_LIMITS.MAX_SUMMARY_CHARS,
        ),
        pr: null,
        skipped: authored.skipped,
      };
    }

    try {
      const review = await this.reviewer.review({
        kind: 'dbt',
        repo: ctx.dbt,
        pullNumber: pr.number,
        intent: `Make these approved changes to dbt:\n${approved}`,
      });
      await sink.saveReview({
        verdict: review.verdict,
        summary: review.summary,
      });
    } catch (err) {
      await sink.saveReview({
        verdict: null,
        summary: `The review agent failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    return {
      summary: clip(
        `**Pull request opened:** ${pr.url}\n\n${authored.summary}${skippedNote}`,
        AUTOMATION_LIMITS.MAX_SUMMARY_CHARS,
      ),
      pr,
      skipped: authored.skipped,
    };
  }
}
