import { AgentSystemBlock } from 'src/llm-agent/type/agent-llm.type';
import { PmAgentRun } from '../entity/pm-agent-run.entity';
import { PmAgentSettings } from '../entity/pm-agent-settings.entity';
import {
  PmCardCategory,
  PmCardKind,
  PmFeedbackStatus,
  PmLane,
  PmMemoryKind,
  PmRunStatus,
  PmRunTrigger,
} from '../enum/pm-agent.enum';
import {
  PM_BANDIT,
  PM_PIPELINE,
  PM_PROMPT_CODES,
  PM_QUESTIONS,
  PM_TASK_IDS,
  PmStopReason,
} from '../constants/pm-agent-pipeline.constants';
import { PmCritic } from '../gate/pm-critic';
import { dedupeBatch, dedupeGate, deterministicGate } from '../gate/pm-gate';
import { baseScore, rankCandidates } from '../gate/pm-ranker';
import { PM_LANES } from '../lane/pm-lane-definitions';
import { PmLaneRunner, PmLaneRunResult } from '../lane/pm-lane-runner';
import {
  exemplarBlock,
  memoryBlock,
  pickExemplars,
  sharedContextBlock,
  topMemory,
} from '../learning/pm-context';
import { metricCatalogBlock } from '../impact/metric-catalog';
import {
  isActiveLesson,
  lessonCategoriesFor,
  lessonsBlock,
  topLessons,
} from '../lessons/pm-lessons-context';
import {
  computeLearnedStats,
  effectiveCategoryWeights,
  PmLearnedStats,
  selectLanes,
} from '../learning/pm-lane-selector';
import { cardVersionHash } from '../util/card-hash.util';
import { fence } from '../util/fence.util';
import { istDate } from '../util/ist.util';
import { estimateCallMaxUsd, PmRunLedger } from '../util/run-ledger';
import { PmAgentBudgetService } from '../service/pm-agent-budget.service';
import { PmLlmPort } from './pm-agent-llm.service';
import { planDegradation } from './pm-degrade';
import {
  PmCandidate,
  PmContextSource,
  PmEvidenceRef,
  PmFeedbackTask,
  PmPipelineStore,
  PmToolbox,
} from './pm-pipeline.types';

export interface PmRunStart {
  runId: string | null;
  started: boolean;
  reason?: string;
}

export interface PmRunOptions {
  trigger: PmRunTrigger;
  userId: number | null;
  /** Revise now: only this feedback row, only the revisions lane. */
  onlyFeedbackId?: string;
  /** Run now answers at once and works in the background; the scheduler awaits. */
  background: boolean;
}

export interface PmPipelineDeps {
  store: PmPipelineStore;
  llm: PmLlmPort;
  toolbox: PmToolbox;
  context: PmContextSource;
  events: { cardUpdated(cardId: string): void; stateUpdated(): void };
  log?: (level: 'info' | 'warn' | 'error', message: string) => void;
  rng?: () => number;
  now?: () => Date;
}

/** Typical share of the worst-case lane cost a lane really spends (for degradation only). */
const TYPICAL_LANE_SHARE = 0.5;
/** Prompt size assumed when estimating a lane before its context exists. */
const ESTIMATE_INPUT_CHARS = 40_000;
/** Critic batch bound: the best this many by preliminary score are reviewed. */
const CRITIC_MAX_CANDIDATES = 12;

const toNumber = (value: unknown) => Number(value ?? 0) || 0;

/**
 * The PM Agent run, end to end (docs/pm-agent.md "Run pipeline"; plan v3 §5–§10).
 *
 *   RunGuard → revisions → lane selection (+ degradation) → lanes → gate 1 (deterministic)
 *   → gate 2 (dedupe) → gate 3 (critic) → ranker → Persister
 *
 * Deterministic code decides whether to run, which lanes, how many candidates, the budget, when
 * to stop and what is written; the models only analyse inside lanes and the critic, through
 * PmLlmPort, with read-only tools. Every write goes through the store; cards only through
 * `persistCard`. Framework-free so the whole run is testable with fakes.
 */
export class PmRunPipeline {
  private readonly now: () => Date;
  private readonly rng: () => number;

  constructor(private readonly deps: PmPipelineDeps) {
    this.now = deps.now ?? (() => new Date());
    this.rng = deps.rng ?? Math.random;
  }

