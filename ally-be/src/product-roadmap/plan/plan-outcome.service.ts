import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BuilderEvidenceService } from 'src/builder/service/builder-evidence.service';
import { BuilderSessionKind } from 'src/builder/enum/builder.enum';
import { ContextAgentChunkService } from 'src/context-library/service/context-agent-chunk.service';
import { ClCollectionId } from 'src/context-library/enum/context-library.enum';
import {
  PlanOutcomeReview,
  PlanOutcomeVerdict,
} from 'src/product-planning/entity/plan-outcome-review.entity';
import {
  PlanEventKind,
  PlanNotificationKind,
  PlanStage,
} from 'src/product-planning/enum/product-planning.enum';
import { PlanEventService } from 'src/product-planning/service/plan-event.service';
import { PlanNotificationService } from 'src/product-planning/service/plan-notification.service';
import { PlanSettingsService } from 'src/product-planning/service/plan-settings.service';
import { RoadmapOpportunity } from '../entity/roadmap-opportunity.entity';
import { PlanAiService, PLANNING_PROMPTS } from './plan-ai.service';
import { PlanSession, PlanSessionStore } from './plan-session.store';
import { PlanStageService } from './plan-stage.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const VERDICTS: PlanOutcomeVerdict[] = [
  'hit',
  'partial',
  'miss',
  'too_early',
  'measurement_broken',
];

/** Review dates: release + each `reviewAfterDays`, as YYYY-MM-DD. Pure. */
export function reviewDueDates(releasedAt: Date, days: number[]): string[] {
  return [...new Set(days)]
    .sort((a, b) => a - b)
    .map((d) =>
      new Date(releasedAt.getTime() + d * DAY_MS).toISOString().slice(0, 10),
    );
}

/**
 * The outcome loop (rev 5.2 §B.5 Learn, P8). When a plan ships its review
 * dates are fixed from the frozen success measure; on each date the measure's
 * own question is asked again, a reviewer judges the answer against baseline,
 * target and guardrails, and the review is written to the plan and into the
 * Context Library's Product Outcomes collection, so later plans learn from it.
 */
@Injectable()
export class PlanOutcomeService {
  constructor(
    private readonly store: PlanSessionStore,
    private readonly stage: PlanStageService,
    private readonly ai: PlanAiService,
    private readonly evidence: BuilderEvidenceService,
    private readonly agentChunks: ContextAgentChunkService,
    private readonly events: PlanEventService,
    private readonly notifications: PlanNotificationService,
    private readonly settings: PlanSettingsService,
    @InjectRepository(PlanOutcomeReview)
    private readonly reviews: Repository<PlanOutcomeReview>,
    @InjectRepository(RoadmapOpportunity)
    private readonly opportunities: Repository<RoadmapOpportunity>,
  ) {}

  list(sessionId: string): Promise<PlanOutcomeReview[]> {
    return this.reviews.find({
      where: { sessionId },
      order: { dueDate: 'ASC' },
    });
  }

  /**
   * Daily: schedule review dates for plans that just shipped, then run every
   * review that is due. Manual measures wait for the lead's observation.
   */
  async sweep(
    now = new Date(),
  ): Promise<{ scheduled: number; reviewed: number }> {
    const settings = await this.settings.get();
    if (!settings.enabled) return { scheduled: 0, reviewed: 0 };
    const live = await this.store.repository
      .createQueryBuilder('s')
      .addSelect('s.plan')
      .where('s.kind = :kind', { kind: BuilderSessionKind.PLAN })
      .andWhere('s.planStage IN (:...stages)', {
        stages: [PlanStage.BUILDING, PlanStage.LAUNCHING, PlanStage.MEASURING],
      })
      .take(2000)
      .getMany();
    let scheduled = 0;
    let reviewed = 0;
    for (const plan of live as PlanSession[]) {
      try {
        if (await this.schedule(plan)) scheduled++;
        const fresh = await this.store.get(plan.id);
        for (const due of fresh.plan.reviews?.dueDates ?? []) {
          if (due > now.toISOString().slice(0, 10)) continue;
          if (
            await this.reviews.findOne({
              where: { sessionId: plan.id, dueDate: due },
            })
          )
            continue;
          const measure = fresh.plan.successMeasure;
          if (!measure || measure.method.kind !== 'analytics_question') {
            await this.notifications.notify(
              fresh.leadUserId ?? fresh.createdBy,
              fresh.id,
              PlanNotificationKind.OUTCOME,
              `"${fresh.title}" is due its outcome review. Record what you observed so it can be judged.`,
            );
            continue;
          }
          const answer = await this.evidence.analyticsAsk(
            measure.method.spec,
            fresh.leadUserId ?? fresh.createdBy,
          );
          await this.review(fresh, due, this.describeAnswer(answer), null);
          reviewed++;
        }
      } catch {
        // One plan's failure must not stop the sweep.
      }
    }
    return { scheduled, reviewed };
  }

