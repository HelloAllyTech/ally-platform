import { restrictBundleToProviders } from '../util/debrief-provider-allowlist.util';
import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppConfigService } from '../../config/config.service';
import { LoggerService } from '../../logger/logger.service';
import { AgentReleaseService } from '../../llm-agent/harness/release/agent-release.service';
import { AgentRelease } from '../../llm-agent/entity/agent-release.entity';
import { DebriefChangeHoldsService } from './debrief-change-holds.service';
import { withPinnedPrompts } from '../util/debrief-releases.util';
import {
  DEBRIEF_AGENT_KEY,
  DEBRIEF_APPROVED_PROVIDERS,
  DEBRIEF_PROMPT_CODES,
  DEBRIEF_SEED_BUNDLE,
  DebriefBundle,
  DebriefRecipe,
  DebriefRecipeKey,
  DebriefModelCatalog,
  DEBRIEF_ORCHESTRATOR_PROMPT_CODES,
  DEBRIEF_SESSION_BUDGET_DEFAULT,
  GUIDANCE_TOOLS_DEFAULT,
  isOrchestrated,
  orchestratorModels,
  validateDebriefBundle,
} from '../constants/debrief-release.constants';
import { DebriefRun } from '../entity/debrief-run.entity';
import {
  DebriefRunArm,
  DebriefRunMode,
  DebriefRunStatus,
} from '../enum/debrief-run.enum';
import {
  effectiveRunCeiling,
  FallbackRung,
  modelPrices,
} from '../util/debrief-budget.util';
import { LlmRuntime } from '../../llm/constants/llm-model-registry.constants';
import { LlmModelService } from '../../llm/service/llm-model.service';
import {
  DebriefContextRepository,
  DebriefSessionContext,
} from './debrief-context.repository';
import {
  DebriefGraphClient,
  DebriefGraphError,
  DebriefGraphRequest,
  DebriefGraphResponse,
} from './debrief-graph.client';
import {
  DebriefRunLogsService,
  PromptVersions,
} from './debrief-run-logs.service';
import { DebriefPracticeService } from './debrief-practice.service';
import { DebriefFrameworkService } from './debrief-framework.service';
import { resolveRiskCue } from '../util/debrief-risk-cue.util';
import {
  DataProvider,
  debriefDataProviders,
  loadDebriefData,
} from './debrief-data-providers';
import {
  roleplayBrief,
  roleplayFieldProblems,
} from '../util/debrief-roleplay-brief.util';
import { emptyFramework } from '../constants/debrief-framework.constants';
import {
  DEBRIEF_ORCHESTRATOR_TOOLS,
  DEBRIEF_GATEWAY_TOOLS,
  DebriefRunTokenService,
} from './debrief-run-token.service';
import { istMonthElapsed } from '../util/debrief-pm-reports.util';
import { DebriefSettingsService } from './debrief-settings.service';
import {
  defaultOwnerSettings,
  OwnerSettings,
} from '../constants/debrief-owner-settings.constants';
import { DebriefProgressResult } from '../entity/debrief-progress-result.entity';
import type { ProgressSettings } from '../util/debrief-progress.util';

/** What a running debrief is doing now, for the learner's "working" panel. */
export interface DebriefProgress {
  step: string;
  round?: number;
  topic?: string;
}

export interface RunOptions {
  mode: DebriefRunMode;
  /** Run this release instead of GA (replays of a candidate). */
  release?: AgentRelease | null;
  /** Replace a prompt's text for this run only (a challenger in a screen). */
  promptOverrides?: Record<string, string>;
  /** Replace bundle settings for this run only. */
  settingOverrides?: Partial<DebriefBundle['settings']>;
  experimentId?: string | null;
  arm?: DebriefRunArm | null;
  /**
   * v9 FR-3: carry on this run (its worker died) instead of claiming a new
   * one. The graph resumes from its last checkpoint, so paid steps are not
   * paid again.
   */
  resume?: DebriefRun | null;
  /**
   * Run this run again from the start, on a fresh graph thread (its first
   * attempt ended without a draft: the safety reader or the writer failed,
   * or it was stuck). The row is reused; `workspace.retries` says which
   * attempt this is. The safety reader runs again, so a retried run never
   * publishes without a safety reading.
   */
  retryOf?: DebriefRun | null;
  /** For tests: the clock. */
  now?: () => number;
}

