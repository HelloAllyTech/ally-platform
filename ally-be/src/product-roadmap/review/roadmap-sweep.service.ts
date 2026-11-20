import {
  ForbiddenException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { RoadmapRoleService } from 'src/product-planning/service/roadmap-role.service';
import { globalCapabilities } from 'src/product-planning/util/roadmap-role.util';
import { RoadmapItemReadService } from '../item/roadmap-item-read.service';
import type { ItemRow } from '../item/roadmap-item.types';
import { RoadmapNotificationService } from '../service/roadmap-notification.service';
import {
  isSweepCandidate,
  SWEEP_MAX_VOTERS,
  SWEEP_OLDER_THAN_DAYS,
  SWEEP_PAGE,
} from './roadmap-sweep.util';

export interface RoadmapSweepResponse {
  olderThanDays: number;
  maxVoters: number;
  /** Every idea the sweep would pull up now. */
  total: number;
  /** The first of them (oldest first), at most SWEEP_PAGE. */
  rows: ItemRow[];
}

/**
 * The Owner's old-and-quiet sweep over To do (idea-to-plan audit rec 9). It
 * reads; the only write is Keep, an Owner's click that stops an idea being
 * offered again. Declining goes through the existing bulk review (with its
 * reasons and its undo), so nothing here declines anything.
 */
@Injectable()
export class RoadmapSweepService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly roles: RoadmapRoleService,
    private readonly reader: RoadmapItemReadService,
    private readonly broadcast: RoadmapNotificationService,
  ) {}

  async list(userId: number, now = new Date()): Promise<RoadmapSweepResponse> {
    await this.assertOwner(userId);
    const rows = await this.candidates(userId, now);
    return {
      olderThanDays: SWEEP_OLDER_THAN_DAYS,
      maxVoters: SWEEP_MAX_VOTERS,
      total: rows.length,
      rows: rows.slice(0, SWEEP_PAGE),
    };
  }

  /** Keep these ideas: the sweep stops offering them. Changes nothing else. */
  async keep(userId: number, codes: string[]): Promise<{ kept: number }> {
    await this.assertOwner(userId);
    const clean = [
      ...new Set(codes.map((c) => String(c).trim().toUpperCase())),
    ].filter(Boolean);
    if (!clean.length) {
      throw new UnprocessableEntityException('Name at least one idea to keep.');
    }
    const result = await this.dataSource.query(
      `UPDATE "roadmap_opportunities"
          SET "sweepKeptAt" = now(), "sweepKeptBy" = $2
        WHERE upper(code) = ANY($1::text[]) AND "deletedAt" IS NULL
          AND "sweepKeptAt" IS NULL
        RETURNING code`,
      [clean, userId],
    );
    const rows: { code: string }[] = Array.isArray(result?.[0])
      ? result[0]
      : result;
    for (const row of rows ?? []) {
      this.broadcast.emit({
        kind: 'ITEM_CHANGED',
        actorId: userId,
        code: row.code,
        fields: ['sweep'],
      });
    }
    return { kept: rows?.length ?? 0 };
  }

  /** Oldest first. The shown stage comes from the read model, so it matches To do exactly. */
  private async candidates(userId: number, now: Date): Promise<ItemRow[]> {
    const facts: {
      id: string;
      createdAt: Date | string;
      voters: number | string;
      kept: boolean;
    }[] = await this.dataSource.query(
      `SELECT o.id, o."createdAt",
              (SELECT count(DISTINCT a."userId") FROM "roadmap_allocations" a
                WHERE a."opportunityId" = o.id AND a.votes > 0) AS voters,
              (o."sweepKeptAt" IS NOT NULL) AS kept
         FROM "roadmap_opportunities" o
        WHERE o."deletedAt" IS NULL
          AND o."createdAt" < $1
          AND o."sweepKeptAt" IS NULL
        ORDER BY o."createdAt" ASC`,
      [new Date(now.getTime() - SWEEP_OLDER_THAN_DAYS * 86_400_000)],
    );
    const quiet = facts.filter((f) => Number(f.voters) <= SWEEP_MAX_VOTERS);
    if (!quiet.length) return [];
    const rows = await this.reader.rowsFor(
      userId,
      quiet.map((f) => String(f.id)),
    );
    const byId = new Map(quiet.map((f) => [String(f.id), f]));
    return rows.filter((row) => {
      const f = byId.get(row.id);
      return (
        !!f &&
        isSweepCandidate(
          {
            id: row.id,
            createdAt: new Date(f.createdAt),
            voters: Number(f.voters),
            shownStage: row.shownStage,
            hasLead: !!row.lead,
            kept: f.kept === true,
          },
          now,
        )
      );
    });
  }

  private async assertOwner(userId: number): Promise<void> {
    if (!globalCapabilities(await this.roles.roleOf(userId)).review) {
      throw new ForbiddenException('Only an Owner can sweep To do.');
    }
  }
}