  /** RunGuard + start. Answers the POST /run contract. */
  async start(options: PmRunOptions): Promise<PmRunStart> {
    const { store } = this.deps;
    const now = this.now();
    const runDate = istDate(now);
    const skip = async (reason: string, stopReason: string, record = true) => {
      if (record) {
        await store
          .recordSkippedRun({
            trigger: options.trigger,
            triggeredBy: options.userId,
            stopReason,
            runDate,
          })
          .catch(() => undefined);
        this.deps.events.stateUpdated();
      }
      return { runId: null, started: false, reason };
    };

    const settings = await store.getSettings();
    if (!settings.enabled) {
      return skip(
        'disabled',
        PmStopReason.DISABLED,
        options.trigger !== PmRunTrigger.SCHEDULED,
      );
    }
    if (await store.findRunning()) {
      return { runId: null, started: false, reason: 'already_running' };
    }
    const open = await store.countOpen();
    if (settings.queueCap - open <= 0) {
      return skip('queue_full', PmStopReason.QUEUE_FULL);
    }
    const monthly = toNumber(settings.monthlyBudgetUsd);
    const committed = await store.monthCommittedUsd(now);
    const runCapUsd = PmAgentBudgetService.runCapUsd(
      monthly,
      committed,
      PM_PIPELINE.RUN_BUDGET_DIVISOR,
    );
    if (runCapUsd < PM_PIPELINE.MIN_RUN_BUDGET_USD) {
      // Cap-full: exit before any paid call. Nothing is reserved or spent.
      return skip('budget_exhausted', PmStopReason.BUDGET);
    }

    const run = await store.startRun({
      trigger: options.trigger,
      triggeredBy: options.userId,
      reservedUsd: runCapUsd,
      runDate,
    });
    if (!run) return { runId: null, started: false, reason: 'already_running' };
    this.deps.events.stateUpdated();

    const work = this.execute(run, settings, runCapUsd, options);
    if (options.background) {
      void work.catch(() => undefined);
    } else {
      await work;
    }
    return { runId: run.id, started: true };
  }

