import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { PermissionsService } from 'src/authorization/service/permissions.service';

export const PLATFORM_ADMIN_ONLY_MESSAGE =
  'Only a platform admin can do this. Ask an Ally admin.';

/**
 * Refuses anyone who isn't a platform admin (holds `system:access`), whatever their toggles.
 * CR1: the Ally-wide WhatsApp routes (global settings, provider registration, connectors and
 * numbers with no assistant, phone mappings) checked only the Chatbots toggle, which an
 * Assistant owner holds.
 */
@Injectable()
export class PlatformAdminOnlyGuard implements CanActivate {
  constructor(private readonly permissionsService: PermissionsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const user = context.switchToHttp().getRequest().user;
    if (!user) throw new UnauthorizedException();
    const permissions = await this.permissionsService.getUserPermissions(
      Number(user.id),
    );
    if (!permissions.includes(PERMISSIONS.SYSTEM_ACCESS)) {
      throw new ForbiddenException(PLATFORM_ADMIN_ONLY_MESSAGE);
    }
    return true;
  }
}
