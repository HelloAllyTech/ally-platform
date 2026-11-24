import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

export type InsightState = 'done' | 'snoozed';

/**
 * What a person did with an insight on For you. Per person, so one admin
 * finishing a finding does not hide it from another.
 */
@Injectable()
export class TenantInsightStateRepository {
  constructor(private readonly dataSource: DataSource) {}

  /** Which of these findings the person has put away: done, or snoozed and not yet back. */
  async hiddenFingerprints(
    userId: number,
    fingerprints: readonly string[],
  ): Promise<Set<string>> {
    if (fingerprints.length === 0) return new Set();
    const rows: Array<{ fingerprint: string }> = await this.dataSource.query(
      `SELECT "fingerprint"
         FROM statistics_insight_state
        WHERE "userId" = $1
          AND "fingerprint" = ANY($2)
          AND ("state" = 'done' OR ("state" = 'snoozed' AND "until" > now()))`,
      [userId, [...fingerprints]],
    );
    return new Set(rows.map((r) => r.fingerprint));
  }

  /**
   * Puts a finding away for this person: done for good (this week's finding), or
   * snoozed for some days. Saying it again replaces what was said before.
   */
  async put(
    tenantId: string,
    userId: number,
    fingerprint: string,
    state: InsightState,
    snoozeDays: number,
  ): Promise<void> {
    // Each parameter appears once, so Postgres can give it one type.
    await this.dataSource.query(
      `INSERT INTO statistics_insight_state ("tenantId", "userId", "fingerprint", "state", "until")
       VALUES ($1::uuid, $2::int, $3::varchar, $4::varchar,
               CASE WHEN $5::int IS NULL THEN NULL ELSE now() + make_interval(days => $5::int) END)
       ON CONFLICT ("userId", "fingerprint")
       DO UPDATE SET "state" = EXCLUDED."state", "until" = EXCLUDED."until", "updatedAt" = now()`,
      [
        tenantId,
        userId,
        fingerprint,
        state,
        state === 'snoozed' ? snoozeDays : null,
      ],
    );
  }
}
