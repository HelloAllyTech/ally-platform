import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  OnModuleDestroy,
  Optional,
  UnprocessableEntityException,
} from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import { BuilderSessionService } from 'src/builder/service/builder-session.service';
import {
  BuilderSessionKind,
  BuilderSessionVisibility,
} from 'src/builder/enum/builder.enum';
import { DataSource, EntityManager } from 'typeorm';
import { AppConfigService } from 'src/config/config.service';
import {
  PlanEventKind,
  PlanStage,
  RoadmapNotificationKind,
} from 'src/product-planning/enum/product-planning.enum';
import { PlanEventService } from 'src/product-planning/service/plan-event.service';
import { PlanSettingsService } from 'src/product-planning/service/plan-settings.service';
import { RoadmapInboxService } from 'src/product-planning/service/roadmap-inbox.service';
import { RoadmapRoleService } from 'src/product-planning/service/roadmap-role.service';
import { roleAtLeast } from 'src/product-planning/util/roadmap-role.util';
import { RoadmapNotificationService } from '../service/roadmap-notification.service';
import { RoadmapStrategyGoalService } from '../service/roadmap-strategy-goal.service';
import { PlanSession, PlanSessionStore } from '../plan/plan-session.store';
import { PlanStageService } from '../plan/plan-stage.service';
import { PlanCloseReadinessService } from '../plan/plan-close-readiness.service';
import { PlanTurnService } from '../plan/plan-turn.service';
import { PlanHandoffService } from '../plan/plan-handoff.service';
import { RoadmapItemLookupService } from '../item/roadmap-item-lookup.service';
import { RoadmapItemReadService } from '../item/roadmap-item-read.service';
import type {
  ItemDetail,
  ItemRow,
  PersonRef,
} from '../item/roadmap-item.types';
import {
  RoadmapDraftService,
  SimilarIdea,
} from '../draft/roadmap-draft.service';
import { REVIEW_REASON_MAX } from '../draft/roadmap-draft.dto';
import { firstLine } from '../draft/roadmap-draft.util';
import {
  readReviewUndo,
  REVIEW_NOTICE_DELAY_MS,
  REVIEW_UNDO_TTL_MS,
  ReviewUndoItem,
  reviewUndoKey,
  scoreLeadCandidates,
  ScoredLeadCandidate,
  signReviewUndo,
} from './roadmap-review.util';

export type ReviewDecision = 'accept' | 'decline' | 'reopen';

export interface ReviewRequest {
  code: string;
  decision: ReviewDecision;
  leadUserId?: number;
  reason?: string;
}

/** A review checked and ready to write: everything the transaction needs. */
interface PlannedReview {
  request: ReviewRequest;
  item: ItemDetail;
  id: string;
  code: string;
  sessionId: string | null;
  authorId: number;
  reason: string | null;
  undo: ReviewUndoItem;
}

const coded = (status: HttpStatus, code: string, message: string, extra = {}) =>
  new HttpException({ statusCode: status, code, message, ...extra }, status);

/**
 * The Owner's review and the lead (plans/roadmap-builder-merge D10, D11,
 * §2.1a, §4.6, §4.11, §5.7a/b): accept, decline with a reason only the author
 * sees, reopen, bulk review in one transaction with one undo token, pick or
 * change the lead (only once the Owner has planned the idea and closed the
 * plan, never from a review call), the lead handing an idea back, and the
 * deterministic suggested lead.
 *
 * Capabilities come from the read model's `can`, so the server refuses
 * exactly what the idea page hides. Every route reaching here has already
 * answered 404 while `roadmap_v2` is off.
 */
@Injectable()
export class RoadmapReviewService implements OnModuleDestroy {
  private readonly logger = LoggerService.getInstance(
    RoadmapReviewService.name,
  );

