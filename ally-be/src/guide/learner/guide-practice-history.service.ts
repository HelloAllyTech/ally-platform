import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

/** One ended practice attempt on this course, as the Coach may read it. */
export interface PracticeAttempt {
  scenarioSessionId: string;
  trackItemId: string;
  endedAt: string | null;
  /** The learner's own session score (0–100), when the session has one. */
  score: number | null;
  /** What the debrief recognised. */
  positives: string[];
  /** What the debrief suggested working on, with its recommendation. */
  growth: Array<{ improvement: string; recommendation: string | null }>;
  /** The learner-facing debrief note, without its transcript anchors. */
  note: string | null;
}

/** Ended attempts the Coach reads at most, newest first. */
export const PRACTICE_HISTORY_LIMIT = 6;
const LINE_CHARS = 240;
const NOTE_CHARS = 900;

const clip = (value: unknown, max: number): string => {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

/** `[[msg:123]]` anchors point into a transcript the Coach never sees. */
const withoutAnchors = (text: string) =>
  text
    .replace(/\[\[msg:[^\]]*\]\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * The learner-facing part of a stored debrief
 * (`scenario_session_details.summary.feedback`). Reads only what the learner
 * was shown: the supervisor's private memory is dropped before it is stored,
 * and nothing here reads it. Anything not in the expected shape yields
 * nothing rather than a throw.
 */
export function learnerFacingDebrief(feedback: unknown): {
  positives: string[];
  growth: PracticeAttempt['growth'];
  note: string | null;
} {
  const f =
    feedback && typeof feedback === 'object'
      ? (feedback as Record<string, unknown>)
      : {};
  const positives = (Array.isArray(f.positives) ? f.positives : [])
    .map((line) => clip(line, LINE_CHARS))
    .filter(Boolean)
    .slice(0, 4);
  let growth: PracticeAttempt['growth'] = [];
  if (Array.isArray(f.areasOfGrowth) && f.areasOfGrowth.length) {
    growth = f.areasOfGrowth
      .map((item) => {
        const row =
          item && typeof item === 'object'
            ? (item as Record<string, unknown>)
            : {};
        return {
          improvement: clip(row.improvement, LINE_CHARS),
          recommendation: clip(row.recommendation, LINE_CHARS) || null,
        };
      })
      .filter((item) => item.improvement);
  } else if (Array.isArray(f.improvements)) {
    growth = f.improvements
      .map((line) => ({
        improvement: clip(line, LINE_CHARS),
        recommendation: null,
      }))
      .filter((item) => item.improvement);
  }
  const note = clip(
    withoutAnchors(
      typeof f.supervisorNote === 'string' ? f.supervisorNote : '',
    ),
    NOTE_CHARS,
  );
  return { positives, growth: growth.slice(0, 4), note: note || null };
}

/**
 * The learner's practice history on one course (plan §4.4, §7.6 "practice
 * digest"): their recent ended roleplay and case sessions on this course's
 * items, with each debrief's learner-facing summary. Read-only, and only the
 * learner's own sessions.
 */
@Injectable()
export class GuidePracticeHistoryService {
  constructor(private readonly dataSource: DataSource) {}

  async recent(input: {
    userId: number;
    trackItemIds: string[];
    limit?: number;
  }): Promise<PracticeAttempt[]> {
    if (!input.trackItemIds.length) return [];
    const rows: Array<{
      id: string;
      trackItemId: string;
      endedAt: Date | string | null;
      score: number | string | null;
      feedback: unknown;
    }> = await this.dataSource.query(
      `SELECT s."id", p."trackItemId", s."endedAt", s."score",
              d."summary"->'feedback' AS "feedback"
         FROM "scenario_sessions" s
         JOIN "track_item_progress" p ON p."id" = s."trackItemProgressId"
         LEFT JOIN "scenario_session_details" d ON d."scenarioSessionId" = s."id"
        WHERE s."counselorId" = $1
          AND p."userId" = $1
          AND p."trackItemId" = ANY($2::uuid[])
          AND s."endedAt" IS NOT NULL
        ORDER BY s."endedAt" DESC
        LIMIT $3`,
      [
        input.userId,
        input.trackItemIds,
        Math.min(input.limit ?? PRACTICE_HISTORY_LIMIT, PRACTICE_HISTORY_LIMIT),
      ],
    );
    return rows.map((row) => {
      const debrief = learnerFacingDebrief(row.feedback);
      const score =
        row.score === null || row.score === undefined
          ? null
          : Number(row.score);
      return {
        scenarioSessionId: row.id,
        trackItemId: row.trackItemId,
        endedAt:
          row.endedAt instanceof Date
            ? row.endedAt.toISOString()
            : (row.endedAt ?? null),
        score: Number.isFinite(score) ? score : null,
        ...debrief,
      };
    });
  }
}
