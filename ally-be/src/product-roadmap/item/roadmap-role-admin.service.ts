import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  FEATURE_TOGGLES,
  FeatureToggleKey,
} from 'src/authorization/constants/admin-feature-toggle.constants';
import { FeatureToggleService } from 'src/authorization/service/feature-toggle.service';
import { PLATFORM_TIER_ROLES } from 'src/common/constants/user.constants';
import { RoadmapRoleService } from 'src/product-planning/service/roadmap-role.service';
import type { RoadmapRole } from 'src/product-planning/util/roadmap-role.util';
import { RedisService } from 'src/redis/service/redis.service';

/** What the Users screen's "Roadmap role" radio can set (§3.2). Viewer is not grantable. */
export type GrantableRoadmapRole = 'none' | 'idea' | 'builder' | 'owner';
export const GRANTABLE_ROADMAP_ROLES: GrantableRoadmapRole[] = [
  'none',
  'idea',
  'builder',
  'owner',
];

export interface RoadmapRoleEntry {
  userId: number;
  name: string;
  /** Effective now: toggles, permissions and any org restriction together. */
  role: RoadmapRole;
  /** Org-restricted: a Viewer at most, whatever the radio says. */
  restricted: boolean;
  /** What the three toggles say on their own: the radio's value. */
  setting: GrantableRoadmapRole;
}

/** The three toggles the roles nest on (§3.2), in the order the radio reads them. */
const ROLE_KEYS = [
  FeatureToggleKey.PRODUCT_ROADMAP,
  FeatureToggleKey.BUILDER,
  FeatureToggleKey.PRODUCT_ROADMAP_MANAGE,
] as const;

/** Each radio value as the three toggles, so they always nest (no Builder without Idea). */
export const ROLE_TOGGLES: Record<
  GrantableRoadmapRole,
  Record<(typeof ROLE_KEYS)[number], boolean>
> = {
  none: {
    [FeatureToggleKey.PRODUCT_ROADMAP]: false,
    [FeatureToggleKey.BUILDER]: false,
    [FeatureToggleKey.PRODUCT_ROADMAP_MANAGE]: false,
  },
  idea: {
    [FeatureToggleKey.PRODUCT_ROADMAP]: true,
    [FeatureToggleKey.BUILDER]: false,
    [FeatureToggleKey.PRODUCT_ROADMAP_MANAGE]: false,
  },
  builder: {
    [FeatureToggleKey.PRODUCT_ROADMAP]: true,
    [FeatureToggleKey.BUILDER]: true,
    [FeatureToggleKey.PRODUCT_ROADMAP_MANAGE]: false,
  },
  owner: {
    [FeatureToggleKey.PRODUCT_ROADMAP]: true,
    [FeatureToggleKey.BUILDER]: true,
    [FeatureToggleKey.PRODUCT_ROADMAP_MANAGE]: true,
  },
};

/** The radio's value from the three toggles: the highest one held wins, as roleFromGrants reads them. */
export function settingFromToggles(
  enabled: Partial<Record<string, boolean>>,
): GrantableRoadmapRole {
  if (enabled[FeatureToggleKey.PRODUCT_ROADMAP_MANAGE]) return 'owner';
  if (enabled[FeatureToggleKey.BUILDER]) return 'builder';
  if (enabled[FeatureToggleKey.PRODUCT_ROADMAP]) return 'idea';
  return 'none';
}

const DEFAULT_ON = new Set(
  FEATURE_TOGGLES.filter((d) => d.defaultEnabled === true).map((d) => d.key),
);

/**
 * The Users screen's one "Roadmap role" radio (plans/roadmap-builder-merge
 * §3.2): Owner only. It writes `product_roadmap`, `builder` and
 * `product_roadmap_manage` together, so the three can never disagree, and
 * busts the person's toggle and permission caches so the change applies on
 * their next request rather than in 30 minutes.
 */
