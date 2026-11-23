import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, IsNull } from 'typeorm';
import { randomUUID } from 'crypto';
import { BuilderMessageRepository } from 'src/builder/repository/builder-message.repository';
import { BuilderSessionService } from 'src/builder/service/builder-session.service';
import {
  BuilderMessageRole,
  BuilderSessionKind,
  BuilderSessionStatus,
  BuilderSessionVisibility,
} from 'src/builder/enum/builder.enum';
import { PlanAccessService } from 'src/product-planning/service/plan-access.service';
import { PlanEventService } from 'src/product-planning/service/plan-event.service';
import { PlanNotificationService } from 'src/product-planning/service/plan-notification.service';
import { PlanSettingsService } from 'src/product-planning/service/plan-settings.service';
import { PlanSpendService } from 'src/product-planning/service/plan-spend.service';
import {
  PlanEventKind,
  PlanNotificationKind,
} from 'src/product-planning/enum/product-planning.enum';
import type {
  PlanImpactTagId,
  PlanSuccessMeasure,
} from 'src/product-planning/type/plan-record.type';
import { mergeImpactTags } from 'src/product-planning/util/plan-impact.util';
import { requiredChecks } from 'src/product-planning/util/plan-readiness.util';
import { checkFactsHash, PlanCheckService } from './plan-check.service';
import type { PlanCheck } from 'src/product-planning/entity/plan-check.entity';
import type { PlanCheckKind } from 'src/product-planning/util/plan-readiness.util';
import { PlanSession, PlanSessionStore } from './plan-session.store';
import { PlanStageService } from './plan-stage.service';
import { PlanReadinessService } from './plan-readiness.service';
import { PlanView, PlanViewService } from './plan-view.service';

const DAY_MS = 24 * 60 * 60 * 1000;
export const NUDGE_AFTER_DAYS = 7;
export const RELEASE_AFTER_DAYS = 14;
/**
 * How the idle hand-back's note starts. P8's Measures counts idle-lead
 * releases by it (`plan_events.detail.note`), so keep the two together.
 */
export const IDLE_RELEASE_NOTE_PREFIX = 'No activity for';

/** A row of the Needs a lead queue. */
export interface PlanQueueItem {
  id: string;
  title: string;
  opportunityId: string | null;
  authorUserId: number;
  votes: number;
  filedAt: string | null;
  /** True when a close is waiting on a second Lead. */
  awaitingCloseConfirmation: boolean;
}

/** What a new lead reads first (rev 5.2 §B.5 Handover). Built by code, never a model. */
export interface PlanCatchUp {
  stage: string | null;
  readiness: { ready: boolean; blockers: string[] };
  successMeasure: PlanSuccessMeasure | null;
  measureFrozen: boolean;
  impactTags: { id: string; source: string; reason?: string }[];
  requiredChecks: string[];
  openFindings: { check: string; severity: string; title: string }[];
  lastAnswers: { content: string; createdBy: number | null; at: string }[];
  handBackNote: string | null;
  spendUsd: number;
}

/**
 * Everything a Lead does after filing (rev 5.2 §B.5, P3): the queue, taking a
 * plan on and handing it back, closing it as not pursuing, asking the author,
 * and the PRD-stage facts that make it measurable (impact tags, success
 * measure). The PRD itself is written in the plan's Builder session, which a
 * Lead reaches through the Lead toggle (see BuilderSessionVisibilityInterceptor).
 */
const OWNER_ONLY_ASSIGN = 'Only an Owner assigns who builds an idea.';
const OWNER_ONLY_CLOSE = 'Only an Owner closes, confirms or reopens an idea.';

@Injectable()
export class PlanLeadService {
  constructor(
    private readonly store: PlanSessionStore,
    private readonly view: PlanViewService,
    private readonly stage: PlanStageService,
    private readonly readiness: PlanReadinessService,
    private readonly checks: PlanCheckService,
    private readonly builderSessions: BuilderSessionService,
    private readonly messages: BuilderMessageRepository,
    private readonly access: PlanAccessService,
    private readonly events: PlanEventService,
    private readonly notifications: PlanNotificationService,
    private readonly settings: PlanSettingsService,
    private readonly spend: PlanSpendService,
    private readonly dataSource: DataSource,
  ) {}