  /** Accepted / declined notices waiting out the undo window, by item id. */
  private readonly heldNotices = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly dataSource: DataSource,
    private readonly config: AppConfigService,
    private readonly settings: PlanSettingsService,
    private readonly roles: RoadmapRoleService,
    private readonly lookup: RoadmapItemLookupService,
    private readonly reader: RoadmapItemReadService,
    private readonly drafts: RoadmapDraftService,
    private readonly store: PlanSessionStore,
    private readonly stage: PlanStageService,
    private readonly events: PlanEventService,
    private readonly inbox: RoadmapInboxService,
    private readonly broadcast: RoadmapNotificationService,
    private readonly strategyGoals: RoadmapStrategyGoalService,
    private readonly builderSessions: BuilderSessionService,
    /** Start planning's opening turn (audit rec 1). Optional so fixtures without it still build. */
    @Optional() private readonly planTurns?: PlanTurnService,
    /** Close plan's one definition of ready (audit rec 2). Optional, like the turns. */
    @Optional() private readonly closeReadiness?: PlanCloseReadinessService,
    /** Start planning's dated hand-off (audit rec. 5). Optional so older fixtures still build. */
    @Optional() private readonly planHandoff?: PlanHandoffService,
  ) {}

  // ── Review ─────────────────────────────────────────────────────────────────

  async review(
    userId: number,
    request: ReviewRequest,
  ): Promise<{ item: ItemDetail; undoToken: string }> {
    const planned = await this.plan(userId, request);
    const undoToken = await this.write(userId, [planned]);
    return { item: await this.reader.detail(userId, planned.code), undoToken };
  }

  /** Bulk triage (§4.11): all or nothing, one undo token. */
  async reviewBatch(
    userId: number,
    requests: ReviewRequest[],
  ): Promise<{ items: ItemRow[]; undoToken: string }> {
    const codes = requests.map((r) => r.code.trim().toUpperCase());
    if (new Set(codes).size !== codes.length) {
      throw new UnprocessableEntityException(
        'An idea appears twice in this batch.',
      );
    }
    const planned: PlannedReview[] = [];
    const failures: { code: string; message: string }[] = [];
    for (const request of requests) {
      try {
        planned.push(await this.plan(userId, request));
      } catch (error) {
        failures.push({
          code: request.code,
          message: (error as Error)?.message ?? 'Refused',
        });
      }
    }
    if (failures.length) {
      throw coded(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'batch_rejected',
        'Nothing was changed: some ideas in the batch could not be reviewed.',
        { failures },
      );
    }
    const undoToken = await this.write(userId, planned);
    return {
      items: await this.reader.rowsFor(
        userId,
        planned.map((p) => p.id),
      ),
      undoToken,
    };
  }

  /** Undo one review or one batch, inside its window, if nothing moved since. */
  async undo(userId: number, token: string): Promise<{ items: ItemRow[] }> {
    const read = readReviewUndo(token, this.undoKey());
    if (!read.ok) {
      throw read.reason === 'expired'
        ? coded(HttpStatus.GONE, 'undo_expired', 'Too late to undo that.')
        : new UnprocessableEntityException('That undo is not valid.');
    }
    const { payload } = read;
    if (payload.u !== userId) {
      throw new ForbiddenException('Only the Owner who reviewed can undo it.');
    }
    await this.assertOwner(userId);

    // An undone decision tells nobody anything: drop its held notices.
    for (const item of payload.items) this.cancelDecisionNotice(item.id);

    await this.dataSource.transaction(async (manager) => {
      const conflicts: string[] = [];
      for (const item of payload.items) {
        const [opp] = await manager.query(
          `SELECT "reviewState" FROM "roadmap_opportunities"
            WHERE id = $1 AND "deletedAt" IS NULL FOR UPDATE`,
          [item.id],
        );
        const [session] = item.sessionId
          ? await manager.query(
              `SELECT "leadUserId", "plan"->>'planningStarted' AS "planningStarted"
                 FROM "builder_sessions" WHERE id = $1 FOR UPDATE`,
              [item.sessionId],
            )
          : [null];
        const lead =
          session?.leadUserId == null ? null : Number(session.leadUserId);
        if (
          !opp ||
          (opp.reviewState ?? null) !== item.next.reviewState ||
          (item.sessionId && lead !== item.next.leadUserId) ||
          session?.planningStarted === 'true'
        ) {
          conflicts.push(item.code);
        }
      }
      if (conflicts.length) {
        throw coded(
          HttpStatus.CONFLICT,
          'undo_conflict',
          'Something changed since, so it cannot be undone.',
          { codes: conflicts },
        );
      }
      for (const item of payload.items) {
        await manager.query(
          `UPDATE "roadmap_opportunities"
              SET "reviewState" = $2, "reviewedBy" = $3, "reviewedAt" = $4,
                  "declineReason" = $5, "updatedBy" = $6, "updatedAt" = now()
            WHERE id = $1`,
          [
            item.id,
            item.prev.reviewState,
            item.prev.reviewedBy,
            item.prev.reviewedAt,
            item.prev.declineReason,
            userId,
          ],
        );
        if (item.sessionId && item.prev.leadUserId !== item.next.leadUserId) {
          await manager.query(
            `UPDATE "builder_sessions" SET "leadUserId" = $2, "updatedBy" = $3 WHERE id = $1`,
            [item.sessionId, item.prev.leadUserId, userId],
          );
        }
      }
    });

    for (const item of payload.items) {
      if (item.sessionId) {
        await this.events.record({
          sessionId: item.sessionId,
          kind: PlanEventKind.REVIEWED,
          actorUserId: userId,
          detail: { decision: 'undo', to: item.prev.reviewState },
        });
        await this.stage.sync(item.sessionId, userId);
      }
      this.broadcast.emit({
        kind: 'ITEM_CHANGED',
        actorId: userId,
        code: item.code,
        fields: ['reviewState', 'lead'],
      });
    }
    return {
      items: await this.reader.rowsFor(
        userId,
        payload.items.map((i) => i.id),
      ),
    };
  }

  // ── The lead ───────────────────────────────────────────────────────────────

  /** Pick or change the lead (Owner), or hand the idea back (the lead). */
  async lead(
    userId: number,
    code: string,
    input: {
      action: 'assign' | 'handBack';
      leadUserId?: number;
      note?: string;
    },
  ): Promise<ItemDetail> {
    const item = await this.reader.detail(userId, code);
    const ref = await this.lookup.get(code);
    // Picking a lead on an idea filed outside the guided interview (quick add,
    // an older idea) has no plan session yet: make one rather than refuse.
    // Handing back needs a lead, so it never creates one.
    const session =
      input.action === 'assign' && item.can.pickLead
        ? await this.ensurePlanSession(userId, ref)
        : await this.planSession(ref.builderSessionId);

    if (input.action === 'assign') {
      if (!item.can.pickLead) {
        throw new ForbiddenException(
          (await this.roles.roleOf(userId)) === 'owner'
            ? item.shownStage === 'shipped' || !item.can.decline
              ? 'This idea is released or closed; it takes no builder.'
              : 'Close the plan before assigning a builder.'
            : 'Only an Owner assigns the builder.',
        );
      }
      const to = Number(input.leadUserId);
      await this.assertCanLead(to);
      const from =
        session.leadUserId == null ? null : Number(session.leadUserId);
      if (from !== to) {
        await this.store.update(session.id, {
          leadUserId: to,
          updatedBy: userId,
        });
        await this.store.patchPlan(session.id, { nudgedAt: null });
        await this.afterLeadAssigned(
          userId,
          ref.id,
          ref.code,
          session.id,
          from,
          to,
        );
      }
      return this.reader.detail(userId, code);
    }

    // Hand back (D11): the lead's own call; the Owner picks someone else.
    if (session.leadUserId !== userId) {
      throw new ForbiddenException('Only the lead can hand this idea back.');
    }
    if (item.shownStage === 'shipped' || item.shownStage === 'closed') {
      throw new ConflictException(
        'This idea is finished; there is nothing to hand back.',
      );
    }
    const note = (input.note ?? '').trim().slice(0, 500) || null;
    await this.store.update(session.id, {
      leadUserId: null,
      updatedBy: userId,
    });
    await this.store.patchPlan(session.id, {
      handBackNote: note,
      nudgedAt: null,
    });
    await this.events.record({
      sessionId: session.id,
      kind: PlanEventKind.LEAD_HANDED_BACK,
      actorUserId: userId,
      detail: note ? { note } : null,
    });
    await this.stage.sync(session.id, userId);
    await this.inbox.deliver({
      kind: RoadmapNotificationKind.HANDED_BACK,
      itemId: ref.id,
      sessionId: session.id,
      actorUserId: userId,
      payload: { code: ref.code, byUserId: userId, ...(note ? { note } : {}) },
    });
    this.broadcast.emit({
      kind: 'ITEM_CHANGED',
      actorId: userId,
      code: ref.code,
      fields: ['lead'],
    });
    return this.reader.detail(userId, code);
  }

  /**
   * Start planning: an Owner expands the idea into a plan, in its one
   * session (lifecycle 2026-11-18). Only an Owner, and nobody is assigned to
   * build it by doing so: the Owner plans, closes the plan, and only then
   * assigns a builder. Starting to plan an idea still waiting for review
   * accepts it. Idempotent.
   */
  async startPlanning(userId: number, code: string): Promise<ItemDetail> {
    const item = await this.reader.detail(userId, code);
    const ref = await this.lookup.get(code);
    const refusal = () =>
      new ForbiddenException(
        item.shownStage === 'submitted' || item.shownStage === 'accepted'
          ? 'Only an Owner expands an idea into a plan.'
          : 'This idea is past planning.',
      );
    if (!ref.builderSessionId && !item.can.startPlanning) throw refusal();
    const session = await this.ensurePlanSession(userId, ref);
    if (session.plan?.planningStarted === true) return item;
    if (!item.can.startPlanning) throw refusal();

    if (item.shownStage === 'submitted') {
      // Expanding it into a plan is the Owner taking it on: it is accepted.
      const accepted = await this.dataSource.query(
        `UPDATE "roadmap_opportunities"
            SET "reviewState" = 'accepted', "reviewedBy" = $2, "reviewedAt" = now(),
                "updatedBy" = $2, "updatedAt" = now()
          WHERE id = $1 AND "reviewState" = 'pending'
          RETURNING id`,
        [ref.id, userId],
      );
      const rows = Array.isArray(accepted?.[0]) ? accepted[0] : accepted;
      if (rows?.length) {
        this.cancelDecisionNotice(ref.id);
        await this.events.record({
          sessionId: session.id,
          kind: PlanEventKind.REVIEWED,
          actorUserId: userId,
          detail: { decision: 'accept', via: 'start_planning' },
        });
      }
    }
    await this.store.patchPlan(session.id, {
      planningStarted: true,
      planningStartedAt: new Date().toISOString(),
      planningStartedBy: userId,
    });
    await this.attachStartHandoff(userId, ref.code, session.id);
    await this.events.record({
      sessionId: session.id,
      kind: PlanEventKind.PLANNING_STARTED,
      actorUserId: userId,
    });
    await this.stage.sync(session.id, userId);
    this.broadcast.emit({
      kind: 'ITEM_CHANGED',
      actorId: userId,
      code: ref.code,
      fields: ['stage'],
    });
    // Last: the situation brief is waiting by the time the Owner looks. Fire
    // and forget, so a busy lock or a model failure never fails Start planning.
    this.planTurns?.queueOpeningTurn(session.id, userId, ref.code, item.title);
    return this.reader.detail(userId, code);
  }

  /**
   * Close the plan (an Owner): planning is done, and the idea can now take a
   * builder. Reopen undoes it while nobody is assigned to build it yet.
   * Neither touches the PRD or design; they only open and shut the gate to
   * assigning a builder. Closing while the plan still has open blockers needs
   * `reason` (PlanCloseReadinessService.checkClose, audit rec 2).
   */
  async setPlanClosed(
    userId: number,
    code: string,
    closed: boolean,
    reason?: string,
  ): Promise<ItemDetail> {
    const item = await this.reader.detail(userId, code);
    const allowed = closed ? item.can.closePlan : item.can.reopenPlan;
    if (!allowed) {
      if ((await this.roles.roleOf(userId)) !== 'owner') {
        throw new ForbiddenException('Only an Owner closes or reopens a plan.');
      }
      throw new ConflictException(
        closed
          ? 'Only a plan that is being planned, with no builder yet, can be closed.'
          : 'Only a closed plan with no builder yet can be reopened.',
      );
    }
    const ref = await this.lookup.get(code);
    const session = await this.planSession(ref.builderSessionId);
    const notReady =
      closed && this.closeReadiness
        ? await this.closeReadiness.checkClose(session, reason)
        : null;
    await this.store.patchPlan(session.id, {
      planClosed: closed
        ? {
            byUserId: userId,
            at: new Date().toISOString(),
            ...(notReady ? { notReady } : {}),
          }
        : null,
    });
    await this.events.record({
      sessionId: session.id,
      kind: closed ? PlanEventKind.PLAN_CLOSED : PlanEventKind.PLAN_REOPENED,
      actorUserId: userId,
      // The count only: the reason lives on the plan and in the build brief.
      ...(notReady
        ? { detail: { notReady: true, openBlockers: notReady.blockers.length } }
        : {}),
    });
    this.broadcast.emit({
      kind: 'ITEM_CHANGED',
      actorId: userId,
      code: ref.code,
      fields: ['stage'],
    });
    return this.reader.detail(userId, code);
  }

  /**
   * Open the conversation on an idea filed before ideas had one (an older or
   * quick-added idea), so anyone who can comment on it can. Makes the idea's
   * session if it has none; changes nothing else (no lead, no planning, no
   * stage). Idempotent.
   */
  async openConversation(userId: number, code: string): Promise<ItemDetail> {
    const item = await this.reader.detail(userId, code);
    if (!item.can.comment) {
      throw new ForbiddenException(
        "This idea can't take comments: it is a draft, declined or closed.",
      );
    }
    const ref = await this.lookup.get(code);
    if (!ref.builderSessionId) {
      await this.ensurePlanSession(userId, ref, 'conversation');
    }
    return this.reader.detail(userId, code);
  }

  /** The lead picker, best first, with why (§4.11). Owner only. */
  async leadSuggestions(
    userId: number,
    code: string,
  ): Promise<{
    suggestedUserId: number | null;
    candidates: (Omit<ScoredLeadCandidate, 'userId'> & { user: PersonRef })[];
  }> {
    await this.assertOwner(userId);
    const ref = await this.lookup.get(code);
    const ids = await this.roles.leadCandidates();
    if (!ids.length) return { suggestedUserId: null, candidates: [] };

    const { inProgressLimit } = await this.settings.getRoadmapV2();
    const leading: { leadUserId: number; n: number }[] =
      await this.dataSource.query(
        `SELECT "leadUserId", count(*)::int AS n FROM "builder_sessions"
          WHERE kind = 'plan' AND "leadUserId" = ANY($1) AND "archivedAt" IS NULL
            AND "deletedAt" IS NULL
            AND COALESCE("planStage", '') NOT IN ('launching', 'measuring', 'learned', 'closed')
          GROUP BY "leadUserId"`,
        [ids],
      );
    const history: { leadUserId: number; app: string; n: number }[] =
      await this.dataSource.query(
        `SELECT s."leadUserId", COALESCE(r.apps, r.service) AS app,
                count(DISTINCT o.id)::int AS n
           FROM "builder_sessions" s
           JOIN "roadmap_opportunities" o ON o."builderSessionId" = s.id AND o."deletedAt" IS NULL
           JOIN "item_releases" r ON r."opportunityId" = o.id
          WHERE s."leadUserId" = ANY($1) AND o.id <> $2
          GROUP BY s."leadUserId", COALESCE(r.apps, r.service)`,
        [ids, ref.id],
      );
    const ideaApps: { app: string }[] = await this.dataSource.query(
      `SELECT DISTINCT COALESCE(apps, service) AS app FROM "item_releases" WHERE "opportunityId" = $1`,
      [ref.id],
    );
    const scored = scoreLeadCandidates(
      ids.map((id) => ({
        userId: id,
        leading: Number(
          leading.find((l) => Number(l.leadUserId) === id)?.n ?? 0,
        ),
        ideasByApp: Object.fromEntries(
          history
            .filter((h) => Number(h.leadUserId) === id)
            .map((h) => [h.app, Number(h.n)]),
        ),
      })),
      inProgressLimit,
      ideaApps.map((a) => a.app),
    );
    const people = await this.people(ids);
    return {
      suggestedUserId: scored[0]?.userId ?? null,
      candidates: scored.map(({ userId: id, ...rest }) => ({
        user: people.get(id) ?? { id, name: `User ${id}`, role: 'builder' },
        ...rest,
      })),
    };
  }

  /** Triage's Similar line and the decline box's suggested reason (§4.6, §4.11). */
  async similar(
    userId: number,
    code: string,
  ): Promise<{ matches: SimilarIdea[] }> {
    // Reading the idea is the access check: 404/403 exactly as the page.
    await this.reader.detail(userId, code);
    const ref = await this.lookup.get(code);
    const [row] = await this.dataSource.query(
      `SELECT description, "productGoal" FROM "roadmap_opportunities" WHERE id = $1`,
      [ref.id],
    );
    return this.drafts.similarTo(
      userId,
      row?.description ?? '',
      row?.productGoal ?? undefined,
      ref.id,
    );
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  /** Check one review against the idea's state and the caller's rights. Writes nothing. */
  private async plan(
    userId: number,
    request: ReviewRequest,
  ): Promise<PlannedReview> {
    const item = await this.reader.detail(userId, request.code);
    const ref = await this.lookup.get(request.code);
    const owner = (await this.roles.roleOf(userId)) === 'owner';
    if (!owner) throw new ForbiddenException('Only an Owner reviews ideas.');

    if (request.decision === 'reopen') {
      if (item.shownStage !== 'declined') {
        throw new ConflictException(`${ref.code} is not declined.`);
      }
    } else if (request.decision === 'decline') {
      if (!item.can.decline) {
        throw new ConflictException(
          `${ref.code} can't be declined: it is released, or already closed.`,
        );
      }
    } else if (!item.can.review) {
      throw new ConflictException(`${ref.code} is not waiting for review.`);
    }

    let reason: string | null = null;
    if (request.decision === 'decline') {
      reason = (request.reason ?? '').replace(/\s+/g, ' ').trim();
      if (!reason) {
        throw new UnprocessableEntityException(
          'Say in one line what would make it stronger.',
        );
      }
      if (reason.length > REVIEW_REASON_MAX) {
        throw new UnprocessableEntityException(
          `Keep the reason under ${REVIEW_REASON_MAX} characters.`,
        );
      }
    }

    const [opp] = await this.dataSource.query(
      `SELECT "reviewState", "reviewedBy", "reviewedAt", "declineReason", "createdBy"
         FROM "roadmap_opportunities" WHERE id = $1`,
      [ref.id],
    );
    const session = ref.builderSessionId
      ? await this.store.find(ref.builderSessionId)
      : null;
    const prevLead =
      session?.leadUserId == null ? null : Number(session.leadUserId);

    const nextLead = prevLead;
    if (request.leadUserId != null) {
      // A builder is assigned only once the Owner has planned the idea and
      // closed the plan (lifecycle 2026-11-18), never straight from review.
      throw new UnprocessableEntityException(
        'Expand the idea into a plan and close the plan before assigning a builder.',
      );
    }

    const nextState =
      request.decision === 'accept'
        ? 'accepted'
        : request.decision === 'decline'
          ? 'declined'
          : 'pending';
    return {
      request,
      item,
      id: ref.id,
      code: ref.code,
      sessionId: session?.id ?? null,
      authorId: Number(opp?.createdBy ?? ref.createdBy),
      reason,
      undo: {
        id: ref.id,
        code: ref.code,
        sessionId: session?.id ?? null,
        prev: {
          reviewState: opp?.reviewState ?? null,
          reviewedBy: opp?.reviewedBy == null ? null : Number(opp.reviewedBy),
          reviewedAt: opp?.reviewedAt
            ? new Date(opp.reviewedAt).toISOString()
            : null,
          declineReason: opp?.declineReason ?? null,
          leadUserId: prevLead,
        },
        next: { reviewState: nextState, leadUserId: nextLead },
      },
    };
  }

  /** One transaction for every planned review, then the side effects. */
  private async write(
    userId: number,
    planned: PlannedReview[],
  ): Promise<string> {
    await this.dataSource.transaction(async (manager) => {
      for (const p of planned) await this.writeOne(manager, userId, p);
    });

    for (const p of planned) {
      if (p.sessionId) {
        await this.events.record({
          sessionId: p.sessionId,
          kind: PlanEventKind.REVIEWED,
          actorUserId: userId,
          // Never the reason: events are read by everyone who reads the idea.
          detail: { decision: p.request.decision },
        });
      }
      const kind =
        p.request.decision === 'accept'
          ? RoadmapNotificationKind.ACCEPTED
          : p.request.decision === 'decline'
            ? RoadmapNotificationKind.DECLINED
            : null;
      if (kind) {
        // Held until the undo window has passed (see scheduleDecisionNotice).
        this.scheduleDecisionNotice(userId, p, kind);
      }
      if (p.sessionId && p.undo.next.leadUserId !== p.undo.prev.leadUserId) {
        await this.afterLeadAssigned(
          userId,
          p.id,
          p.code,
          p.sessionId,
          p.undo.prev.leadUserId,
          p.undo.next.leadUserId as number,
        );
      } else if (p.sessionId) {
        await this.stage.sync(p.sessionId, userId);
      }
      this.broadcast.emit({
        kind: 'ITEM_CHANGED',
        actorId: userId,
        code: p.code,
        fields: ['reviewState'],
      });
    }
    // Accepting moves an idea onto the ranked board.
    this.strategyGoals.invalidate(userId);

    return signReviewUndo(
      {
        v: 1,
        u: userId,
        exp: Date.now() + REVIEW_UNDO_TTL_MS,
        items: planned.map((p) => p.undo),
      },
      this.undoKey(),
    );
  }

  private async writeOne(
    manager: EntityManager,
    userId: number,
    p: PlannedReview,
  ): Promise<void> {
    const decision = p.request.decision;
    // Compare-and-set on the state the check read, so two Owners reviewing
    // the same idea at once cannot both win.
    const result = await manager.query(
      `UPDATE "roadmap_opportunities"
          SET "reviewState" = $2,
              "reviewedBy" = $3,
              "reviewedAt" = now(),
              "declineReason" = $4,
              "updatedBy" = $3,
              "updatedAt" = now()
        WHERE id = $1 AND "reviewState" IS NOT DISTINCT FROM $5
        RETURNING id`,
      [
        p.id,
        p.undo.next.reviewState,
        userId,
        decision === 'decline' ? p.reason : null,
        p.undo.prev.reviewState,
      ],
    );
    const rows = Array.isArray(result?.[0]) ? result[0] : result;
    if (!rows?.length) {
      throw new ConflictException(
        `${p.code} was reviewed by someone else a moment ago.`,
      );
    }
    if (p.sessionId && p.undo.next.leadUserId !== p.undo.prev.leadUserId) {
      await manager.query(
        `UPDATE "builder_sessions" SET "leadUserId" = $2, "updatedBy" = $3 WHERE id = $1`,
        [p.sessionId, p.undo.next.leadUserId, userId],
      );
    }
  }

  /**
   * The accepted / declined notice (author and voters) is sent only once the
   * undo window has passed, and only if the decision still stands then. The
   * timer is in-process: a restart inside the window drops that notice, which
   * is the safe direction (a missed note, never one about an undone decision).
   * A newer decision on the same idea replaces the held one.
   */
  private scheduleDecisionNotice(
    actorUserId: number,
    p: PlannedReview,
    kind: RoadmapNotificationKind,
  ): void {
    this.cancelDecisionNotice(p.id);
    const timer = setTimeout(() => {
      this.heldNotices.delete(p.id);
      void this.sendDecisionNotice(actorUserId, p, kind);
    }, REVIEW_NOTICE_DELAY_MS);
    timer.unref?.();
    this.heldNotices.set(p.id, timer);
  }

  private cancelDecisionNotice(itemId: string): void {
    const held = this.heldNotices.get(itemId);
    if (held) clearTimeout(held);
    this.heldNotices.delete(itemId);
  }

  private async sendDecisionNotice(
    actorUserId: number,
    p: PlannedReview,
    kind: RoadmapNotificationKind,
  ): Promise<void> {
    try {
      const [row] = await this.dataSource.query(
        `SELECT "reviewState" FROM "roadmap_opportunities"
          WHERE id = $1 AND "deletedAt" IS NULL`,
        [p.id],
      );
      // Undone (here or on another instance) or changed since: say nothing.
      if (row?.reviewState !== p.undo.next.reviewState) return;
      await this.inbox.deliver({
        kind,
        itemId: p.id,
        sessionId: p.sessionId,
        actorUserId,
        // `reason` is an author-only key: the inbox strips it for everyone else.
        payload: { code: p.code, ...(p.reason ? { reason: p.reason } : {}) },
      });
    } catch (error) {
      this.logger.error(
        `Could not send the ${kind} notice for ${p.code}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  onModuleDestroy(): void {
    for (const timer of this.heldNotices.values()) clearTimeout(timer);
    this.heldNotices.clear();
  }

  private async afterLeadAssigned(
    actorUserId: number,
    itemId: string,
    code: string,
    sessionId: string,
    from: number | null,
    to: number,
  ): Promise<void> {
    await this.events.record({
      sessionId,
      kind: PlanEventKind.LEAD_ASSIGNED,
      actorUserId,
      detail: { from, to },
    });
    await this.stage.sync(sessionId, actorUserId);
    const payload = { code, leadUserId: to };
    await this.inbox.deliver({
      kind: RoadmapNotificationKind.ASSIGNED_TO_YOU,
      itemId,
      sessionId,
      actorUserId,
      payload,
      directRecipientIds: [to],
    });
    await this.inbox.deliver({
      kind: RoadmapNotificationKind.LEAD_ASSIGNED,
      itemId,
      sessionId,
      actorUserId,
      payload,
    });
    this.broadcast.emit({
      kind: 'ITEM_CHANGED',
      actorId: actorUserId,
      code,
      fields: ['lead'],
    });
  }

  /**
   * The idea's plan session, created if it has none. Only ideas filed through
   * the guided interview are born with one; quick-added and older ideas are
   * not, yet the lead lives on the session. The new session is shared, filed
   * and owned by the idea's author. The column is claimed only while it is
   * still null, so two Owners racing keep one session and the loser's empty
   * one is archived.
   */
  private async ensurePlanSession(
    userId: number,
    ref: {
      id: string;
      code: string;
      createdBy: number;
      builderSessionId: string | null;
    },
    by: 'lead_assignment' | 'conversation' = 'lead_assignment',
  ): Promise<PlanSession> {
    if (ref.builderSessionId) return this.planSession(ref.builderSessionId);

    const [opp] = await this.dataSource.query(
      `SELECT description FROM "roadmap_opportunities" WHERE id = $1`,
      [ref.id],
    );
    const created = await this.builderSessions.createSession(
      Number(ref.createdBy),
      { title: firstLine(opp?.description || ref.code) },
    );
    const now = new Date();
    await this.store.repository.update(
      { id: created.id },
      {
        kind: BuilderSessionKind.PLAN,
        visibility: BuilderSessionVisibility.SHARED,
        planStage: PlanStage.FILED,
        planStageAt: now,
      },
    );
    await this.store.patchPlan(created.id, {
      code: ref.code,
      opportunityId: ref.id,
      filedAt: now.toISOString(),
      planningStarted: false,
      lastActiveAt: now.toISOString(),
    });

    const claimed: unknown = await this.dataSource.query(
      `UPDATE "roadmap_opportunities"
          SET "builderSessionId" = $2, "updatedBy" = $3
        WHERE id = $1 AND "builderSessionId" IS NULL
        RETURNING id`,
      [ref.id, created.id, userId],
    );
    const won = Array.isArray(claimed)
      ? Array.isArray(claimed[0])
        ? claimed[0].length > 0
        : claimed.length > 0
      : false;
    if (!won) {
      await this.store.update(created.id, {
        archivedAt: now,
        updatedBy: userId,
      });
      const current = await this.lookup.get(ref.id);
      this.logger.warn(
        `[ROADMAP] Concurrent plan session for ${ref.code}; keeping ${current.builderSessionId}, archiving ${created.id}`,
      );
      return this.planSession(current.builderSessionId);
    }
    await this.events.record({
      sessionId: created.id,
      kind: PlanEventKind.FILED,
      actorUserId: userId,
      detail: { by },
    });
    return this.planSession(created.id);
  }

  /** Never fails Start planning: a hand-off that could not be written is logged and skipped. */
  private async attachStartHandoff(
    userId: number,
    code: string,
    sessionId: string,
  ): Promise<void> {
    try {
      await this.planHandoff?.attachAtStart(userId, code, sessionId);
    } catch (error) {
      this.logger.warn(
        `[ROADMAP] Start planning hand-off for ${code} not written: ${(error as Error)?.message}`,
      );
    }
  }

  private async planSession(sessionId: string | null) {
    const session = sessionId ? await this.store.find(sessionId) : null;
    if (!session) {
      throw new ConflictException(
        'This idea has no plan yet, so it has no lead to set.',
      );
    }
    return session;
  }

  private async assertCanLead(leadUserId: number): Promise<void> {
    if (
      !Number.isInteger(leadUserId) ||
      !roleAtLeast(await this.roles.roleOf(leadUserId), 'builder')
    ) {
      throw new UnprocessableEntityException(
        'Only a Builder or an Owner can lead an idea.',
      );
    }
  }

  private async assertOwner(userId: number): Promise<void> {
    if ((await this.roles.roleOf(userId)) !== 'owner') {
      throw new ForbiddenException('This is for Owners.');
    }
  }

  private undoKey(): Buffer {
    const secret = this.config.jwt.accessToken.secret;
    if (!secret) {
      throw new Error(
        'JWT_ACCESS_SECRET is not configured; undo cannot be signed.',
      );
    }
    return reviewUndoKey(secret);
  }

  private async people(ids: number[]): Promise<Map<number, PersonRef>> {
    const rows: { id: number; name: string | null }[] =
      await this.dataSource.query(
        `SELECT id, name FROM "users" WHERE id = ANY($1)`,
        [ids],
      );
    const roles = await Promise.all(ids.map((id) => this.roles.roleOf(id)));
    const out = new Map<number, PersonRef>();
    ids.forEach((id, i) => {
      const row = rows.find((r) => Number(r.id) === id);
      out.set(id, {
        id,
        name: row?.name || `User ${id}`,
        role: roles[i],
      });
    });
    return out;
  }
}
