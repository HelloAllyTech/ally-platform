import { Injectable } from '@nestjs/common';
import { DataSource, IsNull, Not } from 'typeorm';

import { BuilderSettings } from 'src/builder/entity/builder-settings.entity';

import {
  ReleaseWindow,
  normaliseHeldPaths,
  normaliseReleaseWindow,
} from '../util/release-policy.util';

/** What the auto-release policy reads from settings. */
export interface ReleasePolicySettings {
  /** The Roadmap v2 launch flag. The release endpoints are 404 while it is off. */
  roadmapV2: boolean;
  /** Held-path globs: the Owner's list, or the §5.5 defaults when it is empty. */
  heldPaths: string[];
  /** Null is any time. */
  releaseWindow: ReleaseWindow | null;
  autoReleaseEnabled: boolean;
  autoReleasePolicyLive: boolean;
  autoReleasePausedAt: Date | null;
  autoReleasePausedReason: string | null;
}

/**
 * P0 SEAM — settings the policy reads but P0 owns.
 *
 * P0 (`feat/roadmap-v2-p0`, not merged when this was written) adds the
 * `roadmap_v2` flag, `autoReleaseHeldPaths` and `releaseWindow` to the Builder
 * settings row. This reads that row as raw SQL (`SELECT *`) so it compiles and
 * behaves the same before and after P0 lands: a column that does not exist yet
 * is simply absent, and absent means the §5.5 default — flag off, default held
 * paths, any time.
 *
 * TODO(P0): once P0 is merged, read its typed fields (and its flag accessor)
 * here instead of probing column names. Callers do not change.
 *
 * The breaker's own state (`autoReleasePausedAt`, `autoReleasePausedReason`)
 * and `autoReleasePolicyLive` are P5's columns (migration 1983500000000).
 */
@Injectable()
export class ReleasePolicySettingsService {
  constructor(private readonly dataSource: DataSource) {}

  async get(): Promise<ReleasePolicySettings> {
    const rows: Record<string, unknown>[] = await this.dataSource.query(
      `SELECT * FROM "builder_settings" ORDER BY "createdAt" ASC LIMIT 1`,
    );
    const row = rows?.[0] ?? {};
    const pausedAt = row.autoReleasePausedAt
      ? new Date(row.autoReleasePausedAt as string)
      : null;
    return {
      roadmapV2: roadmapV2From(row),
      heldPaths: normaliseHeldPaths(row.autoReleaseHeldPaths),
      releaseWindow: normaliseReleaseWindow(row.releaseWindow),
      autoReleaseEnabled: row.autoReleaseEnabled === true,
      autoReleasePolicyLive: row.autoReleasePolicyLive === true,
      autoReleasePausedAt:
        pausedAt && !Number.isNaN(pausedAt.getTime()) ? pausedAt : null,
      autoReleasePausedReason:
        typeof row.autoReleasePausedReason === 'string'
          ? row.autoReleasePausedReason
          : null,
    };
  }

  /** Whether `roadmap_v2` is on. False whenever it cannot be read. */
  async isRoadmapV2Enabled(): Promise<boolean> {
    try {
      return (await this.get()).roadmapV2;
    } catch {
      return false;
    }
  }

  /**
   * Open the breaker. Conditional on it being closed, so two replicas (or two
   * passes) tripping together pause once and notify once. True when this call
   * opened it.
   */
  async pause(reason: string, at = new Date()): Promise<boolean> {
    const result = await this.dataSource
      .getRepository(BuilderSettings)
      .createQueryBuilder()
      .update()
      .set({
        autoReleasePausedAt: at,
        autoReleasePausedReason: reason.slice(0, 500),
      })
      .where({ autoReleasePausedAt: IsNull() })
      .execute();
    return (result.affected ?? 0) > 0;
  }

  /** Close the breaker. Returns when it had been opened, or null if it was not open. */
  async resume(): Promise<Date | null> {
    const { autoReleasePausedAt } = await this.get();
    if (!autoReleasePausedAt) return null;
    await this.dataSource
      .getRepository(BuilderSettings)
      .createQueryBuilder()
      .update()
      .set({ autoReleasePausedAt: null, autoReleasePausedReason: null })
      .where({ autoReleasePausedAt: Not(IsNull()) })
      .execute();
    return autoReleasePausedAt;
  }
}

/**
 * The flag under whichever name P0 gives its column. Only a real `true` turns
 * it on; anything else, including a missing column, is off.
 */
export function roadmapV2From(row: Record<string, unknown>): boolean {
  return ['roadmapV2', 'roadmap_v2', 'roadmapV2Enabled'].some(
    (key) => row[key] === true,
  );
}
