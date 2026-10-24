import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { matchFirstPersonRisk } from 'src/common/safety/first-person-risk.matcher';
import {
  GuideAdviceLine,
  GuideAdviceStatus,
} from '../entity/guide-advice-line.entity';
import { GuidePeerPolicy } from '../release/guide-release.bundle';
import { redactText } from '../safety/redaction';

/** One item's peer aggregate, already turned into words. Never a person. */
export interface PeerItemSignal {
  itemId: string;
  phrases: string[];
}

/** Share of a group that makes a pattern "often" (plan §4.9 peer whispers). */
export const PEER_OFTEN_SHARE = 0.3;
/** Longer than this between starting and finishing an item counts as a pause. */
export const PEER_PAUSE_HOURS = 24;
/** A typical time is only worth saying for a sitting, not a week. */
const PEER_TYPICAL_MINUTES_MAX = 180;
/** Approved advice lines shown at once. */
export const ADVICE_SHOWN_MAX = 5;

export interface PeerAggregateRow {
  trackItemId: string;
  learners: number;
  paused: number;
  retried: number;
  medianMinutes: number | null;
}

/**
 * An aggregate in words, or nothing when the group is under the minimum
 * (plan Appendix A: 5). Counts never leave this function: only phrases do,
 * so nothing can be worked back to one learner.
 */
export function peerPhrases(
  row: PeerAggregateRow,
  minGroupSize: number,
): string[] {
  const n = Number(row.learners);
  if (!Number.isFinite(n) || n < minGroupSize) return [];
  const phrases: string[] = [];
  if (Number(row.paused) / n >= PEER_OFTEN_SHARE) {
    phrases.push('Learners often pause around here and come back to it later.');
  }
  if (Number(row.retried) / n >= PEER_OFTEN_SHARE) {
    phrases.push('Many learners take more than one go at this.');
  }
  const minutes = row.medianMinutes == null ? null : Number(row.medianMinutes);
  if (
    minutes !== null &&
    Number.isFinite(minutes) &&
    minutes >= 1 &&
    minutes <= PEER_TYPICAL_MINUTES_MAX
  ) {
    const rounded =
      minutes < 10 ? Math.round(minutes) : Math.round(minutes / 5) * 5;
    phrases.push(`Learners usually spend about ${rounded} minutes on this.`);
  }
  return phrases;
}

export type AdviceProblem = 'empty' | 'too_long' | 'contact_details';

/** Why a submitted line cannot be kept as written, or null. */
export function adviceProblem(
  text: string,
  maxChars: number,
): AdviceProblem | null {
  const trimmed = text.trim();
  if (!trimmed) return 'empty';
  if ([...trimmed].length > maxChars) return 'too_long';
  // A line is shown to strangers: no emails, links or phone numbers.
  if (redactText(trimmed) !== trimmed) return 'contact_details';
  return null;
}

const ADVICE_PROBLEM_MESSAGE: Record<AdviceProblem, (max: number) => string> = {
  empty: () => 'Write a line of advice first.',
  too_long: (max) => `Keep it to ${max} characters.`,
  contact_details: () =>
    'Leave out email addresses, links and phone numbers: other learners will read this.',
};

export interface AdviceLineView {
  id: string;
  text: string;
  status: GuideAdviceStatus;
  createdAt: string;
}

const view = (line: GuideAdviceLine): AdviceLineView => ({
  id: line.id,
  text: line.text,
  status: line.status,
  createdAt: new Date(line.createdAt).toISOString(),
});

/**
 * Peer signals (plans/ally-guide/plan.md §4.9): relatedness without rank.
 *
 *  - Whispers: per item, "learners often pause here", from the progress of
 *    other learners in the same organisation, never under the minimum group.
 *  - Advice lines: written by finishers at the mentor door, moderated, shown
 *    anonymously to the same organisation once enough have finished.
 *
 * No leaderboards, no individual comparison, no names — nothing here returns
 * a learner or a count that could single one out.
 */
@Injectable()
export class GuidePeerService {
  constructor(
    @InjectRepository(GuideAdviceLine)
    private readonly advice: Repository<GuideAdviceLine>,
    private readonly dataSource: DataSource,
  ) {}

