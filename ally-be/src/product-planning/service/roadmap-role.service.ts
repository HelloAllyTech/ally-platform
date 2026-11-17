import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { FeatureToggleService } from 'src/authorization/service/feature-toggle.service';
import { PermissionsService } from 'src/authorization/service/permissions.service';
import {
  RoadmapGrants,
  RoadmapRole,
  roleFromGrants,
} from '../util/roadmap-role.util';

/** One person in the cutover preview (§3.3). Name and id only, never an email. */
export interface RoadmapRolePreviewEntry {
  userId: number;
  name: string;
  role: 'builder' | 'owner';
}

/**
 * Who is what on the Roadmap (plans/roadmap-builder-merge §3.2): the single
 * answer guards, services and the item read model ask, built on the toggles
 * and permissions that gate the same surfaces today, so nobody's access moves
 * until the cutover applies the mapping.
 *
 * Lives in ProductPlanningModule rather than ProductRoadmapModule because
 * Builder needs it too (the notification fan-out and the ceiling check run
 * inside Builder), and Builder must not import the roadmap module.
 *
 * Reads only cached sources: toggles (FeatureToggleService, 30-minute cache),
 * permissions (PermissionsService, Redis-cached) and the org restriction.
 */
@Injectable()
export class RoadmapRoleService {
  constructor(
    private readonly toggles: FeatureToggleService,
    private readonly permissions: PermissionsService,
    private readonly dataSource: DataSource,
  ) {}

  async grantsOf(userId: number): Promise<RoadmapGrants> {
    const [keys, perms, restricted] = await Promise.all([
      this.toggles.getEnabledKeys(userId),
      this.permissions.getUserPermissions(userId),
      this.toggles.isRestricted(userId),
    ]);
    const has = (key: FeatureToggleKey, permission: string) =>
      keys.includes(key) && perms.includes(permission);
    return {
      roadmap: has(
        FeatureToggleKey.PRODUCT_ROADMAP,
        PERMISSIONS.VIEW_PRODUCT_ROADMAP,
      ),
      builder: has(FeatureToggleKey.BUILDER, PERMISSIONS.EDIT_BUILDER),
      manage: has(
        FeatureToggleKey.PRODUCT_ROADMAP_MANAGE,
        PERMISSIONS.EDIT_PRODUCT_ROADMAP,
      ),
      restricted,
    };
  }

  async roleOf(userId: number | null | undefined): Promise<RoadmapRole> {
    if (!userId) return 'none';
    return roleFromGrants(await this.grantsOf(userId));
  }

  /**
   * Everyone whose role resolves to Owner. Read from the Manage toggle's rows
   * and confirmed one by one, so a holder who lost the permission or became
   * org-restricted is not counted.
   */
  async owners(): Promise<number[]> {
    const holders = await this.toggles.listEnabledHolderIds(
      FeatureToggleKey.PRODUCT_ROADMAP_MANAGE,
    );
    const roles = await Promise.all(holders.map((id) => this.roleOf(id)));
    return holders.filter((_, i) => roles[i] === 'owner');
  }

  /**
   * The people who will become Builder and Owner at cutover (§3.3), for the
   * Owner to confirm before the switch: Builder gains merge rights on real
   * code. Builder and Manage are granted per person, so their rows are the
   * whole list; Idea is default-on and not listed.
   */
  async previewPromotions(): Promise<RoadmapRolePreviewEntry[]> {
    const ids = [
      ...new Set([
        ...(await this.toggles.listEnabledHolderIds(FeatureToggleKey.BUILDER)),
        ...(await this.toggles.listEnabledHolderIds(
          FeatureToggleKey.PRODUCT_ROADMAP_MANAGE,
        )),
      ]),
    ];
    if (!ids.length) return [];
    const roles = await Promise.all(ids.map((id) => this.roleOf(id)));
    const promoted = ids
      .map((userId, i) => ({ userId, role: roles[i] }))
      .filter(
        (row): row is { userId: number; role: 'builder' | 'owner' } =>
          row.role === 'builder' || row.role === 'owner',
      );
    if (!promoted.length) return [];
    const users: { id: number; name: string | null }[] =
      await this.dataSource.query(
        `SELECT id, name FROM "users" WHERE id = ANY($1)`,
        [promoted.map((row) => row.userId)],
      );
    const names = new Map(users.map((u) => [Number(u.id), u.name ?? '']));
    return promoted
      .filter((row) => names.has(row.userId))
      .map((row) => ({
        userId: row.userId,
        name: names.get(row.userId) || `User ${row.userId}`,
        role: row.role,
      }))
      .sort(
        (a, b) =>
          (a.role === b.role ? 0 : a.role === 'owner' ? -1 : 1) ||
          a.name.localeCompare(b.name),
      );
  }
}
