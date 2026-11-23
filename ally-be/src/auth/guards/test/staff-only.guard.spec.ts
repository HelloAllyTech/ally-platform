import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PERMISSIONS } from '../../../authorization/constants/permissions.constants';
import { StaffOnlyGuard } from '../staff-only.guard';

const context = (user: unknown, query: Record<string, string> = {}) =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ user, query }) }),
    getHandler: () => ({}),
    getClass: () => ({}),
  }) as never;

function guard(
  permissions: string[],
  options?: { unlessQuery?: string },
  config: Record<string, string> = {},
) {
  return new StaffOnlyGuard(
    { getUserPermissions: jest.fn().mockResolvedValue(permissions) } as never,
    { getAllAndOverride: () => options } as never,
    { get: (k: string) => config[k] } as never,
  );
}

describe('StaffOnlyGuard', () => {
  it('lets a platform admin through', async () => {
    await expect(
      guard([PERMISSIONS.SYSTEM_ACCESS]).canActivate(context({ id: 1 })),
    ).resolves.toBe(true);
  });

  it('answers everyone else with 404, not 403', async () => {
    await expect(
      guard([]).canActivate(context({ id: 2 })),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses a request with no user', async () => {
    await expect(
      guard([]).canActivate(context(undefined)),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('leaves a request that names a chatbot to the route’s own membership check', async () => {
    const g = guard([], { unlessQuery: 'chatbotId' });
    await expect(
      g.canActivate(context({ id: 2 }, { chatbotId: 'x' })),
    ).resolves.toBe(true);
    await expect(g.canActivate(context({ id: 2 }))).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('can be switched off', async () => {
    await expect(
      guard([], undefined, { STAFF_DENY_GUARD_ENABLED: 'false' }).canActivate(
        context({ id: 2 }),
      ),
    ).resolves.toBe(true);
  });
});
