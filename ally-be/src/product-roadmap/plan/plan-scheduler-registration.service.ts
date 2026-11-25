import { Injectable, OnModuleInit } from '@nestjs/common';
import { scheduledTaskRegistry } from '../../scheduler/registry/scheduled-task.registry';
import { PlanStageService } from './plan-stage.service';
import { PlanIdeaService } from './plan-idea.service';
import { PlanLeadService } from './plan-lead.service';

/**
 * The plan flow's clocks. Every job is a no-op while planning is switched off.
 *
 * - 15 min: stage reconcile, so a build finishing or a release landing moves
 *   the plan without anyone opening it.
 * - daily: draft expiry (archive 30 / purge 90), lead nudges and auto-release.
 *
 * The outcome-review sweep and the weekly signal scout are no longer scheduled: the routes
 * that read what they produce (outcomes, signals) went with the old Product Roadmap, so
 * their model calls had no consumer. Re-register them if a reader comes back.
 */
@Injectable()
export class PlanSchedulerRegistrationService implements OnModuleInit {
  constructor(
    private readonly stage: PlanStageService,
    private readonly ideas: PlanIdeaService,
    private readonly leads: PlanLeadService,
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
      await this.ideas.sweepExpiry();
      await this.leads.sweepLeads();
    });
  }
}
