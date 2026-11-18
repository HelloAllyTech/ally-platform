import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { BuilderSessionService } from 'src/builder/service/builder-session.service';
import {
  PlanEventKind,
  PlanStage,
} from 'src/product-planning/enum/product-planning.enum';
import { PlanEventService } from 'src/product-planning/service/plan-event.service';
import { PlanSettingsService } from 'src/product-planning/service/plan-settings.service';
import type { PlanLaunchState } from 'src/product-planning/type/plan-record.type';
import { PlanAiService, PLANNING_PROMPTS } from './plan-ai.service';
import { PlanSessionStore } from './plan-session.store';
import { PlanStageService } from './plan-stage.service';

const KINDS: PlanLaunchState['items'][number]['kind'][] = [
  'product_update',
  'changelog',
  'tooltip',
  'tenant_comms',
  'rollout',
  'training_notes',
  'support_notes',
];

/**
 * Launch & adoption (rev 5.2 §B.5, P9). Once a plan's work is released, the
 * launch planner drafts the materials; every item is a proposal a person
 * publishes through Ally's own surfaces (Product Updates, tooltips, a tenant
 * email) and ticks off here. Nothing is sent by an agent. The plan is launched
 * when every item is done.
 */
@Injectable()
export class PlanLaunchService {
  constructor(
    private readonly store: PlanSessionStore,
    private readonly stage: PlanStageService,
    private readonly ai: PlanAiService,
    private readonly builderSessions: BuilderSessionService,
    private readonly events: PlanEventService,
    private readonly settings: PlanSettingsService,
  ) {}

  async draft(sessionId: string, userId: number): Promise<PlanLaunchState> {
    await this.settings.assertEnabled();
    const plan = await this.store.get(sessionId);
    if (plan.leadUserId !== userId)
      throw new ForbiddenException(
        'Only this plan’s lead can draft its launch.',
      );
    if (plan.planStage !== PlanStage.LAUNCHING) {
      throw new ForbiddenException(
        'Launch materials are drafted once the work has been released.',
      );
    }
    const detail = await this.builderSessions.getSessionDetail(
      sessionId,
      plan.createdBy,
    );
    const out = await this.ai.json<{
      items?: { kind?: string; title?: string; body?: string }[];
    }>({
      promptCode: PLANNING_PROMPTS.LAUNCH_PLAN,
      payload: JSON.stringify({
        title: plan.title,
        prd: detail.prd,
        successMeasure: plan.plan.successMeasure ?? null,
      }).slice(0, 120_000),
      maxTokens: 6000,
      sessionId,
      stage: PlanStage.LAUNCHING,
      actorUserId: userId,
      specialist: 'launch_planner',
    });
    const items = (out?.items ?? [])
      .filter((i) => KINDS.includes(i.kind as never) && i.body)
      .map((i) => ({
        id: randomUUID(),
        kind: i.kind as PlanLaunchState['items'][number]['kind'],
        title: String(i.title ?? i.kind).slice(0, 200),
        body: String(i.body).slice(0, 8000),
        done: false,
        doneBy: null,
        doneAt: null,
      }));
    const launch: PlanLaunchState = {
      items,
      draftedAt: new Date().toISOString(),
      launchedAt: null,
    };
    await this.store.patchPlan(sessionId, { launch });
    return launch;
  }

  async markItem(
    sessionId: string,
    userId: number,
    itemId: string,
    done: boolean,
  ): Promise<PlanLaunchState> {
    await this.settings.assertEnabled();
    const plan = await this.store.get(sessionId);
    if (plan.leadUserId !== userId)
      throw new ForbiddenException(
        'Only this plan’s lead can tick off its launch.',
      );
    const launch = plan.plan.launch;
    const item = launch?.items.find((i) => i.id === itemId);
    if (!launch || !item) throw new NotFoundException('Launch item not found');
    item.done = done;
    item.doneBy = done ? userId : null;
    item.doneAt = done ? new Date().toISOString() : null;
    const complete =
      launch.items.length > 0 && launch.items.every((i) => i.done);
    if (complete && !launch.launchedAt)
      launch.launchedAt = new Date().toISOString();
    if (!complete) launch.launchedAt = null;
    await this.store.patchPlan(sessionId, { launch });
    if (complete) {
      await this.events.record({
        sessionId,
        kind: PlanEventKind.LAUNCHED,
        actorUserId: userId,
      });
      await this.stage.sync(sessionId, userId);
    }
    return launch;
  }
}
