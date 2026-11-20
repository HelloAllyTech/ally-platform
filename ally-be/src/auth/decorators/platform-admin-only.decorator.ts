import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PlatformAdminOnlyGuard } from '../guards/platform-admin-only.guard';

export const PLATFORM_ADMIN_ONLY_KEY = 'platform-admin-only';

/** Platform admins only (CR1). Stack it with the route's own toggle and permissions. */
export const PlatformAdminOnly = () =>
  applyDecorators(
    SetMetadata(PLATFORM_ADMIN_ONLY_KEY, true),
    UseGuards(AuthGuard('jwt'), PlatformAdminOnlyGuard),
  );
