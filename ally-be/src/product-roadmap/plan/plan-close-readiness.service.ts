import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  OnModuleInit,
} from '@nestjs/common';
import { BuilderSessionService } from 'src/builder/service/builder-session.service';
import { BuilderSessionVisibility } from 'src/builder/enum/builder.enum';
import { LoggerService } from 'src/logger/logger.service';
import { planGateRegistry } from 'src/product-planning/service/plan-gate.registry';
import {
  mergeImpactTags,
  tagsForPaths,
} from 'src/product-planning/util/plan-impact.util';
import {
  CLOSE_REASON_MAX,
  CLOSE_REASON_MIN,
  PlanCloseReadiness,
  planCloseReadiness,
} from 'src/product-planning/util/plan-close-readiness.util';
import { RoadmapItemLookupService } from '../item/roadmap-item-lookup.service';
import { RoadmapItemReadService } from '../item/roadmap-item-read.service';
import {
  checkFactsHash,
  pathsIn,
  PlanCheckService,
} from './plan-check.service';
import { PlanReadinessService } from './plan-readiness.service';
import { PlanSession, PlanSessionStore } from './plan-session.store';
import { PlanStageService } from './plan-stage.service';

/**
 * "Ready to close the plan", gathered (audit 2026-11-19, rec 2). The rule
 * itself is the pure planCloseReadiness; this reads its inputs:
 *
 * - the PRD through PlanReadinessService.assess, the existing "PRD ready for
 *   a plan" (Builder's rubric, cold-review findings included, plus the
 *   success measure and the specialist checks), with the impact tags code
 *   derives from the paths the PRD names, so a check the PRD needs counts
 *   even before anyone has run it;
 * - the technical design through Builder's computeDesignReadiness (on the
 *   session detail), the same answer the Design tab shows;
 * - open answer conflicts from the plan record.
 *
 * Registered with planGateRegistry at start-up so Builder's interview can show
 * the agent the same blockers and refuse its "complete" while any is open,
 * and so the specialist reviewers run when the PRD first reads ready.
 */
@Injectable()
export class PlanCloseReadinessService implements OnModuleInit {
  private readonly logger = LoggerService.getInstance(
    PlanCloseReadinessService.name,
  );

  constructor(
    private readonly store: PlanSessionStore,
    private readonly builderSessions: BuilderSessionService,
    private readonly readiness: PlanReadinessService,
    private readonly checks: PlanCheckService,
    private readonly stage: PlanStageService,
    private readonly reader: RoadmapItemReadService,
    private readonly lookup: RoadmapItemLookupService,
  ) {}

  onModuleInit(): void {
    planGateRegistry.register({
      readiness: async (sessionId) => {
        const plan = await this.store.find(sessionId);
        return plan && this.isBeingPlanned(plan) ? this.assess(plan) : null;
      },
      prdReadied: (sessionId) => this.runReviewers(sessionId),
    });
  }

  /**
   * The Close plan dialog's list, for whoever may close the plan or work it
   * (an Owner, or the builder already assigned to it).
   */
  async forItem(userId: number, code: string): Promise<PlanCloseReadiness> {
    const item = await this.reader.detail(userId, code);
    if (!item.can.closePlan && !item.can.workPlan && !item.can.reopenPlan) {
      throw new ForbiddenException(
        'Only an Owner or the builder working this plan can see what it still needs.',
      );
    }
    const ref = await this.lookup.get(code);
    const plan = ref.builderSessionId
      ? await this.store.find(ref.builderSessionId)
      : null;
    if (!plan) throw new ConflictException('This idea has no plan yet.');
    return this.assess(plan);
  }

