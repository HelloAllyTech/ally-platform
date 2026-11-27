import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserRole } from 'src/common/constants/user.constants';
import { GroupService } from 'src/authorization/service/group.service';
import { AuditLoggerService } from 'src/audit/service/audit-logger.service';
import { AUDIT_EVENTS } from 'src/audit/constants/audit-event.constants';
import { LoggerService } from 'src/logger/logger.service';
import { UserRepository } from '../repository/user.repository';
import { UserService } from '../service/user.service';

/**
 * Ally admin → Custom logins (CR1 Part B). A custom login is an Assistant owner: a user with the
 * ASSISTANT_OWNER role, its toggles as Ally ticked them, never a platform admin. Created by the
 * same three steps as before, with this route in place of `POST /v1/platform-admins`.
 */
@Injectable()
export class CustomLoginService {
  private readonly logger = LoggerService.getInstance(CustomLoginService.name);
  private readonly auditLogger = AuditLoggerService.getInstance();

  constructor(
    private readonly users: UserRepository,
    private readonly groups: GroupService,
    private readonly dataSource: DataSource,
    private readonly userService: UserService,
  ) {}

  async list(search?: string) {
    const { users } = await this.users.getUsersWithRole(
      UserRole.ASSISTANT_OWNER,
      search,
    );
    if (!users.length) return { data: [], count: 0 };
    const ids = users.map((user: { id: number }) => user.id);
    const extra: Array<Record<string, unknown>> = await this.dataSource.query(
      `SELECT u.id, t.name AS "organisation",
              (SELECT array_agg(f."featureKey" ORDER BY f."featureKey") FROM admin_feature_toggles f
                WHERE f."userId" = u.id AND f.enabled) AS features,
              (SELECT count(*) FROM chatbots c WHERE c.created_by = u.id) AS assistants
         FROM users u LEFT JOIN tenants t ON t.id::text = u.tenant_id::text
        WHERE u.id = ANY($1)`,
      [ids],
    );
    const byId = new Map(extra.map((row) => [Number(row.id), row]));
    const data = users.map((user: { id: number }) => {
      const row = byId.get(user.id) ?? {};
      return {
        ...user,
        organisation: row.organisation ?? null,
        features: row.features ?? [],
        assistants: Number(row.assistants ?? 0),
      };
    });
    return { data, count: data.length };
  }

  /** Make an existing user a custom login. Refused for a platform admin: move them with the script. */
  async assign(userId: number, actingUserId: number) {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    const roles = await this.groups.getUserGroupNames(userId);
    if (roles.includes(UserRole.ASSISTANT_OWNER)) {
      throw new ConflictException('This user is already a custom login.');
    }
    if (roles.includes(UserRole.PLATFORM_ADMIN)) {
      throw new BadRequestException(
        'This user is an Ally admin. Remove that first, or move existing custom logins with the migration script.',
      );
    }
    await this.groups.assignRole({ role: UserRole.ASSISTANT_OWNER, userId });
    this.logger.info(
      `User ${userId} made a custom login by user ${actingUserId}`,
    );
    await this.auditLogger.log({
      eventType: AUDIT_EVENTS.CUSTOM_LOGIN_CREATED,
      userId: actingUserId,
      details: { targetUserId: userId },
    });
    return { success: true };
  }

  /**
   * Create a brand-new user directly as a custom login (Assistant owner). The
   * user and the role are written in one transaction by
   * `UserService.createCustomLoginUser`, which applies the same tenant and
   * duplicate-email checks as `POST /v1/users`.
   */
  async create(
    input: { name: string; email: string; tenantId: string },
    actingUserId: number,
  ) {
    const user = await this.userService.createCustomLoginUser(input);
    this.logger.info(`Custom login ${user.id} created by user ${actingUserId}`);
    await this.auditLogger.log({
      eventType: AUDIT_EVENTS.CUSTOM_LOGIN_CREATED,
      userId: actingUserId,
      details: { targetUserId: user.id },
    });
    return user;
  }

  async remove(userId: number, actingUserId: number) {
    const roles = await this.groups.getUserGroupNames(userId);
    if (!roles.includes(UserRole.ASSISTANT_OWNER)) {
      throw new NotFoundException('This user is not a custom login.');
    }
    await this.groups.removeRole({ role: UserRole.ASSISTANT_OWNER, userId });
    await this.auditLogger.log({
      eventType: AUDIT_EVENTS.CUSTOM_LOGIN_REMOVED,
      userId: actingUserId,
      details: { targetUserId: userId },
    });
    return { success: true };
  }
}
