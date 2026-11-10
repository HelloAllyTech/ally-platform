import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { BuilderSessionService } from 'src/builder/service/builder-session.service';
import { BuilderMessageRepository } from 'src/builder/repository/builder-message.repository';
import {
  BuilderMessageRole,
  BuilderSessionKind,
  BuilderSessionVisibility,
} from 'src/builder/enum/builder.enum';
import { PlanAccessService } from 'src/product-planning/service/plan-access.service';
import { PlanEventService } from 'src/product-planning/service/plan-event.service';
import { PlanSpendService } from 'src/product-planning/service/plan-spend.service';
import { PlanSettingsService } from 'src/product-planning/service/plan-settings.service';
import { PlanNotificationService } from 'src/product-planning/service/plan-notification.service';
import {
  PlanEventKind,
  PlanNotificationKind,
  PlanStage,
} from 'src/product-planning/enum/product-planning.enum';
import { RoadmapOpportunity } from '../entity/roadmap-opportunity.entity';
import { RoadmapIdeaDraft } from '../entity/roadmap-idea-draft.entity';
import { RoadmapCopilotService } from '../service/roadmap-copilot.service';
import { RoadmapOpportunityService } from '../service/roadmap-opportunity.service';
import { RoadmapBuilderService } from '../service/roadmap-builder.service';
import { CreateOpportunityDto } from '../dto/roadmap-opportunity.dto';
import { PlanSession, PlanSessionStore } from './plan-session.store';
import { PlanStageService } from './plan-stage.service';
import {
  ARCHIVE_AFTER_DAYS,
  PlanView,
  PlanViewService,
  PURGE_AFTER_ARCHIVE_DAYS,
  WARN_DAYS_BEFORE,
} from './plan-view.service';

const DAY_MS = 24 * 60 * 60 * 1000;
/** The registry row the copilot's own calls run under; used here only to label spend rows. */
const COPILOT_SPEND_TASK = 'roadmap-opportunity-copilot';
const IDEA_STAGE = { planStage: 'idea' } as const;

/** The copilot's line when the private draft reaches its spend wrap-up point. */
export const IDEA_WRAP_UP_REPLY =
  'I have enough to work with here. If the checklist shows everything is covered, file it now; ' +
  'otherwise park it and come back with fresh eyes. Either way nothing is lost.';

export interface PlanSummary {
  id: string;
  title: string;
  stage: string | null;
  private: boolean;
  parked: boolean;
  archivedAt: string | null;
  updatedAt: string;
  opportunityId: string | null;
}

/**
 * The private Idea stage (rev 5.2 §B.5, P2): a plan is a session from its
 * first words. Park it (no AI, no cost) or work it up with the copilot, whose
 * verdicts are held on the server; File it turns the draft into a roadmap
 * opportunity in one idempotent step and the same session carries on into the
 * PRD stage once a lead takes it on.
 */
@Injectable()
export class PlanIdeaService {
  constructor(
    private readonly store: PlanSessionStore,
    private readonly view: PlanViewService,
    private readonly stage: PlanStageService,
    private readonly builderSessions: BuilderSessionService,
    private readonly messages: BuilderMessageRepository,
    private readonly copilot: RoadmapCopilotService,
    private readonly opportunityService: RoadmapOpportunityService,
    private readonly roadmapBuilder: RoadmapBuilderService,
    private readonly access: PlanAccessService,
    private readonly settings: PlanSettingsService,
    private readonly spend: PlanSpendService,
    private readonly events: PlanEventService,
    private readonly notifications: PlanNotificationService,
    private readonly dataSource: DataSource,
    @InjectRepository(RoadmapOpportunity)
    private readonly opportunities: Repository<RoadmapOpportunity>,
    @InjectRepository(RoadmapIdeaDraft)
    private readonly drafts: Repository<RoadmapIdeaDraft>,
  ) {}

  /** Park it (`park: true`, no AI) or work it up: either way a private plan session. */
  async start(
    userId: number,
    input: { text: string; captureMode?: 'typed' | 'voice'; park?: boolean },
  ): Promise<PlanView> {
    await this.settings.assertEnabled();
    await this.access.assertIdeas(userId);
    const text = (input.text ?? '').trim();
    if (!text) throw new BadRequestException('Say what the idea is first.');
    const id = await this.createPrivatePlan(userId, text, {
      parked: !!input.park,
      captureMode: input.captureMode ?? 'typed',
    });
    return this.view.render(await this.store.get(id), userId);
  }