  /** Filed plans nobody leads, most-voted first, then oldest. */
  async queue(userId: number): Promise<PlanQueueItem[]> {
    await this.settings.assertEnabled();
    await this.access.assertLead(userId);
    const rows = await this.store.repository
      .createQueryBuilder('s')
      .addSelect('s.plan')
      .where('s.kind = :kind', { kind: BuilderSessionKind.PLAN })
      .andWhere('s.visibility = :v', { v: BuilderSessionVisibility.SHARED })
      .andWhere('s.archivedAt IS NULL')
      .andWhere(
        "(s.leadUserId IS NULL OR (s.plan->'closed'->>'pendingConfirmation') = 'true')",
      )
      .andWhere("(s.planStage IS NULL OR s.planStage <> 'closed')")
      .take(500)
      .getMany();
    const votes = await this.votesFor(
      rows.map((r) => r.plan?.opportunityId).filter((id): id is string => !!id),
    );
    return rows
      .map((s) => ({
        id: s.id,
        title: s.title,
        opportunityId: s.plan?.opportunityId ?? null,
        authorUserId: s.createdBy,
        votes: votes.get(s.plan?.opportunityId ?? '') ?? 0,
        filedAt: s.plan?.filedAt ?? null,
        awaitingCloseConfirmation: !!s.plan?.closed?.pendingConfirmation,
      }))
      .sort(
        (a, b) =>
          b.votes - a.votes ||
          String(a.filedAt ?? '').localeCompare(String(b.filedAt ?? '')),
      );
  }

  /**
   * Take this on: one atomic claim; the loser is told who won. Only an Owner
   * (lifecycle 2026-11-18): Builders don't claim ideas, an Owner assigns them.
   */
  async takeOn(sessionId: string, userId: number): Promise<PlanView> {
    await this.settings.assertEnabled();
    await this.access.assertOwner(userId, OWNER_ONLY_ASSIGN);
    const plan = await this.sharedPlan(sessionId);
    if (plan.plan.closed)
      throw new BadRequestException('Reopen this plan before taking it on.');
    // IsNull(), not a literal null: TypeORM compiles `= NULL`, which never matches.
    const claimed = await this.store.repository.update(
      { id: sessionId, leadUserId: IsNull() },
      { leadUserId: userId, updatedBy: userId },
    );
    if (!claimed.affected) {
      const current = await this.store.get(sessionId);
      if (current.leadUserId === userId)
        return this.view.render(current, userId);
      throw new ConflictException(
        `Someone else took this on a moment ago (user ${current.leadUserId}).`,
      );
    }
    await this.store.patchPlan(sessionId, {
      nudgedAt: null,
      handBackNote: plan.plan.handBackNote ?? null,
    });
    await this.events.record({
      sessionId,
      kind: PlanEventKind.TAKEN_ON,
      actorUserId: userId,
    });
    await this.notifications.notify(
      plan.createdBy,
      sessionId,
      PlanNotificationKind.TAKEN_ON,
      `Your idea "${plan.title}" has been taken on. You'll hear when its PRD is ready.`,
    );
    await this.stage.sync(sessionId, userId);
    return this.view.render(await this.store.get(sessionId), userId);
  }

  async handBack(
    sessionId: string,
    userId: number,
    note?: string,
  ): Promise<PlanView> {
    await this.settings.assertEnabled();
    const plan = await this.sharedPlan(sessionId);
    if (plan.leadUserId !== userId)
      throw new ForbiddenException('Only this plan’s lead can hand it back.');
    await this.release(plan, userId, PlanEventKind.HANDED_BACK, note ?? null);
    return this.view.render(await this.store.get(sessionId), userId);
  }

