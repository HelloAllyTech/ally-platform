import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import {
  AUTOMATION_LIMITS,
  AUTOMATION_WRITE_PATHS,
  DBT_BUILD_LABEL,
  DBT_ANALYSIS_SYSTEM_PROMPT,
  DBT_CHANGES_SYSTEM_PROMPT,
  DBT_CI_FIX_SYSTEM_PROMPT,
} from '../constants/analytics-automation.constants';
import {
  newWriteState,
  WritePolicy,
  WriteState,
} from '../util/analytics-automation-write-guard.util';
import {
  automationBranch,
  CheckRun,
  clip,
  evaluateChecks,
  filesNeedDbtBuild,
  fingerprint,
} from '../util/analytics-automation.util';
import {
  AutomationCiProgress,
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
import type { AutomationFindingInput } from './analytics-automation-posthog.agent';

const itemSchema = z.object({
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
  steps: z.array(z.string()),
  dbtFiles: z.array(z.string()),
  sourcePaths: z.array(z.string()),
});

const analysisSchema = z.object({
  needsChanges: z.boolean(),
  summary: z.string(),
  definitionChanges: z.array(
    z.object({
      area: z.enum(['database', 'metric_definition', 'enum', 'other']),
      title: z.string(),
      description: z.string(),
      sourcePaths: z.array(z.string()),
      affectsDbt: z.boolean(),
    }),
  ),
  items: z.array(itemSchema),
});

const ciFixSchema = z.object({
  fixable: z.boolean(),
  summary: z.string(),
  reason: z.string(),
});

const changesSchema = z.object({
  summary: z.string(),
  prTitle: z.string(),
  skipped: z.array(z.object({ key: z.string(), reason: z.string() })),
  /** Merging needs a `dbt build` (see DBT_CHANGES_SYSTEM_PROMPT). */
  needsBuild: z.boolean(),
  buildReason: z.string(),
});

/** Whether the pull request needs a rebuild, and whether it got the label. */
interface BuildLabel {
  needed: boolean;
  labelled: boolean;
  note: string;
}

/** An event the PostHog agent put in its pull request, as the dbt agent is told about it. */
export interface ProposedEvent {
  name: string;
  properties: string[];
  rationale: string;
}

/** The PostHog agent's pull request, as the dbt agent is told about it. */
export interface PosthogPrInfo {
  number: number;
  url: string;
  state: 'open' | 'merged' | 'closed';
}

/** What changed in the platform, for the "Metrics / Definition changes" section. */
export type DefinitionChange = z.infer<
  typeof analysisSchema
>['definitionChanges'][number];

/**
 * One step of the dbt plan, as stored on the agent run for the approver.
 * `dependsOnPosthog` is set by the server, not the model: the item exists only
 * because of the PostHog events, so it is applied only if their pull request is
 * merged, and left out if it is closed.
 */
export type DbtProposalItem = z.infer<typeof itemSchema> & {
  dependsOnPosthog: boolean;
};

export interface DbtAnalysisResult {
  summary: string;
  needsChanges: boolean;
  definitionChanges: DefinitionChange[];
  items: DbtProposalItem[];
  findings: AutomationFindingInput[];
}

export interface DbtApplyResult {
  summary: string;
  pr: { number: number; url: string } | null;
  skipped: { key: string; reason: string }[];
  /** Where the pull request's CI ended up; null when no pull request was opened. */
  ci: AutomationCiProgress | null;
}

/** What one wait for CI came to. */
type CiWait =
  | { state: 'green' }
  | { state: 'none' }
  | { state: 'timeout'; pending: string[] }
  | { state: 'failed'; failed: CheckRun[] };

/** Whether a plan item is applied given what became of the PostHog pull request. */
export function itemApplies(
  item: Pick<DbtProposalItem, 'dependsOnPosthog'>,
  withEvents: boolean,
): boolean {
  return withEvents || !item.dependsOnPosthog;
}

/**
 * Agent 3: works out what changed in the platform and what Ally's dbt project
 * needs because of it (`analyse`: read-only, runs at the end of the weekly run,
 * before any approval), and — only after a person approves that plan and the
 * PostHog pull request is resolved — makes those changes in the dbt repo
 * (`apply`).
 *
 * Like the PostHog agent, `apply` writes to a branch with guarded GitHub tools
 * (confined in code to the dbt repo, an `automation/` branch and the dbt
 * folders), the review agent then reads the branch and fixes what it finds, and
 * only then is the pull request opened. A branch the reviewer rejects gets no
 * pull request. Nothing is edited before approval.
 */
@Injectable()
export class AnalyticsAutomationDbtAgent {
  private readonly logger = new Logger(AnalyticsAutomationDbtAgent.name);

  constructor(
    private readonly github: AnalyticsAutomationGithubService,
    private readonly reviewer: AnalyticsAutomationPrReviewAgent,
  ) {}

  async analyse(
    ctx: AutomationRunContext,
    input: {
      /** Events in the PostHog agent's pull request; empty when it opened none. */
      events: ProposedEvent[];
      posthogPr: PosthogPrInfo | null;
      /** Keys of items a person already rejected: do not raise them again. */
      rejectedKeys: string[];
    },
  ): Promise<DbtAnalysisResult> {
    const events = input.events.length
      ? [
          `The PostHog agent proposed these events in ${input.posthogPr ? `pull request #${input.posthogPr.number} (${input.posthogPr.state})` : 'a pull request'}. It may still be merged or closed:`,
          ...input.events.map(
            (e) =>
              `- ${e.name} (${e.properties.join(', ') || 'no properties'}): ${e.rationale}`,
          ),
        ].join('\n')
      : 'The PostHog agent proposed no events this week, so plan nothing of kind new_event.';
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
    const items: DbtProposalItem[] = result.items
      .filter(
        (item) => !rejectedPrints.has(fingerprint('dbt_change', item.key)),
      )
      // Event items only make sense when the PostHog agent proposed events.
      .filter((item) => item.kind !== 'new_event' || input.events.length > 0)
      .map((item) => ({
        ...item,
        dependsOnPosthog: item.kind === 'new_event',
      }));
    const needsChanges = result.needsChanges && items.length > 0;

    return {
      summary: clip(result.summary, AUTOMATION_LIMITS.MAX_SUMMARY_CHARS),
      needsChanges,
      definitionChanges: result.definitionChanges
        .slice(0, AUTOMATION_LIMITS.MAX_DEFINITION_CHANGES)
        .map((change) => ({
          ...change,
          title: clip(change.title, 200),
          description: clip(change.description, 2_000),
        })),
      items: needsChanges ? items : [],
      findings: needsChanges
        ? items.map((item) => ({
            kind: 'dbt_change' as const,
            title: clip(item.title, 200),
            detail: item.description,
            payload: {
              key: item.key,
              kind: item.kind,
              steps: item.steps,
              dbtFiles: item.dbtFiles,
              sourcePaths: item.sourcePaths,
              dependsOnPosthog: item.dependsOnPosthog,
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
    opts: {
      /**
       * 1 for the first try after approval. A retry gets its own branch: the
       * earlier one exists on GitHub, cannot be created again, and may hold
       * files this try knows nothing about.
       */
      attempt?: number;
      /** Set when the PostHog events pull request was merged. */
      mergedPosthogPr?: PosthogPrInfo | null;
    } = {},
  ): Promise<DbtApplyResult> {
    const approved = items
      .map(
        (item) =>
          `- [${item.key}] ${item.title}: ${item.description}${item.steps.length ? ` Steps: ${item.steps.join('; ')}.` : ''} (dbt files: ${item.dbtFiles.join(', ') || 'unknown'}; platform files: ${item.sourcePaths.join(', ') || 'unknown'})`,
      )
      .join('\n');
    const attempt = opts.attempt ?? 1;
    const branch = automationBranch(
      ctx.runId,
      attempt > 1 ? `dbt-changes-${attempt}` : 'dbt-changes',
    );
    const merged = opts.mergedPosthogPr;
    // The plan was made while that pull request was open; a person may have
    // renamed or dropped events before merging it. What merged is the truth.
    const posthogNote =
      merged && items.some((item) => item.dependsOnPosthog)
        ? [
            '',
            `The PostHog events pull request #${merged.number} (${merged.url}) in the platform repo was MERGED. The items of kind new_event come from it, but it may have changed after the plan was made: read its files (\`pull_request_read\` with method \`get_files\`, or the files on the platform default branch) and use the event and property names exactly as merged. Leave out, under \`skipped\`, an event that is not in it.`,
          ]
        : [];
    const state = newWriteState();
    const policy: WritePolicy = {
      ...ctx.dbt,
      branchPrefix: `automation/${ctx.runId.slice(0, 8)}/`,
      branch,
      allowedPrefixes: AUTOMATION_WRITE_PATHS.dbt,
      maxFiles: AUTOMATION_LIMITS.MAX_FILES_PER_PR,
      maxFileBytes: AUTOMATION_LIMITS.MAX_FILE_BYTES,
    };
    const writeTools = await this.github.guardedWriteTools(policy, state, [
      'create_branch',
      'push_files',
    ]);

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
        ...posthogNote,
      ].join('\n'),
    });

    const skippedNote = authored.skipped.length
      ? '\n\n**Not done**\n' +
        authored.skipped.map((s) => `- \`${s.key}\` — ${s.reason}`).join('\n')
      : '';
    const written = state.branches.has(branch) && state.files.size > 0;
    if (!written) {
      return {
        summary: clip(
          `**No pull request opened.** ${authored.summary}${skippedNote}`,
          AUTOMATION_LIMITS.MAX_SUMMARY_CHARS,
        ),
        pr: null,
        skipped: authored.skipped,
        ci: null,
      };
    }

    // Review, and fix, BEFORE the pull request exists.
    let review: PrReviewResult;
    try {
      review = await this.reviewer.review({
        kind: 'dbt',
        policy,
        state,
        branch,
        intent: `Make these approved changes to dbt:\n${approved}`,
      });
    } catch (err) {
      const why = `The review agent failed: ${err instanceof Error ? err.message : String(err)}`;
      await sink.saveReview({ verdict: null, summary: why });
      return {
        summary: clip(
          `**No pull request opened.** The branch \`${branch}\` was written but could not be reviewed. ${why}\n\n${authored.summary}${skippedNote}`,
          AUTOMATION_LIMITS.MAX_SUMMARY_CHARS,
        ),
        pr: null,
        skipped: authored.skipped,
        ci: null,
      };
    }
    this.logger.log(
      `Review of ${branch}: ${review.verdict}, ${review.fixed.length} fixed, ${review.remaining.length} left`,
    );
    const reviewBody = renderReview(review);
    await sink.saveReview({ verdict: review.verdict, summary: review.summary });

    if (review.verdict === 'reject') {
      return {
        summary: clip(
          `**No pull request opened:** the review agent rejected the branch and could not fix it. The branch \`${branch}\` is on GitHub to look at.\n\n${reviewBody}\n\n${authored.summary}${skippedNote}`,
          AUTOMATION_LIMITS.MAX_SUMMARY_CHARS,
        ),
        pr: null,
        skipped: authored.skipped,
        ci: null,
      };
    }

    const pr = await this.github.openPullRequest(policy, state, {
      head: branch,
      title: clip(
        authored.prTitle.trim() || 'dbt changes for platform updates',
        AUTOMATION_LIMITS.MAX_TITLE_CHARS,
      ),
      body: clip(
        `${authored.summary}${skippedNote}\n\n${reviewBody}`,
        AUTOMATION_LIMITS.MAX_BODY_CHARS,
      ),
    });
    await sink.savePullRequest({
      repo: `${ctx.dbt.owner}/${ctx.dbt.repo}`,
      ...pr,
    });

    // Labelled before CI is watched, so the label is there whenever a person
    // merges, even mid-watch. The files decide as well as the author: a model's
    // SQL or a seed always needs a build.
    const repo = { owner: ctx.dbt.owner, repo: ctx.dbt.repo };
    let build: BuildLabel = { needed: false, labelled: false, note: '' };
    if (authored.needsBuild || filesNeedDbtBuild(state.files)) {
      build = await this.labelForBuild(repo, pr.number, {
        fresh: true,
        reason: authored.buildReason,
      });
    }

    // The pull request's CI runs now. Watch it, and fix the branch if it fails.
    const ci = await this.ensureCi({
      ctx,
      policy,
      state,
      branch,
      pr,
      sink,
      intent: approved,
    });

    // A CI fix can touch a model's SQL that the first push did not.
    if (!build.needed && filesNeedDbtBuild(state.files)) {
      build = await this.labelForBuild(repo, pr.number, {
        fresh: false,
        reason: 'A CI fix changed model SQL or a seed.',
      });
    }

    return {
      summary: clip(
        `**Pull request opened:** ${pr.url}\n\n**CI:** ${ci.message}\n\n**dbt build:** ${build.needed ? build.note : `not needed (${authored.buildReason || 'docs or tests only'}), so no \`${DBT_BUILD_LABEL}\` label.`}\n\n${authored.summary}${skippedNote}\n\n${reviewBody}`,
        AUTOMATION_LIMITS.MAX_SUMMARY_CHARS,
      ),
      pr,
      skipped: authored.skipped,
      ci,
    };
  }

  /** Waits between two reads of CI. A method of its own so tests need not wait. */
  protected pause(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Makes sure the pull request's CI passes. Waits for the checks; when one
   * fails, the CI fixer reads its logs and pushes a fix to the SAME branch, and
   * the wait starts again on the new commit. Gives up after
   * CI_MAX_FIX_ATTEMPTS fixes, or at once when the failure is not one it can
   * fix. It never rejects: the pull request is already open, so a problem here
   * is reported on the run, not thrown.
   */
  private async ensureCi(input: {
    ctx: AutomationRunContext;
    policy: WritePolicy;
    state: WriteState;
    branch: string;
    pr: { number: number; url: string };
    sink: AutomationPrSink;
    intent: string;
  }): Promise<AutomationCiProgress> {
    const { ctx, policy, state, branch, pr, sink } = input;
    const repo = { owner: ctx.dbt.owner, repo: ctx.dbt.repo };
    const max = AUTOMATION_LIMITS.CI_MAX_FIX_ATTEMPTS;
    let attempts = 0;
    let expectedHead: string | null = null;

    const finish = async (
      state: AutomationCiProgress['state'],
      message: string,
      failedChecks: string[] = [],
    ): Promise<AutomationCiProgress> => {
      const progress = { state, attempts, message, failedChecks };
      await sink.saveCi(progress).catch(() => undefined);
      this.logger.log(`CI for #${pr.number}: ${state}. ${message}`);
      return progress;
    };

    try {
      for (;;) {
        await sink.saveCi({
          state: 'running',
          attempts,
          message:
            attempts === 0
              ? `Waiting for CI on pull request #${pr.number}.`
              : `Waiting for CI again after fix ${attempts} of ${max}.`,
          failedChecks: [],
        });
        const waited = await this.waitForChecks(repo, pr.number, expectedHead);

        if (waited.state === 'green') {
          return finish(
            'green',
            attempts === 0
              ? 'All checks passed.'
              : `All checks passed after ${attempts} fix${attempts === 1 ? '' : 'es'}.`,
          );
        }
        if (waited.state === 'none') {
          return finish(
            'none',
            'No CI checks ran on this pull request, so there is nothing to wait for.',
          );
        }
        if (waited.state === 'timeout') {
          return finish(
            'timeout',
            `CI did not finish in ${Math.round(AUTOMATION_LIMITS.CI_WAIT_MS / 60_000)} minutes (still running: ${waited.pending.join(', ')}).`,
          );
        }

        const failedNames = waited.failed.map((run) => run.name);
        if (attempts >= max) {
          return finish(
            'failed',
            `CI is still failing after ${attempts} fix attempt${attempts === 1 ? '' : 's'}: ${failedNames.join(', ')}.`,
            failedNames,
          );
        }
        // Do not push to a branch whose pull request is already merged or closed.
        if (
          (await this.github.getPullRequestState(repo, pr.number)).state !==
          'open'
        ) {
          return finish(
            'stopped',
            'The pull request was merged or closed while CI was being watched.',
            failedNames,
          );
        }

        attempts += 1;
        await sink.saveCi({
          state: 'fixing',
          attempts,
          message: `CI failed (${failedNames.join(', ')}). Working on a fix, attempt ${attempts} of ${max}.`,
          failedChecks: failedNames,
        });
        const before = await this.github.getBranchHead(repo, branch);
        const fix = await this.fixCi({
          ctx,
          policy,
          state,
          branch,
          prNumber: pr.number,
          failed: waited.failed,
          attempt: attempts,
          intent: input.intent,
        });
        const after = await this.github.getBranchHead(repo, branch);

        if (after === before) {
          await this.comment(
            repo,
            pr.number,
            `**CI failed and the agent did not change the branch.**\n\nFailed: ${failedNames.join(', ')}\n\n${clip(fix.reason || fix.summary, 1_500)}`,
          );
          return finish(
            'failed',
            `CI failed (${failedNames.join(', ')}) and the agent could not fix it: ${clip(fix.reason || fix.summary || 'no reason given', 300)}`,
            failedNames,
          );
        }
        await this.comment(
          repo,
          pr.number,
          `**CI failed** (${failedNames.join(', ')}). **Fix ${attempts} of ${max} pushed** (\`${after.slice(0, 7)}\`):\n\n${clip(fix.summary, 3_000)}`,
        );
        expectedHead = after;
      }
    } catch (err) {
      return finish(
        'unreadable',
        `Could not read or fix CI: ${clip(err instanceof Error ? err.message : String(err), 300)}. The pull request is open; check its CI by hand. (The GitHub App needs permission to read checks and Actions.)`,
      );
    }
  }

  /**
   * One wait for the pull request's checks to finish. After a fix has been
   * pushed (`expectedHead`) it first waits for the pull request to point at that
   * commit, so a result left over from the commit before is never read as the
   * answer. Counted in polls, not by the clock.
   */
  private async waitForChecks(
    repo: { owner: string; repo: string },
    prNumber: number,
    expectedHead: string | null,
  ): Promise<CiWait> {
    const polls = Math.max(
      1,
      Math.ceil(AUTOMATION_LIMITS.CI_WAIT_MS / AUTOMATION_LIMITS.CI_POLL_MS),
    );
    const noChecksPolls = Math.max(
      1,
      Math.ceil(
        AUTOMATION_LIMITS.CI_NO_CHECKS_GRACE_MS / AUTOMATION_LIMITS.CI_POLL_MS,
      ),
    );
    let noChecks = 0;
    let pending: string[] = [];

    for (let poll = 0; poll < polls; poll++) {
      if (poll > 0 || expectedHead)
        await this.pause(AUTOMATION_LIMITS.CI_POLL_MS);
      if (
        expectedHead &&
        (await this.github.getPullRequestHead(repo, prNumber)) !== expectedHead
      ) {
        continue;
      }
      const verdict = evaluateChecks(
        await this.github.getCheckRuns(repo, prNumber),
      );
      if (verdict.state === 'green') return { state: 'green' };
      if (verdict.state === 'failed') {
        return { state: 'failed', failed: verdict.failed };
      }
      if (verdict.state === 'none') {
        // Checks register a moment after a push; only a long silence means no CI.
        noChecks += 1;
        if (noChecks >= noChecksPolls) return { state: 'none' };
      } else {
        noChecks = 0;
        pending = verdict.pending;
      }
    }
    return { state: 'timeout', pending };
  }

  /** The CI fixer: reads the failed jobs' logs and pushes a fix to the same branch. */
  private async fixCi(input: {
    ctx: AutomationRunContext;
    policy: WritePolicy;
    state: WriteState;
    branch: string;
    prNumber: number;
    failed: CheckRun[];
    attempt: number;
    intent: string;
  }): Promise<z.infer<typeof ciFixSchema>> {
    const { ctx, policy, state, branch } = input;
    const writeTools = await this.github.guardedWriteTools(policy, state, [
      'push_files',
    ]);
    return runStructuredAgent({
      label: 'dbt-ci-fix',
      systemPrompt: DBT_CI_FIX_SYSTEM_PROMPT,
      schema: ciFixSchema,
      tools: [...(await this.github.readTools()), ...writeTools],
      input: [
        `dbt repo: owner "${ctx.dbt.owner}", repo "${ctx.dbt.repo}". Pull request #${input.prNumber}, branch "${branch}", base "${ctx.dbt.base}".`,
        `Fix attempt ${input.attempt} of ${AUTOMATION_LIMITS.CI_MAX_FIX_ATTEMPTS}.`,
        `Platform repo (read-only, for the source the changes refer to): owner "${ctx.platform.owner}", repo "${ctx.platform.repo}".`,
        '',
        'Failed checks (id is the job_id for get_job_logs):',
        ...input.failed.map(
          (run) =>
            `- id ${run.id}: ${run.name} (${run.conclusion ?? 'no conclusion'})${run.url ? ` ${run.url}` : ''}`,
        ),
        '',
        'What the pull request was meant to do:',
        `<intent>\n${clip(input.intent, 4_000)}\n</intent>`,
      ].join('\n'),
    });
  }

  /**
   * Puts the `dbt-build` label on the pull request. Never throws: the pull
   * request is open either way; when GitHub refuses, a comment asks a person to
   * add the label so merging it still rebuilds the models.
   */
  private async labelForBuild(
    repo: { owner: string; repo: string },
    prNumber: number,
    opts: { fresh: boolean; reason: string },
  ): Promise<BuildLabel> {
    try {
      await this.github.addPullRequestLabel(repo, prNumber, DBT_BUILD_LABEL, {
        fresh: opts.fresh,
      });
      return {
        needed: true,
        labelled: true,
        note: `needed (${opts.reason || 'model SQL or seeds changed'}); labelled \`${DBT_BUILD_LABEL}\`.`,
      };
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Could not label ${repo.owner}/${repo.repo}#${prNumber} "${DBT_BUILD_LABEL}": ${why}`,
      );
      await this.comment(
        repo,
        prNumber,
        `**This pull request needs a \`dbt build\` once merged**, but the agent could not add the \`${DBT_BUILD_LABEL}\` label. Please add it before merging.`,
      );
      return {
        needed: true,
        labelled: false,
        note: `needed, but the \`${DBT_BUILD_LABEL}\` label could not be added (${clip(why, 200)}). Add it by hand before merging.`,
      };
    }
  }

  /** A comment on the pull request. Never throws: it is for the reader, not the run. */
  private async comment(
    repo: { owner: string; repo: string },
    prNumber: number,
    body: string,
  ): Promise<void> {
    try {
      await this.github.commentOnPullRequest(repo, prNumber, body);
    } catch (err) {
      this.logger.warn(
        `Could not comment on ${repo.owner}/${repo.repo}#${prNumber}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
