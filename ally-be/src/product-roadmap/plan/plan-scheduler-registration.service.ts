import { Injectable, OnModuleInit } from '@nestjs/common';
import { scheduledTaskRegistry } from '../../scheduler/registry/scheduled-task.registry';
import { PlanStageService } from './plan-stage.service';
import { PlanIdeaService } from './plan-idea.service';
import { PlanLeadService } from './plan-lead.service';
import { PlanOutcomeService } from './plan-outcome.service';
import { PlanDiscoveryService } from './plan-discovery.service';

/**
 * The plan flow's clocks. Every job is a no-op while planning is switched off.
 *
 * - 15 min: stage reconcile, so a build finishing or a release landing moves
 *   the plan without anyone opening it.
 * - daily: draft expiry (archive 30 / purge 90), lead nudges and auto-release,
 *   outcome reviews, and the one-time move of old idea drafts into plans.
 * - weekly: the signal scout.
 */
@Injectable()
export class PlanSchedulerRegistrationService implements OnModuleInit {
  constructor(
    private readonly stage: PlanStageService,
    private readonly ideas: PlanIdeaService,
    private readonly leads: PlanLeadService,
    private readonly outcomes: PlanOutcomeService,
    private readonly discovery: PlanDiscoveryService,
  ) {}

  onModuleInit(): void {
    scheduledTaskRegistry.register(
      '15min',
      'plan-stage-reconcile',
      async () => {
        await this.stage.reconcile();
      },
    );
    scheduledTaskRegistry.register('daily', 'plan-daily', async () => {
      await this.ideas.migrateIdeaDrafts();
      await this.ideas.sweepExpiry();
      await this.leads.sweepLeads();
      await this.outcomes.sweep();
    });
    scheduledTaskRegistry.register('weekly', 'plan-signal-scout', async () => {
      await this.discovery.scout();
    });
  }
}
