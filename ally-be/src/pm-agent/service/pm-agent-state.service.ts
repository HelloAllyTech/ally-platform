import { Inject, Injectable, Optional } from '@nestjs/common';
import { PmAgentRun } from '../entity/pm-agent-run.entity';
import { PmAgentSettings } from '../entity/pm-agent-settings.entity';
import {
  PmAcceptPath,
  PmAgentState,
  PmCardStatus,
} from '../enum/pm-agent.enum';
import {
  PM_IN_PROGRESS_STATUSES,
  PM_NEEDS_YOU_STATUSES,
} from '../constants/pm-agent.constants';
import {
  PmCardResponse,
  PmHealthResponse,
  PmRunNowResponse,
  PmRunResponse,
  PmStateResponse,
  PmTrackingResponse,
} from '../dto/pm-agent.dto';
import { PmAgentCardRepository } from '../repository/pm-agent-card.repository';
import {
  PmAgentRunRepository,
  PmAgentRunStepRepository,
} from '../repository/pm-agent.repositories';
import { nextRunAt } from '../util/ist.util';
import { PmAgentBudgetService } from './pm-agent-budget.service';
import { PmAgentPresenterService } from './pm-agent-presenter.service';
import {
  PM_AGENT_RUN_TRIGGER,
  PmAgentRunTrigger,
} from './pm-agent-run-trigger';
import { PmAgentSettingsService } from './pm-agent-settings.service';
import { PmAgentImpactService } from '../impact/pm-agent-impact.service';
import { PmAgentLessonsService } from '../lessons/pm-lessons.service';

const DAY_MS = 24 * 60 * 60 * 1000;

const STOP_REASON_TEXT: Record<string, string> = {
  [PmAgentState.DISABLED]: 'The PM Agent is switched off.',
  [PmAgentState.QUEUE_FULL]:
    'The queue is full. The agent pauses until you decide on some cards.',
  [PmAgentState.BUDGET_EXHAUSTED]:
    "This month's budget is used up. It resets on the 1st (IST), or raise it in Settings.",
};

const round2 = (value: number) => Number(value.toFixed(2));
const ratio = (num: number, den: number) =>
  den > 0 ? Number((num / den).toFixed(4)) : null;

/**
 * The read side the UI's three views need: the derived agent state, runs, tracking
 * groups, history and health. Every number is computed from the tables at read time —
 * there are no counters to drift.
 */
@Injectable()
export class PmAgentStateService {
  constructor(
    private readonly settingsService: PmAgentSettingsService,
    private readonly cards: PmAgentCardRepository,
    private readonly runs: PmAgentRunRepository,
    private readonly runSteps: PmAgentRunStepRepository,
    private readonly budget: PmAgentBudgetService,
    private readonly presenter: PmAgentPresenterService,
    @Inject(PM_AGENT_RUN_TRIGGER)
    private readonly runTrigger: PmAgentRunTrigger,
    @Optional() private readonly impact?: PmAgentImpactService,
    @Optional() private readonly lessons?: PmAgentLessonsService,
  ) {}

  /**
   * The state precedence is what the UI explains first: off beats everything, a run in
   * progress beats why the NEXT run would not start, and budget beats a full queue
   * (raising the budget is the action that would change nothing while the queue is full,
   * so it is the one worth saying first only when it is the blocker).
   */
  static deriveState(input: {
    settings: Pick<PmAgentSettings, 'enabled' | 'queueCap'>;
    running: boolean;
    openCards: number;
    spentUsd: number;
    reservedUsd: number;
    monthlyBudgetUsd: number;
  }): PmAgentState {
    if (!input.settings.enabled) return PmAgentState.DISABLED;
    if (input.running) return PmAgentState.RUNNING;
    if (input.spentUsd + input.reservedUsd >= input.monthlyBudgetUsd) {
      return PmAgentState.BUDGET_EXHAUSTED;
    }
    if (input.openCards >= input.settings.queueCap) {
      return PmAgentState.QUEUE_FULL;
    }
    // PAUSED (auto-build paused) went with Accept → Builder: nothing is built any more.
    return PmAgentState.IDLE;
  }

  async getState(now: Date = new Date()): Promise<PmStateResponse> {
    const settings = await this.settingsService.get();
    const [open, needsYou, running, last, spend, reservedUsd] =
      await Promise.all([
        this.cards.countOpen(),
        this.cards.countNeedsYou(),
        this.runs.findRunning(),
        this.runs.findLast(),
        this.budget.spentThisMonthUsd(now),
        this.runs.openReservationsUsd(),
      ]);
    const monthlyBudgetUsd = Number(settings.monthlyBudgetUsd);
    const agentState = PmAgentStateService.deriveState({
      settings,
      running: Boolean(running),
      openCards: open,
      spentUsd: spend.spentUsd,
      reservedUsd,
      monthlyBudgetUsd,
    });
    const stopReason =
      agentState === PmAgentState.IDLE && last?.stopReason
        ? last.stopReason
        : STOP_REASON_TEXT[agentState];
    return {
      agentState,
      ...(stopReason ? { stopReason } : {}),
      settings: PmAgentSettingsService.toResponse(settings),
      budget: {
        monthlyBudgetUsd,
        spentUsd: round2(spend.spentUsd),
        reservedUsd: round2(reservedUsd),
      },
      queue: { open, cap: settings.queueCap, needsYou },
      ...(last ? { lastRun: PmAgentStateService.runResponse(last) } : {}),
      ...(settings.enabled
        ? { nextRunAt: nextRunAt(settings.runHourIst, now).toISOString() }
        : {}),
      autoBuildPaused: settings.autoBuildPaused,
    };
  }