  async listMine(userId: number): Promise<PlanSummary[]> {
    await this.settings.assertEnabled();
    const rows = await this.store.repository
      .createQueryBuilder('s')
      .addSelect('s.plan')
      .where('s.kind = :kind', { kind: BuilderSessionKind.PLAN })
      .andWhere('s.createdBy = :userId', { userId })
      .orderBy('s.updatedAt', 'DESC')
      .take(200)
      .getMany();
    return rows.map((s) => ({
      id: s.id,
      title: s.title,
      stage: s.planStage ?? null,
      private: s.visibility === BuilderSessionVisibility.PRIVATE,
      parked: !!s.plan?.parked,
      archivedAt: s.archivedAt ? s.archivedAt.toISOString() : null,
      updatedAt: s.updatedAt.toISOString(),
      opportunityId: s.plan?.opportunityId ?? null,
    }));
  }

  async get(sessionId: string, userId: number): Promise<PlanView> {
    await this.settings.assertEnabled();
    const plan = await this.readable(sessionId, userId);
    return this.view.render(plan, userId);
  }

  /** One copilot turn on a private draft. */
  async turn(
    sessionId: string,
    userId: number,
    text: string,
  ): Promise<PlanView> {
    await this.settings.assertEnabled();
    const plan = await this.editableDraft(sessionId, userId);
    const content = (text ?? '').trim();
    if (!content) throw new BadRequestException('Write something first.');

    await this.messages.appendMessage(sessionId, {
      role: BuilderMessageRole.USER,
      content,
      metadata: IDEA_STAGE,
      createdBy: userId,
    });
    const now = new Date().toISOString();
    await this.store.patchPlan(sessionId, { lastActiveAt: now, parked: false });

    // The private stage never hits a hard wall: past its wrap-up point the
    // copilot stops exploring and points at File it or Park (rev 5.2 decision 6).
    const ceiling = await this.spend.checkCeiling(sessionId, PlanStage.IDEA);
    if (ceiling.state === 'wrap_up') {
      await this.messages.appendMessage(sessionId, {
        role: BuilderMessageRole.ASSISTANT,
        content: IDEA_WRAP_UP_REPLY,
        metadata: { ...IDEA_STAGE, wrapUp: true },
      });
      return this.view.render(await this.store.get(sessionId), userId);
    }

    const history = (await this.messages.listBySession(sessionId))
      .filter(
        (m) =>
          m.metadata?.planStage === 'idea' && m.content && !m.metadata?.wrapUp,
      )
      .map((m) => ({
        role:
          m.role === BuilderMessageRole.USER
            ? ('admin' as const)
            : ('agent' as const),
        content: m.content as string,
      }));

    const result = await this.copilot.takeTurn(
      {
        messages: history,
        brief: plan.plan.idea?.brief,
        onUsage: async (usage) => {
          await this.spend.record({
            sessionId,
            stage: PlanStage.IDEA,
            actorUserId: userId,
            specialist: null,
            taskId: COPILOT_SPEND_TASK,
            provider: usage.provider,
            model: usage.model,
            tokensIn: usage.inputTokens,
            tokensOut: usage.outputTokens,
            cachedTokens: usage.cachedTokens,
            cacheWriteTokens: usage.cacheCreationTokens,
          });
        },
      },
      userId,
    );

    await this.messages.appendMessage(sessionId, {
      role: BuilderMessageRole.ASSISTANT,
      content: result.reply,
      metadata: { ...IDEA_STAGE, gates: result.gates },
    });
    await this.store.patchPlan(sessionId, {
      idea: {
        brief: result.brief ?? plan.plan.idea?.brief ?? null,
        gates: (result.gates ?? []).map((g) => ({
          id: String(g.id),
          met: !!g.met,
          note: g.note ?? undefined,
        })),
        draft: result.draft
          ? {
              description: result.draft.description,
              productGoal: result.draft.productGoal ?? null,
              effort: (result.draft.effort as string | null) ?? null,
            }
          : null,
        readinessToken: result.readinessToken ?? null,
        lastTurnAt: new Date().toISOString(),
      },
    });
    return this.view.render(await this.store.get(sessionId), userId);
  }

