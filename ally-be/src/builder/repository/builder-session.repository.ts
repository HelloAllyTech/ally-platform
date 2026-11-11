import { Injectable } from '@nestjs/common';
import { DataSource, FindOptionsWhere, Repository } from 'typeorm';
import { BuilderSession } from '../entity/builder-session.entity';
import {
  BuilderSessionStatus,
  BuilderSessionVisibility,
} from '../enum/builder.enum';

/**
 * A `where` that keeps PRIVATE sessions out. Every Builder surface that lists
 * sessions (mission control, archive, Now) spreads this in: an unfiled plan is
 * its author's alone and is worked on the roadmap, never in Builder's feeds.
 */
export const SHARED_SESSIONS_ONLY: FindOptionsWhere<BuilderSession> = {
  visibility: BuilderSessionVisibility.SHARED,
};

/**
 * Whether `viewerId` may see this session: every SHARED session, and a PRIVATE
 * one only to its author. The single rule behind visibleToWhere, the
 * interceptor on Builder's session routes and the plan's own reads.
 */
export function isSessionVisibleTo(
  session: Pick<BuilderSession, 'visibility' | 'createdBy'>,
  viewerId: number,
): boolean {
  return (
    session.visibility !== BuilderSessionVisibility.PRIVATE ||
    session.createdBy === viewerId
  );
}

@Injectable()
export class BuilderSessionRepository extends Repository<BuilderSession> {
  constructor(private readonly dataSource: DataSource) {
    super(BuilderSession, dataSource.createEntityManager());
  }

  /**
   * Sessions that ended badly, newest first.
   *
   * For the outcome sweep, which re-tests a FAILED verdict against what the
   * session's pull requests actually did. Bounded rather than exhaustive: a
   * verdict nobody has looked at in weeks is not what this is for, and an
   * unbounded scan on every tick is how a cheap sweep becomes a slow one.
   */
  listRecentlyFailed(take = 50): Promise<BuilderSession[]> {
    return this.find({
      where: { status: BuilderSessionStatus.FAILED },
      order: { updatedAt: 'DESC' },
      take,
    });
  }

  /**
   * `where` (one branch or an OR-list of branches) narrowed to what `viewerId`
   * may see: each branch becomes "shared" OR "private and authored by the
   * viewer". A branch that already pins `createdBy` to someone else gets no
   * private half, so it can never widen to another author's drafts.
   */
  static visibleToWhere(
    viewerId: number,
    where:
      | FindOptionsWhere<BuilderSession>
      | FindOptionsWhere<BuilderSession>[] = {},
  ): FindOptionsWhere<BuilderSession>[] {
    const branches = Array.isArray(where) ? where : [where];
    return branches.flatMap((branch) => {
      const shared = { ...branch, visibility: BuilderSessionVisibility.SHARED };
      if (branch.createdBy !== undefined && branch.createdBy !== viewerId) {
        return [shared];
      }
      return [
        shared,
        {
          ...branch,
          visibility: BuilderSessionVisibility.PRIVATE,
          createdBy: viewerId,
        },
      ];
    });
  }

  /** Visibility and author only, for the per-route check — no row hydration. */
  findVisibilityFacts(
    sessionId: string,
  ): Promise<Pick<
    BuilderSession,
    'id' | 'visibility' | 'createdBy' | 'kind' | 'leadUserId'
  > | null> {
    return this.findOne({
      where: { id: sessionId },
      select: {
        id: true,
        visibility: true,
        createdBy: true,
        kind: true,
        leadUserId: true,
      },
    });
  }

  /**
   * True when the slug is already taken. Checked against soft-deleted rows
   * too: the branch those sessions pushed still exists on the remote, so
   * reusing the name would push onto someone else's history.
   */
  async slugExists(slug: string): Promise<boolean> {
    const count = await this.count({ where: { slug }, withDeleted: true });
    return count > 0;
  }

  /**
   * Display name of the admin who started a session, for the exported PRD's
   * "Built by" line. Read by raw query rather than through UserService: the
   * builder module has no reason to depend on the user module for one column,
   * and importing from `src/user/service/*` is a known boot-time cycle risk.
   *
   * Falls back to the email when the name is blank (bulk-created accounts
   * leave it empty), and to null when the user row is gone.
   */
  async findCreatorName(
    userId: number | null | undefined,
  ): Promise<string | null> {
    if (!userId) return null;
    const rows: { label: string | null }[] = await this.dataSource.query(
      `SELECT COALESCE(NULLIF(TRIM(name), ''), email) AS label FROM users WHERE id = $1`,
      [userId],
    );
    return rows[0]?.label ?? null;
  }

  /** `findCreatorName` for a whole list in one query, keyed by user id. */
  async findCreatorNames(
    userIds: number[],
  ): Promise<Map<number, string | null>> {
    const ids = [...new Set(userIds.filter(Boolean))];
    if (!ids.length) return new Map();
    const rows: { id: number; label: string | null }[] =
      await this.dataSource.query(
        `SELECT id, COALESCE(NULLIF(TRIM(name), ''), email) AS label FROM users WHERE id = ANY($1)`,
        [ids],
      );
    return new Map(rows.map((row) => [Number(row.id), row.label]));
  }
}