/** The prompts the debrief graph's steps run, whether or not a release pins them. */
const GRAPH_PROMPT_CODES: readonly string[] = [
  DEBRIEF_PROMPT_CODES.safetyReader,
  DEBRIEF_PROMPT_CODES.riskCueDefinition,
  DEBRIEF_PROMPT_CODES.analyst,
  DEBRIEF_PROMPT_CODES.progressReader,
  DEBRIEF_PROMPT_CODES.progress,
  DEBRIEF_PROMPT_CODES.guidanceAgent,
  DEBRIEF_PROMPT_CODES.writer,
  DEBRIEF_PROMPT_CODES.reviser,
  DEBRIEF_PROMPT_CODES.rubric,
  DEBRIEF_PROMPT_CODES.evaluator,
  DEBRIEF_PROMPT_CODES.evaluatorFix,
];

/** An optional read that can never fail the run: any error gives the fallback. */
async function orFallback<T>(read: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await read();
  } catch {
    return fallback;
  }
}

/** Why a run ended before it reached the graph, by its skip reason. */
const END_WHY: Record<string, string> = {
  no_session: 'Stopped: the session could not be found.',
  too_short: 'No debrief: the learner said nothing in the session.',
  no_transcript: 'No debrief: the session has no transcript.',
  monthly_cap:
    'Held for a person: this month’s debrief budget is spent, so no run could start.',
  provider_not_allowed:
    'No debrief: a step has no priced model on any provider this organisation allows (Settings › Organisations), so the learner gets today’s debrief.',
  debrief_tab_off: 'No debrief: the roleplay’s Debrief tab is switched off.',
};

const GRAPH_STATUSES: ReadonlySet<string> = new Set([
  DebriefRunStatus.PUBLISHED,
  DebriefRunStatus.BELOW_BAR,
  DebriefRunStatus.NEEDS_PERSON,
  DebriefRunStatus.SKIPPED,
  DebriefRunStatus.FAILED,
]);

/** A prepared run: either it already ended in ally-be, or here is what the graph gets. */
type Prepared =
  | { ended: DebriefRun }
  | {
      request: Omit<DebriefGraphRequest, 'run_token' | 'gateway_url'>;
      /** The Skills Store version of each prompt sent, for the Agent logs. */
      promptVersions: PromptVersions;
      /** The learner, for storing the progress reading. */
      counselorId: number | null;
    };

/** The owner settings' progress group, as the graph's `progress_profile.settings`. */
export function progressSettings(s: OwnerSettings): ProgressSettings {
  return {
    window: s.progressWindow,
    cardEvery: s.progressCardEvery,
    useFhs: s.progressUseFhs,
    showWorseToLearners: s.progressShowWorseToLearners,
  };
}

/**
 * Debriefs one session (plan §8) on the Debrief harness
 * (docs/debrief-harness/CONTRACT.md). The graph in ally-ai decides; this
 * prepares and applies:
 *
 * - `prepare`: the release and its settings, the claim (one run per session
 *   in production), the early skips, language detection, every context read,
 *   the prompt texts with the run's overrides, the run ceiling and the
 *   `monthly_cap` skip, and the price of every model the bundle names.
 * - the graph (`POST /api/v1/debrief/runs`): every model step, the budget,
 *   the check → evaluate ⇄ revise loop, deadlines, fallback rungs and the
 *   decision. Mid-run it calls back the gateway tools
 *   (`POST /api/v1/internal/debrief/tools/:name`, `DebriefGatewayController`)
 *   with the run token signed here.
 * - `apply`: the graph's answer onto the run row, the same fields as always,
 *   so publishing, judging, trials and metrics read them unchanged.
 */
@Injectable()
export class DebriefRunnerService {
  private readonly logger = LoggerService.getInstance(
    DebriefRunnerService.name,
  );

  /** Where each piece of context data comes from (one provider each). */
  private readonly dataProviders: DataProvider[];

  constructor(
    @InjectRepository(DebriefRun)
    private readonly runs: Repository<DebriefRun>,
    private readonly context: DebriefContextRepository,
    private readonly graph: DebriefGraphClient,
    private readonly tokens: DebriefRunTokenService,
    private readonly config: AppConfigService,
    private readonly releases: AgentReleaseService,
    practice: DebriefPracticeService,
    private readonly llmModels: LlmModelService,
    private readonly agentLogs: DebriefRunLogsService,
    @Optional() private readonly ownerSettings?: DebriefSettingsService,
    @Optional()
    @InjectRepository(DebriefProgressResult)
    private readonly progressResults?: Repository<DebriefProgressResult>,
    /** V2_AUTONOMY A9: a language pinned to another release. Absent in unit tests. */
    @Optional() private readonly holds?: DebriefChangeHoldsService,
    /** The organisation's skill frameworks (Context Library). Absent in unit tests: none. */
    @Optional() private readonly frameworks?: DebriefFrameworkService,
  ) {
    this.dataProviders = debriefDataProviders({ context, practice });
  }