  /**
   * File it: the draft becomes a roadmap opportunity, the session becomes
   * shared, and the filing interview is handed to the PRD stage. Idempotent
   * (a double click files once) and all-or-nothing from the author's view.
   */
  async file(
    sessionId: string,
    userId: number,
    input: { productGoal?: string | null } = {},
  ): Promise<PlanView> {
    await this.settings.assertEnabled();
    const plan = await this.readable(sessionId, userId);
    if (plan.plan.opportunityId) return this.view.render(plan, userId);
    await this.access.assertIdeas(userId);
    if (plan.createdBy !== userId)
      throw new NotFoundException('Plan not found');

    const idea = plan.plan.idea;
    const gates = idea?.gates ?? [];
    if (
      !idea?.draft ||
      !idea.readinessToken ||
      !gates.length ||
      !gates.every((g) => g.met)
    ) {
      const missing = gates.filter((g) => !g.met).map((g) => g.id);
      throw new BadRequestException(
        missing.length
          ? `Not ready to file yet. Still needed: ${missing.join(', ')}.`
          : 'Not ready to file yet. Keep going with the copilot until the checklist is complete.',
      );
    }
    const productGoal = (
      input.productGoal ??
      idea.draft.productGoal ??
      ''
    ).trim();
    if (!productGoal) {
      throw new BadRequestException('Pick the product goal this idea serves.');
    }

    // Claim the filing so a second click waits on the first instead of filing twice.
    const claimed: unknown[] = await this.dataSource.query(
      `UPDATE "builder_sessions"
          SET "plan" = COALESCE("plan", '{}'::jsonb) || jsonb_build_object('filingAt', now()::text)
        WHERE id = $1 AND COALESCE("plan"->>'filingAt', '') = ''
          AND COALESCE("plan"->>'opportunityId', '') = ''
        RETURNING id`,
      [sessionId],
    );
    const rows = Array.isArray(claimed?.[0])
      ? (claimed[0] as unknown[])
      : claimed;
    if (!rows?.length)
      return this.view.render(await this.store.get(sessionId), userId);

    try {
      const transcript = (await this.messages.listBySession(sessionId))
        .filter((m) => m.metadata?.planStage === 'idea' && m.content)
        .map((m) => ({
          role: m.role === BuilderMessageRole.USER ? 'admin' : 'agent',
          content: m.content,
        }));
      const created = await this.opportunityService.create(
        userId,
        {
          description: idea.draft.description,
          productGoal,
          effort: idea.draft.effort,
          readinessToken: idea.readinessToken,
          brief: (idea.brief ?? undefined) as Record<string, any> | undefined,
          interviewTranscript: transcript,
        } as unknown as CreateOpportunityDto,
        { canManage: false, enforceReadiness: true },
      );

      await this.opportunities.update(
        { id: created.id, builderSessionId: IsNull() },
        { builderSessionId: sessionId },
      );
      const filedAt = new Date().toISOString();
      await this.store.update(sessionId, {
        visibility: BuilderSessionVisibility.SHARED,
        title: firstLine(idea.draft.description),
        archivedAt: null,
        updatedBy: userId,
      });
      await this.store.patchPlan(sessionId, {
        filedAt,
        opportunityId: created.id,
        filingAt: null,
        lastActiveAt: filedAt,
      });
      const handoff = await this.roadmapBuilder.handoffTextForOpportunity(
        created.id,
      );
      if (handoff)
        await this.builderSessions.attachHandoffContext(sessionId, handoff);
      await this.events.record({
        sessionId,
        kind: PlanEventKind.FILED,
        actorUserId: userId,
        detail: { opportunityId: created.id },
      });
      await this.events.record({
        sessionId,
        kind: PlanEventKind.VISIBILITY_CHANGED,
        actorUserId: userId,
        detail: { to: 'shared' },
      });
      await this.stage.sync(sessionId, userId);
    } catch (error) {
      await this.store.patchPlan(sessionId, { filingAt: null });
      throw error;
    }
    return this.view.render(await this.store.get(sessionId), userId);
  }