  /** Whispers for some items of a course, from the learner's own organisation. */
  async itemSignals(input: {
    trackItemIds: string[];
    tenantId: string;
    excludeUserId: number;
    policy: GuidePeerPolicy;
  }): Promise<PeerItemSignal[]> {
    if (!input.trackItemIds.length || !input.tenantId) return [];
    const rows: PeerAggregateRow[] = await this.dataSource.query(
      `SELECT p."trackItemId",
              COUNT(DISTINCT p."userId")::int AS "learners",
              COUNT(*) FILTER (
                WHERE (p."completedAt" IS NULL AND p."startedAt" < now() - make_interval(hours => $4))
                   OR (p."completedAt" - p."startedAt" > make_interval(hours => $4))
              )::int AS "paused",
              COUNT(*) FILTER (WHERE p."attemptCount" > 1)::int AS "retried",
              percentile_cont(0.5) WITHIN GROUP (
                ORDER BY EXTRACT(EPOCH FROM (p."completedAt" - p."startedAt")) / 60
              ) FILTER (WHERE p."completedAt" IS NOT NULL) AS "medianMinutes"
         FROM "track_item_progress" p
         JOIN "track_enrollments" e ON e."id" = p."trackEnrollmentId"
        WHERE p."trackItemId" = ANY($1::uuid[])
          AND e."tenantId" = $2
          AND p."userId" <> $3
          AND p."startedAt" IS NOT NULL
          AND p."deletedAt" IS NULL
          AND e."deletedAt" IS NULL
        GROUP BY p."trackItemId"`,
      [
        input.trackItemIds,
        input.tenantId,
        input.excludeUserId,
        PEER_PAUSE_HOURS,
      ],
    );
    return rows
      .map((row) => ({
        itemId: row.trackItemId,
        phrases: peerPhrases(row, input.policy.minGroupSize),
      }))
      .filter((signal) => signal.phrases.length > 0);
  }

  /** Learners in the organisation who have finished the course. */
  async finishers(trackId: string, tenantId: string): Promise<number> {
    const rows: Array<{ n: number }> = await this.dataSource.query(
      `SELECT COUNT(DISTINCT "userId")::int AS "n"
         FROM "track_enrollments"
        WHERE "trackId" = $1 AND "tenantId" = $2
          AND "completedAt" IS NOT NULL AND "deletedAt" IS NULL`,
      [trackId, tenantId],
    );
    return Number(rows[0]?.n ?? 0);
  }

  /**
   * Approved advice for the course in this organisation — none at all until
   * enough have finished (an empty or thin wall reads as nobody cares; plan
   * Appendix A: 10). Text only: who wrote it is never returned.
   */
  async visibleAdvice(input: {
    trackId: string;
    tenantId: string;
    policy: GuidePeerPolicy;
    excludeUserId?: number;
  }): Promise<string[]> {
    if (!input.tenantId) return [];
    const finished = await this.finishers(input.trackId, input.tenantId);
    if (finished < input.policy.adviceMinFinishers) return [];
    const lines = await this.advice
      .createQueryBuilder('a')
      .select(['a.text'])
      .where('a.trackId = :trackId', { trackId: input.trackId })
      .andWhere('a.tenantId = :tenantId', { tenantId: input.tenantId })
      .andWhere("a.status = 'approved'")
      .andWhere(input.excludeUserId != null ? 'a.userId <> :me' : '1 = 1', {
        me: input.excludeUserId,
      })
      .orderBy('a.moderatedAt', 'DESC')
      .limit(ADVICE_SHOWN_MAX)
      .getMany();
    return lines.map((line) => line.text);
  }

  /** The learner's own line for a course, if they wrote one. */
  async mine(userId: number, trackId: string): Promise<AdviceLineView | null> {
    const line = await this.advice.findOne({ where: { userId, trackId } });
    return line ? view(line) : null;
  }

