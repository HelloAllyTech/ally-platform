import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import {
  AUTOMATION_LIMITS,
  AUTOMATION_WRITE_PATHS,
  POSTHOG_EVENTS_SYSTEM_PROMPT,
} from '../constants/analytics-automation.constants';
import {
  automationBranch,
  clip,
  findPhiProperties,
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

const schema = z.object({
  reason: z.string(),
  events: z.array(
    z.object({
      name: z.string(),
      rationale: z.string(),
      properties: z.array(z.string()),
      files: z.array(z.string()),
    }),
  ),
});

/** An item the agent found, ready to be saved as a finding. */
export interface AutomationFindingInput {
  kind: 'posthog_event' | 'dbt_change';
  title: string;
  detail: string | null;
  payload: Record<string, unknown>;
  fingerprint: string;
  status: 'proposed' | 'included' | 'dropped';
}

export interface PosthogAgentResult {
  summary: string;
  output: Record<string, unknown>;
  findings: AutomationFindingInput[];
}

/** An event name is a short identifier-like string, not a sentence. */
const EVENT_NAME = /^[\w .:-]{2,80}$/;

/**
 * Agent 2: decides whether code added since the last run needs new PostHog
 * events and, if so, adds them in a pull request against the platform repo.
 *
 * The agent holds GitHub's write tools (create branch, push files, open pull
 * request), each wrapped by a guard that refuses, in code, anything outside its
 * repo, branch prefix and allowed folders. It opens the pull request without
 * waiting for anyone; a separate review agent then reads it. Merging is a
 * person's decision.
 *
 * What the guard cannot see is the meaning of a property, so the events the
 * agent reports are checked afterwards for personal-data property names. A pull
 * request that fails that check stays open (it is already on GitHub) but is
 * flagged loudly: a comment on the PR and a `reject` verdict.
 */
@Injectable()
export class AnalyticsAutomationPosthogAgent {
  constructor(
    private readonly github: AnalyticsAutomationGithubService,
    private readonly reviewer: AnalyticsAutomationPrReviewAgent,
  ) {}

  async run(
    ctx: AutomationRunContext,
    sink: AutomationPrSink,
  ): Promise<PosthogAgentResult> {
    const branch = automationBranch(ctx.runId, 'posthog-events');
    const opened: { pr?: { number: number; url: string } } = {};

    const writeTools = await this.github.guardedWriteTools(
      {
        ...ctx.platform,
        branchPrefix: `automation/${ctx.runId.slice(0, 8)}/`,
        allowedPrefixes: AUTOMATION_WRITE_PATHS.posthog,
        maxFiles: AUTOMATION_LIMITS.MAX_FILES_PER_PR,
        maxFileBytes: AUTOMATION_LIMITS.MAX_FILE_BYTES,
      },
      async (pr) => {
        opened.pr = pr;
        await sink.savePullRequest({
          repo: `${ctx.platform.owner}/${ctx.platform.repo}`,
          ...pr,
        });
      },
    );

    const proposal = await runStructuredAgent({
      label: 'posthog-events',
      systemPrompt: POSTHOG_EVENTS_SYSTEM_PROMPT,
      schema,
      tools: [...(await this.github.readTools()), ...writeTools],
      input: [
        describePlatformPeriod(ctx),
        `dbt repo (for the event catalog seeds): owner "${ctx.dbt.owner}", repo "${ctx.dbt.repo}" (default branch "${ctx.dbt.base}").`,
        '',
        `Write to the platform repo only: owner "${ctx.platform.owner}", repo "${ctx.platform.repo}".`,
        `Your branch: "${branch}". Pull request base: "${ctx.platform.base}".`,
      ].join('\n'),
    });

    const events = proposal.events.slice(
      0,
      AUTOMATION_LIMITS.MAX_EVENTS_PER_PR,
    );
    const pr = opened.pr;

    // Events the agent reported, checked for personal-data property names.
    const flagged = new Map<string, string[]>();
    for (const event of events) {
      const bad = findPhiProperties(event.properties);
      if (bad.length > 0 || !EVENT_NAME.test(event.name)) {
        flagged.set(
          event.name,
          bad.length > 0 ? bad : ['(invalid event name)'],
        );
      }
    }

    const findings = events.map<AutomationFindingInput>((event) => {
      const problem = flagged.get(event.name);
      return {
        kind: 'posthog_event',
        title: clip(event.name, 200),
        detail: problem
          ? `Flagged, do not merge as it is: properties that could carry personal or health information (${problem.join(', ')}).`
          : pr
            ? event.rationale
            : 'The agent described this event but opened no pull request.',
        payload: {
          name: event.name,
          properties: event.properties,
          files: event.files,
        },
        fingerprint: fingerprint('posthog_event', event.name),
        status: problem || !pr ? 'dropped' : 'included',
      };
    });

    if (!pr) {
      return {
        summary: clip(
          `**No pull request opened.** ${proposal.reason}`,
          AUTOMATION_LIMITS.MAX_SUMMARY_CHARS,
        ),
        output: { reason: proposal.reason, events: [] },
        findings,
      };
    }

    const eventList = events
      .map(
        (e) =>
          `- \`${e.name}\` (${e.properties.length ? e.properties.join(', ') : 'no properties'}): ${e.rationale}`,
      )
      .join('\n');

    if (flagged.size > 0) {
      const warning = `**Automated check failed.** These events have properties that could carry personal or health information: ${[...flagged].map(([n, p]) => `\`${n}\` (${p.join(', ')})`).join('; ')}. Do not merge until they are removed.`;
      await this.github
        .commentOnPullRequest(ctx.platform, pr.number, warning)
        .catch(() => undefined);
      await sink.saveReview({ verdict: 'reject', summary: warning });
    } else {
      try {
        const review = await this.reviewer.review({
          kind: 'posthog',
          repo: ctx.platform,
          pullNumber: pr.number,
          intent: `Add these PostHog events:\n${eventList}`,
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
    }

    // Only events that passed the check are handed on to the dbt agent.
    const merged = events.filter((e) => !flagged.has(e.name));
    return {
      summary: clip(
        `**Pull request opened:** ${pr.url}\n\n**Events**\n${eventList}\n\n${proposal.reason}`,
        AUTOMATION_LIMITS.MAX_SUMMARY_CHARS,
      ),
      output: {
        reason: proposal.reason,
        events: merged.map((e) => ({
          name: e.name,
          properties: e.properties,
          rationale: e.rationale,
        })),
      },
      findings,
    };
  }
}