  /**
   * The LLM catalog as the release check reads it. Its service falls back to
   * the in-code list when the table is unreadable, so a database hiccup
   * narrows what may run rather than failing the run.
   */
  async modelCatalog(): Promise<DebriefModelCatalog> {
    // Ask Ally runs in ally-ai too (CONTRACT.md §5): one list for both.
    const models = new Set(
      (await this.llmModels.getModels(LlmRuntime.ALLY_AI)).map((m) => m.model),
    );
    return { steps: models, reply: models };
  }

  /** The GA bundle, or the seed when GA is missing or does not validate. */
  async resolveRelease(
    release?: AgentRelease | null,
  ): Promise<{ release: AgentRelease | null; bundle: DebriefBundle }> {
    const r = release ?? (await this.releases.getGa(DEBRIEF_AGENT_KEY));
    const problems = r
      ? validateDebriefBundle(r.bundle, await this.modelCatalog())
      : [];
    if (r && problems.length === 0) {
      // Recording pins must never fail a learner's debrief: on a failed
      // write the release runs with what it has recorded so far.
      const pins = r.id
        ? await this.pinPrompts(r).catch((e) => {
            this.logger.warn(
              `[debrief] could not record prompt versions for release v${r.version}: ${(e as Error).message}`,
            );
            return (
              (r.changeSet as Record<string, any> | null)?.pinnedPrompts ?? null
            );
          })
        : null;
      return {
        release: r,
        bundle: withPinnedPrompts(r.bundle as unknown as DebriefBundle, pins),
      };
    }
    if (r) {
      this.logger.error(
        `debrief release v${r.version} does not validate (${problems.join('; ')}); running the seed bundle`,
      );
    }
    return { release: null, bundle: DEBRIEF_SEED_BUNDLE };
  }

  /**
   * The exact Skills Store version of every prompt this release left
   * unpinned (plan §8.8), recorded once: when the release is created (the
   * services that make releases call this straight after), or at the latest
   * the first time it is resolved. A release that has them never follows the
   * store's current version again, so rolling back restores its texts.
   */
  async pinPrompts(r: AgentRelease): Promise<Record<string, number>> {
    const existing = (r.changeSet as Record<string, any> | null)
      ?.pinnedPrompts as Record<string, number> | undefined;
    if (existing) return existing;
    const unpinned = Object.entries(
      ((r.bundle as Record<string, any>)?.prompts ?? {}) as Record<
        string,
        number | null
      >,
    )
      .filter(([, v]) => v == null)
      .map(([code]) => code);
    const pins = await this.context.currentPromptVersions(unpinned);
    await this.context.recordPromptPins(r.id, pins, 'created');
    r.changeSet = { ...(r.changeSet ?? {}), pinnedPrompts: pins };
    return pins;
  }

  /** Pin every debrief release that has no record yet (after the seed sync at boot). */
  async pinAll(): Promise<number> {
    const all = await this.releases.list(DEBRIEF_AGENT_KEY);
    let n = 0;
    for (const r of all) {
      if (!(r.changeSet as Record<string, any> | null)?.pinnedPrompts) {
        await this.pinPrompts(r);
        n++;
      }
    }
    return n;
  }

