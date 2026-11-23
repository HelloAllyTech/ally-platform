import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Repository } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import { BuilderNotificationKind } from 'src/builder/enum/builder.enum';
import { RoadmapNotification } from '../entity/roadmap-notification.entity';
import { RoadmapWatch } from '../entity/roadmap-watch.entity';
import {
  PlanNotificationKind,
  RoadmapNotificationKind,
  RoadmapWatchLevel,
} from '../enum/product-planning.enum';
import {
  kindForBuilderNotification,
  kindForPlanNotification,
  RecipientFacts,
  recipientsFor,
  roadmapGroupKey,
  ROADMAP_AUDIENCE,
} from '../util/roadmap-recipients.util';
import { RoadmapRoleService } from './roadmap-role.service';

/** One event for the inbox. */
export interface RoadmapInboxEvent {
  kind: RoadmapNotificationKind;
  itemId?: string | null;
  sessionId?: string | null;
  /** Data for the frontend to word. `reason` is kept for the author only. */
  payload?: Record<string, unknown>;
  actorUserId?: number | null;
  directRecipientIds?: (number | null | undefined)[];
  /** Only the people named in `directRecipientIds`: the kind's audience is skipped. */
  onlyDirect?: boolean;
  /** Never these people (e.g. those @mentioned, who get their own notice). */
  excludeRecipientIds?: number[];
}

/** One line in the inbox: every notice sharing a group key. */
export interface RoadmapInboxGroup {
  groupKey: string;
  kind: RoadmapNotificationKind;
  itemId: string | null;
  sessionId: string | null;
  count: number;
  unread: number;
  /** The newest notice's payload. */
  payload: Record<string, unknown>;
  ids: string[];
  firstAt: string;
  lastAt: string;
}

/** Payload keys only the idea's author may read (D10, [FP-0992]). */
const AUTHOR_ONLY_KEYS = ['reason', 'declineReason'];

/**
 * The Roadmap v2 inbox (plans/roadmap-builder-merge §4.8, §5.6): one stream,
 * with recipients chosen by role, relationship and watch level instead of
 * "whoever created the session".
 *
 * Lives in ProductPlanningModule because Builder's notification writer
 * dual-writes here and Builder must not import the roadmap module.
 *
 * Every write is best effort: a notice that fails to save must never fail or
 * slow down the thing it reports, so `deliver` and the dual-write entry points
 * never throw. While roadmap_v2 is off nothing reads these tables; the rows
 * accumulate so the inbox is not empty on switch day.
 */
@Injectable()
export class RoadmapInboxService {
  private readonly logger = LoggerService.getInstance(RoadmapInboxService.name);

  constructor(
    @InjectRepository(RoadmapNotification)
    private readonly notifications: Repository<RoadmapNotification>,
    @InjectRepository(RoadmapWatch)
    private readonly watches: Repository<RoadmapWatch>,
    private readonly roles: RoadmapRoleService,
    private readonly dataSource: DataSource,
  ) {}

  // ── Writing ────────────────────────────────────────────────────────────────