@Injectable()
export class RoadmapRoleAdminService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly roles: RoadmapRoleService,
    private readonly toggles: FeatureToggleService,
    private readonly cache: RedisService,
  ) {}

  /** Every platform admin with their Roadmap role, by name. */
  async list(actorId: number): Promise<{ users: RoadmapRoleEntry[] }> {
    await this.assertOwner(actorId);
    const people = await this.platformAdmins();
    return { users: await this.entries(people) };
  }

  async get(actorId: number, userId: number): Promise<RoadmapRoleEntry> {
    await this.assertOwner(actorId);
    const [person] = await this.platformAdmins([userId]);
    if (!person) throw new NotFoundException('No platform admin with that id.');
    const [entry] = await this.entries([person]);
    return entry;
  }

  async set(
    actorId: number,
    userId: number,
    role: GrantableRoadmapRole,
  ): Promise<RoadmapRoleEntry> {
    await this.assertOwner(actorId);
    if (!GRANTABLE_ROADMAP_ROLES.includes(role)) {
      throw new BadRequestException(
        'A Roadmap role is none, idea, builder or owner.',
      );
    }
    // Which also means the last Owner can never remove themselves.
    if (userId === actorId) {
      throw new BadRequestException(
        'You can’t change your own Roadmap role. Ask another Owner.',
      );
    }
    const [person] = await this.platformAdmins([userId]);
    if (!person) {
      throw new UnprocessableEntityException(
        'Roadmap roles apply to platform admins only.',
      );
    }
    const want = ROLE_TOGGLES[role];
    // FeatureToggleService.setToggles upserts the rows, busts the toggle
    // cache (both key versions) and writes the audit log.
    await this.toggles.setToggles(
      userId,
      ROLE_KEYS.map((featureKey) => ({
        featureKey,
        enabled: want[featureKey],
      })),
      actorId,
    );
    await this.bustPermissionCache(userId);
    const [entry] = await this.entries([person]);
    return entry;
  }

  /**
   * A role reads permissions too (VIEW_PRODUCT_ROADMAP, EDIT_BUILDER,
   * EDIT_PRODUCT_ROADMAP), which sit behind 30-minute Redis caches. The
   * toggles changed, not the groups, but dropping the person's own entries is
   * cheap and means the radio's answer is what the next request sees.
   */
  private async bustPermissionCache(userId: number): Promise<void> {
    await Promise.all(
      [`user:groups:${userId}`, `user:roles:${userId}`].map((key) =>
        this.cache.del(key).catch(() => undefined),
      ),
    );
  }

  private async assertOwner(actorId: number): Promise<void> {
    if ((await this.roles.roleOf(actorId)) !== 'owner') {
      throw new ForbiddenException('Only an Owner can set Roadmap roles.');
    }
  }

  /** Platform-tier admins (the people toggles apply to), optionally only these ids. */
  private async platformAdmins(
    ids?: number[],
  ): Promise<{ id: number; name: string }[]> {
    const rows: { id: number; name: string | null }[] =
      await this.dataSource.query(
        `SELECT DISTINCT u.id, u.name
           FROM "users" u
           JOIN "user_groups" ug ON ug."userId" = u.id
           JOIN "groups" g ON g.id = ug."groupId"
          WHERE g.name = ANY($1::varchar[])
            AND ($2::int[] IS NULL OR u.id = ANY($2::int[]))`,
        [PLATFORM_TIER_ROLES, ids ?? null],
      );
    return rows
      .map((r) => ({
        id: Number(r.id),
        name: (r.name ?? '').trim() || `User ${r.id}`,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private async entries(
    people: { id: number; name: string }[],
  ): Promise<RoadmapRoleEntry[]> {
    if (!people.length) return [];
    const stored: { userId: number; featureKey: string; enabled: boolean }[] =
      await this.dataSource.query(
        `SELECT "userId", "featureKey", enabled
           FROM "admin_feature_toggles"
          WHERE "userId" = ANY($1::int[]) AND "featureKey" = ANY($2::varchar[])`,
        [people.map((p) => p.id), [...ROLE_KEYS]],
      );
    return Promise.all(
      people.map(async (person) => {
        const rows = new Map(
          stored
            .filter((r) => Number(r.userId) === person.id)
            .map((r) => [r.featureKey, !!r.enabled]),
        );
        const enabled = Object.fromEntries(
          ROLE_KEYS.map((key) => [key, rows.get(key) ?? DEFAULT_ON.has(key)]),
        );
        const [role, restricted] = await Promise.all([
          this.roles.roleOf(person.id),
          this.toggles.isRestricted(person.id),
        ]);
        return {
          userId: person.id,
          name: person.name,
          role,
          restricted,
          setting: settingFromToggles(enabled),
        };
      }),
    );
  }
}
