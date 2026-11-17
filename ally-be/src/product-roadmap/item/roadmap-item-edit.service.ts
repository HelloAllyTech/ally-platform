import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  PlanEventKind,
  RoadmapNotificationKind,
} from 'src/product-planning/enum/product-planning.enum';
import { PlanEventService } from 'src/product-planning/service/plan-event.service';
import { RoadmapInboxService } from 'src/product-planning/service/roadmap-inbox.service';
import { RoadmapRoleService } from 'src/product-planning/service/roadmap-role.service';
import { roleAtLeast } from 'src/product-planning/util/roadmap-role.util';
import { UpdateOpportunityDto } from '../dto/roadmap-opportunity.dto';
import { ROADMAP_LIMITS } from '../constants/product-roadmap.constants';
import { PlanSessionStore } from '../plan/plan-session.store';
import { PlanStageService } from '../plan/plan-stage.service';
import { RoadmapNotificationService } from '../service/roadmap-notification.service';
import { RoadmapOpportunityService } from '../service/roadmap-opportunity.service';
import { RoadmapStrategyGoalService } from '../service/roadmap-strategy-goal.service';
import { PatchRoadmapItemDto } from './roadmap-item.dto';
import { RoadmapItemLookupService } from './roadmap-item-lookup.service';
import { RoadmapItemReadService } from './roadmap-item-read.service';
import { bodyOf, joinDescription, titleOf } from './roadmap-item-query.util';
import type { ItemCan, ItemDetail, PersonRef } from './roadmap-item.types';

type EditField = 'title' | 'goal' | 'summary' | 'lead' | 'month';

const FIELD_CAN: Record<EditField, keyof ItemCan> = {
  title: 'editTitle',
  goal: 'editGoal',
  summary: 'editSummary',
  lead: 'editLead',
  month: 'editMonth',
};

const FIELD_WORDS: Record<EditField, string> = {
  title: 'title',
  goal: 'goal',
  summary: 'summary',
  lead: 'lead',
  month: 'planned month',
};

/**
 * The Roadmap v2 writes that belong to the read model (§4.11, §4.12): inline
 * edits, the Owner's star and "I opened it". Each inline edit is checked
 * field by field against the same `can.edit*` the idea page shows, goes
 * through the board's own write path (RoadmapOpportunityService.update, so the
 * vector index, goal assessment and board broadcast behave exactly as a
 * drawer edit), writes one attributed `item_edited` plan event per field, and
 * tells open queues with `roadmap:item-changed`.
 */