  /**
   * Debrief one session. For production modes this is idempotent per
   * session: a second call returns the existing run.
   */
  async run(sessionId: string, opts: RunOptions): Promise<DebriefRun> {
    const now = opts.now ?? Date.now;
    // V2_AUTONOMY A9: a production session whose language is pinned (a change
    // held or undone for it, or live only for it) runs on the pinned release.
    // A pin that cannot be read fails the attempt (nothing is claimed, the drain
    // starts it again) rather than running a pinned language on the release in force.
    const pinned =
      !opts.release && opts.mode !== DebriefRunMode.REPLAY
        ? await this.holds?.releaseForSession(sessionId)
        : null;
    const { release, bundle: released } = await this.resolveRelease(
      opts.release ?? pinned,
    );
    const bundle: DebriefBundle = {
      ...released,
      settings: { ...released.settings, ...(opts.settingOverrides ?? {}) },
    };

    const created =
      opts.resume ??
      opts.retryOf ??
      (await this.claim(sessionId, opts, release));
    if (!created) {
      return (await this.runs.findOne({
        where: { scenarioSessionId: sessionId, mode: opts.mode },
      })) as DebriefRun;
    }
    const run = created;

    try {
      const prepared = await this.prepare(run, sessionId, opts, release, {
        bundle,
        now,
      });
      if ('ended' in prepared) return prepared.ended;
      const retries = Number(run.workspace?.retries ?? 0) || 0;
      const res = await this.graph.run(
        {
          ...prepared.request,
          // A retry starts a fresh graph thread (CONTRACT.md §1 `attempt`).
          ...(opts.retryOf && retries > 0 ? { attempt: retries } : {}),
          // The orchestrator's data tools only for a run that may plan.
          run_token: this.tokens.sign(
            run.id,
            sessionId,
            isOrchestrated(bundle)
              ? [...DEBRIEF_GATEWAY_TOOLS, ...DEBRIEF_ORCHESTRATOR_TOOLS]
              : DEBRIEF_GATEWAY_TOOLS,
            // Which step may call which guidance tool, enforced by the gateway.
            (bundle.settings.guidanceTools as Record<string, string[]>) ??
              GUIDANCE_TOOLS_DEFAULT,
          ),
          gateway_url: `${this.config.publicApiBaseUrl.replace(/\/+$/, '')}/api/v1/internal/debrief`,
        },
        bundle.settings.riskDeadlineMs,
      );
      return await this.apply(
        run,
        res,
        prepared.promptVersions,
        prepared.counselorId,
      );
    } catch (e) {
      // ally-ai unreachable or crashed mid-run (a deploy, a restart): the run
      // stays `running` so the stuck-run sweeper resumes it from the graph's
      // checkpoint (v9 FR-3); the sweeper's own limits hand it to a person if
      // that fails too. Only an error the graph itself returned ends it here.
      // Replays aren't swept; they end as failed, as before.
      if (
        run.mode !== DebriefRunMode.REPLAY &&
        e instanceof DebriefGraphError &&
        (e.status === null || e.status >= 500)
      ) {
        this.logger.warn(
          `debrief run ${run.id} for session ${sessionId}: the graph did not answer (${e.message}); left running for the sweeper to resume`,
        );
        run.workspace = {
          ...run.workspace,
          graphUnreachable: {
            error: e.message.slice(0, 300),
            at: new Date().toISOString(),
          },
        };
        await this.runs.save(run);
        return run;
      }
      this.logger.error(
        `debrief run ${run.id} for session ${sessionId} failed: ${(e as Error).message}`,
      );
      return this.finish(
        run,
        DebriefRunStatus.FAILED,
        { error: (e as Error).message.slice(0, 1000) },
        FallbackRung.PERSON_FINISHES,
      );
    }
  }