  private async execute(
    run: PmAgentRun,
    settings: PmAgentSettings,
    runCapUsd: number,
    options: PmRunOptions,
  ): Promise<void> {
    const { store } = this.deps;
    const ledger = new PmRunLedger(runCapUsd);
    const startedAt = this.now().getTime();
    const deadline = startedAt + PM_PIPELINE.RUN_TIMEOUT_MS;
    const log: Record<string, any> = { lanes: {}, revisions: {} };
    const claimed: string[] = [];
    let budgetHit = false;
    let timedOut = false;

    try {
      const now = this.now();
      const [outcomeRows, memory] = await Promise.all([
        store.outcomeRows(PM_BANDIT.LOOKBACK_DAYS),
        store.activeMemory(),
      ]);
      const stats = computeLearnedStats(outcomeRows, now);
      await store
        .saveLearnedScores(
          [...stats.entries()].map(([key, stat]) => {
            const [dimension, name] = key.split(':') as [
              'category' | 'lane',
              string,
            ];
            return { dimension, key: name, score: stat.score };
          }),
        )
        .catch(() => undefined);
      const shared = sharedContextBlock(
        await this.deps.context.sharedContext(settings),
      );
      const facts = memory.filter(
        (m) => m.kind === PmMemoryKind.FACT && m.active,
      );
      // Active weekly lessons (lessons/): guidance, fenced; never above the hard gates.
      const lessons = memory.filter((m) => isActiveLesson(m, now));
      const runEvidence = new Map<string, PmEvidenceRef>();
      const runner = new PmLaneRunner(this.deps.llm, this.deps.toolbox);
      const candidates: PmCandidate[] = [];
      const freeAtStart = Math.max(
        0,
        settings.queueCap - (await store.countOpen()),
      );

      // ── revisions first: the explicit user signal ─────────────────────────
      const feedback = await store.pendingFeedback(
        PM_PIPELINE.MAX_REVISIONS_PER_RUN,
        options.onlyFeedbackId,
      );
      const selected = options.onlyFeedbackId
        ? []
        : selectLanes({
            count: Math.min(
              PM_PIPELINE.MAX_LANES_PER_RUN,
              Math.max(
                1,
                Math.ceil(
                  (freeAtStart * PM_PIPELINE.CANDIDATE_MULTIPLIER) /
                    PM_PIPELINE.MAX_CANDIDATES_PER_LANE,
                ),
              ),
            ),
            categoryWeights: settings.categoryWeights,
            stats,
            recentRuns: await store.recentRunLanes(
              PM_BANDIT.COVERAGE_WINDOW_RUNS,
            ),
            rng: this.rng,
            available: (await store.hasUxSignals())
              ? undefined
              : (Object.keys(PM_LANES).filter(
                  (lane) =>
                    lane !== PmLane.REVISIONS && lane !== PmLane.UX_SIGNALS,
                ) as Exclude<PmLane, PmLane.REVISIONS>[]),
          });

      // Degradation, decided before any spend.
      const probe = await this.deps.llm.resolveTarget(
        PM_TASK_IDS[PmLane.ANALYTICS],
        PM_PROMPT_CODES[PmLane.ANALYTICS],
        false,
      );
      const cheapProbe = await this.deps.llm.resolveTarget(
        PM_TASK_IDS[PmLane.ANALYTICS],
        PM_PROMPT_CODES[PmLane.ANALYTICS],
        true,
      );
      const laneEstimate = (model: string) =>
        estimateCallMaxUsd(
          model,
          ESTIMATE_INPUT_CHARS,
          PM_PIPELINE.LANE_MAX_TOKENS,
        ) *
        PM_PIPELINE.MAX_PASSES *
        TYPICAL_LANE_SHARE;
      const perLane = Math.min(
        PM_PIPELINE.MAX_CANDIDATES_PER_LANE,
        Math.max(
          2,
          Math.ceil(
            (freeAtStart * PM_PIPELINE.CANDIDATE_MULTIPLIER) /
              Math.max(1, selected.length),
          ),
        ),
      );
      const plan = planDegradation({
        laneBudgetUsd: ledger.laneBudgetUsd,
        fullLaneUsd: laneEstimate(probe.model),
        cheapLaneUsd: laneEstimate(cheapProbe.model),
        laneCount: feedback.length + selected.length,
        candidatesPerLane: perLane,
      });
      log.selection = selected;
      log.degrade = plan;
      if (plan.stop) {
        budgetHit = true;
      }
      const revisionCount = Math.min(feedback.length, plan.laneCount);
      const lanes = selected.slice(
        0,
        Math.max(0, plan.laneCount - revisionCount),
      );
      ledger.setLaneCount(revisionCount + lanes.length);

      const laneSystem = async (lane: PmLane) => {
        const definition = PM_LANES[lane];
        const prompt = await this.deps.llm.loadPrompt(definition.promptCode);
        const picked = pickExemplars(outcomeRows, definition.topic);
        return {
          prompt,
          system: [
            { text: prompt.text },
            shared,
            {
              text: [
                memoryBlock(topMemory(facts, definition.topic, now)),
                lessonsBlock(
                  topLessons(lessons, now, {
                    lane,
                    categories: lessonCategoriesFor(lane),
                  }),
                ),
                exemplarBlock(picked),
                // Code-injected (not a template variable), so it never drifts from the
                // catalog and needs no prompt-variable release order.
                metricCatalogBlock(),
              ].join('\n\n'),
            },
          ],
        };
      };

      for (const task of feedback.slice(0, revisionCount)) {
        if (budgetHit || this.now().getTime() >= deadline) break;
        const outcome = await this.revise(task, {
          run,
          runner,
          ledger,
          deadline,
          runEvidence,
          cheap: plan.cheapModel,
          perLane: 1,
          laneSystem,
          claimed,
        });
        log.revisions[task.id] = outcome.log;
        candidates.push(...outcome.candidates);
        if (outcome.result?.outcome === 'budget') budgetHit = true;
        if (outcome.result?.outcome === 'timeout') timedOut = true;
      }

      // ── selected lanes ────────────────────────────────────────────────────
      for (const choice of lanes) {
        if (this.now().getTime() >= deadline) {
          timedOut = true;
          break;
        }
        if (ledger.laneRemainingUsd < PM_PIPELINE.MIN_RUN_BUDGET_USD / 2) {
          budgetHit = true;
          break;
        }
        const definition = PM_LANES[choice.lane];
        const target = await this.deps.llm.resolveTarget(
          definition.taskId,
          definition.promptCode,
          plan.cheapModel,
        );
        const { prompt, system } = await laneSystem(choice.lane);
        const result = await runner.run({
          runId: run.id,
          definition,
          target,
          promptVersion: prompt.version,
          system,
          userMessage: this.laneBrief(
            choice.lane,
            plan.candidatesPerLane,
            freeAtStart,
            facts.length,
          ),
          maxCandidates: plan.candidatesPerLane,
          ledger,
          deadline: Math.min(
            deadline,
            this.now().getTime() + PM_PIPELINE.LANE_TIMEOUT_MS,
          ),
          runEvidence,
        });
        log.lanes[choice.lane] = this.laneLog(result, ledger, choice.lane);
        candidates.push(...result.candidates);
        if (result.outcome === 'budget') budgetHit = true;
        if (result.outcome === 'timeout') timedOut = true;
        await store.updateRunSpend(run.id, ledger.spent).catch(() => undefined);
      }

      // ── gate, critic, rank, persist ───────────────────────────────────────
      const created = await this.gateAndPersist({
        run,
        settings,
        candidates,
        runEvidence,
        ledger,
        shared,
        facts: facts.length,
        memoryText: [
          memoryBlock(
            topMemory(facts, 'scope risk decision strategy rejected', now),
          ),
          lessonsBlock(topLessons(lessons, now)),
        ]
          .filter(Boolean)
          .join('\n\n'),
        log,
        stats,
        onBudget: () => {
          budgetHit = true;
        },
      });

      // Revisions that produced no successor: back to pending only when the lane could not
      // run (budget, provider, clock); a revision the gate or critic refused is closed.
      for (const id of claimed) {
        const entry = log.revisions[id] ?? {};
        if (entry.successorCardId) continue;
        const infra = ['budget', 'failed', 'timeout'].includes(entry.outcome);
        await store
          .moveFeedback(
            id,
            [PmFeedbackStatus.IN_PROGRESS],
            infra ? PmFeedbackStatus.PENDING : PmFeedbackStatus.DONE,
          )
          .catch(() => undefined);
      }

      const slotsLeft = settings.queueCap - (await store.countOpen());
      const stopReason =
        slotsLeft <= 0
          ? PmStopReason.QUEUE_FULL
          : budgetHit
            ? PmStopReason.BUDGET
            : timedOut
              ? PmStopReason.TIMEOUT
              : created === 0
                ? PmStopReason.NO_CANDIDATES
                : null;
      await store.finishRun(run.id, {
        status: PmRunStatus.COMPLETED,
        stopReason,
        finishedAt: this.now(),
        spentUsd: ledger.spent.toFixed(4),
        cardsCreated: created,
        lanes: { ...log, spentUsd: ledger.spent, runCapUsd },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.deps.log?.('error', `[PM_AGENT] Run ${run.id} failed: ${message}`);
      for (const id of claimed) {
        await store
          .moveFeedback(
            id,
            [PmFeedbackStatus.IN_PROGRESS],
            PmFeedbackStatus.PENDING,
          )
          .catch(() => undefined);
      }
      await store
        .finishRun(run.id, {
          status: PmRunStatus.FAILED,
          stopReason: PmStopReason.ERROR,
          finishedAt: this.now(),
          spentUsd: ledger.spent.toFixed(4),
          error: message.slice(0, 2000),
          lanes: { ...log, spentUsd: ledger.spent, runCapUsd },
        })
        .catch(() => undefined);
    } finally {
      this.deps.events.stateUpdated();
    }
  }

  private async revise(
    task: PmFeedbackTask,
    ctx: {
      run: PmAgentRun;
      runner: PmLaneRunner;
      ledger: PmRunLedger;
      deadline: number;
      runEvidence: Map<string, PmEvidenceRef>;
      cheap: boolean;
      perLane: number;
      laneSystem: (lane: PmLane) => Promise<{
        prompt: { text: string; version: number | null };
        system: AgentSystemBlock[];
      }>;
      claimed: string[];
    },
  ): Promise<{
    candidates: PmCandidate[];
    result?: PmLaneRunResult;
    log: Record<string, unknown>;
  }> {
    const { store } = this.deps;
    if (
      !task.card ||
      this.now().getTime() - new Date(task.createdAt).getTime() >
        PM_PIPELINE.REVISION_MAX_AGE_MS
    ) {
      await store.moveFeedback(
        task.id,
        [PmFeedbackStatus.PENDING],
        PmFeedbackStatus.CANCELLED,
      );
      return { candidates: [], log: { outcome: 'cancelled' } };
    }
    if (
      !(await store.moveFeedback(
        task.id,
        [PmFeedbackStatus.PENDING],
        PmFeedbackStatus.IN_PROGRESS,
      ))
    ) {
      return { candidates: [], log: { outcome: 'taken' } };
    }
    ctx.claimed.push(task.id);
    const definition = PM_LANES[PmLane.REVISIONS];
    const target = await this.deps.llm.resolveTarget(
      definition.taskId,
      definition.promptCode,
      ctx.cheap,
    );
    const { prompt, system } = await ctx.laneSystem(PmLane.REVISIONS);
    const result = await ctx.runner.run({
      runId: ctx.run.id,
      definition,
      target,
      promptVersion: prompt.version,
      system,
      userMessage: [
        'Revise the card below so it addresses the admin feedback. Re-fetch the evidence you',
        'need with the tools: only evidence ids returned in THIS run may be cited. Submit',
        'exactly one candidate (a recommendation, or a question if the feedback cannot be',
        'addressed without knowledge you cannot retrieve).',
        '',
        `## The original card (${task.card.kind}, ${task.card.category})`,
        '```json',
        JSON.stringify(task.card.payload ?? {}, null, 1).slice(0, 6000),
        '```',
        '',
        '## The admin feedback',
        fence(
          'admin_feedback',
          { chips: (task.chips ?? []).join(',') },
          task.text,
          2000,
        ),
      ].join('\n'),
      maxCandidates: ctx.perLane,
      ledger: ctx.ledger,
      deadline: Math.min(
        ctx.deadline,
        this.now().getTime() + PM_PIPELINE.LANE_TIMEOUT_MS,
      ),
      runEvidence: ctx.runEvidence,
      forced: {
        category: task.card.category as PmCardCategory,
        revisedFromCardId: task.card.id,
      },
    });
    return {
      candidates: result.candidates.map((candidate) => ({
        ...candidate,
        feedbackId: task.id,
      })),
      result,
      log: this.laneLog(result, ctx.ledger, PmLane.REVISIONS),
    };
  }

  private async gateAndPersist(input: {
    run: PmAgentRun;
    settings: PmAgentSettings;
    candidates: PmCandidate[];
    runEvidence: Map<string, PmEvidenceRef>;
    ledger: PmRunLedger;
    shared: ReturnType<typeof sharedContextBlock>;
    facts: number;
    memoryText: string;
    log: Record<string, any>;
    stats: PmLearnedStats;
    onBudget: () => void;
  }): Promise<number> {
    const { store } = this.deps;
    const { run, runEvidence } = input;
    const now = this.now();
    const [tenantNames, corpus] = await Promise.all([
      store.tenantNames(),
      store.dedupeCorpus(),
    ]);

    const layer12 = async (pool: PmCandidate[], layer: string) => {
      const passed: PmCandidate[] = [];
      const failed: { title: string; reasons: string[] }[] = [];
      for (const candidate of pool) {
        const one = deterministicGate(candidate, runEvidence, tenantNames);
        let reasons = one.reasons;
        if (
          one.pass &&
          candidate.kind === PmCardKind.QUESTION &&
          candidate.questionKey &&
          (await store.isQuestionSuppressed(candidate.questionKey))
        ) {
          reasons = ['question: skipped in the last 14 days'];
        }
        if (!reasons.length) {
          const two = dedupeGate(candidate, corpus, runEvidence);
          reasons = two.reasons;
        }
        if (reasons.length) {
          failed.push({
            title: String(candidate.payload?.title ?? '').slice(0, 120),
            reasons: reasons.slice(0, 8),
          });
        } else passed.push(candidate);
      }
      await store
        .traceGate(run.id, layer, { passed: passed.length, failed })
        .catch(() => undefined);
      return passed;
    };

    const batch = dedupeBatch(input.candidates);
    let pool = await layer12(batch.kept, 'deterministic+dedupe');

    // Critic: the best CRITIC_MAX_CANDIDATES by preliminary score.
    const weights = effectiveCategoryWeights(
      input.settings.categoryWeights,
      input.stats,
    );
    pool = pool
      .map((candidate, order) => ({
        candidate,
        order,
        score: baseScore(candidate, {
          runEvidence,
          categoryWeights: weights,
          now,
        }).score,
      }))
      .sort((a, b) => b.score - a.score || a.order - b.order)
      .slice(0, CRITIC_MAX_CANDIDATES)
      .map((item) => item.candidate);

    let approved: PmCandidate[] = [];
    if (pool.length) {
      const target = await this.deps.llm.resolveTarget(
        PM_TASK_IDS.CRITIC,
        PM_PROMPT_CODES.CRITIC,
        false,
      );
      const prompt = await this.deps.llm.loadPrompt(PM_PROMPT_CODES.CRITIC);
      const review = await new PmCritic(this.deps.llm).review({
        runId: run.id,
        target,
        promptText: prompt.text,
        promptVersion: prompt.version,
        sharedContext: input.shared,
        memoryBlock: input.memoryText,
        candidates: pool,
        runEvidence,
        ledger: input.ledger,
      });
      if (review.outcome === 'budget') input.onBudget();
      const passIdx = new Set(
        review.verdicts.filter((v) => v.pass).map((v) => v.index),
      );
      approved = pool.filter((_, index) => passIdx.has(index));
      const spawned = review.questions.length
        ? await layer12(dedupeBatch(review.questions).kept, 'critic-questions')
        : [];
      approved = dedupeBatch([...approved, ...spawned]).kept;
      await store
        .traceGate(run.id, 'critic', {
          outcome: review.outcome,
          passed: approved.length,
          failed: review.verdicts
            .filter((v) => !v.pass)
            .map((v) => ({
              title: String(pool[v.index]?.payload?.title ?? '').slice(0, 120),
              reasons: v.reasons.slice(0, 8),
            })),
          noVerdict: pool.length - review.verdicts.length,
          spawnedQuestions: spawned.length,
        })
        .catch(() => undefined);
      input.log.critic = {
        outcome: review.outcome,
        reviewed: pool.length,
        passed: approved.length,
      };
    }

    // Ranker over the approved set, for the slots free NOW (decisions may have freed more).
    const slots = Math.max(
      0,
      input.settings.queueCap - (await store.countOpen()),
    );
    const maxQuestions =
      input.facts >= PM_QUESTIONS.SOLID_MEMORY_FACTS
        ? Math.max(1, Math.floor(slots * PM_QUESTIONS.MAX_SHARE_WHEN_SOLID))
        : slots;
    const ranked = rankCandidates({
      candidates: approved,
      runEvidence,
      categoryWeights: weights,
      slots,
      maxQuestions,
      now,
    });

    // Persister: the only writer of cards.
    let created = 0;
    for (const candidate of ranked) {
      const result = await store.persistCard({
        runId: run.id,
        candidate,
        versionHash: cardVersionHash(
          candidate.kind,
          candidate.category,
          candidate.payload,
        ),
        queueCap: input.settings.queueCap,
      });
      if (result.status === 'queue_full') break;
      if (result.status !== 'created') continue;
      created += 1;
      this.deps.events.cardUpdated(result.card.id);
      await store
        .bumpShown(candidate.category, candidate.lane)
        .catch(() => undefined);
      if (candidate.feedbackId) {
        await store.moveFeedback(
          candidate.feedbackId,
          [PmFeedbackStatus.IN_PROGRESS],
          PmFeedbackStatus.DONE,
          result.card.id,
        );
        input.log.revisions[candidate.feedbackId] = {
          ...(input.log.revisions[candidate.feedbackId] ?? {}),
          successorCardId: result.card.id,
        };
      }
    }
    input.log.ranked = ranked.length;
    return created;
  }

  private laneBrief(
    lane: PmLane,
    maxCandidates: number,
    freeSlots: number,
    factCount: number,
  ): string {
    const solid = factCount >= PM_QUESTIONS.SOLID_MEMORY_FACTS;
    return [
      `Lane: ${lane}. Today (IST): ${istDate(this.now())}.`,
      `The review queue has ${freeSlots} free slot(s); propose at most ${maxCandidates} candidate(s).`,
      solid
        ? 'Memory holds enough context: prefer recommendations; at most about one in three candidates may be a question.'
        : 'Memory is still thin: where a decision depends on knowledge no tool can retrieve, a question is the right candidate.',
      'Research with the tools first, then call submit_candidates once. An empty list is a valid answer.',
    ].join('\n');
  }

  private laneLog(
    result: PmLaneRunResult,
    ledger: PmRunLedger,
    lane: string,
  ): Record<string, unknown> {
    return {
      outcome: result.outcome,
      candidates: result.candidates.length,
      discarded: result.discarded.length,
      repaired: result.repaired,
      passes: result.passes,
      toolCalls: result.toolCalls,
      costUsd: ledger.laneSpentUsd(lane),
    };
  }
}