  /** The lead records an observation for a manual measure; the reviewer judges it. */
  async recordObservation(
    sessionId: string,
    userId: number,
    dueDate: string,
    observed: string,
  ): Promise<PlanOutcomeReview> {
    await this.settings.assertEnabled();
    const plan = await this.store.get(sessionId);
    if (plan.leadUserId !== userId)
      throw new ForbiddenException(
        'Only this plan’s lead can record its outcome.',
      );
    if (!(plan.plan.reviews?.dueDates ?? []).includes(dueDate)) {
      throw new NotFoundException('No review is scheduled for that date.');
    }
    if (!observed.trim())
      throw new BadRequestException('Say what you observed.');
    return this.review(plan, dueDate, observed.trim(), userId);
  }

  /** Fix review dates once the plan has shipped. True when it scheduled them now. */
  private async schedule(plan: PlanSession): Promise<boolean> {
    if (plan.plan.reviews?.dueDates?.length) return false;
    const measure = plan.plan.successMeasure;
    if (!measure?.reviewAfterDays?.length || !plan.plan.opportunityId)
      return false;
    const opportunity = await this.opportunities.findOne({
      where: { id: plan.plan.opportunityId },
      select: { id: true, releasedAt: true, stage: true },
    });
    if (!opportunity?.releasedAt) return false;
    await this.store.patchPlan(plan.id, {
      reviews: {
        dueDates: reviewDueDates(
          opportunity.releasedAt,
          measure.reviewAfterDays,
        ),
        done: 0,
      },
    });
    return true;
  }

  private async review(
    plan: PlanSession,
    dueDate: string,
    observed: string,
    actorUserId: number | null,
  ): Promise<PlanOutcomeReview> {
    const measure = plan.plan.successMeasure;
    const out = await this.ai.json<{
      verdict?: string;
      reasons?: string;
      nextSteps?: string[];
      lesson?: string;
    }>({
      promptCode: PLANNING_PROMPTS.OUTCOME_REVIEW,
      payload: JSON.stringify(
        {
          title: plan.title,
          successMeasure: measure,
          reviewDate: dueDate,
          observed,
        },
        null,
        2,
      ),
      maxTokens: 2000,
      sessionId: plan.id,
      stage: PlanStage.MEASURING,
      actorUserId,
      specialist: 'outcome_reviewer',
    });
    const verdict = VERDICTS.includes(out?.verdict as PlanOutcomeVerdict)
      ? (out!.verdict as PlanOutcomeVerdict)
      : 'measurement_broken';
    const row = await this.reviews.save(
      this.reviews.create({
        sessionId: plan.id,
        dueDate,
        verdict,
        observed: observed.slice(0, 8000),
        reasons: String(
          out?.reasons ?? 'The reviewer did not return a readable judgement.',
        ).slice(0, 4000),
        nextSteps: (out?.nextSteps ?? [])
          .slice(0, 3)
          .map((s) => String(s).slice(0, 500)),
      }),
    );

    if (verdict !== 'measurement_broken') {
      try {
        const chunk = await this.agentChunks.writeAgentChunk({
          collection: ClCollectionId.PRODUCT_OUTCOMES,
          agent: 'planning',
          statement:
            `${plan.title}: ${measure?.metric ?? 'outcome'} — ${row.reasons}`.slice(
              0,
              600,
            ),
          body: out?.lesson ? `Lesson: ${out.lesson}` : null,
          facets: { verdict: verdict === 'too_early' ? 'too_early' : verdict },
          evidence: { sessionId: plan.id },
          createdBy: actorUserId,
        });
        await this.reviews.update(
          { id: row.id },
          { chunkCode: chunk.code ?? null },
        );
      } catch {
        // The review stands even if the library write fails; it can be re-added by hand.
      }
    }

    const done = await this.reviews.count({ where: { sessionId: plan.id } });
    await this.store.patchPlan(plan.id, {
      reviews: { dueDates: plan.plan.reviews?.dueDates ?? [dueDate], done },
    });
    await this.events.record({
      sessionId: plan.id,
      kind: PlanEventKind.OUTCOME_REVIEWED,
      actorUserId,
      detail: { dueDate, verdict },
    });
    const text = `Outcome review for "${plan.title}" (${dueDate}): ${verdict.replace('_', ' ')}. ${row.reasons}`;
    await this.notifications.notify(
      plan.createdBy,
      plan.id,
      PlanNotificationKind.OUTCOME,
      text,
    );
    await this.notifications.notify(
      plan.leadUserId,
      plan.id,
      PlanNotificationKind.OUTCOME,
      text,
    );
    await this.stage.sync(plan.id, actorUserId);
    return row;
  }

  private describeAnswer(answer: {
    ok?: boolean;
    outcome?: string;
    answer?: unknown;
    message?: string | null;
    caveats?: string[];
    error?: string;
  }): string {
    if (!answer?.ok)
      return `The measurement could not be taken: ${answer?.error ?? 'unknown error'}.`;
    return JSON.stringify(
      {
        outcome: answer.outcome,
        answer: answer.answer,
        message: answer.message,
        caveats: answer.caveats,
      },
      null,
      2,
    ).slice(0, 8000);
  }
}