  /**
   * The mentor door (plan §4.9): a finisher leaves one line for those who
   * come after. One per learner per course; it can be rewritten while it
   * waits for review, and not after.
   */
  async submit(input: {
    userId: number;
    tenantId: string;
    trackId: string;
    text: string;
    policy: GuidePeerPolicy;
  }): Promise<AdviceLineView> {
    const text = input.text.trim().replace(/\s+/g, ' ');
    const problem = adviceProblem(text, input.policy.adviceMaxChars);
    if (problem) {
      throw new BadRequestException(
        ADVICE_PROBLEM_MESSAGE[problem](input.policy.adviceMaxChars),
      );
    }
    const finished: unknown[] = await this.dataSource.query(
      `SELECT 1 FROM "track_enrollments"
        WHERE "userId" = $1 AND "trackId" = $2 AND "tenantId" = $3
          AND "completedAt" IS NOT NULL AND "deletedAt" IS NULL
        LIMIT 1`,
      [input.userId, input.trackId, input.tenantId],
    );
    if (!finished.length) {
      throw new ForbiddenException(
        'Advice lines are for learners who have finished this course.',
      );
    }
    const flags = matchFirstPersonRisk(text) ? ['risk_words'] : [];
    const existing = await this.advice.findOne({
      where: { userId: input.userId, trackId: input.trackId },
    });
    if (existing) {
      if (existing.status !== 'pending') {
        throw new ConflictException(
          'You have already left your advice for this course.',
        );
      }
      existing.text = text;
      existing.flags = flags;
      return view(await this.advice.save(existing));
    }
    const saved = await this.advice.save(
      this.advice.create({
        userId: input.userId,
        tenantId: input.tenantId,
        trackId: input.trackId,
        text,
        status: 'pending',
        flags,
      }),
    );
    return view(saved);
  }

  /** The moderation queue (Ally Console). Authors are never shown. */
  async listForModeration(input: {
    status: GuideAdviceStatus;
    limit: number;
    before?: string | null;
  }): Promise<
    Array<{
      id: string;
      text: string;
      status: GuideAdviceStatus;
      flags: string[];
      trackId: string;
      trackTitle: string | null;
      tenantId: string;
      organisationName: string | null;
      createdAt: string;
      moderatedAt: string | null;
      rejectReason: string | null;
    }>
  > {
    const rows: Array<Record<string, any>> = await this.dataSource.query(
      `SELECT a."id", a."text", a."status", a."flags", a."trackId",
              t."title" AS "trackTitle", a."tenant_id" AS "tenantId",
              o."name" AS "organisationName", a."createdAt", a."moderatedAt",
              a."rejectReason"
         FROM "guide_advice_lines" a
         LEFT JOIN "tracks" t ON t."id" = a."trackId"
         LEFT JOIN "tenants" o ON o."id"::text = a."tenant_id"
        WHERE a."status" = $1
          AND ($2::timestamp IS NULL OR a."createdAt" < $2::timestamp)
        ORDER BY a."createdAt" ${input.status === 'pending' ? 'ASC' : 'DESC'}
        LIMIT $3`,
      [input.status, input.before ?? null, Math.min(input.limit, 100)],
    );
    return rows.map((row) => ({
      id: row.id,
      text: row.text,
      status: row.status,
      flags: Array.isArray(row.flags) ? row.flags : [],
      trackId: row.trackId,
      trackTitle: row.trackTitle ?? null,
      tenantId: row.tenantId,
      organisationName: row.organisationName ?? null,
      createdAt: new Date(row.createdAt).toISOString(),
      moderatedAt: row.moderatedAt
        ? new Date(row.moderatedAt).toISOString()
        : null,
      rejectReason: row.rejectReason ?? null,
    }));
  }

  /** Approve or reject one line. A decision can be changed later. */
  async moderate(input: {
    id: string;
    decision: 'approve' | 'reject';
    reason?: string | null;
    moderatorId: number;
  }): Promise<AdviceLineView> {
    const line = await this.advice.findOne({ where: { id: input.id } });
    if (!line) throw new NotFoundException('Advice line not found');
    line.status = input.decision === 'approve' ? 'approved' : 'rejected';
    line.moderatedBy = input.moderatorId;
    line.moderatedAt = new Date();
    line.rejectReason =
      input.decision === 'reject' ? input.reason?.trim() || null : null;
    return view(await this.advice.save(line));
  }
}
