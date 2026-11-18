import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import {
  AUTOMATION_LIMITS,
  AUTOMATION_WRITE_PATHS,
  POSTHOG_EVENTS_SYSTEM_PROMPT,
} from '../constants/analytics-automation.constants';
import {
  newWriteState,
  WritePolicy,
} from '../util/analytics-automation-write-guard.util';
import { findInstrumentationViolations } from '../util/analytics-automation-instrumentation.util';
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
import {
  AnalyticsAutomationPrReviewAgent,
  PrReviewResult,
  renderReview,
} from './analytics-automation-pr-review.agent';

const schema = z.object({
  reason: z.string(),
  prTitle: z.string(),
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

/** Names of the events whose properties could carry personal data, with the culprits. */
function flagEvents(
  events: { name: string; properties: string[] }[],
): Map<string, string[]> {
  const flagged = new Map<string, string[]>();
  for (const event of events) {
    const bad = findPhiProperties(event.properties);
    if (bad.length > 0 || !EVENT_NAME.test(event.name)) {
      flagged.set(event.name, bad.length > 0 ? bad : ['(invalid event name)']);
    }
  }
  return flagged;
}

/**
 * Agent 2: decides whether code added since the last run needs new PostHog
 * events and, if so, adds them on a branch of the platform repo. It does not
 * open the pull request. The flow is:
 *
 *  1. the agent writes the events to its branch (guarded write tools: create
 *     branch, push files, confined in code to its repo, branch prefix and
 *     allowed folders);
 *  2. the review agent reads that branch and fixes what it finds, on the same
 *     branch;
 *  3. the server opens the pull request, with the review in its description.
 *
 * A branch the reviewer rejects, or whose events still carry personal-data
 * property names after the review (checked here too, in code), gets no pull
 * request: the run records why, and the branch stays on GitHub to look at.
 * Merging is a person's decision.
 */
@Injectable()
export class AnalyticsAutomationPosthogAgent {
  private readonly logger = new Logger(AnalyticsAutomationPosthogAgent.name);

  constructor(
    private readonly github: AnalyticsAutomationGithubService,
    private readonly reviewer: AnalyticsAutomationPrReviewAgent,
  ) {}

  async run(
    ctx: AutomationRunContext,
    sink: AutomationPrSink,
  ): Promise<PosthogAgentResult> {
    const branch = automationBranch(ctx.runId, 'posthog-events');
    const state = newWriteState();
    const policy: WritePolicy = {
      ...ctx.platform,
      branchPrefix: `automation/${ctx.runId.slice(0, 8)}/`,
      branch,
      allowedPrefixes: AUTOMATION_WRITE_PATHS.posthog,
      maxFiles: AUTOMATION_LIMITS.MAX_FILES_PER_PR,
      maxFileBytes: AUTOMATION_LIMITS.MAX_FILE_BYTES,
    };
    const writeTools = await this.github.guardedWriteTools(policy, state, [
      'create_branch',
      'push_files',
    ]);

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
    const written = state.branches.has(branch) && state.files.size > 0;

    // Without a pushed branch there is nothing to review or open.
    if (!written) {
      return this.notOpened(
        events,
        `**No pull request opened.** ${proposal.reason}`,
        'The agent described this event but wrote nothing to the branch.',
        proposal.reason,
      );
    }

    const eventList = (list: typeof events) =>
      list
        .map(
          (e) =>
            `- \`${e.name}\` (${e.properties.length ? e.properties.join(', ') : 'no properties'}): ${e.rationale}`,
        )
        .join('\n');

    // Review, and fix, BEFORE the pull request exists.
    const knownBefore = flagEvents(events);
    const instrumentationBefore = findInstrumentationViolations(state.contents);
    let review: PrReviewResult;
    try {
      review = await this.reviewer.review({
        kind: 'posthog',
        policy,
        state,
        branch,
        intent: `Add these PostHog events:\n${eventList(events)}`,
        knownIssues: [
          ...[...knownBefore].map(
            ([n, p]) =>
              `event \`${n}\` has properties that could carry personal or health information (${p.join(', ')}): remove them`,
          ),
          ...instrumentationBefore.blocking,
          ...instrumentationBefore.advisory,
        ],
      });
    } catch (err) {
      const why = `The review agent failed: ${err instanceof Error ? err.message : String(err)}`;
      await sink.saveReview({ verdict: null, summary: why });
      return this.notOpened(
        events,
        `**No pull request opened.** The branch \`${branch}\` was written but could not be reviewed. ${why}`,
        'The branch was written but the review failed, so no pull request was opened.',
        proposal.reason,
      );
    }
    this.logger.log(
      `Review of ${branch}: ${review.verdict}, ${review.fixed.length} fixed, ${review.remaining.length} left`,
    );

    // The events as they are on the branch after the review. Checked again in code.
    // The reviewer's list is the truth when it gives one: it may have renamed an
    // event to fit the convention, and the dbt agent must hear the new name.
    const finalEvents = review.finalEvents
      ? review.finalEvents
          .slice(0, AUTOMATION_LIMITS.MAX_EVENTS_PER_PR)
          .map((f) => {
            const original = events.find((e) => e.name === f.name);
            return {
              name: f.name,
              properties: f.properties,
              rationale:
                original?.rationale ??
                'Renamed or rewritten by the review agent.',
              files: original?.files ?? [],
            };
          })
      : knownBefore.size === 0
        ? events
        : null;
    const finalFlagged = flagEvents(
      review.finalEvents ?? (knownBefore.size === 0 ? events : []),
    );
    // The branch as it is after the review's own pushes (they share `state`).
    const instrumentation = findInstrumentationViolations(state.contents);
    const blocked =
      review.verdict === 'reject' ||
      finalEvents === null ||
      finalEvents.length === 0 ||
      finalFlagged.size > 0 ||
      instrumentation.blocking.length > 0;
    const reviewBody = renderReview(review);

    if (blocked) {
      const why =
        review.verdict === 'reject'
          ? 'the review agent rejected the branch and could not fix it'
          : finalEvents === null
            ? 'events with personal-data properties were found and the review did not report the events left on the branch'
            : finalEvents.length === 0
              ? 'the review agent removed every event, so the branch adds nothing to track'
              : finalFlagged.size > 0
                ? `events still carry properties that could hold personal or health information (${[...finalFlagged].map(([n, p]) => `${n}: ${p.join(', ')}`).join('; ')})`
                : `the events do not use the app's existing PostHog instrumentation (${instrumentation.blocking.join('; ')})`;
      await sink.saveReview({ verdict: 'reject', summary: review.summary });
      return this.notOpened(
        events,
        `**No pull request opened:** ${why}. The branch \`${branch}\` is on GitHub to look at.\n\n${reviewBody}`,
        `Not opened: ${why}.`,
        proposal.reason,
      );
    }

    const kept = finalEvents;
    const dropped = events.filter((e) => !kept.some((k) => k.name === e.name));
    const instrumentationNotes = instrumentation.advisory.length
      ? [
          '',
          '**Instrumentation notes (check these)**',
          ...instrumentation.advisory.map((note) => `- ${note}`),
        ]
      : [];
    const body = clip(
      [
        '**Events**',
        eventList(kept),
        '',
        proposal.reason,
        ...instrumentationNotes,
        '',
        reviewBody,
      ].join('\n'),
      AUTOMATION_LIMITS.MAX_BODY_CHARS,
    );
    const pr = await this.github.openPullRequest(policy, state, {
      head: branch,
      title: clip(
        proposal.prTitle.trim() || 'Add PostHog events',
        AUTOMATION_LIMITS.MAX_TITLE_CHARS,
      ),
      body,
    });
    await sink.savePullRequest({
      repo: `${ctx.platform.owner}/${ctx.platform.repo}`,
      ...pr,
    });
    await sink.saveReview({ verdict: review.verdict, summary: review.summary });

    // Every event proposed, plus any the review added or renamed into.
    const recorded = [
      ...events,
      ...kept.filter((k) => !events.some((e) => e.name === k.name)),
    ];
    const findings = recorded.map<AutomationFindingInput>((event) => {
      const gone = dropped.some((d) => d.name === event.name);
      return {
        kind: 'posthog_event',
        title: clip(event.name, 200),
        detail: gone
          ? 'Removed by the review agent before the pull request was opened.'
          : event.rationale,
        payload: {
          name: event.name,
          properties: event.properties,
          files: event.files,
        },
        fingerprint: fingerprint('posthog_event', event.name),
        status: gone ? 'dropped' : 'included',
      };
    });

    // Only events that are in the pull request are handed on to the dbt agent.
    return {
      summary: clip(
        `**Pull request opened:** ${pr.url}\n\n**Events**\n${eventList(kept)}\n\n${proposal.reason}\n\n${reviewBody}`,
        AUTOMATION_LIMITS.MAX_SUMMARY_CHARS,
      ),
      output: {
        reason: proposal.reason,
        events: kept.map((e) => ({
          name: e.name,
          properties: e.properties,
          rationale: e.rationale,
        })),
      },
      findings,
    };
  }

  /** The result when no pull request was opened: every event is recorded as dropped. */
  private notOpened(
    events: z.infer<typeof schema>['events'],
    summary: string,
    detail: string,
    reason: string,
  ): PosthogAgentResult {
    return {
      summary: clip(summary, AUTOMATION_LIMITS.MAX_SUMMARY_CHARS),
      output: { reason, events: [] },
      findings: events.map<AutomationFindingInput>((event) => ({
        kind: 'posthog_event',
        title: clip(event.name, 200),
        detail,
        payload: {
          name: event.name,
          properties: event.properties,
          files: event.files,
        },
        fingerprint: fingerprint('posthog_event', event.name),
        status: 'dropped',
      })),
    };
  }
}