  /** Fan one event out to its recipients. Returns who was told. Never throws. */
  async deliver(event: RoadmapInboxEvent): Promise<number[]> {
    try {
      const itemId =
        event.itemId ??
        (event.sessionId ? await this.itemForSession(event.sessionId) : null);
      const facts = await this.factsFor(event.kind, itemId, event);
      const recipients = this.recipientsOf(event, facts);
      if (!recipients.length) return [];
      const now = new Date();
      const groupKey = roadmapGroupKey(
        event.kind,
        { itemId, sessionId: event.sessionId },
        now,
      );
      const payload = event.payload ?? {};
      await this.notifications.save(
        recipients.map((recipientUserId) =>
          this.notifications.create({
            recipientUserId,
            itemId,
            sessionId: event.sessionId ?? null,
            kind: event.kind,
            payload:
              recipientUserId === facts.authorUserId
                ? payload
                : RoadmapInboxService.withoutAuthorOnly(payload),
            groupKey,
          }),
        ),
      );
      return recipients;
    } catch (error) {
      this.logger.warn(
        `Could not deliver roadmap notification (${event.kind}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return [];
    }
  }

  /**
   * New comments, as ONE unread notice per person and idea however many
   * arrive (idea-to-plan audit rec 8): a person who already has an unread
   * comment notice about this idea gets it bumped (count, newest commenter,
   * time) instead of a second row, so a busy thread is one line. Reading it
   * (opening the idea) starts the next one. Never throws.
   */
  async deliverComment(event: {
    itemId: string;
    sessionId?: string | null;
    actorUserId: number;
    payload: Record<string, unknown>;
    excludeRecipientIds?: number[];
  }): Promise<number[]> {
    try {
      const kind = RoadmapNotificationKind.COMMENT;
      const facts = await this.factsFor(kind, event.itemId, {
        kind,
        actorUserId: event.actorUserId,
      });
      const recipients = this.recipientsOf(
        { kind, excludeRecipientIds: event.excludeRecipientIds },
        facts,
      );
      if (!recipients.length) return [];
      const open: { id: string; recipientUserId: number }[] =
        await this.dataSource.query(
          `SELECT id, "recipientUserId" FROM "roadmap_notifications"
            WHERE "itemId" = $1 AND kind = $2 AND "readAt" IS NULL
              AND "recipientUserId" = ANY($3::int[])`,
          [event.itemId, kind, recipients],
        );
      const bump = new Set(open.map((row) => Number(row.recipientUserId)));
      if (open.length) {
        await this.dataSource.query(
          `UPDATE "roadmap_notifications"
              SET payload = payload || $2::jsonb
                    || jsonb_build_object('count', COALESCE((payload->>'count')::int, 1) + 1),
                  "createdAt" = now()
            WHERE id = ANY($1::uuid[])`,
          [open.map((row) => row.id), JSON.stringify(event.payload)],
        );
      }
      const fresh = recipients.filter((id) => !bump.has(id));
      if (fresh.length) {
        await this.notifications.save(
          fresh.map((recipientUserId) =>
            this.notifications.create({
              recipientUserId,
              itemId: event.itemId,
              sessionId: event.sessionId ?? null,
              kind,
              payload: { ...event.payload, count: 1 },
              // One open group per idea: the reader sees one line however long the thread.
              groupKey: `item:${event.itemId}:${kind}:open`,
            }),
          ),
        );
      }
      return recipients;
    } catch (error) {
      this.logger.warn(
        `Could not deliver roadmap comment notice: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return [];
    }
  }

  /** Dual-write from BuilderNotificationService. The original recipient is always kept. */
  fromBuilderNotification(
    session: { id: string; createdBy: number },
    kind: BuilderNotificationKind,
    message: string,
  ): Promise<number[]> {
    return this.deliver({
      kind: kindForBuilderNotification(kind),
      sessionId: session.id,
      payload: { source: 'builder', sourceKind: kind, message },
      directRecipientIds: [session.createdBy],
    });
  }

  /** Dual-write from PlanNotificationService. The original recipient is always kept. */
  fromPlanNotification(
    recipientUserId: number,
    sessionId: string,
    kind: PlanNotificationKind,
    message: string,
  ): Promise<number[]> {
    return this.deliver({
      kind: kindForPlanNotification(kind),
      sessionId,
      payload: { source: 'plan', sourceKind: kind, message },
      directRecipientIds: [recipientUserId],
    });
  }

  /**
   * A vote: the voter follows the idea's milestones unless they already chose
   * a level (§4.8). Never overwrites an existing row. Never throws.
   */
  async watchOnVote(userId: number, itemId: string): Promise<void> {
    try {
      await this.dataSource.query(
        `INSERT INTO "roadmap_watches" ("userId", "itemId", "level")
         VALUES ($1, $2, $3)
         ON CONFLICT ("userId", "itemId") DO NOTHING`,
        [userId, itemId, RoadmapWatchLevel.MILESTONES],
      );
    } catch (error) {
      this.logger.warn(
        `Could not record a vote watch: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /** The person's own choice; always wins over a default. */
  async setWatch(
    userId: number,
    itemId: string,
    level: RoadmapWatchLevel,
  ): Promise<{ itemId: string; level: RoadmapWatchLevel }> {
    await this.dataSource.query(
      `INSERT INTO "roadmap_watches" ("userId", "itemId", "level")
       VALUES ($1, $2, $3)
       ON CONFLICT ("userId", "itemId")
       DO UPDATE SET "level" = EXCLUDED."level", "updatedAt" = now()`,
      [userId, itemId, level],
    );
    return { itemId, level };
  }

  /** The idea page was seen (unread dots, §5.2). Moves forward only. */
  async markSeen(
    userId: number,
    itemId: string,
    at = new Date(),
  ): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO "roadmap_item_reads" ("userId", "itemId", "lastSeenAt")
       VALUES ($1, $2, $3)
       ON CONFLICT ("userId", "itemId")
       DO UPDATE SET "lastSeenAt" = GREATEST("roadmap_item_reads"."lastSeenAt", EXCLUDED."lastSeenAt")`,
      [userId, itemId, at],
    );
  }

  // ── Reading ────────────────────────────────────────────────────────────────

  /** The caller's inbox, newest first, one line per group. */
  async listGrouped(
    recipientUserId: number,
    limit = 200,
  ): Promise<RoadmapInboxGroup[]> {
    const rows = await this.notifications.find({
      where: { recipientUserId },
      order: { createdAt: 'DESC' },
      take: Math.min(Math.max(limit, 1), 500),
    });
    return RoadmapInboxService.group(rows);
  }

  /** Pure: rows (newest first) into inbox lines, keeping that order. */
  static group(
    rows: Pick<
      RoadmapNotification,
      | 'id'
      | 'groupKey'
      | 'kind'
      | 'itemId'
      | 'sessionId'
      | 'payload'
      | 'readAt'
      | 'createdAt'
    >[],
  ): RoadmapInboxGroup[] {
    const groups = new Map<string, RoadmapInboxGroup>();
    for (const row of rows) {
      const at = row.createdAt.toISOString();
      const existing = groups.get(row.groupKey);
      if (!existing) {
        groups.set(row.groupKey, {
          groupKey: row.groupKey,
          kind: row.kind,
          itemId: row.itemId ?? null,
          sessionId: row.sessionId ?? null,
          count: 1,
          unread: row.readAt ? 0 : 1,
          payload: row.payload ?? {},
          ids: [row.id],
          firstAt: at,
          lastAt: at,
        });
        continue;
      }
      existing.count += 1;
      existing.unread += row.readAt ? 0 : 1;
      existing.ids.push(row.id);
      if (at < existing.firstAt) existing.firstAt = at;
    }
    return [...groups.values()];
  }

  /**
   * The caller opened this idea: every notice about it is read now, so a
   * mention or a plan-ready notice stops holding it in Needs you (idea-to-plan
   * audit rec 8). Returns how many changed.
   */
  async markItemRead(recipientUserId: number, itemId: string): Promise<number> {
    const result = await this.notifications.update(
      { recipientUserId, itemId, readAt: IsNull() },
      { readAt: new Date() },
    );
    return result.affected ?? 0;
  }

  /** Mark the caller's notices read: these ids, these groups, or everything. */
  async markRead(
    recipientUserId: number,
    target: { ids?: string[]; groupKeys?: string[]; all?: boolean },
  ): Promise<number> {
    const base = { recipientUserId, readAt: IsNull() };
    let criteria;
    if (target.all) criteria = base;
    else if (target.ids?.length) criteria = { ...base, id: In(target.ids) };
    else if (target.groupKeys?.length)
      criteria = { ...base, groupKey: In(target.groupKeys) };
    else return 0;
    const result = await this.notifications.update(criteria, {
      readAt: new Date(),
    });
    return result.affected ?? 0;
  }

  // ── Facts ──────────────────────────────────────────────────────────────────

  static withoutAuthorOnly(
    payload: Record<string, unknown>,
  ): Record<string, unknown> {
    if (!AUTHOR_ONLY_KEYS.some((key) => key in payload)) return payload;
    const copy = { ...payload };
    for (const key of AUTHOR_ONLY_KEYS) delete copy[key];
    return copy;
  }

  private recipientsOf(
    event: Pick<
      RoadmapInboxEvent,
      'kind' | 'onlyDirect' | 'excludeRecipientIds'
    >,
    facts: RecipientFacts,
  ): number[] {
    const all = event.onlyDirect
      ? [...new Set(facts.directRecipientIds ?? [])]
          .filter((id) => id !== facts.actorUserId)
          .sort((a, b) => a - b)
      : recipientsFor(event.kind, facts);
    const skip = new Set(event.excludeRecipientIds ?? []);
    return all.filter((id) => !skip.has(id));
  }

  /** The idea a session belongs to: the opportunity pointing at it. */
  private async itemForSession(sessionId: string): Promise<string | null> {
    const rows: { id: string }[] = await this.dataSource.query(
      `SELECT id FROM "roadmap_opportunities"
        WHERE "builderSessionId" = $1 AND "deletedAt" IS NULL
        ORDER BY "createdAt" ASC LIMIT 1`,
      [sessionId],
    );
    return rows?.[0]?.id ?? null;
  }

  /** Loads only what this kind's audience needs. */
  private async factsFor(
    kind: RoadmapNotificationKind,
    itemId: string | null,
    event: Pick<
      RoadmapInboxEvent,
      'kind' | 'directRecipientIds' | 'actorUserId'
    >,
  ): Promise<RecipientFacts> {
    const audience = ROADMAP_AUDIENCE[kind];
    const facts: RecipientFacts = {
      authorUserId: null,
      leadUserId: null,
      ownerIds: [],
      voterIds: [],
      watches: [],
      directRecipientIds: (event.directRecipientIds ?? []).filter(
        (id): id is number => typeof id === 'number' && id > 0,
      ),
      actorUserId: event.actorUserId ?? null,
    };
    if (audience.owners) facts.ownerIds = await this.roles.owners();
    if (!itemId) return facts;

    const [row] = await this.dataSource.query(
      `SELECT o."createdBy" AS "authorUserId", s."leadUserId" AS "leadUserId",
              s.plan->>'planningStartedBy' AS "plannerUserId"
         FROM "roadmap_opportunities" o
         LEFT JOIN "builder_sessions" s ON s.id = o."builderSessionId"
        WHERE o.id = $1`,
      [itemId],
    );
    facts.authorUserId = row?.authorUserId ?? null;
    facts.leadUserId = row?.leadUserId ?? null;
    facts.plannerUserId =
      row?.plannerUserId == null ? null : Number(row.plannerUserId) || null;

    if (audience.watchAll || audience.milestones) {
      const [watchRows, voterRows] = await Promise.all([
        this.watches.find({ where: { itemId } }),
        audience.milestones
          ? this.dataSource.query(
              `SELECT DISTINCT "userId" FROM "roadmap_allocations"
                WHERE "opportunityId" = $1 AND votes > 0`,
              [itemId],
            )
          : Promise.resolve([]),
      ]);
      facts.watches = watchRows.map((w) => ({
        userId: w.userId,
        level: w.level,
      }));
      facts.voterIds = (voterRows as { userId: number }[]).map((v) =>
        Number(v.userId),
      );
    }
    return facts;
  }
}