  async archive(sessionId: string, userId: number): Promise<PlanView> {
    const plan = await this.ownDraft(sessionId, userId);
    await this.store.update(sessionId, { archivedAt: new Date() });
    await this.events.record({
      sessionId,
      kind: PlanEventKind.ARCHIVED,
      actorUserId: userId,
    });
    return this.view.render({ ...plan, archivedAt: new Date() }, userId);
  }

  async restore(sessionId: string, userId: number): Promise<PlanView> {
    await this.ownDraft(sessionId, userId);
    await this.store.update(sessionId, { archivedAt: null });
    await this.store.patchPlan(sessionId, {
      lastActiveAt: new Date().toISOString(),
      expiryWarnings: [],
    });
    await this.events.record({
      sessionId,
      kind: PlanEventKind.RESTORED,
      actorUserId: userId,
    });
    return this.view.render(await this.store.get(sessionId), userId);
  }

  /** Discard an unfiled draft for good. Filed plans are never deleted this way. */
  async discard(sessionId: string, userId: number): Promise<void> {
    await this.ownDraft(sessionId, userId);
    await this.store.repository.delete({ id: sessionId });
  }

  /**
   * Daily: archive quiet drafts at 30 days, purge archived ones 60 days later
   * (90 in all), warning 7 days before each. Filed plans are never touched.
   */
  async sweepExpiry(
    now = new Date(),
  ): Promise<{ archived: number; purged: number }> {
    const settings = await this.settings.get();
    if (!settings.enabled) return { archived: 0, purged: 0 };
    const drafts = await this.store.repository
      .createQueryBuilder('s')
      .addSelect('s.plan')
      .where('s.kind = :kind', { kind: BuilderSessionKind.PLAN })
      .andWhere('s.visibility = :v', { v: BuilderSessionVisibility.PRIVATE })
      .take(5000)
      .getMany();
    let archived = 0;
    let purged = 0;
    for (const draft of drafts as PlanSession[]) {
      const record = draft.plan ?? {};
      const warned = new Set(record.expiryWarnings ?? []);
      const last = new Date(record.lastActiveAt ?? draft.createdAt).getTime();
      if (!draft.archivedAt) {
        const age = (now.getTime() - last) / DAY_MS;
        if (age >= ARCHIVE_AFTER_DAYS) {
          await this.store.update(draft.id, { archivedAt: now });
          await this.events.record({
            sessionId: draft.id,
            kind: PlanEventKind.ARCHIVED,
            actorUserId: null,
          });
          await this.notifications.notify(
            draft.createdBy,
            draft.id,
            PlanNotificationKind.ARCHIVED,
            `"${draft.title}" was archived after ${ARCHIVE_AFTER_DAYS} quiet days. Restore it from My ideas within ${PURGE_AFTER_ARCHIVE_DAYS} days to keep it.`,
          );
          archived++;
        } else if (
          age >= ARCHIVE_AFTER_DAYS - WARN_DAYS_BEFORE &&
          !warned.has('archive')
        ) {
          await this.notifications.notify(
            draft.createdBy,
            draft.id,
            PlanNotificationKind.ARCHIVE_SOON,
            `"${draft.title}" will be archived in ${WARN_DAYS_BEFORE} days unless you pick it up again.`,
          );
          await this.store.patchPlan(draft.id, {
            expiryWarnings: [...warned, 'archive'],
          });
        }
        continue;
      }
      const sinceArchive =
        (now.getTime() - draft.archivedAt.getTime()) / DAY_MS;
      if (sinceArchive >= PURGE_AFTER_ARCHIVE_DAYS) {
        // Re-checked inside the DELETE: a draft restored a moment ago survives.
        const result = await this.dataSource.query(
          `DELETE FROM "builder_sessions"
            WHERE id = $1 AND kind = 'plan' AND visibility = 'private'
              AND "archivedAt" IS NOT NULL AND "archivedAt" <= $2`,
          [
            draft.id,
            new Date(now.getTime() - PURGE_AFTER_ARCHIVE_DAYS * DAY_MS),
          ],
        );
        if (Array.isArray(result) ? (result[1] ?? 0) > 0 : true) purged++;
      } else if (
        sinceArchive >= PURGE_AFTER_ARCHIVE_DAYS - WARN_DAYS_BEFORE &&
        !warned.has('purge')
      ) {
        await this.notifications.notify(
          draft.createdBy,
          draft.id,
          PlanNotificationKind.PURGE_SOON,
          `Archived idea "${draft.title}" will be deleted in ${WARN_DAYS_BEFORE} days. Restore it from My ideas to keep it.`,
        );
        await this.store.patchPlan(draft.id, {
          expiryWarnings: [...warned, 'purge'],
        });
      }
    }
    return { archived, purged };
  }

