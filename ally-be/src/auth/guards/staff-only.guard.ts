import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS } from '../../authorization/constants/permissions.constants';
import { PermissionsService } from '../../authorization/service/permissions.service';
import { SWITCHES, switchOn } from '../../chatbot/safety/switches';

export const STAFF_ONLY_OPTIONS_KEY = 'staff-only-options';

export interface StaffOnlyOptions {
  /**
   * A query parameter that, when present, scopes the request to one chatbot, so the route's own
   * membership check applies instead. Used where one route serves both the global defaults (no
   * parameter) and one chatbot's own data.
   */
  unlessQuery?: string;
}

/**
 * Ally staff (platform admins, `system:access`) only; everyone else gets 404, as if the route did
 * not exist (assistants build, stage 1b). Unlike `PlatformAdminOnlyGuard` (403) this does not
 * reveal that the route is there. Switch off with `STAFF_DENY_GUARD_ENABLED=false`.
 */
@Injectable()
export class StaffOnlyGuard implements CanActivate {
  constructor(
    private readonly permissions: PermissionsService,
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!switchOn(this.config, SWITCHES.staffGuard)) return true;
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (!user) throw new UnauthorizedException();
    const options = this.reflector.getAllAndOverride<
      StaffOnlyOptions | undefined
    >(STAFF_ONLY_OPTIONS_KEY, [context.getHandler(), context.getClass()]);
    if (options?.unlessQuery && request.query?.[options.unlessQuery]) {
      return true;
    }
    const granted = await this.permissions.getUserPermissions(Number(user.id));
    if (!granted.includes(PERMISSIONS.SYSTEM_ACCESS)) {
      throw new NotFoundException();
    }
    return true;
  }
}
