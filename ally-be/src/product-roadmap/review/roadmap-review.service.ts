import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { AppConfigService } from 'src/config/config.service';
import {
  PlanEventKind,
  RoadmapNotificationKind,
} from 'src/product-planning/enum/product-planning.enum';
import { PlanEventService } from 'src/product-planning/service/plan-event.service';
import { PlanSettingsService } from 'src/product-planning/service/plan-settings.service';
import { RoadmapInboxService } from 'src/product-planning/service/roadmap-inbox.service';
import { RoadmapRoleService } from 'src/product-planning/service/roadmap-role.service';
import { roleAtLeast } from 'src/product-planning/util/roadmap-role.util';
import { RoadmapNotificationService } from '../service/roadmap-notification.service';
import { RoadmapStrategyGoalService } from '../service/roadmap-strategy-goal.service';
import { PlanSessionStore } from '../plan/plan-session.store';
import { PlanStageService } from '../plan/plan-stage.service';
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
import {
  readReviewUndo,
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
 * §2.1a, §4.6, §4.11, §5.7a/b): accept (optionally with a lead in the same
 * call), decline with a reason only the author sees, reopen, bulk review in
 * one transaction with one undo token, pick or change the lead, the lead
 * handing an idea back, and the deterministic suggested lead.
 *
 * Capabilities come from the read model's `can`, so the server refuses
 * exactly what the idea page hides. Every route reaching here has already
 * answered 404 while `roadmap_v2` is off.
 */
@Injectable()
export class RoadmapReviewService {
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
    const session = await this.planSession(ref.builderSessionId);

    if (input.action === 'assign') {
      if (!item.can.pickLead) {
        throw new ForbiddenException(
          (await this.roles.roleOf(userId)) === 'owner'
            ? 'This idea is not at a stage that takes a lead.'
            : 'Only an Owner can pick the lead.',
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
   * Start planning (§2.1a, P3b): the plan interview begins in the idea's one
   * session. The lead on their own idea, or any Owner on any idea; an Owner
   * starting an idea nobody leads takes the lead, because the plan
   * interview is the lead's conversation. Idempotent.
   */
  async startPlanning(userId: number, code: string): Promise<ItemDetail> {
    const item = await this.reader.detail(userId, code);
    const ref = await this.lookup.get(code);
    const session = await this.planSession(ref.builderSessionId);
    if (session.plan?.planningStarted === true) return item;
    if (!item.can.startPlanning) {
      throw new ForbiddenException(
        item.shownStage === 'accepted'
          ? 'Only the lead or an Owner can start planning.'
          : 'Planning starts once an idea is accepted.',
      );
    }
    const lead = session.leadUserId == null ? null : Number(session.leadUserId);
    if (lead === null) {
      await this.store.update(session.id, {
        leadUserId: userId,
        updatedBy: userId,
      });
      await this.afterLeadAssigned(
        userId,
        ref.id,
        ref.code,
        session.id,
        null,
        userId,
      );
    }
    await this.store.patchPlan(session.id, {
      planningStarted: true,
      planningStartedAt: new Date().toISOString(),
      planningStartedBy: userId,
    });
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

    let nextLead = prevLead;
    if (request.decision === 'accept' && request.leadUserId != null) {
      if (!session) {
        throw new ConflictException(
          `${ref.code} has no plan yet, so it has no lead to set.`,
        );
      }
      await this.assertCanLead(Number(request.leadUserId));
      nextLead = Number(request.leadUserId);
    } else if (request.leadUserId != null) {
      throw new UnprocessableEntityException(
        'A lead can only be picked when accepting.',
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
        await this.inbox.deliver({
          kind,
          itemId: p.id,
          sessionId: p.sessionId,
          actorUserId: userId,
          // `reason` is an author-only key: the inbox strips it for everyone else.
          payload: { code: p.code, ...(p.reason ? { reason: p.reason } : {}) },
        });
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
