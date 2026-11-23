import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  STAFF_ONLY_OPTIONS_KEY,
  StaffOnlyGuard,
  StaffOnlyOptions,
} from '../guards/staff-only.guard';
import { PLATFORM_ADMIN_ONLY_KEY } from './platform-admin-only.decorator';

/**
 * Ally staff only; anyone else gets 404. For the platform-scope routes builders must not reach:
 * the global Defaults, the knowledge library admin, WhatsApp analytics.
 *
 * With `unlessQuery`, a request that names a chatbot through that query parameter is left to the
 * route's own membership check, so the same route can still serve one chatbot's own data. Without
 * it the route is staff-only outright and carries the platform-admin-only marker.
 */
export const StaffOnly = (options: StaffOnlyOptions = {}) =>
  applyDecorators(
    SetMetadata(STAFF_ONLY_OPTIONS_KEY, options),
    ...(options.unlessQuery
      ? []
      : [SetMetadata(PLATFORM_ADMIN_ONLY_KEY, true)]),
    UseGuards(AuthGuard('jwt'), StaffOnlyGuard),
  );