@Injectable()
export class RoadmapItemEditService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly roles: RoadmapRoleService,
    private readonly lookup: RoadmapItemLookupService,
    private readonly reader: RoadmapItemReadService,
    private readonly opportunities: RoadmapOpportunityService,
    private readonly strategyGoals: RoadmapStrategyGoalService,
    private readonly planStore: PlanSessionStore,
    private readonly planStage: PlanStageService,
    private readonly events: PlanEventService,
    private readonly inbox: RoadmapInboxService,
    private readonly notifications: RoadmapNotificationService,
  ) {}

  async patch(
    userId: number,
    code: string,
    dto: PatchRoadmapItemDto,
  ): Promise<ItemDetail> {
    const before = await this.reader.detail(userId, code);
    const ref = await this.lookup.get(code);

    const asked: EditField[] = [];
    if (dto.title !== undefined && dto.title !== null) asked.push('title');
    if (dto.goalId !== undefined && dto.goalId !== null) asked.push('goal');
    if (dto.summary?.problem !== undefined) asked.push('summary');
    if (dto.leadUserId !== undefined && dto.leadUserId !== null)
      asked.push('lead');
    if (dto.plannedMonth !== undefined) asked.push('month');
    if (!asked.length) return before;

    for (const field of asked) {
      if (!before.can[FIELD_CAN[field]]) {
        throw new ForbiddenException(
          `You can't change this idea's ${FIELD_WORDS[field]}.`,
        );
      }
    }

    const [current] = await this.dataSource.query(
      `SELECT description, "productGoal", "plannedMonth"
         FROM "roadmap_opportunities" WHERE id = $1`,
      [ref.id],
    );
    const update: UpdateOpportunityDto = {};
    const changes: { field: EditField; from?: unknown; to?: unknown }[] = [];

    let title = titleOf(current.description);
    let body = bodyOf(current.description);
    if (asked.includes('title')) {
      const next = (dto.title as string).replace(/\s+/g, ' ').trim();
      if (!next) {
        throw new UnprocessableEntityException('An idea needs a title.');
      }
      if (next !== title) {
        changes.push({ field: 'title', from: title, to: next });
        title = next;
      }
    }
    if (asked.includes('summary')) {
      const next = (dto.summary?.problem ?? '').trim() || null;
      if (next !== body) {
        changes.push({ field: 'summary' });
        body = next;
      }
    }
    if (changes.some((c) => c.field === 'title' || c.field === 'summary')) {
      const description = joinDescription(title, body);
      if (description.length > ROADMAP_LIMITS.DESCRIPTION_MAX) {
        throw new UnprocessableEntityException(
          `The title and summary together can be at most ${ROADMAP_LIMITS.DESCRIPTION_MAX} characters.`,
        );
      }
      update.description = description;
    }

    if (asked.includes('goal')) {
      const [goal] = await this.dataSource.query(
        `SELECT name FROM "roadmap_product_goals" WHERE id = $1`,
        [dto.goalId],
      );
      if (!goal) {
        throw new UnprocessableEntityException('That goal does not exist.');
      }
      if (goal.name !== current.productGoal) {
        update.productGoal = goal.name;
        changes.push({
          field: 'goal',
          from: current.productGoal,
          to: goal.name,
        });
      }
    }

    if (asked.includes('month')) {
      const next = dto.plannedMonth ?? null;
      if (next !== (current.plannedMonth ?? null)) {
        update.plannedMonth = next;
        changes.push({ field: 'month', from: current.plannedMonth, to: next });
      }
    }

    // Lead first: it is the one that can be refused for a reason the others
    // cannot (no plan yet), and a refused PATCH must change nothing.
    const leadChange = asked.includes('lead')
      ? await this.checkLead(ref.builderSessionId, dto.leadUserId as number)
      : null;
    if (leadChange && leadChange.from !== leadChange.to) {
      changes.push({ field: 'lead', from: leadChange.from, to: leadChange.to });
    }

    if (Object.keys(update).length) {
      await this.opportunities.update(userId, ref.id, update);
    }
    if (leadChange && leadChange.from !== leadChange.to) {
      await this.assignLead(
        ref.id,
        leadChange.sessionId,
        userId,
        leadChange.to,
      );
    }

    if (changes.length) {
      if (ref.builderSessionId) {
        for (const change of changes) {
          await this.events.record({
            sessionId: ref.builderSessionId,
            kind: PlanEventKind.ITEM_EDITED,
            actorUserId: userId,
            detail: change,
          });
        }
      }
      this.notifications.emit({
        kind: 'ITEM_CHANGED',
        actorId: userId,
        code: ref.code,
        fields: changes.map((c) => c.field),
      });
    }
    // Your own edit is not news to you.
    await this.inbox.markSeen(userId, ref.id);
    return this.reader.detail(userId, code);
  }

  /** The Owner's star (D16): any Owner, shown with who gave it. */
  async setStar(
    userId: number,
    code: string,
    starred: boolean,
  ): Promise<{ starred: boolean; starredBy: PersonRef | null }> {
    const before = await this.reader.detail(userId, code);
    if (!before.can.star) {
      throw new ForbiddenException(
        (await this.roles.roleOf(userId)) === 'owner'
          ? 'This idea can no longer be starred.'
          : 'Only an Owner can star an idea.',
      );
    }
    const ref = await this.lookup.get(code);
    await this.dataSource.query(
      `UPDATE "roadmap_opportunities"
          SET "directorStarred" = $2,
              "starredByUserId" = $3,
              "updatedBy" = $4,
              "updatedAt" = now()
        WHERE id = $1`,
      [ref.id, starred, starred ? userId : null, userId],
    );
    // The star moves the composite rank, so every card's queue position can move.
    this.strategyGoals.invalidate(userId);
    this.notifications.emit({
      kind: 'ITEM_CHANGED',
      actorId: userId,
      code: ref.code,
      fields: ['starred'],
    });
    await this.inbox.markSeen(userId, ref.id);
    const after = await this.reader.detail(userId, code);
    return { starred: after.starred, starredBy: after.starredBy ?? null };
  }

  /** The idea page or reading pane was opened (§4.3: opening marks it read). */
  async markRead(userId: number, code: string): Promise<void> {
    if ((await this.roles.roleOf(userId)) === 'none') {
      throw new ForbiddenException('You do not have access to the Roadmap.');
    }
    const ref = await this.lookup.get(code);
    await this.inbox.markSeen(userId, ref.id);
  }

  private async checkLead(
    sessionId: string | null,
    leadUserId: number,
  ): Promise<{ sessionId: string; from: number | null; to: number }> {
    const [session] = sessionId
      ? await this.dataSource.query(
          `SELECT id, kind, "leadUserId" FROM "builder_sessions"
            WHERE id = $1 AND "deletedAt" IS NULL`,
          [sessionId],
        )
      : [];
    if (!session || session.kind !== 'plan') {
      throw new ConflictException(
        'This idea has no plan yet, so it has no lead to set.',
      );
    }
    if (!roleAtLeast(await this.roles.roleOf(leadUserId), 'builder')) {
      throw new UnprocessableEntityException(
        'Only a Builder or an Owner can lead an idea.',
      );
    }
    return {
      sessionId: session.id,
      from: session.leadUserId == null ? null : Number(session.leadUserId),
      to: leadUserId,
    };
  }

  private async assignLead(
    itemId: string,
    sessionId: string,
    actorUserId: number,
    leadUserId: number,
  ): Promise<void> {
    await this.planStore.update(sessionId, {
      leadUserId,
      updatedBy: actorUserId,
    });
    await this.planStore.patchPlan(sessionId, { nudgedAt: null });
    await this.events.record({
      sessionId,
      kind: PlanEventKind.LEAD_ASSIGNED,
      actorUserId,
      detail: { to: leadUserId },
    });
    await this.planStage.sync(sessionId, actorUserId);
    const payload = { leadUserId };
    await this.inbox.deliver({
      kind: RoadmapNotificationKind.ASSIGNED_TO_YOU,
      itemId,
      sessionId,
      actorUserId,
      payload,
      directRecipientIds: [leadUserId],
    });
    await this.inbox.deliver({
      kind: RoadmapNotificationKind.LEAD_ASSIGNED,
      itemId,
      sessionId,
      actorUserId,
      payload,
    });
  }
}
