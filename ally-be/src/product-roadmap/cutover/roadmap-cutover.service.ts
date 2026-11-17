import {
  ConflictException,
  ForbiddenException,
  HttpStatus,
  Injectable,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import { AppConfigService } from 'src/config/config.service';
import { BuilderSession } from 'src/builder/entity/builder-session.entity';
import {
  BUILDER_ACTIVE_STATUSES,
  BuilderMessageRole,
  BuilderSessionKind,
  BuilderSessionVisibility,
} from 'src/builder/enum/builder.enum';
import {
  PlanEventKind,
  PlanStage,
} from 'src/product-planning/enum/product-planning.enum';
import { PlanEventService } from 'src/product-planning/service/plan-event.service';
import { PlanSettingsService } from 'src/product-planning/service/plan-settings.service';
import { RoadmapRoleService } from 'src/product-planning/service/roadmap-role.service';
import { ROADMAP_LIMITS } from '../constants/product-roadmap.constants';
import { firstLine } from '../draft/roadmap-draft.util';
import { RoadmapCutoverCounts } from '../entity/roadmap-cutover-log.entity';
import { RoadmapOpportunitySource } from '../enum/roadmap-opportunity.enum';
import { RoadmapOpportunityService } from '../service/roadmap-opportunity.service';

/** One person, by name and id only (never an email: the repo and the wiki are public). */
export interface CutoverPerson {
  userId: number;
  name: string;
}

export interface CutoverDraftRow {
  id: string;
  authorUserId: number;
  authorName: string;
  title: string;
}

export interface CutoverSessionRow {
  sessionId: string;
  title: string;
  status: string;
  creatorUserId: number;
  creatorName: string;
}

export interface CutoverPreview {
  /** Whether `roadmap_v2` is on now. A run while it is on is a catch-up run. */
  roadmapV2Enabled: boolean;
  /** Who becomes Builder and who becomes Owner (§3.3): the list the Owner confirms. */
  builders: CutoverPerson[];
  owners: CutoverPerson[];
  /**
   * Builders and Owners whose Product Roadmap toggle is off. They hold the role, but every
   * Roadmap route is behind that toggle, so they cannot open the Roadmap until someone gives
   * them a Roadmap role on Users. Shown, never fixed silently: granting it would change their
   * access to the old Product Roadmap too.
   */
  withoutRoadmapAccess: CutoverPerson[];
  /** Parked `roadmap_idea_drafts` that become private drafts in My drafts. */
  drafts: { total: number; items: CutoverDraftRow[] };
  /** Live direct Builder sessions with no idea, which each get a filed idea. */
  sessions: { total: number; items: CutoverSessionRow[] };
  /** Opportunities filed through the old doors with no review state; they become Accepted. */
  reviewBackfill: { total: number };
  /** The goal a session's idea is filed under (the first by position); null when none exist. */
  goal: string | null;
  /** The newest run, if any. */
  lastRun: {
    at: string;
    actorUserId: number | null;
    actorName: string | null;
    counts: RoadmapCutoverCounts;
  } | null;
}

export interface CutoverResult {
  counts: RoadmapCutoverCounts;
  /** Each moved draft and the code it now has in My drafts. */
  drafts: { draftId: string; code: string }[];
  /** Each session and the code of the idea it was given. */
  filed: { sessionId: string; code: string }[];
  roadmapV2Enabled: true;
  at: string;
}

/** Lists in the preview are capped; the totals are not. */
const PREVIEW_LIST_MAX = 200;
/** Serialises two Owners pressing the button at once. */
const LOCK_KEY = 'roadmap_v2_cutover';
const UNNAMED = (id: number) => `User ${id}`;

const coded = (status: HttpStatus, code: string, message: string) => ({
  statusCode: status,
  code,
  message,
});

const sameIds = (a: number[], b: number[]): boolean => {
  const x = [...new Set(a)].sort((m, n) => m - n);
  const y = [...new Set(b)].sort((m, n) => m - n);
  return x.length === y.length && x.every((v, i) => v === y[i]);
};

/**
 * The Roadmap cutover (plans/roadmap-builder-merge §6, §7 P6, D8): the Owner's switch-on
 * action, never a deploy-time migration, so production behaves as it does today until the
 * Owner presses it.
 *
 * - `preview()` is what the Owner looks at: who becomes Builder and Owner, and what moves.
 * - `run()` refuses unless the Owner confirmed exactly today's lists (Builder gains merge
 *   rights on real code), then in one transaction copies parked drafts into private drafts,
 *   files an idea for each live direct Builder session, accepts every unreviewed opportunity,
 *   switches `roadmapV2Enabled` on last, and writes a `roadmap_cutover_log` row.
 *
 * Idempotent: each step skips what an earlier run already did, so a second run moves nothing
 * and only re-asserts the flag. Reversible: nothing is deleted. Switching `roadmap_v2` off
 * (Builder settings PATCH) brings the old tabs back with their data; the old drafts are still
 * there, labelled `migratedAt`. Deletion is P7.
 *
 * Role mapping (§3.3) needs no write. P0's RoadmapRoleService reads the three roles live from
 * the same toggles that gate today's pages, and only the Roadmap's own routes — 404 while the
 * flag is off — consult them. Writing new grants here would change access with the flag off.
 */
@Injectable()
export class RoadmapCutoverService {
  private readonly logger = LoggerService.getInstance(
    RoadmapCutoverService.name,
  );

  constructor(
    private readonly dataSource: DataSource,
    private readonly roles: RoadmapRoleService,
    private readonly settings: PlanSettingsService,
    private readonly events: PlanEventService,
    private readonly opportunities: RoadmapOpportunityService,
    private readonly config: AppConfigService,
  ) {}

  // ── Preview ──────────────────────────────────────────────────────────────

  async preview(userId: number): Promise<CutoverPreview> {
    await this.assertOwner(userId);
    const [people, enabled, drafts, sessions, reviews, goal, lastRun] =
      await Promise.all([
        this.people(),
        this.settings.getRoadmapV2().then((s) => s.enabled),
        this.pendingDrafts(this.dataSource.manager, false),
        this.pendingSessions(this.dataSource.manager, false),
        this.pendingReviews(),
        this.defaultGoal(this.dataSource.manager),
        this.lastRun(),
      ]);
    const names = await this.names([
      ...drafts.map((d) => d.ownerUserId),
      ...sessions.map((s) => s.createdBy),
    ]);
    return {
      roadmapV2Enabled: enabled,
      ...people,
      drafts: {
        total: drafts.length,
        items: drafts.slice(0, PREVIEW_LIST_MAX).map((d) => ({
          id: d.id,
          authorUserId: d.ownerUserId,
          authorName: names.get(d.ownerUserId) ?? UNNAMED(d.ownerUserId),
          title: firstLine(d.rawText),
        })),
      },
      sessions: {
        total: sessions.length,
        items: sessions.slice(0, PREVIEW_LIST_MAX).map((s) => ({
          sessionId: s.id,
          title: s.title,
          status: s.status,
          creatorUserId: s.createdBy,
          creatorName: names.get(s.createdBy) ?? UNNAMED(s.createdBy),
        })),
      },
      reviewBackfill: { total: reviews },
      goal,
      lastRun,
    };
  }

  // ── Run ──────────────────────────────────────────────────────────────────

  async run(
    userId: number,
    input: { confirmedBuilderIds: number[]; confirmedOwnerIds: number[] },
  ): Promise<CutoverResult> {
    await this.assertOwner(userId);
    const people = await this.people();
    if (
      !sameIds(
        input.confirmedBuilderIds ?? [],
        people.builders.map((p) => p.userId),
      ) ||
      !sameIds(
        input.confirmedOwnerIds ?? [],
        people.owners.map((p) => p.userId),
      )
    ) {
      throw new ConflictException(
        coded(
          HttpStatus.CONFLICT,
          'roles_changed',
          'Access changed since you looked. Review the list again.',
        ),
      );
    }
    const flagWasOn = (await this.settings.getRoadmapV2()).enabled;

    const outcome = await this.dataSource.transaction(async (manager) => {
      await manager.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
        LOCK_KEY,
      ]);
      const drafts = await this.moveDrafts(manager);
      const filed = await this.fileSessions(manager, userId);
      const reviewsAccepted = await this.acceptReviews(manager);
      const counts: RoadmapCutoverCounts = {
        draftsMoved: drafts.length,
        sessionsFiled: filed.length,
        reviewsAccepted,
        builders: people.builders.length,
        owners: people.owners.length,
      };
      // Last, so a failure in any step above leaves the flag as it was.
      await this.switchOn(manager, userId);
      const [log] = await manager.query(
        `INSERT INTO "roadmap_cutover_log"
           ("actorUserId", "counts", "confirmedBuilderIds", "confirmedOwnerIds", "flagWasOn")
         VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb, $5)
         RETURNING "at"`,
        [
          userId,
          JSON.stringify(counts),
          JSON.stringify(people.builders.map((p) => p.userId)),
          JSON.stringify(people.owners.map((p) => p.userId)),
          flagWasOn,
        ],
      );
      return { drafts, filed, counts, at: log?.at };
    });

    this.logger.info(
      `Roadmap v2 ENABLED by cutover, user ${userId}: ${JSON.stringify(outcome.counts)}`,
    );
    // After the commit, best-effort, as create() does after its save.
    try {
      await this.opportunities.afterMigratedFiling(
        outcome.filed.map((f) => f.id),
        userId,
      );
    } catch (error) {
      this.logger.warn(
        `Cutover follow-up (index, goal impact) failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    return {
      counts: outcome.counts,
      drafts: outcome.drafts,
      filed: outcome.filed.map(({ sessionId, code }) => ({ sessionId, code })),
      roadmapV2Enabled: true,
      at: new Date(outcome.at ?? Date.now()).toISOString(),
    };
  }

  // ── Steps (each skips what an earlier run did) ───────────────────────────

  /**
   * Each parked draft becomes a private plan draft for its author, shaped as P3's New idea
   * makes one (RoadmapDraftService.create), keeping its words and when it was last touched.
   * The source row is labelled, not deleted. A plan the old planning migrator already made
   * from the row (`migratedFromDraftId`) is reused, and given a code if it has none.
   */
  private async moveDrafts(
    manager: EntityManager,
  ): Promise<{ draftId: string; code: string }[]> {
    const drafts = await this.pendingDrafts(manager, true);
    if (!drafts.length) return [];
    const budgetUsd = await this.defaultBudget(manager);
    const moved: { draftId: string; code: string }[] = [];
    for (const draft of drafts) {
      const text = (draft.rawText ?? '').replace(/\r\n/g, '\n').trim();
      const [existing] = await manager.query(
        `SELECT id, "plan"->>'code' AS code FROM "builder_sessions"
          WHERE kind = 'plan' AND "plan"->>'migratedFromDraftId' = $1
          ORDER BY "createdAt" LIMIT 1`,
        [draft.id],
      );
      let sessionId: string;
      let code: string;
      if (existing) {
        sessionId = existing.id;
        code = existing.code ?? (await this.nextCode(manager));
        await manager.query(
          `UPDATE "builder_sessions"
              SET "plan" = COALESCE("plan", '{}'::jsonb) || jsonb_build_object(
                    'code', $2::text,
                    'draftText', COALESCE("plan"->>'draftText', $3::text),
                    'draftVersion', COALESCE(("plan"->>'draftVersion')::int, 1))
            WHERE id = $1`,
          [sessionId, code, text],
        );
      } else {
        code = await this.nextCode(manager);
        const repository = manager.getRepository(BuilderSession);
        const lastActive = new Date(
          draft.updatedAt ?? draft.createdAt ?? Date.now(),
        );
        const saved = await repository.save(
          repository.create({
            title: firstLine(text),
            slug: await this.freeSlug(manager, draft.id),
            kind: BuilderSessionKind.PLAN,
            visibility: BuilderSessionVisibility.PRIVATE,
            planStage: PlanStage.IDEA,
            planStageAt: new Date(),
            budgetUsd,
            plan: {
              code,
              draftText: text,
              draftGoalId: null,
              draftVersion: 1,
              parked: true,
              captureMode: draft.captureMode === 'voice' ? 'voice' : 'typed',
              migratedFromDraftId: draft.id,
              lastActiveAt: lastActive.toISOString(),
            } as BuilderSession['plan'],
            createdBy: draft.ownerUserId,
            updatedBy: draft.ownerUserId,
          }),
        );
        sessionId = saved.id;
        await this.events.record(
          {
            sessionId,
            kind: PlanEventKind.PARKED,
            actorUserId: draft.ownerUserId,
            detail: { migratedFromDraftId: draft.id, by: 'cutover' },
          },
          manager,
        );
      }
      await manager.query(
        `UPDATE "roadmap_idea_drafts" SET "migratedAt" = now(), "migratedToId" = $2
          WHERE id = $1 AND "migratedAt" IS NULL`,
        [draft.id, sessionId],
      );
      moved.push({ draftId: draft.id, code });
    }
    return moved;
  }

  /**
   * Each live direct Builder session with no idea gets one, through the labelled filing path
   * (RoadmapOpportunityService.fileMigratedBuilderSession), lead = its creator. Terminal and
   * archived sessions are left alone: they stay readable as archive pages.
   */
  private async fileSessions(
    manager: EntityManager,
    actorUserId: number,
  ): Promise<{ id: string; sessionId: string; code: string }[]> {
    const sessions = await this.pendingSessions(manager, true);
    if (!sessions.length) return [];
    const goal = await this.defaultGoal(manager);
    if (!goal) {
      throw new UnprocessableEntityException(
        coded(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'no_goal',
          'Add a product goal first: each Builder session is filed under one.',
        ),
      );
    }
    const filed: { id: string; sessionId: string; code: string }[] = [];
    for (const session of sessions) {
      const created = await this.opportunities.fileMigratedBuilderSession(
        manager,
        {
          sessionId: session.id,
          description: await this.describe(manager, session),
          productGoal: goal,
          creatorUserId: session.createdBy,
          actorUserId,
        },
      );
      await manager.query(
        `UPDATE "builder_sessions" SET "leadUserId" = COALESCE("leadUserId", "createdBy")
          WHERE id = $1`,
        [session.id],
      );
      await this.events.record(
        {
          sessionId: session.id,
          kind: PlanEventKind.FILED,
          actorUserId,
          detail: {
            opportunityId: created.id,
            source: RoadmapOpportunitySource.MIGRATED_BUILDER_SESSION,
          },
        },
        manager,
      );
      filed.push({ id: created.id, sessionId: session.id, code: created.code });
    }
    return filed;
  }

  /** Opportunities filed through the old doors carry no review state: they count as accepted. */
  private async acceptReviews(manager: EntityManager): Promise<number> {
    const [row] = await manager.query(
      `WITH accepted AS (
         UPDATE "roadmap_opportunities" SET "reviewState" = 'accepted'
          WHERE "reviewState" IS NULL
         RETURNING 1
       )
       SELECT count(*)::int AS n FROM accepted`,
    );
    return Number(row?.n ?? 0);
  }

  private async switchOn(
    manager: EntityManager,
    userId: number,
  ): Promise<void> {
    const rows = await manager.query(
      `UPDATE "builder_settings"
          SET "roadmapV2Enabled" = true, "updatedBy" = $1, "updatedAt" = now()
        WHERE id = (SELECT id FROM "builder_settings" ORDER BY "createdAt" ASC LIMIT 1)
        RETURNING id`,
      [userId],
    );
    const updated = Array.isArray(rows?.[0]) ? rows[0] : rows;
    if (!updated?.length) {
      throw new ServiceUnavailableException(
        'Builder settings are missing. Open Builder settings once, then try again.',
      );
    }
  }

  // ── Reads ────────────────────────────────────────────────────────────────

  private async assertOwner(userId: number): Promise<void> {
    if ((await this.roles.roleOf(userId)) !== 'owner') {
      throw new ForbiddenException(
        'Only a Roadmap Owner (Product Roadmap — Manage) can switch Roadmap on.',
      );
    }
  }

  private async people(): Promise<{
    builders: CutoverPerson[];
    owners: CutoverPerson[];
    withoutRoadmapAccess: CutoverPerson[];
  }> {
    const promoted = await this.roles.previewPromotions();
    const grants = await Promise.all(
      promoted.map((p) => this.roles.grantsOf(p.userId)),
    );
    const person = (p: { userId: number; name: string }) => ({
      userId: p.userId,
      name: p.name,
    });
    return {
      builders: promoted.filter((p) => p.role === 'builder').map(person),
      owners: promoted.filter((p) => p.role === 'owner').map(person),
      withoutRoadmapAccess: promoted
        .filter((_, i) => !grants[i].roadmap)
        .map(person),
    };
  }

  private pendingDrafts(
    manager: EntityManager,
    lock: boolean,
  ): Promise<
    {
      id: string;
      ownerUserId: number;
      rawText: string;
      captureMode: string;
      createdAt: Date;
      updatedAt: Date;
    }[]
  > {
    return manager.query(
      `SELECT id, "ownerUserId", "rawText", "captureMode", "createdAt", "updatedAt"
         FROM "roadmap_idea_drafts"
        WHERE "deletedAt" IS NULL AND "migratedAt" IS NULL
        ORDER BY "createdAt" ASC${lock ? ' FOR UPDATE' : ''}`,
    );
  }

  /**
   * A session is "direct with no idea" when nothing links to it: not even a soft-deleted
   * opportunity, whose link the unique index still holds (that session had an idea once).
   */
  private pendingSessions(
    manager: EntityManager,
    lock: boolean,
  ): Promise<
    { id: string; title: string; status: string; createdBy: number }[]
  > {
    return manager.query(
      `SELECT s.id, s.title, s.status, s."createdBy"
         FROM "builder_sessions" s
        WHERE s.kind = $1 AND s.visibility = $2
          AND s."archivedAt" IS NULL AND s."deletedAt" IS NULL
          AND s.status = ANY($3)
          AND NOT EXISTS (
            SELECT 1 FROM "roadmap_opportunities" o WHERE o."builderSessionId" = s.id
          )
        ORDER BY s."createdAt" ASC${lock ? ' FOR UPDATE OF s' : ''}`,
      [
        BuilderSessionKind.BUILD,
        BuilderSessionVisibility.SHARED,
        BUILDER_ACTIVE_STATUSES,
      ],
    );
  }

  private async pendingReviews(): Promise<number> {
    const [row] = await this.dataSource.query(
      `SELECT count(*)::int AS n FROM "roadmap_opportunities" WHERE "reviewState" IS NULL`,
    );
    return Number(row?.n ?? 0);
  }

  private async defaultGoal(manager: EntityManager): Promise<string | null> {
    const [row] = await manager.query(
      `SELECT name FROM "roadmap_product_goals" ORDER BY position ASC, "createdAt" ASC LIMIT 1`,
    );
    return row?.name ?? null;
  }

  private async lastRun(): Promise<CutoverPreview['lastRun']> {
    const [row] = await this.dataSource.query(
      `SELECT l."at", l."actorUserId", l."counts", u.name AS "actorName"
         FROM "roadmap_cutover_log" l
         LEFT JOIN "users" u ON u.id = l."actorUserId"
        ORDER BY l."at" DESC LIMIT 1`,
    );
    if (!row) return null;
    return {
      at: new Date(row.at).toISOString(),
      actorUserId: row.actorUserId ?? null,
      actorName: row.actorName ?? null,
      counts: row.counts,
    };
  }

  private async names(ids: number[]): Promise<Map<number, string>> {
    const unique = [...new Set(ids.filter((id) => Number.isFinite(id)))];
    if (!unique.length) return new Map();
    const rows: { id: number; name: string | null }[] =
      await this.dataSource.query(
        `SELECT id, name FROM "users" WHERE id = ANY($1)`,
        [unique],
      );
    return new Map(
      rows.map((u) => [Number(u.id), u.name || UNNAMED(Number(u.id))]),
    );
  }

  private async nextCode(manager: EntityManager): Promise<string> {
    const [{ code }] = await manager.query(
      `SELECT 'OPP-' || lpad(nextval('roadmap_opportunity_code_seq')::text, 4, '0') AS code`,
    );
    return code;
  }

  /** Branch-safe and unique, like Builder's own slugs: `idea-<draft id>`, suffixed on a clash. */
  private async freeSlug(
    manager: EntityManager,
    draftId: string,
  ): Promise<string> {
    const base = `idea-${draftId.replace(/-/g, '').slice(0, 12)}`;
    for (let n = 0; ; n++) {
      const slug = n ? `${base}-${n + 1}` : base;
      const [taken] = await manager.query(
        `SELECT 1 FROM "builder_sessions" WHERE slug = $1 LIMIT 1`,
        [slug],
      );
      if (!taken) return slug;
    }
  }

  /** The session's default budget, as BuilderSessionService.createSession stamps it. */
  private async defaultBudget(manager: EntityManager): Promise<string | null> {
    const [row] = await manager.query(
      `SELECT "defaultBudgetUsd" FROM "builder_settings" ORDER BY "createdAt" ASC LIMIT 1`,
    );
    if (row?.defaultBudgetUsd != null) return String(row.defaultBudgetUsd);
    const fallback = this.config.builder?.defaultBudgetUsd;
    return fallback ? String(fallback) : null;
  }

  /**
   * The idea's words: the session's title, or its first message when the title is still
   * Builder's placeholder. Bounded to the opportunity's 1000 characters.
   */
  private async describe(
    manager: EntityManager,
    session: { id: string; title: string },
  ): Promise<string> {
    let text = (session.title ?? '').trim();
    if (!text || text === 'New build') {
      const [first] = await manager.query(
        `SELECT content FROM "builder_messages"
          WHERE "sessionId" = $1 AND role = $2 AND content IS NOT NULL AND btrim(content) <> ''
          ORDER BY seq ASC LIMIT 1`,
        [session.id, BuilderMessageRole.USER],
      );
      text = String(first?.content ?? '').trim();
    }
    if (!text) text = 'Builder session moved to the Roadmap';
    return text.slice(0, ROADMAP_LIMITS.DESCRIPTION_MAX);
  }
}