  /**
   * Everything before the first model step: the early skips, the language,
   * the context, the prompts, the ceiling and the prices. A run that ends
   * here (a skip, the monthly cap) is finished and returned as `ended`.
   */
  private async prepare(
    run: DebriefRun,
    sessionId: string,
    opts: RunOptions,
    release: AgentRelease | null,
    { bundle: released, now }: { bundle: DebriefBundle; now: () => number },
  ): Promise<Prepared> {
    let bundle = released;
    const settings = bundle.settings;
    const resumed = !!opts.resume;
    const session = await this.context.loadSession(sessionId);
    if (!session) {
      return {
        ended: await this.finish(run, DebriefRunStatus.SKIPPED, {
          skipReason: 'no_session',
        }),
      };
    }
    Object.assign(run, {
      tenantId: session.tenantId,
      language: session.language,
      learnerTurns: session.learnerTurns,
    });
    // The Console lists a running debrief with its organisation and
    // language, not only once it finishes. Never awaited, never fails it.
    try {
      void Promise.resolve(
        this.runs.update(run.id, {
          tenantId: session.tenantId,
          language: session.language,
          learnerTurns: session.learnerTurns,
        } as Partial<DebriefRun>),
      ).catch(() => undefined);
    } catch {
      // The finish writes them anyway.
    }
    if (session.learnerTurns === 0) {
      return {
        ended: await this.finish(run, DebriefRunStatus.SKIPPED, {
          skipReason: 'too_short',
        }),
      };
    }
    // The roleplay shows no Debrief tab: nobody would read the debrief.
    if (session.debriefTabOff && opts.mode !== DebriefRunMode.REPLAY) {
      return {
        ended: await this.finish(run, DebriefRunStatus.SKIPPED, {
          skipReason: 'debrief_tab_off',
        }),
      };
    }
    const transcript = await this.context.transcript(sessionId);
    if (transcript.length === 0) {
      return {
        ended: await this.finish(run, DebriefRunStatus.SKIPPED, {
          skipReason: 'no_transcript',
        }),
      };
    }
    // v9 FR-39: a session that recorded no language is sent with the default
    // and `language_recorded: false`; the graph reads the language from what
    // the learner wrote and answers it with `language` and
    // `workspace.languageSource` (the Console counts these per organisation).
    run.workspace = {
      ...run.workspace,
      ...(session.languageRecorded ? { languageSource: 'recorded' } : {}),
      ...(resumed ? { resumes: Number(run.workspace?.resumes ?? 0) || 1 } : {}),
    };

    // The graph picks the recipe from the same rule; ally-be records it now
    // so a run held at the monthly cap still says which it would have run.
    const recipe: DebriefRecipe =
      session.learnerTurns < settings.standardMinLearnerTurns
        ? bundle.recipes[DebriefRecipeKey.SHORT]
        : // A release from before Case and Assessment runs Standard.
          (bundle.recipes[
            session.assessment
              ? DebriefRecipeKey.ASSESSMENT
              : session.inCase
                ? DebriefRecipeKey.CASE
                : DebriefRecipeKey.STANDARD
          ] ?? bundle.recipes[DebriefRecipeKey.STANDARD]);
    run.recipeKey = recipe.key;

    // Plan §8.9 (FR-57, Q12): an organisation whose contract restricts
    // providers gets the release with only those providers' models — never
    // another company. A step whose models are all disallowed runs on a
    // priced model from the catalogue on an allowed provider (same tier
    // first). Only when none exists does the run end, and the learner gets
    // today's debrief (or "not available" when today's provider is not
    // allowed either; DebriefAgentService.fallBackToToday).
    const allowed = await this.context.providerAllowlist(session.tenantId);
    const everyAllowed = DEBRIEF_APPROVED_PROVIDERS.every((p) =>
      allowed.includes(p),
    );
    const substitutes = everyAllowed
      ? []
      : await orFallback(
          async () => [...(await this.modelCatalog()).steps],
          [] as string[],
        );
    const restricted = restrictBundleToProviders(bundle, allowed, substitutes);
    if (restricted.changed) {
      run.workspace = {
        ...run.workspace,
        providerAllowlist: {
          allowed,
          ...(restricted.blockedSteps.length
            ? { blockedSteps: restricted.blockedSteps }
            : {}),
          ...(Object.keys(restricted.substitutedSteps).length
            ? { substitutedSteps: restricted.substitutedSteps }
            : {}),
          ...(restricted.orchestratorOff ? { orchestratorOff: true } : {}),
        },
      };
    }
    if (restricted.blockedRecipes.includes(recipe.key)) {
      return {
        ended: await this.finish(run, DebriefRunStatus.SKIPPED, {
          skipReason: 'provider_not_allowed',
        }),
      };
    }
    bundle = restricted.bundle;

    let ceiling = settings.runCeilingUsd;
    let spentThisMonthUsd = 0;
    if (opts.mode !== DebriefRunMode.REPLAY) {
      const mtd = await this.context.monthToDate();
      spentThisMonthUsd = mtd.spentUsd;
      const elapsed = istMonthElapsed(new Date(now()));
      ceiling = effectiveRunCeiling(settings, {
        sessionsThisMonth: mtd.sessions,
        spentThisMonthUsd: mtd.spentUsd,
        monthElapsed: elapsed,
      });
    }
    // The session's whole budget covers the run and every Ask Ally reply.
    ceiling = Math.min(
      ceiling,
      settings.sessionBudgetUsd ?? DEBRIEF_SESSION_BUDGET_DEFAULT,
    );
    // Gopi, 2026-11-16: a learner's debrief may go past the month's budget.
    // A live run the cap (or what is left of it) would stop runs with the
    // floor — the minimum path, writer and checks — and the owner is told
    // once a day (DebriefAgentService.notifyOverCap). Shadow runs keep the cap.
    if (opts.mode === DebriefRunMode.LIVE && ceiling < settings.runFloorUsd) {
      if (spentThisMonthUsd + settings.runFloorUsd > settings.monthlyCapUsd) {
        run.workspace = {
          ...run.workspace,
          overCap: true,
          overCapSpend: {
            spentUsd: Number(spentThisMonthUsd.toFixed(4)),
            capUsd: settings.monthlyCapUsd,
          },
        };
      }
      ceiling = settings.runFloorUsd;
    }
    run.ceilingUsd = ceiling.toFixed(4);
    if (ceiling <= 0) {
      return {
        ended: await this.finish(
          run,
          DebriefRunStatus.NEEDS_PERSON,
          { skipReason: 'monthly_cap' },
          FallbackRung.PERSON_FINISHES,
        ),
      };
    }

    // Learner progress: the owner settings' switch, then the learner's
    // profile. Never blocks a debrief: unreadable means no profile.
    const owner = await orFallback(
      async () => (await this.ownerSettings?.get()) ?? defaultOwnerSettings(),
      defaultOwnerSettings(),
    );

    // The context the graph's steps read. The optional reads never block a
    // debrief: unreadable means none.
    // The skill frameworks the learner's organisation can read (spec DEBRIEF_ACROSS_ROLEPLAYS §4);
    // none or unreadable means only the roleplay's own competencies, so it can never stop a debrief.
    const framework = this.frameworks
      ? await this.frameworks.forTenant(session.tenantId)
      : emptyFramework();
    const riskCue = resolveRiskCue(session.riskCueOption);
    const competencyNames = (session.competencies ?? []).map((c) => c.name);
    const [{ texts: prompts, versions: promptVersions }, loaded] =
      await Promise.all([
        this.prompts(bundle, opts.promptOverrides),
        // Every piece of context data, each from its one provider (debrief-data-providers.ts).
        loadDebriefData(this.dataProviders, {
          session,
          sessionId,
          recipeKey: recipe.key,
          orchestrated: isOrchestrated(bundle),
          progressOn: owner.progressOn,
          progressProfile: () =>
            this.context.progressProfile(
              session.counselorId!,
              session.tenantId,
              sessionId,
              progressSettings(owner),
              { framework, competencies: competencyNames },
            ),
        }),
      ]);
    const liveDetections = (loaded.context.live_detections ?? []) as unknown[];
    const caseMemory = loaded.context.case_memory;
    const cohort = loaded.context.cohort;
    // A roleplay field in the wrong shape is skipped by the brief; say so on the run.
    for (const p of roleplayFieldProblems(
      session.roleplayFields,
      bundle.settings?.roleplayFields,
    )) {
      loaded.problems.push({
        contextKey: 'scenario',
        item: 'roleplay_brief',
        why: `${p.label}: ${p.why}`,
      });
    }
    if (loaded.problems.length) {
      // A run that read less than it should says so; the Agent logs can show it.
      this.logger.warn(
        `[debrief] ${sessionId}: ${loaded.problems.map((p) => `${p.contextKey} (${p.why})`).join('; ')}`,
      );
      run.workspace = { ...run.workspace, dataNotes: loaded.problems };
    }
    run.workspace = {
      ...run.workspace,
      // What this run used, kept so a later edit never changes how a past debrief reads.
      // Not `framework`: the graph's answer writes its own key of that name into the workspace.
      frameworkUsed: {
        id: framework.id,
        ids: framework.ids,
        name: framework.name,
        areas: framework.areas.map((a) => a.name),
      },
      riskCueOption: {
        key: riskCue.key,
        name: riskCue.name,
        version: riskCue.version,
        handling: riskCue.handling,
        supportLinesOnCue: riskCue.supportLinesOnCue,
        wordListRaises: riskCue.wordListRaises,
        // Always null now: the pinned definition is the only one (older runs may hold a wording).
        wording: riskCue.wording,
      },
      speakerLabels: bundle.settings?.neutralWording ? 'neutral' : 'legacy',
    };
    if (liveDetections.length) {
      run.workspace = { ...run.workspace, liveDetections };
    }
    if (caseMemory) run.workspace = { ...run.workspace, caseMemory };
    if (cohort) run.workspace = { ...run.workspace, cohort };

    const models = Object.values(bundle.recipes).flatMap((r) =>
      (r?.steps ?? []).flatMap((s) => [s.model, s.backupModel]),
    );
    if (bundle.reply?.model) models.push(bundle.reply.model);
    models.push(...orchestratorModels(bundle));

    return {
      request: {
        run_id: run.id,
        scenario_session_id: sessionId,
        mode: opts.mode,
        resume: !!opts.resume,
        release: {
          id: release?.id ?? null,
          version: release?.version ?? null,
        },
        bundle,
        prompts,
        ceiling_usd: ceiling,
        // A learner is waiting: the minimum path (safety reader, writer,
        // checks) runs even when its estimate passes the ceiling.
        ...(opts.mode === DebriefRunMode.LIVE
          ? { allow_over_ceiling: true }
          : {}),
        prices: modelPrices(models),
        session: {
          ...sessionForGraph(session, bundle.settings?.roleplayFields),
          framework,
          risk_cue: {
            key: riskCue.key,
            name: riskCue.name,
            handling: riskCue.handling,
            word_list_raises: riskCue.wordListRaises,
          },
          speaker_labels: bundle.settings?.neutralWording
            ? 'neutral'
            : 'legacy',
        },
        transcript,
        context: loaded.context as DebriefGraphRequest['context'],
      },
      promptVersions,
      counselorId: session.counselorId,
    };
  }

