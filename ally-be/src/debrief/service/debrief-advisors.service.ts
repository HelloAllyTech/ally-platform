import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuditLogService } from '../../audit/service/audit-log.service';
import { GroupService } from '../../authorization/service/group.service';
import { FeatureToggleService } from '../../authorization/service/feature-toggle.service';
import { FeatureToggleKey } from '../../authorization/constants/admin-feature-toggle.constants';
import { UserRole } from '../../common/constants/user.constants';

export interface DebriefAdvisorPerson {
  userId: number;
  name: string;
  email: string | null;
  organisation: string | null;
  /** Every group the person holds, so the owner sees nothing else changes. */
  roles: string[];
  advisor: boolean;
  /** Holds the DEBRIEF_OWNER role (Debrief settings, releases, PM agent, Agent logs). */
  owner: boolean;
  /** The "Debriefs — Clinical advisor" toggle: what opens the console to someone without platform access. */
  signOff: boolean;
}

/** The two debrief roles this page grants. */
export type DebriefRoleKind = 'advisor' | 'owner';

const ADVISOR_GROUP = UserRole.CLINICAL_ADVISOR;
const OWNER_GROUP = UserRole.DEBRIEF_OWNER;
const SIGN_OFF = FeatureToggleKey.DEBRIEF_CLINICAL_SIGN_OFF;

const ROLE: Record<
  DebriefRoleKind,
  {
    group: UserRole;
    added: 'CLINICAL_ADVISOR_ADDED' | 'DEBRIEF_OWNER_ADDED';
    removed: 'CLINICAL_ADVISOR_REMOVED' | 'DEBRIEF_OWNER_REMOVED';
  }
> = {
  advisor: {
    group: ADVISOR_GROUP,
    added: 'CLINICAL_ADVISOR_ADDED',
    removed: 'CLINICAL_ADVISOR_REMOVED',
  },
  owner: {
    group: OWNER_GROUP,
    added: 'DEBRIEF_OWNER_ADDED',
    removed: 'DEBRIEF_OWNER_REMOVED',
  },
};

/**
 * Debrief roles (User Management › Clinical advisors), granted person by person
 * because both reach every organisation's debriefs:
 * - Clinical advisor: the CLINICAL_ADVISOR group (`review:admin:debriefs`).
 * - Debrief owner: the DEBRIEF_OWNER group (`manage:admin:debrief-settings`).
 * Either one also needs the "Debriefs — Clinical advisor" toggle, which opens
 * the console to someone without platform access; it is turned on with the
 * first role and off only when neither is left. The generic role picker can't
 * grant these groups (PLATFORM_MANAGED_ROLES). Adding and removing touch only
 * the role's group and that toggle; every other group and toggle the person
 * holds stays as it is. Every write busts the person's cached permissions and
 * is audited.
 */
@Injectable()
export class DebriefAdvisorsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly groups: GroupService,
    private readonly toggles: FeatureToggleService,
    private readonly audit: AuditLogService,
  ) {}

  private async people(where: string, params: unknown[]) {
    const rows: Array<{
      id: number;
      name: string;
      email: string | null;
      organisation: string | null;
      roles: string[] | null;
      sign_off: boolean | null;
    }> = await this.dataSource.query(
      `SELECT u.id, u.name, u.email, t.name AS organisation,
              (SELECT array_agg(g.name ORDER BY g.name)
                 FROM user_groups ug JOIN groups g ON g.id = ug."groupId"
                WHERE ug."userId" = u.id) AS roles,
              (SELECT f.enabled FROM admin_feature_toggles f
                WHERE f."userId" = u.id AND f."featureKey" = $1) AS sign_off
         FROM users u
         LEFT JOIN tenants t ON t.id::text = u.tenant_id::text
        WHERE ${where}
        ORDER BY u.name
        LIMIT 20`,
      [SIGN_OFF, ...params],
    );
    return rows.map((r): DebriefAdvisorPerson => {
      const roles = r.roles ?? [];
      return {
        userId: r.id,
        name: r.name,
        email: r.email,
        organisation: r.organisation,
        roles,
        advisor: roles.includes(ADVISOR_GROUP),
        owner: roles.includes(OWNER_GROUP),
        signOff: r.sign_off === true,
      };
    });
  }

  /** Everyone holding a debrief role or the console toggle. */
  list(): Promise<DebriefAdvisorPerson[]> {
    return this.people(
      `EXISTS (SELECT 1 FROM user_groups ug JOIN groups g ON g.id = ug."groupId"
                WHERE ug."userId" = u.id AND g.name IN ($2, $3))
       OR EXISTS (SELECT 1 FROM admin_feature_toggles f
                   WHERE f."userId" = u.id AND f."featureKey" = $1 AND f.enabled)`,
      [ADVISOR_GROUP, OWNER_GROUP],
    );
  }

  /** People by name or email, at least 3 characters. */
  search(q: string): Promise<DebriefAdvisorPerson[]> {
    const term = (q ?? '').trim();
    if (term.length < 3) return Promise.resolve([]);
    const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    return this.people(`(u.name ILIKE $2 OR u.email ILIKE $2)`, [like]);
  }

  private async one(userId: number): Promise<DebriefAdvisorPerson> {
    const [p] = await this.people(`u.id = $2`, [userId]);
    if (!p) throw new BadRequestException('No such person');
    return p;
  }

  private async setSignOff(
    userId: number,
    enabled: boolean,
    actingUserId: number,
  ) {
    await this.toggles.setToggles(
      userId,
      [{ featureKey: SIGN_OFF, enabled }],
      actingUserId,
    );
  }

  /** Grant one debrief role (default: clinical advisor). Nothing else the person holds changes. */
  async add(
    userId: number,
    actingUserId: number,
    kind: DebriefRoleKind = 'advisor',
  ) {
    const role = ROLE[kind];
    const before = await this.one(userId);
    if (!before.roles.includes(role.group)) {
      await this.groups.assignRole({ role: role.group, userId });
    }
    if (!before.signOff) await this.setSignOff(userId, true, actingUserId);
    const after = await this.one(userId);
    await this.audit.log({
      eventType: role.added,
      userId: actingUserId,
      details: {
        targetUserId: userId,
        rolesBefore: before.roles,
        rolesAfter: after.roles,
      },
    });
    return after;
  }

  /**
   * Take one debrief role away. Nothing else the person holds changes; the
   * console toggle goes only when they hold neither debrief role any more.
   */
  async remove(
    userId: number,
    actingUserId: number,
    kind: DebriefRoleKind = 'advisor',
  ) {
    const role = ROLE[kind];
    const other = ROLE[kind === 'advisor' ? 'owner' : 'advisor'].group;
    const before = await this.one(userId);
    if (before.roles.includes(role.group)) {
      if (before.roles.length <= 1) {
        throw new BadRequestException(
          'This person has no other role; give them one first',
        );
      }
      await this.groups.removeRole({ role: role.group, userId });
    }
    if (before.signOff && !before.roles.includes(other)) {
      await this.setSignOff(userId, false, actingUserId);
    }
    const after = await this.one(userId);
    await this.audit.log({
      eventType: role.removed,
      userId: actingUserId,
      details: {
        targetUserId: userId,
        rolesBefore: before.roles,
        rolesAfter: after.roles,
      },
    });
    return after;
  }
}