  /** The open blockers for one plan session. Never calls a model. */
  async assess(plan: PlanSession): Promise<PlanCloseReadiness> {
    const detail = await this.builderSessions.getSessionDetail(
      plan.id,
      plan.createdBy,
    );
    const prd = detail.prd ?? {};
    const tags = mergeImpactTags(
      plan.plan?.impactTags ?? [],
      (plan.plan?.impactTags ?? [])
        .filter((t) => t.source === 'lead')
        .map((t) => t.id),
      tagsForPaths(pathsIn(prd)),
      plan.leadUserId ?? plan.createdBy,
    );
    const forPrd = await this.readiness.assess(
      { ...plan, plan: { ...(plan.plan ?? {}), impactTags: tags } },
      detail.readiness,
      checkFactsHash(prd),
    );
    const design = (prd as { technicalDesign?: { status?: string } | null })
      .technicalDesign;
    return planCloseReadiness({
      planBlockers: forPrd.blockers,
      requirementCount: Array.isArray(
        (prd as { requirements?: unknown }).requirements,
      )
        ? ((prd as { requirements: unknown[] }).requirements.length ?? 0)
        : 0,
      design: design?.status
        ? {
            status: design.status,
            ready: !!detail.designReadiness?.ready,
            stale: !!detail.designReadiness?.stale,
            blockers: detail.designReadiness?.blockers ?? [],
          }
        : null,
      openConflicts: Number(plan.plan?.openConflicts ?? 0) || 0,
    });
  }

  /**
   * Close plan's server-side gate. A plan with no open blockers closes as it
   * always did, with or without a reason (the released frontend sends none).
   * A plan with open blockers closes only with a typed reason, which is kept
   * with the blockers as they stood and printed at the top of the build
   * brief; without one the answer is 409 `plan_not_ready` carrying the
   * blockers, so an older page shows why and a newer one opens its dialog.
   */
  async checkClose(
    plan: PlanSession,
    reason: string | undefined,
  ): Promise<{ reason: string; blockers: string[] } | null> {
    const readiness = await this.assess(plan);
    if (readiness.ready) return null;
    const why = String(reason ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    const count = readiness.blockers.length;
    if (why.length < CLOSE_REASON_MIN) {
      throw new HttpException(
        {
          statusCode: HttpStatus.CONFLICT,
          code: 'plan_not_ready',
          message: why
            ? 'Say a little more about why you are closing it anyway: the builder reads this first.'
            : `This plan isn't ready to close: ${count} thing${count === 1 ? ' is' : 's are'} still open. Reload the page to see them, or give a reason for closing it anyway.`,
          blockers: readiness.blockers,
          prdEmpty: readiness.prdEmpty,
        },
        HttpStatus.CONFLICT,
      );
    }
    if (why.length > CLOSE_REASON_MAX) {
      throw new HttpException(
        {
          statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
          code: 'reason_too_long',
          message: `Keep the reason under ${CLOSE_REASON_MAX} characters.`,
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return { reason: why, blockers: readiness.blockers.map((b) => b.text) };
  }

  /**
   * The specialist reviewers (safety, privacy, AI quality) the PRD's paths
   * call for, once it reads ready. Each judges a given PRD once
   * (PlanCheckService.run skips a check that already judged this PRD), so
   * the PRD flapping between ready and not costs nothing extra.
   */
  async runReviewers(sessionId: string): Promise<void> {
    const plan = await this.store.find(sessionId);
    if (!plan || !this.isBeingPlanned(plan)) return;
    const actor =
      plan.leadUserId ?? plan.plan?.planningStartedBy ?? plan.createdBy;
    try {
      const detail = await this.builderSessions.getSessionDetail(
        plan.id,
        plan.createdBy,
      );
      const tags = await this.checks.run(plan, detail.prd, actor);
      await this.store.patchPlan(plan.id, { impactTags: tags });
      await this.stage.sync(plan.id, actor);
    } catch (error) {
      this.logger.warn(
        `[PLAN_GATE] reviewers for ${sessionId} did not run: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /** A shared plan whose planning has started and is not closed as not pursuing. */
  isBeingPlanned(plan: PlanSession): boolean {
    return (
      plan.visibility === BuilderSessionVisibility.SHARED &&
      !plan.archivedAt &&
      plan.plan?.planningStarted === true &&
      !plan.plan?.closed
    );
  }
}