  /**
   * Every prompt the bundle names and the graph runs, live text with this
   * run's overrides; and the Skills Store version each one is (an override's
   * own text, which has none), for the Agent logs.
   */
  private async prompts(
    bundle: DebriefBundle,
    overrides: Record<string, string> = {},
  ): Promise<{
    texts: Record<string, string | null>;
    versions: PromptVersions;
  }> {
    const codes = [
      ...new Set([
        ...GRAPH_PROMPT_CODES,
        ...(isOrchestrated(bundle) ? DEBRIEF_ORCHESTRATOR_PROMPT_CODES : []),
        ...Object.keys(bundle.prompts ?? {}),
        ...Object.keys(overrides),
      ]),
    ];
    const texts = await Promise.all(
      codes.map(
        async (code) =>
          overrides[code] ??
          (await this.context.promptText(code, bundle.prompts?.[code] ?? null)),
      ),
    );
    const current = await orFallback(
      () =>
        this.context.currentPromptVersions(
          codes.filter((c) => bundle.prompts?.[c] == null && !overrides[c]),
        ),
      {} as Record<string, number>,
    );
    const versions: PromptVersions = Object.fromEntries(
      codes.map((code, i) => [
        code,
        overrides[code] != null
          ? { text: overrides[code] }
          : texts[i] == null
            ? null
            : (bundle.prompts?.[code] ?? current[code] ?? null),
      ]),
    );
    return {
      texts: Object.fromEntries(codes.map((code, i) => [code, texts[i]])),
      versions,
    };
  }