  /**
   * Daily: nudge a lead after 7 quiet days, hand the plan back after 14, and
   * hand back any plan whose lead lost the Lead toggle. Never releases a plan
   * with a live build run.
   */
  async sweepLeads(
    now = new Date(),
  ): Promise<{ nudged: number; released: number }> {
    const settings = await this.settings.get();
    if (!settings.enabled) return { nudged: 0, released: 0 };
    // Roadmap v2 (D11, plan §4.10): the Owner assigns the lead, so nothing is unassigned
    // automatically. An idle lead shows as "Reassign?" in the Owner's To triage instead, and
    // the old Lead toggle no longer decides who may lead (a Builder may not hold it).
    const ownerAssigns = (await this.settings.getRoadmapV2()).enabled;
    const led = await this.store.repository
      .createQueryBuilder('s')
      .addSelect('s.plan')
      .where('s.kind = :kind', { kind: BuilderSessionKind.PLAN })
      .andWhere('s.leadUserId IS NOT NULL')
      .andWhere('s.archivedAt IS NULL')
      .take(2000)
      .getMany();
    let nudged = 0;
    let released = 0;
    for (const plan of led as PlanSession[]) {
      const live =
        plan.status === BuilderSessionStatus.BUILDING ||
        plan.status === BuilderSessionStatus.WAITING_FOR_INPUT;
      if (live || plan.plan?.closed) continue;
      if (
        !ownerAssigns &&
        !(await this.access.canLead(plan.leadUserId as number))
      ) {
        await this.release(
          plan,
          null,
          PlanEventKind.AUTO_RELEASED,
          'The lead no longer holds the Lead toggle.',
        );
        released++;
        continue;
      }
      const quietDays = (now.getTime() - plan.updatedAt.getTime()) / DAY_MS;
      if (quietDays >= RELEASE_AFTER_DAYS && !ownerAssigns) {
        await this.release(
          plan,
          null,
          PlanEventKind.AUTO_RELEASED,
          `${IDLE_RELEASE_NOTE_PREFIX} ${RELEASE_AFTER_DAYS} days.`,
        );
        released++;
      } else if (quietDays >= NUDGE_AFTER_DAYS && !plan.plan?.nudgedAt) {
        await this.notifications.notify(
          plan.leadUserId,
          plan.id,
          PlanNotificationKind.NUDGE,
          `No activity on "${plan.title}" for a week. Continue, or hand it back so someone else can take it on.`,
        );
        await this.store.patchPlan(plan.id, { nudgedAt: now.toISOString() });
        nudged++;
      }
    }
    return { nudged, released };
  }

  /**
   * Close as not pursuing (an Owner). The old rule that a second Lead confirms
   * above the vote threshold (rev 5.2 decision 4) is gone: only an Owner
   * closes now. confirmClose stays for closes already waiting.
   */
  async close(
    sessionId: string,
    userId: number,
    reason: string,
  ): Promise<PlanView> {
    await this.settings.assertEnabled();
    // Closing as not pursuing is declining it: the Owner's call only.
    await this.access.assertOwner(userId, OWNER_ONLY_CLOSE);
    const plan = await this.sharedPlan(sessionId);
    if (plan.plan.closed && !plan.plan.closed.pendingConfirmation) {
      return this.view.render(plan, userId);
    }
    const text = (reason ?? '').trim();
    if (text.length < 10)
      throw new BadRequestException(
        'Say why, in a sentence the author will read.',
      );
    // Only an Owner closes now, and today there is one Owner: a second-person
    // confirmation above the vote threshold would leave the close pending
    // forever. The Owner's decision stands on its own, as a decline does.
    const needsSecond = false;
    await this.store.patchPlan(sessionId, {
      closed: {
        at: new Date().toISOString(),
        by: userId,
        reason: text,
        pendingConfirmation: needsSecond,
        confirmedBy: null,
      },
    });
    if (!needsSecond) await this.finishClose(plan, userId, text);
    return this.view.render(await this.store.get(sessionId), userId);
  }

  async confirmClose(sessionId: string, userId: number): Promise<PlanView> {
    await this.settings.assertEnabled();
    await this.access.assertOwner(userId, OWNER_ONLY_CLOSE);
    const plan = await this.sharedPlan(sessionId);
    const closed = plan.plan.closed;
    if (!closed?.pendingConfirmation)
      throw new BadRequestException('Nothing is waiting for confirmation.');
    await this.store.patchPlan(sessionId, {
      closed: { ...closed, pendingConfirmation: false, confirmedBy: userId },
    });
    await this.finishClose(plan, userId, closed.reason);
    return this.view.render(await this.store.get(sessionId), userId);
  }