  /**
   * Once, when planning is switched on: every parked `roadmap_idea_drafts`
   * row becomes a parked private plan, and the old row is retired. Idempotent
   * by `migratedFromDraftId`.
   */
  async migrateIdeaDrafts(): Promise<number> {
    const settings = await this.settings.get();
    if (!settings.enabled) return 0;
    const drafts = await this.drafts.find({ where: {}, take: 1000 });
    let moved = 0;
    for (const draft of drafts) {
      const existing: { id: string }[] = await this.dataSource.query(
        `SELECT id FROM "builder_sessions" WHERE kind = 'plan' AND plan->>'migratedFromDraftId' = $1 LIMIT 1`,
        [draft.id],
      );
      if (!existing.length) {
        await this.createPrivatePlan(draft.ownerUserId, draft.rawText, {
          parked: true,
          captureMode: draft.captureMode === 'voice' ? 'voice' : 'typed',
          migratedFromDraftId: draft.id,
          lastActiveAt: draft.updatedAt?.toISOString?.(),
        });
      }
      await this.drafts.softDelete({ id: draft.id });
      moved++;
    }
    return moved;
  }

  private async createPrivatePlan(
    userId: number,
    text: string,
    record: {
      parked: boolean;
      captureMode: 'typed' | 'voice';
      migratedFromDraftId?: string;
      lastActiveAt?: string;
    },
  ): Promise<string> {
    const session = await this.builderSessions.createSession(userId, {
      title: firstLine(text),
    });
    const now = new Date();
    await this.store.repository.update(
      { id: session.id },
      {
        kind: BuilderSessionKind.PLAN,
        visibility: BuilderSessionVisibility.PRIVATE,
        planStage: PlanStage.IDEA,
        planStageAt: now,
      },
    );
    await this.store.patchPlan(session.id, {
      parked: record.parked,
      captureMode: record.captureMode,
      ...(record.migratedFromDraftId
        ? { migratedFromDraftId: record.migratedFromDraftId }
        : {}),
      lastActiveAt: record.lastActiveAt ?? now.toISOString(),
    });
    await this.messages.appendMessage(session.id, {
      role: BuilderMessageRole.USER,
      content: text,
      metadata: IDEA_STAGE,
      createdBy: userId,
    });
    if (record.parked) {
      await this.events.record({
        sessionId: session.id,
        kind: PlanEventKind.PARKED,
        actorUserId: userId,
      });
    }
    return session.id;
  }

  private async readable(
    sessionId: string,
    userId: number,
  ): Promise<PlanSession> {
    const plan = await this.store.find(sessionId);
    if (!plan || !(await this.access.canRead(plan, userId))) {
      throw new NotFoundException('Plan not found');
    }
    return plan;
  }

  private async ownDraft(
    sessionId: string,
    userId: number,
  ): Promise<PlanSession> {
    await this.settings.assertEnabled();
    const plan = await this.readable(sessionId, userId);
    if (
      plan.visibility !== BuilderSessionVisibility.PRIVATE ||
      plan.createdBy !== userId
    ) {
      throw new NotFoundException('Plan not found');
    }
    return plan;
  }

  private async editableDraft(
    sessionId: string,
    userId: number,
  ): Promise<PlanSession> {
    const plan = await this.ownDraft(sessionId, userId);
    if (!(await this.access.canEdit(plan, userId))) {
      await this.access.assertIdeas(userId);
      throw new NotFoundException('Plan not found');
    }
    if (plan.archivedAt) {
      throw new BadRequestException('Restore this idea before working on it.');
    }
    return plan;
  }
}

function firstLine(text: string): string {
  const line = text.trim().split('\n')[0].trim();
  return (line || 'New idea').slice(0, 120);
}