  /** The graph's answer onto the run: the same fields the in-process runner wrote. */
  private async apply(
    run: DebriefRun,
    res: DebriefGraphResponse,
    promptVersions: PromptVersions = {},
    counselorId: number | null = null,
  ): Promise<DebriefRun> {
    if (!res || !GRAPH_STATUSES.has(res.status)) {
      throw new Error(
        `debrief graph returned no decision (status ${String(res?.status)})`,
      );
    }
    const status = res.status as DebriefRunStatus;
    run.workspace = { ...run.workspace, ...(res.workspace ?? {}) };
    if (status === DebriefRunStatus.FAILED && !run.workspace.decision) {
      run.workspace = {
        ...run.workspace,
        decision: {
          status,
          round: null,
          why: 'Failed: an unexpected error stopped the run (see the error).',
        },
      };
    }
    Object.assign(run, {
      status,
      skipReason: res.skip_reason ?? null,
      recipeKey: res.recipe_key ?? run.recipeKey ?? null,
      cards: res.cards ?? null,
      steps: res.steps ?? [],
      // This attempt plus what earlier attempts of a retried run spent.
      estimatedCostUsd: (
        Number(res.estimated_cost_usd ?? 0) +
        Number(run.workspace?.priorEstimatedUsd ?? 0)
      ).toFixed(4),
      fallbackRung: Math.max(run.fallbackRung ?? 0, res.fallback_rung ?? 0),
      // The graph's language: the recorded one, or the one it read from the
      // learner's turns.
      ...(res.language ? { language: res.language } : {}),
      hasRiskCue: !!res.has_risk_cue,
      learnerDistress: !!res.learner_distress,
      revisionRounds: res.revision_rounds ?? 0,
      evaluatorOverall:
        res.evaluator_overall != null
          ? Number(res.evaluator_overall).toFixed(2)
          : null,
      evaluatorHardFails: res.evaluator_hard_fails ?? [],
      checkFailures: (res.check_failures ?? []).map((c) =>
        typeof c === 'string' ? { code: c, section: '', detail: '' } : c,
      ),
      ...(status === DebriefRunStatus.FAILED
        ? { error: (res.error ?? 'the debrief graph failed').slice(0, 1000) }
        : {}),
      finishedAt: new Date(),
    });
    await this.runs.save(run);
    // The progress reading, append-only. Never fails the run.
    await this.storeProgress(run, res, counselorId);
    // The Agent logs: what every agent was sent and answered. Never fails the run.
    await this.agentLogs.record(run, res.logs, promptVersions);
    return run;
  }

