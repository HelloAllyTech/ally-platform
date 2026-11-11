import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppConfigService } from '../../config/config.service';
import { LoggerService } from '../../logger/logger.service';
import { AgentReleaseService } from '../../llm-agent/harness/release/agent-release.service';
import { AgentRelease } from '../../llm-agent/entity/agent-release.entity';
import {
  DEBRIEF_AGENT_KEY,
  DEBRIEF_PROMPT_CODES,
  DEBRIEF_SEED_BUNDLE,
  DebriefBundle,
  DebriefRecipe,
  DebriefRecipeKey,
  DebriefModelCatalog,
  DEBRIEF_ORCHESTRATOR_PROMPT_CODES,
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
import { LanguageSource, detectLanguage } from '../util/detect-language';
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
import { DebriefPracticeService } from './debrief-practice.service';
import {
  DEBRIEF_ORCHESTRATOR_TOOLS,
  DEBRIEF_GATEWAY_TOOLS,
  DebriefRunTokenService,
} from './debrief-run-token.service';

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
  /** For tests: the clock. */
  now?: () => number;
}

/** The prompts the debrief graph's steps run, whether or not a release pins them. */
const GRAPH_PROMPT_CODES: readonly string[] = [
  DEBRIEF_PROMPT_CODES.safetyReader,
  DEBRIEF_PROMPT_CODES.analyst,
  DEBRIEF_PROMPT_CODES.progressReader,
  DEBRIEF_PROMPT_CODES.writer,
  DEBRIEF_PROMPT_CODES.reviser,
  DEBRIEF_PROMPT_CODES.rubric,
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
  | { request: Omit<DebriefGraphRequest, 'run_token' | 'gateway_url'> };

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

  constructor(
    @InjectRepository(DebriefRun)
    private readonly runs: Repository<DebriefRun>,
    private readonly context: DebriefContextRepository,
    private readonly graph: DebriefGraphClient,
    private readonly tokens: DebriefRunTokenService,
    private readonly config: AppConfigService,
    private readonly releases: AgentReleaseService,
    private readonly practice: DebriefPracticeService,
    private readonly llmModels: LlmModelService,
  ) {}

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
      return { release: r, bundle: r.bundle as unknown as DebriefBundle };
    }
    if (r) {
      this.logger.error(
        `debrief release v${r.version} does not validate (${problems.join('; ')}); running the seed bundle`,
      );
    }
    return { release: null, bundle: DEBRIEF_SEED_BUNDLE };
  }

  /**
   * Debrief one session. For production modes this is idempotent per
   * session: a second call returns the existing run.
   */
  async run(sessionId: string, opts: RunOptions): Promise<DebriefRun> {
    const now = opts.now ?? Date.now;
    const { release, bundle: released } = await this.resolveRelease(
      opts.release,
    );
    const bundle: DebriefBundle = {
      ...released,
      settings: { ...released.settings, ...(opts.settingOverrides ?? {}) },
    };

    const created = opts.resume ?? (await this.claim(sessionId, opts, release));
    if (!created) {
      return (await this.runs.findOne({
        where: { scenarioSessionId: sessionId, mode: opts.mode },
      })) as DebriefRun;
    }
    const run = created;
    // The in-process runner's step checkpoints: the graph keeps its own now,
    // and the finished run never stores them.
    const workspaceNow = { ...((run.workspace ?? {}) as Record<string, any>) };
    delete workspaceNow.stepResults;
    run.workspace = workspaceNow;

    try {
      const prepared = await this.prepare(run, sessionId, opts, release, {
        bundle,
        now,
      });
      if ('ended' in prepared) return prepared.ended;
      const res = await this.graph.run(
        {
          ...prepared.request,
          // The orchestrator's data tools only for a run that may plan.
          run_token: this.tokens.sign(
            run.id,
            sessionId,
            isOrchestrated(bundle)
              ? [...DEBRIEF_GATEWAY_TOOLS, ...DEBRIEF_ORCHESTRATOR_TOOLS]
              : DEBRIEF_GATEWAY_TOOLS,
          ),
          gateway_url: `${this.config.publicApiBaseUrl.replace(/\/+$/, '')}/api/v1/internal/debrief`,
        },
        bundle.settings.riskDeadlineMs,
      );
      return await this.apply(run, res);
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
    { bundle, now }: { bundle: DebriefBundle; now: () => number },
  ): Promise<Prepared> {
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
    const transcript = await this.context.transcript(sessionId);
    if (transcript.length === 0) {
      return {
        ended: await this.finish(run, DebriefRunStatus.SKIPPED, {
          skipReason: 'no_transcript',
        }),
      };
    }
    // v9 FR-39: no recorded language → read it from what the learner wrote,
    // and say so on the run (the Console counts these per organisation).
    let languageSource: LanguageSource = 'recorded';
    if (!session.languageRecorded) {
      const detected = detectLanguage(
        transcript.filter((t) => t.role === 'counselor').map((t) => t.text),
      );
      session.language = detected.language;
      languageSource = detected.source;
      run.language = detected.language;
    }
    run.workspace = {
      ...run.workspace,
      languageSource,
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

    let ceiling = settings.runCeilingUsd;
    if (opts.mode !== DebriefRunMode.REPLAY) {
      const mtd = await this.context.monthToDate();
      const d = new Date(now());
      const daysInMonth = new Date(
        d.getUTCFullYear(),
        d.getUTCMonth() + 1,
        0,
      ).getDate();
      const elapsed = (d.getUTCDate() - 1 + d.getUTCHours() / 24) / daysInMonth;
      ceiling = effectiveRunCeiling(settings, {
        sessionsThisMonth: mtd.sessions,
        spentThisMonthUsd: mtd.spentUsd,
        monthElapsed: elapsed,
      });
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

    // The context the graph's steps read. The optional reads never block a
    // debrief: unreadable means none.
    const [
      liveDetections,
      caseMemory,
      pastWorkOnThis,
      cohort,
      practiceOptions,
      prompts,
      availability,
    ] = await Promise.all([
      orFallback(
        () => this.context.liveDetections(sessionId, session.scenarioId),
        [],
      ),
      recipe.key === DebriefRecipeKey.CASE
        ? orFallback(() => this.context.caseMemory(session.id), null)
        : Promise.resolve(null),
      session.counselorId
        ? orFallback(
            () =>
              this.context.pastWorkOnThis(
                session.counselorId!,
                session.tenantId,
                sessionId,
              ),
            [],
          )
        : Promise.resolve([]),
      orFallback(() => this.context.cohortStats(session), null),
      this.practice.optionsFor(session.counselorId, session.tenantId),
      this.prompts(bundle, opts.promptOverrides),
      // What the orchestrator's planner may build on (spec A5: presence of
      // org protocols, past debriefs, cohort and course data), cheap counts.
      isOrchestrated(bundle)
        ? orFallback(() => this.context.availability(session), null)
        : Promise.resolve(null),
    ]);
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
        prices: modelPrices(models),
        session: sessionForGraph(session, languageSource),
        transcript,
        context: {
          live_detections: liveDetections,
          past_work_on_this: pastWorkOnThis,
          cohort,
          case_memory: caseMemory,
          practice_options: practiceOptions,
          ...(availability ? { availability } : {}),
        },
      },
    };
  }

  /** Every prompt the bundle names and the graph runs, live text with this run's overrides. */
  private async prompts(
    bundle: DebriefBundle,
    overrides: Record<string, string> = {},
  ): Promise<Record<string, string | null>> {
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
    return Object.fromEntries(codes.map((code, i) => [code, texts[i]]));
  }

  /** The graph's answer onto the run: the same fields the in-process runner wrote. */
  private async apply(
    run: DebriefRun,
    res: DebriefGraphResponse,
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
      estimatedCostUsd: Number(res.estimated_cost_usd ?? 0).toFixed(4),
      fallbackRung: Math.max(run.fallbackRung ?? 0, res.fallback_rung ?? 0),
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
    return run;
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
  languageSource: LanguageSource,
): Record<string, unknown> {
  return {
    id: s.id,
    tenant_id: s.tenantId,
    counselor_id: s.counselorId,
    status: s.status,
    language: s.language,
    language_source: languageSource,
    language_recorded: s.languageRecorded,
    learner_level: s.learnerLevel,
    learner_turns: s.learnerTurns,
    scenario_id: s.scenarioId,
    scenario: s.scenario,
    expected_behaviours: s.expectedBehaviours,
    assessment: s.assessment,
    in_case: s.inCase,
  };
}

export type { DebriefSessionContext };