  async listRuns(limit = 20): Promise<{ runs: PmRunResponse[] }> {
    const runs = await this.runs.listRecent(limit);
    return { runs: runs.map(PmAgentStateService.runResponse) };
  }

  /**
   * POST /run. The guard here is the cheap, honest answer for the obvious cases; the
   * pipeline's RunGuard re-checks everything (it owns the budget reservation).
   */
  async runNow(userId: number): Promise<PmRunNowResponse> {
    const state = await this.getState();
    if (state.agentState === PmAgentState.DISABLED) {
      return { runId: null, started: false, reason: 'disabled' };
    }
    if (state.agentState === PmAgentState.RUNNING) {
      return { runId: null, started: false, reason: 'already_running' };
    }
    if (state.agentState === PmAgentState.BUDGET_EXHAUSTED) {
      return { runId: null, started: false, reason: 'budget_exhausted' };
    }
    if (state.agentState === PmAgentState.QUEUE_FULL) {
      return { runId: null, started: false, reason: 'queue_full' };
    }
    return this.runTrigger.runNow(userId);
  }

  async tracking(): Promise<PmTrackingResponse> {
    const accepted = await this.cards.listByStatuses(
      [
        ...PM_IN_PROGRESS_STATUSES,
        ...PM_NEEDS_YOU_STATUSES,
        PmCardStatus.RELEASED,
        PmCardStatus.ROADMAP_ARCHIVED,
        PmCardStatus.HANDED_OFF,
      ],
      200,
    );
    const presented = await this.presenter.present(accepted);
    const out: PmTrackingResponse = {
      needsYou: [],
      inProgress: [],
      shipped: [],
      other: [],
    };
    for (const card of presented) {
      if (card.needsYou) out.needsYou.push(card);
      else if (PM_IN_PROGRESS_STATUSES.includes(card.status))
        out.inProgress.push(card);
      else if (card.status === PmCardStatus.RELEASED) out.shipped.push(card);
      else out.other.push(card);
    }
    return out;
  }

  async history(limit = 50): Promise<{ cards: PmCardResponse[] }> {
    return {
      cards: await this.presenter.present(await this.cards.listHistory(limit)),
    };
  }

  async health(now: Date = new Date()): Promise<PmHealthResponse> {
    const since30 = new Date(now.getTime() - 30 * DAY_MS);
    const since7 = new Date(now.getTime() - 7 * DAY_MS);
    const [decided, spendByLane, impact] = await Promise.all([
      this.cards.listDecidedSince(since30),
      this.runSteps.spendByLaneSince(since30),
      this.impact
        ? this.impact.healthFigures()
        : { impactMeasuredCount: 0, impactImprovedRate: null },
    ]);
    const isAccepted = (status: PmCardStatus, path?: string | null) =>
      Boolean(path) &&
      status !== PmCardStatus.OPEN &&
      status !== PmCardStatus.REJECTED;
    const acceptRate = (since: Date) => {
      const window = decided.filter(
        (card) => card.decidedAt && new Date(card.decidedAt) >= since,
      );
      return ratio(
        window.filter((card) => isAccepted(card.status, card.acceptPath))
          .length,
        window.length,
      );
    };
    const accepted = decided.filter((card) =>
      isAccepted(card.status, card.acceptPath),
    );
    // Shipped = released, over the accepts that could ship: filed to the roadmap, or (legacy)
    // sent to Builder. A plan.md hand-off never came back to us.
    const shippable = accepted.filter(
      (card) =>
        card.acceptPath === PmAcceptPath.ROADMAP ||
        card.acceptPath === PmAcceptPath.BUILDER,
    );
    const shipped = shippable.filter(
      (card) => card.status === PmCardStatus.RELEASED,
    );
    const spend = spendByLane.reduce((sum, row) => sum + row.costUsd, 0);

    // A rejection that repeats an earlier one: same normalised title rejected before.
    const rejected = decided
      .filter((card) => card.status === PmCardStatus.REJECTED)
      .sort(
        (a, b) =>
          new Date(a.decidedAt!).getTime() - new Date(b.decidedAt!).getTime(),
      );
    const seen = new Set<string>();
    let repeats = 0;
    for (const card of rejected) {
      const key = card.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
      if (seen.has(key)) repeats += 1;
      seen.add(key);
    }

    return {
      acceptRate7d: acceptRate(since7),
      acceptRate30d: acceptRate(since30),
      shippedRate: ratio(shipped.length, shippable.length),
      costPerAcceptedCardUsd: accepted.length
        ? round2(spend / accepted.length)
        : null,
      spendByLane,
      repeatedRejectionRate: ratio(repeats, rejected.length),
      ...impact,
      ...(this.lessons
        ? await this.lessons.healthFields()
        : { activeLessons: 0, proposedLessons: 0, lessonAgreementDelta: null }),
    };
  }

  static runResponse(run: PmAgentRun): PmRunResponse {
    return {
      id: run.id,
      status: run.status,
      trigger: run.trigger,
      runDate: String(run.runDate),
      stopReason: run.stopReason ?? null,
      startedAt: new Date(run.startedAt).toISOString(),
      finishedAt: run.finishedAt
        ? new Date(run.finishedAt).toISOString()
        : null,
      reservedUsd: Number(run.reservedUsd ?? 0),
      spentUsd: Number(run.spentUsd ?? 0),
      cardsCreated: run.cardsCreated ?? 0,
      error: run.error ?? null,
    };
  }
}