  /** One `debrief_progress_results` row when the progress agent ran; a failure is logged, never thrown. */
  private async storeProgress(
    run: DebriefRun,
    res: DebriefGraphResponse,
    counselorId: number | null,
  ): Promise<void> {
    const p = res.progress;
    if (!p || !p.report || !this.progressResults || counselorId == null) {
      return;
    }
    try {
      const uuids = (v: unknown): string[] =>
        Array.isArray(v)
          ? v.filter(
              (x): x is string =>
                typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x),
            )
          : [];
      const ints = (v: unknown): number[] =>
        Array.isArray(v)
          ? v.map(Number).filter((n) => Number.isInteger(n))
          : [];
      const shownAs =
        (p.shown_as ?? p.report.shown_as) === 'card' ? 'card' : 'line';
      await this.progressResults.insert({
        tenantId: run.tenantId ?? null,
        counselorId,
        runId: run.id,
        scenarioSessionId: run.scenarioSessionId,
        windowSessionIds: uuids(p.window_session_ids),
        skills: Array.isArray(p.report.skills) ? p.report.skills : [],
        followups: Array.isArray(p.report.followups) ? p.report.followups : [],
        focus: p.report.focus ?? null,
        vetoes: Array.isArray(p.vetoes) ? p.vetoes : [],
        shownAs,
        analystVersions: ints(p.analyst_versions),
        model: p.model ? String(p.model).slice(0, 200) : null,
      });
    } catch (e) {
      this.logger.warn(
        `[debrief] could not store the progress reading for run ${run.id}: ${(e as Error).message}`,
      );
    }
  }

  /** A run that ended in ally-be (a skip, the cap, an error), with why. */
  private async finish(
    run: DebriefRun,
    status: DebriefRunStatus,
    patch: Partial<DebriefRun> = {},
    rung: FallbackRung = FallbackRung.NONE,
  ): Promise<DebriefRun> {
    const ended =
      patch.skipReason ??
      (status === DebriefRunStatus.FAILED ? 'failed' : null);
    if (ended && !run.workspace?.decision) {
      run.workspace = {
        ...run.workspace,
        decision: {
          status,
          round: null,
          why:
            END_WHY[ended] ??
            (status === DebriefRunStatus.FAILED
              ? 'Failed: an unexpected error stopped the run (see the error).'
              : ended),
        },
      };
    }
    Object.assign(run, patch, {
      status,
      steps: [],
      estimatedCostUsd: Number(run.estimatedCostUsd ?? 0).toFixed(4),
      fallbackRung: Math.max(run.fallbackRung ?? 0, rung),
      finishedAt: new Date(),
    });
    await this.runs.save(run);
    return run;
  }

  /**
   * v9 FR-3: carry on a run whose worker died, on the GA release. The graph
   * resumes from its last checkpoint; the rest runs as usual.
   */
  async resume(run: DebriefRun): Promise<DebriefRun> {
    return this.run(run.scenarioSessionId, {
      mode: run.mode,
      resume: run,
      experimentId: run.experimentId ?? null,
      arm: run.arm ?? null,
    });
  }

  /**
   * Run a live run again from the start, once its first attempt ended with
   * no draft (DebriefAgentService.retryRun claims it first). The earlier
   * attempt's decision and error are cleared; everything else it recorded
   * (the retry count, the cost so far) stays.
   */
  async retry(run: DebriefRun): Promise<DebriefRun> {
    const { decision: _decision, ...workspace } = run.workspace ?? {};
    void _decision;
    run.workspace = workspace;
    run.error = null;
    run.skipReason = null;
    run.cards = null;
    return this.run(run.scenarioSessionId, {
      mode: run.mode,
      retryOf: run,
      experimentId: run.experimentId ?? null,
      arm: run.arm ?? null,
    });
  }

  /**
   * Insert the run row. For a production mode the unique index makes this the
   * claim: a second caller for the same session gets null and reads the first.
   */
  private async claim(
    sessionId: string,
    opts: RunOptions,
    release: AgentRelease | null,
  ): Promise<DebriefRun | null> {
    const row = this.runs.create({
      scenarioSessionId: sessionId,
      mode: opts.mode,
      status: DebriefRunStatus.RUNNING,
      releaseId: release?.id ?? null,
      releaseVersion: release?.version ?? null,
      experimentId: opts.experimentId ?? null,
      arm: opts.arm ?? null,
      startedAt: new Date(),
      steps: [],
      workspace: {},
      checkFailures: [],
      evaluatorHardFails: [],
      estimatedCostUsd: '0',
    });
    if (opts.mode === DebriefRunMode.REPLAY) return this.runs.save(row);
    const res = await this.runs
      .createQueryBuilder()
      .insert()
      .into(DebriefRun)
      .values(row)
      .orIgnore()
      .returning('*')
      .execute();
    const raw = (res.raw as Array<Record<string, any>>)?.[0];
    if (!raw) return null;
    return this.runs.findOneOrFail({ where: { id: raw.id } });
  }
}

/** The session as the graph reads it (CONTRACT.md §1), in its snake_case. */
export function sessionForGraph(
  s: DebriefSessionContext,
  roleplayFields?: unknown,
): Record<string, unknown> {
  return {
    id: s.id,
    tenant_id: s.tenantId,
    counselor_id: s.counselorId,
    status: s.status,
    language: s.language,
    // What ally-be knows; the graph reads an unrecorded one from the
    // learner's turns and sets the source to `detected` or
    // `detected_low_confidence`.
    language_source: s.languageRecorded ? 'recorded' : null,
    language_recorded: s.languageRecorded,
    learner_level: s.learnerLevel,
    learner_turns: s.learnerTurns,
    scenario_id: s.scenarioId,
    // The roleplay's brief: the always-on fields plus the optional ones this release has on.
    scenario: s.roleplayFields
      ? roleplayBrief(s.roleplayFields, roleplayFields)
      : s.scenario,
    expected_behaviours: s.expectedBehaviours,
    helpful_behaviours: s.helpfulBehaviours ?? [],
    unhelpful_behaviours: s.unhelpfulBehaviours ?? [],
    competencies: s.competencies ?? [],
    assessment: s.assessment,
    in_case: s.inCase,
  };
}

export type { DebriefSessionContext };