  async reopen(sessionId: string, userId: number): Promise<PlanView> {
    await this.settings.assertEnabled();
    await this.access.assertOwner(userId, OWNER_ONLY_CLOSE);
    const plan = await this.sharedPlan(sessionId);
    if (!plan.plan.closed) return this.view.render(plan, userId);
    await this.store.patchPlan(sessionId, { closed: null });
    await this.events.record({
      sessionId,
      kind: PlanEventKind.REOPENED,
      actorUserId: userId,
    });
    await this.stage.sync(sessionId, userId);
    return this.view.render(await this.store.get(sessionId), userId);
  }

  /** The lead asks the author something; the author answers in the plan. */
  async askAuthor(
    sessionId: string,
    userId: number,
    question: string,
  ): Promise<PlanView> {
    const plan = await this.ledBy(sessionId, userId);
    const questionId = randomUUID();
    await this.messages.appendMessage(sessionId, {
      role: BuilderMessageRole.USER,
      content: `Question for the author: ${question.trim()}`,
      metadata: { askAuthor: { questionId, open: true } },
      createdBy: userId,
    });
    await this.events.record({
      sessionId,
      kind: PlanEventKind.AUTHOR_ASKED,
      actorUserId: userId,
      detail: { questionId },
    });
    await this.notifications.notify(
      plan.createdBy,
      sessionId,
      PlanNotificationKind.AUTHOR_QUESTION,
      `The lead of "${plan.title}" has a question for you.`,
    );
    return this.view.render(await this.store.get(sessionId), userId);
  }

  /**
   * The author's one write after filing. Lands in the transcript as the
   * author's words for the lead's next turn; it never edits the PRD itself.
   */
  async answerAuthorQuestion(
    sessionId: string,
    userId: number,
    questionId: string,
    answer: string,
  ): Promise<PlanView> {
    await this.settings.assertEnabled();
    const plan = await this.sharedPlan(sessionId);
    if (plan.createdBy !== userId)
      throw new ForbiddenException('Only the author can answer this.');
    const asked = (await this.messages.listBySession(sessionId)).find(
      (m) => m.metadata?.askAuthor?.questionId === questionId,
    );
    if (!asked) throw new NotFoundException('Question not found');
    await this.messages.appendMessage(sessionId, {
      role: BuilderMessageRole.USER,
      content: `The author answered: ${answer.trim()}`,
      metadata: { authorAnswer: { questionId } },
      createdBy: userId,
    });
    await this.notifications.notify(
      plan.leadUserId,
      sessionId,
      PlanNotificationKind.AUTHOR_ANSWERED,
      `The author of "${plan.title}" answered your question.`,
    );
    return this.view.render(await this.store.get(sessionId), userId);
  }

  /** The lead's choice of what the plan touches; code tags always stay. */
  async setImpactTags(
    sessionId: string,
    userId: number,
    tags: PlanImpactTagId[],
  ): Promise<PlanView> {
    const plan = await this.planWork(sessionId, userId);
    const merged = mergeImpactTags(
      plan.plan.impactTags ?? [],
      tags,
      [],
      userId,
    );
    await this.store.patchPlan(sessionId, { impactTags: merged });
    const before = new Set(
      requiredChecks((plan.plan.impactTags ?? []).map((t) => t.id)),
    );
    for (const kind of requiredChecks(merged.map((t) => t.id))) {
      if (!before.has(kind)) {
        await this.events.record({
          sessionId,
          kind: PlanEventKind.CHECK_REQUIRED,
          actorUserId: userId,
          detail: { check: kind },
        });
      }
    }
    await this.stage.sync(sessionId, userId);
    return this.view.render(await this.store.get(sessionId), userId);
  }

