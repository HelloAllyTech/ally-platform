import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { AppConfigService } from 'src/config/config.service';

import { User } from 'src/user/entity/user.entity';
import { PERMISSIONS } from '../../authorization/constants/permissions.constants';
import { ROADMAP_MULTIPLIER_WINDOW_DAYS } from '../constants/product-roadmap.constants';
import {
  breadthMultiplier,
  breadthTarget,
  nextDrop,
} from '../util/roadmap-multiplier.util';
import { BreadthDto, BreadthEveryoneRowDto } from '../dto/roadmap-response.dto';

/**
 * Breadth multiplier: a vote is worth more when the voter has recently backed many DIFFERENT
 * colleagues. Computed on demand from standing allocations — there is no stored multiplier to
 * go stale, so it "decays" by the window moving, with no cron.
 *
 * What counts: a standing vote (votes > 0) on an opportunity somebody ELSE created, whose last
 * increase is inside the window, deduped by author. Taking a vote back removes that author.
 *
 * On by default; ROADMAP_MULTIPLIER_ENABLED=false makes `enabled` false and the multiplier 1.0 for new votes;
 * the weighted column keeps being written either way so the week of shadow data exists.
 */
@Injectable()
export class RoadmapMultiplierService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly config: AppConfigService,
  ) {}

  get enabled(): boolean {
    return this.config.roadmapMultiplierEnabled;
  }

  /** Candidate authors: others with something a vote can actually land on right now. */
  private async candidateAuthorCount(
    manager: EntityManager,
    userId: number,
  ): Promise<number> {
    const [row] = await manager.query<{ n: string }[]>(
      `SELECT COUNT(DISTINCT o."createdBy") AS n
         FROM roadmap_opportunities o
        WHERE o."deletedAt" IS NULL
          AND o.stage = 'new' AND o.type <> 'bug'
          AND o."createdBy" <> $1`,
      [userId],
    );
    return Number(row?.n ?? 0);
  }

  /** Each qualifying author and when they leave the window. */
  private async qualifyingAuthors(
    manager: EntityManager,
    userId: number,
  ): Promise<{ authorId: number; at: Date }[]> {
    const rows = await manager.query<{ author: number; last: Date }[]>(
      `SELECT o."createdBy" AS author, MAX(a."lastIncreasedAt") AS last
         FROM roadmap_allocations a
         JOIN roadmap_opportunities o ON o.id = a."opportunityId"
        WHERE a."userId" = $1 AND a.votes > 0
          AND o."deletedAt" IS NULL AND o."createdBy" <> $1
          AND a."lastIncreasedAt" >= now() - make_interval(days => $2)
        GROUP BY o."createdBy"`,
      [userId, ROADMAP_MULTIPLIER_WINDOW_DAYS],
    );
    const windowMs = ROADMAP_MULTIPLIER_WINDOW_DAYS * 86_400_000;
    return rows.map((r) => ({
      authorId: Number(r.author),
      at: new Date(new Date(r.last).getTime() + windowMs),
    }));
  }

  /**
   * The multiplier a vote cast RIGHT NOW is worth. Used inside setVotes, so it takes the
   * caller's transaction manager and runs after the per-user advisory lock.
   */
  async multiplierFor(manager: EntityManager, userId: number): Promise<number> {
    if (!this.enabled) return 1;
    const [authors, candidates] = await Promise.all([
      this.qualifyingAuthors(manager, userId),
      this.candidateAuthorCount(manager, userId),
    ]);
    return breadthMultiplier(authors.length, breadthTarget(candidates));
  }

  /** The caller's multiplier and qualifying count inside an open transaction (post-vote). */
  async getBreadthInTx(
    manager: EntityManager,
    userId: number,
  ): Promise<{ multiplier: number; qualifying: number }> {
    const [authors, candidates] = await Promise.all([
      this.qualifyingAuthors(manager, userId),
      this.candidateAuthorCount(manager, userId),
    ]);
    return {
      multiplier: this.enabled
        ? breadthMultiplier(authors.length, breadthTarget(candidates))
        : 1,
      qualifying: authors.length,
    };
  }

  async getBreadth(userId: number): Promise<BreadthDto> {
    const manager = this.dataSource.manager;
    const [authors, candidates] = await Promise.all([
      this.qualifyingAuthors(manager, userId),
      this.candidateAuthorCount(manager, userId),
    ]);
    const target = breadthTarget(candidates);
    const multiplier = this.enabled
      ? breadthMultiplier(authors.length, target)
      : 1;
    const drop = this.enabled ? nextDrop(authors, target) : null;
    let nextDropAuthorName: string | null = null;
    if (drop) {
      const u = await manager.findOne(User, {
        where: { id: drop.authorId },
        select: ['id', 'name'],
      });
      nextDropAuthorName = u?.name ?? null;
    }
    return {
      enabled: this.enabled,
      multiplier,
      qualifying: authors.length,
      target,
      windowDays: ROADMAP_MULTIPLIER_WINDOW_DAYS,
      maxMultiplier: breadthMultiplier(target, target),
      nextDropAt: drop?.at.toISOString() ?? null,
      nextDropMultiplier: drop?.multiplierAfter ?? null,
      nextDropAuthorName,
    };
  }

  /** Everyone who can vote, with their current breadth. Small set (platform admins). */
  async getEveryone(): Promise<BreadthEveryoneRowDto[]> {
    const manager = this.dataSource.manager;
    const eligible = await manager.query<{ userId: number }[]>(
      `SELECT DISTINCT ug."userId"
         FROM user_groups ug
         INNER JOIN group_permissions gp ON gp."groupId" = ug."groupId"
         INNER JOIN permissions p ON p.id = gp."permissionId"
        WHERE p.name = $1`,
      [PERMISSIONS.VOTE_PRODUCT_ROADMAP],
    );
    const ids = eligible.map((r) => r.userId);
    if (ids.length === 0) return [];
    const users = await manager.find(User, {
      where: { id: In(ids) },
      select: ['id', 'name'],
    });
    const rows = await Promise.all(
      users.map(async (u) => {
        const [authors, candidates] = await Promise.all([
          this.qualifyingAuthors(manager, u.id),
          this.candidateAuthorCount(manager, u.id),
        ]);
        const target = breadthTarget(candidates);
        return {
          userId: u.id,
          name: u.name,
          multiplier: this.enabled
            ? breadthMultiplier(authors.length, target)
            : 1,
          qualifying: authors.length,
          target,
        };
      }),
    );
    return rows.sort(
      (a, b) => b.multiplier - a.multiplier || a.name.localeCompare(b.name),
    );
  }
}
