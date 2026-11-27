import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { FeatureToggleService } from 'src/authorization/service/feature-toggle.service';
import {
  MANUAL_BANNER_BUDGET_EXHAUSTED,
  MANUAL_RUNS_DEFAULT_LIMIT,
  MANUAL_RUNS_MAX_LIMIT,
} from '../constants/manual.constants';
import { ManualRun } from '../entity/manual-run.entity';
import type {
  ManualAgentState,
  ManualState,
  RunRow,
} from '../type/manual.types';
import { nextWeeklyRunAt } from '../util/manual-time.util';
import { ManualBudgetService } from './manual-budget.service';
import { ManualProposalService } from './manual-proposal.service';
import { ManualSettingsService } from './manual-settings.service';

export function toRunRow(run: ManualRun): RunRow {
  return {
    id: run.id,
    trigger: run.trigger,
    status: run.status,
    stopReason: run.stopReason ?? null,
    reservedUsd: Number(run.reservedUsd) || 0,
    spentUsd: Number(run.spentUsd) || 0,
    pagesTouched: run.pagesTouched ?? 0,
    proposalsApplied: run.proposalsApplied ?? 0,
    summary: run.summary ?? null,
    error: run.error ?? null,
    triggeredBy: run.triggeredBy ?? null,
    itemLog: Array.isArray(run.itemLog) ? run.itemLog : [],
    startedAt: new Date(run.startedAt).toISOString(),
    finishedAt: run.finishedAt ? new Date(run.finishedAt).toISOString() : null,
  };
}

/** What the Product Manual tab needs to know about the agent and the caller, in one request. */
@Injectable()
export class ManualStateService {
  constructor(
    @InjectRepository(ManualRun)
    private readonly runs: Repository<ManualRun>,
    private readonly settings: ManualSettingsService,
    private readonly budget: ManualBudgetService,
    private readonly proposals: ManualProposalService,
    private readonly toggles: FeatureToggleService,
  ) {}

  async state(userId: number, now: Date = new Date()): Promise<ManualState> {
    const [
      settings,
      snapshot,
      running,
      open,
      analyticsAvailable,
      canAdminister,
    ] = await Promise.all([
      this.settings.get(),
      this.budget.snapshot(now),
      this.runs.exist({ where: { status: 'running' } }),
      this.proposals.countOpen(),
      this.toggles.hasToggle(userId, FeatureToggleKey.ANALYTICS_AGENT),
      this.toggles.hasToggle(userId, FeatureToggleKey.PRODUCT_ROADMAP_MANAGE),
    ]);

    // disabled > running > budget_exhausted > idle
    let agentState: ManualAgentState = 'idle';
    if (!settings.enabled) agentState = 'disabled';
    else if (running) agentState = 'running';
    else if (snapshot.exhausted) agentState = 'budget_exhausted';

    return {
      agentState,
      // The agent ships off, so "disabled" is a state to show, not a warning to nag about.
      banner:
        agentState === 'budget_exhausted'
          ? MANUAL_BANNER_BUDGET_EXHAUSTED
          : null,
      budget: {
        monthlyBudgetUsd: snapshot.monthlyBudgetUsd,
        spentUsd: snapshot.spentUsd,
        reservedUsd: snapshot.reservedUsd,
      },
      lastRun: settings.lastRun,
      nextRunAt: settings.enabled ? nextWeeklyRunAt(now).toISOString() : null,
      openProposals: open.proposals,
      openGaps: open.gaps,
      analyticsAvailable,
      canAdminister,
    };
  }

  async listRuns(limit?: number): Promise<RunRow[]> {
    const take = Math.min(
      Math.max(Math.floor(Number(limit)) || MANUAL_RUNS_DEFAULT_LIMIT, 1),
      MANUAL_RUNS_MAX_LIMIT,
    );
    const rows = await this.runs.find({
      order: { startedAt: 'DESC' },
      take,
    });
    return rows.map(toRunRow);
  }
}
