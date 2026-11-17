import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

export interface WeeklyDigestRecipient {
  userId: number;
  email: string;
  name: string;
}

export type WeeklyIdeaStage =
  | 'submitted'
  | 'accepted'
  | 'planning'
  | 'building'
  | 'shipped'
  | 'declined'
  | 'closed';

/** What happened to one of your ideas this week. Counts and facts; the email words them. */
export interface WeeklyIdeaNews {
  code: string;
  title: string;
  stage: WeeklyIdeaStage;
  /** Released this week. */
  shippedAt: string | null;
  /** Reviewed by an Owner this week. Never the decline reason. */
  reviewed: 'accepted' | 'declined' | null;
  /** Comments by other people this week. */
  comments: number;
  /** Plan events by other people (or the agent) this week: a lead, a design, a build… */
  planUpdates: number;
}

const PLANNING = new Set(['prd', 'design', 'ready']);
const SHIPPED_PLAN = new Set(['launching', 'measuring', 'learned']);

/** At most this many ideas in one person's email. */
const MAX_IDEAS = 20;

const iso = (value: unknown): string | null => {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
};

/**
 * The facts behind "Your ideas this week" (plans/roadmap-builder-merge
 * §4.14, §5.7b), for the product-updates digest service to send. Raw SQL on
 * purpose: this module must not depend on the roadmap module. Only people
 * who turned the digest on are ever read.
 */
@Injectable()
export class RoadmapDigestFeedService {
  constructor(private readonly dataSource: DataSource) {}

  /** Everyone who turned the weekly digest on and has not had one since `notSince`. */
  async recipients(notSince: Date): Promise<WeeklyDigestRecipient[]> {
    const rows: {
      userId: number;
      email: string | null;
      name: string | null;
    }[] = await this.dataSource.query(
      `SELECT p."userId", u.email, u.name
           FROM "roadmap_user_preferences" p
           JOIN "users" u ON u.id = p."userId"
          WHERE p."weeklyDigest"
            AND (p."lastDigestAt" IS NULL OR p."lastDigestAt" < $1)
          ORDER BY p."userId"`,
      [notSince],
    );
    return rows
      .filter((r) => !!r.email)
      .map((r) => ({
        userId: Number(r.userId),
        email: String(r.email),
        name: (r.name ?? '').trim(),
      }));
  }

  /** The ideas this person filed that had news since `since`, newest activity first. */
  async ideasThisWeek(userId: number, since: Date): Promise<WeeklyIdeaNews[]> {
    const rows: Record<string, unknown>[] = await this.dataSource.query(
      `SELECT o.code, o.description, o.stage, o."reviewState", o."reviewedAt",
              o."releasedAt", s."planStage",
              (SELECT count(*) FROM "roadmap_opportunity_comments" c
                WHERE c."opportunityId" = o.id AND c."deletedAt" IS NULL
                  AND c."createdAt" >= $2 AND c."createdBy" <> $1) AS comments,
              (SELECT count(*) FROM "plan_events" e
                WHERE e."sessionId" = o."builderSessionId" AND e.at >= $2
                  AND (e."actorUserId" IS NULL OR e."actorUserId" <> $1)
                  AND e.kind <> 'exported') AS "planUpdates"
         FROM "roadmap_opportunities" o
         LEFT JOIN "builder_sessions" s
                ON s.id = o."builderSessionId" AND s."deletedAt" IS NULL
        WHERE o."createdBy" = $1 AND o."deletedAt" IS NULL AND o.type <> 'bug'
        ORDER BY o."updatedAt" DESC
        LIMIT 200`,
      [userId, since],
    );
    const sinceMs = since.getTime();
    const after = (value: unknown) => {
      const at = iso(value);
      return at && new Date(at).getTime() >= sinceMs ? at : null;
    };
    const news: WeeklyIdeaNews[] = [];
    for (const r of rows) {
      const shippedAt = r.stage === 'released' ? after(r.releasedAt) : null;
      const reviewedAt = after(r.reviewedAt);
      const reviewed =
        reviewedAt &&
        (r.reviewState === 'accepted' || r.reviewState === 'declined')
          ? r.reviewState
          : null;
      const comments = Number(r.comments ?? 0);
      const planUpdates = Number(r.planUpdates ?? 0);
      if (!shippedAt && !reviewed && !comments && !planUpdates) continue;
      news.push({
        code: String(r.code),
        title:
          String(r.description ?? '')
            .split('\n')[0]
            .trim()
            .slice(0, 140) || String(r.code),
        stage: stageOf(r),
        shippedAt,
        reviewed,
        comments,
        planUpdates,
      });
      if (news.length >= MAX_IDEAS) break;
    }
    return news;
  }

  async markSent(userId: number, at: Date): Promise<void> {
    await this.dataSource.query(
      `UPDATE "roadmap_user_preferences"
          SET "lastDigestAt" = $2, "updatedAt" = now()
        WHERE "userId" = $1`,
      [userId, at],
    );
  }
}

/** The idea's stage in a word, from the stage mirrors (as the board reads them). */
function stageOf(r: Record<string, unknown>): WeeklyIdeaStage {
  const plan = String(r.planStage ?? '');
  if (r.reviewState === 'declined') return 'declined';
  if (r.stage === 'archived' || plan === 'closed') return 'closed';
  if (r.stage === 'released' || SHIPPED_PLAN.has(plan)) return 'shipped';
  if (r.reviewState === 'pending') return 'submitted';
  if (plan === 'building') return 'building';
  if (PLANNING.has(plan)) return 'planning';
  return 'accepted';
}