  /**
   * Set the success measure. Frozen once the design is approved: a later
   * change needs a reason and is recorded, so goalposts never move silently.
   */
  async setSuccessMeasure(
    sessionId: string,
    userId: number,
    measure: PlanSuccessMeasure,
    changeReason?: string,
  ): Promise<PlanView> {
    const plan = await this.planWork(sessionId, userId);
    const frozen = !!plan.plan.measureFrozenAt;
    if (frozen && !(changeReason ?? '').trim()) {
      throw new BadRequestException(
        'The success measure is frozen. Say why it has to change.',
      );
    }
    const days = [...new Set(measure.reviewAfterDays)].sort((a, b) => a - b);
    await this.store.patchPlan(sessionId, {
      successMeasure: { ...measure, reviewAfterDays: days },
    });
    if (frozen) {
      await this.events.record({
        sessionId,
        kind: PlanEventKind.MEASURE_CHANGED,
        actorUserId: userId,
        detail: {
          before: plan.plan.successMeasure ?? null,
          reason: changeReason,
        },
      });
    }
    await this.stage.sync(sessionId, userId);
    return this.view.render(await this.store.get(sessionId), userId);
  }

  async catchUp(sessionId: string, userId: number): Promise<PlanCatchUp> {
    await this.settings.assertEnabled();
    await this.access.assertLead(userId);
    const plan = await this.sharedPlan(sessionId);
    const detail = await this.builderSessions.getSessionDetail(
      sessionId,
      plan.createdBy,
    );
    const readiness = await this.readiness.assess(
      plan,
      detail.readiness,
      checkFactsHash(detail.prd),
    );
    const checkRows = await this.checks.list(sessionId);
    const lastAnswers = (await this.messages.listBySession(sessionId))
      .filter(
        (m) =>
          m.role === BuilderMessageRole.USER &&
          m.content &&
          m.metadata?.planStage !== 'idea',
      )
      .slice(-5)
      .map((m) => ({
        content: m.content as string,
        createdBy: m.createdBy ?? null,
        at:
          (m as unknown as { createdAt: Date }).createdAt?.toISOString?.() ??
          '',
      }));
    const summary = await this.spend.summarize(sessionId);
    return {
      stage: plan.planStage ?? null,
      readiness: { ready: readiness.ready, blockers: readiness.blockers },
      successMeasure: plan.plan.successMeasure ?? null,
      measureFrozen: !!plan.plan.measureFrozenAt,
      impactTags: (plan.plan.impactTags ?? []).map((t) => ({
        id: t.id,
        source: t.source,
        reason: t.reason,
      })),
      requiredChecks: requiredChecks(
        (plan.plan.impactTags ?? []).map((t) => t.id),
      ),
      openFindings: checkRows.flatMap((c) =>
        c.findings
          .filter((f) => !f.resolution)
          .map((f) => ({
            check: c.kind,
            severity: f.severity,
            title: f.title,
          })),
      ),
      lastAnswers,
      handBackNote: plan.plan.handBackNote ?? null,
      spendUsd: summary.totalUsd,
    };
  }

  /** Run the checks the plan's tags require (or one), adding code's tags first. */
  async runChecks(
    sessionId: string,
    userId: number,
    only?: PlanCheckKind,
  ): Promise<PlanCheck[]> {
    const plan = await this.planWork(sessionId, userId);
    const detail = await this.builderSessions.getSessionDetail(
      sessionId,
      plan.createdBy,
    );
    const tags = await this.checks.run(plan, detail.prd, userId, only);
    await this.store.patchPlan(sessionId, { impactTags: tags });
    await this.stage.sync(sessionId, userId);
    return this.checks.list(sessionId);
  }

  async resolveFinding(
    sessionId: string,
    userId: number,
    kind: PlanCheckKind,
    findingId: string,
    resolution: { kind: 'fixed' | 'dismissed'; reason: string },
  ): Promise<PlanCheck[]> {
    const plan = await this.planWork(sessionId, userId);
    // planWork has already checked the caller: the lead, or an Owner.
    await this.checks.resolve(plan, userId, kind, findingId, resolution, {
      authorised: true,
    });
    await this.stage.sync(sessionId, userId);
    return this.checks.list(sessionId);
  }

  async listChecks(sessionId: string, userId: number): Promise<PlanCheck[]> {
    await this.assertPlanWorkOn();
    const plan = await this.sharedPlan(sessionId);
    if (!(await this.access.canRead(plan, userId)))
      throw new NotFoundException('Plan not found');
    return this.checks.list(sessionId);
  }

