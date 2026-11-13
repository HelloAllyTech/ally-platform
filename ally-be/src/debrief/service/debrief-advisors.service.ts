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
  /** The "Debriefs — Clinical advisor" access toggle. */
  signOff: boolean;
}

const ADVISOR_GROUP = UserRole.CLINICAL_ADVISOR;
const SIGN_OFF = FeatureToggleKey.DEBRIEF_CLINICAL_SIGN_OFF;

/**
 * Clinical advisors (User Management › Clinical advisors). The advisor's
 * access is two things: the CLINICAL_ADVISOR group (the
 * `review:admin:debriefs` permission) and the "Debriefs — Clinical advisor"
 * toggle that opens the console to someone without platform access. The
 * generic role picker can't grant the group (PLATFORM_MANAGED_ROLES), so it is
 * granted here, next to Ally admins. Adding and removing touch only these two; every
 * other group and toggle the person holds stays as it is. Both writes bust
 * the person's cached permissions and are audited.
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
    return rows.map(
      (r): DebriefAdvisorPerson => ({
        userId: r.id,
        name: r.name,
        email: r.email,
        organisation: r.organisation,
        roles: r.roles ?? [],
        advisor: (r.roles ?? []).includes(ADVISOR_GROUP),
        signOff: r.sign_off === true,
      }),
    );
  }

  /** Everyone holding the advisor group or the advisor toggle. */
  list(): Promise<DebriefAdvisorPerson[]> {
    return this.people(
      `EXISTS (SELECT 1 FROM user_groups ug JOIN groups g ON g.id = ug."groupId"
                WHERE ug."userId" = u.id AND g.name = $2)
       OR EXISTS (SELECT 1 FROM admin_feature_toggles f
                   WHERE f."userId" = u.id AND f."featureKey" = $1 AND f.enabled)`,
      [ADVISOR_GROUP],
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

  /** Grant the advisor's access. Nothing else the person holds changes. */
  async add(userId: number, actingUserId: number) {
    const before = await this.one(userId);
    if (!before.advisor) {
      await this.groups.assignRole({ role: ADVISOR_GROUP, userId });
    }
    if (!before.signOff) {
      await this.toggles.setToggles(
        userId,
        [{ featureKey: SIGN_OFF, enabled: true }],
        actingUserId,
      );
    }
    const after = await this.one(userId);
    await this.audit.log({
      eventType: 'CLINICAL_ADVISOR_ADDED',
      userId: actingUserId,
      details: {
        targetUserId: userId,
        rolesBefore: before.roles,
        rolesAfter: after.roles,
      },
    });
    return after;
  }

  /** Take the advisor's access away. Nothing else the person holds changes. */
  async remove(userId: number, actingUserId: number) {
    const before = await this.one(userId);
    if (before.advisor) {
      if (before.roles.length <= 1) {
        throw new BadRequestException(
          'This person has no other role; give them one first',
        );
      }
      await this.groups.removeRole({ role: ADVISOR_GROUP, userId });
    }
    if (before.signOff) {
      await this.toggles.setToggles(
        userId,
        [{ featureKey: SIGN_OFF, enabled: false }],
        actingUserId,
      );
    }
    const after = await this.one(userId);
    await this.audit.log({
      eventType: 'CLINICAL_ADVISOR_REMOVED',
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
