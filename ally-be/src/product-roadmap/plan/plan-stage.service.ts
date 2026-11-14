import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import { BuilderSessionService } from 'src/builder/service/builder-session.service';
import {
  BuilderSessionKind,
  BuilderSessionStatus,
  BuilderSessionVisibility,
} from 'src/builder/enum/builder.enum';
import { PlanEventService } from 'src/product-planning/service/plan-event.service';
import { PlanNotificationService } from 'src/product-planning/service/plan-notification.service';
import {
  PlanEventKind,
  PlanNotificationKind,
  PlanStage,
} from 'src/product-planning/enum/product-planning.enum';
import {
  derivePlanStage,
  PlanStageFacts,
} from 'src/product-planning/util/plan-stage.util';
import { RoadmapOpportunity } from '../entity/roadmap-opportunity.entity';
import { RoadmapOpportunityStage } from '../enum/roadmap-opportunity.enum';
import { PlanSession, PlanSessionStore } from './plan-session.store';
import { PlanReadinessService } from './plan-readiness.service';
import { checkFactsHash } from './plan-check.service';

const BUILD_STATUSES: string[] = [
  BuilderSessionStatus.BUILDING,
  BuilderSessionStatus.WAITING_FOR_INPUT,
  BuilderSessionStatus.COMPLETED,
  BuilderSessionStatus.FAILED,
];

/**
 * The only writer of a plan's stage (rev 5.2 §B.4).
 *
 * `sync` gathers the facts, derives the stage with the pure derivePlanStage,
 * and writes it to the session and its opportunity when it changed, with a
 * `stage_changed` event. Called at every transition the plan flow makes, and
 * by a daily reconcile for transitions that happen elsewhere (a build ending,
 * a release landing).
 */
@Injectable()
export class PlanStageService {
  constructor(
    private readonly store: PlanSessionStore,
    private readonly builderSessions: BuilderSessionService,
    private readonly readiness: PlanReadinessService,
    private readonly events: PlanEventService,
    private readonly notifications: PlanNotificationService,
    @InjectRepository(RoadmapOpportunity)
    private readonly opportunities: Repository<RoadmapOpportunity>,
  ) {}

  async facts(plan: PlanSession): Promise<PlanStageFacts> {
    const record = plan.plan ?? {};
    const opportunity = record.opportunityId
      ? await this.opportunities.findOne({
          where: { id: record.opportunityId },
          select: { id: true, stage: true },
        })
      : null;
    const isPrivate = plan.visibility === BuilderSessionVisibility.PRIVATE;

    let prdReady = false;
    let designApproved = false;
    if (!isPrivate && plan.leadUserId) {
      const detail = await this.builderSessions.getSessionDetail(
        plan.id,
        plan.createdBy,
      );
      prdReady = (
        await this.readiness.assess(
          plan,
          detail.readiness,
          checkFactsHash(detail.prd),
        )
      ).ready;
      const design = (detail.prd as { technicalDesign?: { status?: string } })
        ?.technicalDesign;
      designApproved =
        design?.status === 'approved' && !detail.designReadiness.stale;
    }

    return {
      private: isPrivate,
      closed: !!record.closed && !record.closed.pendingConfirmation,
      leadUserId: plan.leadUserId ?? null,
      prdReady,
      designApproved,
      buildStarted:
        (plan.lastRunSequence ?? 0) > 0 || BUILD_STATUSES.includes(plan.status),
      shipped: opportunity?.stage === RoadmapOpportunityStage.RELEASED,
      launched: !!record.launch?.launchedAt,
      reviewsDue: record.reviews?.dueDates.length ?? 0,
      reviewsDone: record.reviews?.done ?? 0,
    };
  }

  /** Recompute and persist. Returns the stage. Never throws on a missing plan. */
  async sync(
    sessionId: string,
    actorUserId: number | null = null,
  ): Promise<PlanStage | null> {
    const plan = await this.store.find(sessionId);
    if (!plan) return null;
    const next = derivePlanStage(await this.facts(plan));
    const previous = (plan.planStage as PlanStage | null) ?? null;
    if (previous === next) return next;

    const now = new Date();
    await this.store.update(sessionId, { planStage: next, planStageAt: now });
    if (plan.plan?.opportunityId) {
      await this.opportunities.update(
        { id: plan.plan.opportunityId },
        { planStage: next, planStageAt: now },
      );
    }
    await this.events.record({
      sessionId,
      kind: PlanEventKind.STAGE_CHANGED,
      actorUserId,
      detail: { from: previous, to: next },
    });
    await this.onEnter(plan, next, actorUserId);
    await this.announce(plan, next);
    return next;
  }

  /**
   * What entering a stage fixes in place. The success measure freezes when the
   * design is approved, so the goalposts cannot move once building starts
   * (a later change needs a reason and is recorded — PlanLeadService).
   */
  private async onEnter(
    plan: PlanSession,
    stage: PlanStage,
    actorUserId: number | null,
  ): Promise<void> {
    if (stage === PlanStage.READY) {
      await this.events.record({
        sessionId: plan.id,
        kind: PlanEventKind.DESIGN_APPROVED,
        actorUserId,
      });
      if (!plan.plan?.measureFrozenAt && plan.plan?.successMeasure) {
        await this.store.patchPlan(plan.id, {
          measureFrozenAt: new Date().toISOString(),
        });
        await this.events.record({
          sessionId: plan.id,
          kind: PlanEventKind.MEASURE_FROZEN,
          actorUserId,
        });
      }
    } else if (stage === PlanStage.BUILDING) {
      await this.events.record({
        sessionId: plan.id,
        kind: PlanEventKind.BUILD_SENT,
        actorUserId,
      });
    }
  }

  /** The transitions the author and lead hear about (rev 5.2 decision 7). */
  private async announce(plan: PlanSession, stage: PlanStage): Promise<void> {
    const title = plan.title;
    const tell = (
      who: number | null | undefined,
      kind: PlanNotificationKind,
      text: string,
    ) => this.notifications.notify(who, plan.id, kind, text);
    if (stage === PlanStage.DESIGN) {
      await tell(
        plan.createdBy,
        PlanNotificationKind.PRD_READY,
        `The PRD for "${title}" is ready.`,
      );
    } else if (stage === PlanStage.BUILDING) {
      await tell(
        plan.createdBy,
        PlanNotificationKind.SENT_TO_BUILD,
        `"${title}" has been sent to build.`,
      );
    } else if (stage === PlanStage.MEASURING) {
      await tell(
        plan.createdBy,
        PlanNotificationKind.LAUNCHED,
        `"${title}" has launched. Its outcome will be reviewed on the dates set in the plan.`,
      );
    }
  }

  /** Daily: every live plan, so stages that moved elsewhere catch up. */
  async reconcile(): Promise<number> {
    const live = await this.store.repository.find({
      where: {
        kind: BuilderSessionKind.PLAN,
        archivedAt: IsNull(),
        planStage: Not(In([PlanStage.CLOSED, PlanStage.LEARNED])),
      },
      select: { id: true },
      take: 2000,
    });
    let changed = 0;
    for (const { id } of live) {
      try {
        const before = (await this.store.find(id))?.planStage;
        const after = await this.sync(id);
        if (after && after !== before) changed++;
      } catch {
        // One broken plan must not stop the rest of the sweep.
      }
    }
    return changed;
  }
}