  private async finishClose(
    plan: PlanSession,
    userId: number,
    reason: string,
  ): Promise<void> {
    await this.events.record({
      sessionId: plan.id,
      kind: PlanEventKind.CLOSED,
      actorUserId: userId,
      detail: { reason },
    });
    await this.notifications.notify(
      plan.createdBy,
      plan.id,
      PlanNotificationKind.CLOSED,
      `"${plan.title}" is not being pursued for now. The reason: ${reason}`,
    );
    await this.stage.sync(plan.id, userId);
  }

  private async release(
    plan: PlanSession,
    actorUserId: number | null,
    kind: PlanEventKind.HANDED_BACK | PlanEventKind.AUTO_RELEASED,
    note: string | null,
  ): Promise<void> {
    const formerLead = plan.leadUserId;
    await this.store.repository.update(
      { id: plan.id, leadUserId: formerLead as number },
      { leadUserId: null },
    );
    await this.store.patchPlan(plan.id, { handBackNote: note, nudgedAt: null });
    await this.events.record({
      sessionId: plan.id,
      kind,
      actorUserId,
      detail: note ? { note } : null,
    });
    await this.notifications.notify(
      plan.createdBy,
      plan.id,
      PlanNotificationKind.HANDED_BACK,
      `"${plan.title}" is waiting for a new lead.`,
    );
    if (kind === PlanEventKind.AUTO_RELEASED) {
      await this.notifications.notify(
        formerLead,
        plan.id,
        PlanNotificationKind.AUTO_RELEASED,
        `"${plan.title}" was handed back automatically. ${note ?? ''}`.trim(),
      );
    }
    await this.stage.sync(plan.id, actorUserId);
  }

  private async sharedPlan(sessionId: string): Promise<PlanSession> {
    const plan = await this.store.find(sessionId);
    if (!plan || plan.visibility !== BuilderSessionVisibility.SHARED) {
      throw new NotFoundException('Plan not found');
    }
    return plan;
  }

  /**
   * The plan's own work (impact tags, the success measure, asking the author,
   * checks): its assigned builder, or an Owner, who plans it before anyone is
   * assigned (lifecycle 2026-11-18).
   */
  private async ledBy(sessionId: string, userId: number): Promise<PlanSession> {
    await this.settings.assertEnabled();
    await this.access.assertLead(userId);
    const plan = await this.sharedPlan(sessionId);
    if (plan.leadUserId !== userId && !(await this.access.isOwner(userId))) {
      throw new ForbiddenException(
        'Only an Owner or the builder assigned to this idea can do that.',
      );
    }
    return plan;
  }

  /**
   * The plan's success measure, impact tags and specialist checks, which the
   * Owner-led flow needs (audit 2026-11-19, rec 2): reachable while either
   * the old planning flag or `roadmap_v2` is on, so turning the Owner-led
   * flow on does not need the rest of the old planning flow switched on.
   * Same people as ledBy: the assigned builder, or an Owner.
   */
  private async planWork(
    sessionId: string,
    userId: number,
  ): Promise<PlanSession> {
    await this.assertPlanWorkOn();
    await this.access.assertLead(userId);
    const plan = await this.sharedPlan(sessionId);
    if (plan.leadUserId !== userId && !(await this.access.isOwner(userId))) {
      throw new ForbiddenException(
        'Only an Owner or the builder assigned to this idea can do that.',
      );
    }
    return plan;
  }

  private async assertPlanWorkOn(): Promise<void> {
    if ((await this.settings.get()).enabled) return;
    await this.settings.assertRoadmapV2();
  }

  private async votesFor(
    opportunityIds: string[],
  ): Promise<Map<string, number>> {
    if (!opportunityIds.length) return new Map();
    const rows: { opportunityId: string; votes: string }[] =
      await this.dataSource.query(
        `SELECT "opportunityId", COALESCE(SUM(votes), 0) AS votes
         FROM "roadmap_allocations" WHERE "opportunityId" = ANY($1)
        GROUP BY "opportunityId"`,
        [opportunityIds],
      );
    return new Map(rows.map((r) => [r.opportunityId, Number(r.votes)]));
  }
}
