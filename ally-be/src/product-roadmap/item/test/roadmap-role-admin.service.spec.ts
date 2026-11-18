import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import {
  ROLE_TOGGLES,
  RoadmapRoleAdminService,
  settingFromToggles,
} from '../roadmap-role-admin.service';

const OWNER = 1;

function build(
  opts: {
    roles?: Record<number, string>;
    admins?: { id: number; name: string | null }[];
    stored?: { userId: number; featureKey: string; enabled: boolean }[];
    restricted?: number[];
  } = {},
) {
  const roleOf: Record<number, string> = { [OWNER]: 'owner', ...opts.roles };
  const admins = opts.admins ?? [
    { id: 2, name: 'Ravi' },
    { id: 3, name: 'Asha' },
  ];
  const dataSource = {
    query: jest.fn(async (sql: string, params: any[]) => {
      if (sql.includes('"user_groups"')) {
        const ids: number[] | null = params[1];
        return admins.filter((a) => !ids || ids.includes(a.id));
      }
      if (sql.includes('"admin_feature_toggles"')) return opts.stored ?? [];
      return [];
    }),
  };
  const roles = {
    roleOf: jest.fn(async (id: number) => roleOf[id] ?? 'idea'),
  };
  const toggles = {
    setToggles: jest.fn(async () => undefined),
    isRestricted: jest.fn(async (id: number) =>
      (opts.restricted ?? []).includes(id),
    ),
  };
  const cache = { del: jest.fn(async () => undefined) };
  const service = new RoadmapRoleAdminService(
    dataSource as never,
    roles as never,
    toggles as never,
    cache as never,
  );
  return { service, dataSource, roles, toggles, cache };
}

describe('RoadmapRoleAdminService', () => {
  it('keeps the three toggles nested for every radio value', () => {
    expect(ROLE_TOGGLES).toEqual({
      none: {
        product_roadmap: false,
        builder: false,
        product_roadmap_manage: false,
      },
      idea: {
        product_roadmap: true,
        builder: false,
        product_roadmap_manage: false,
      },
      builder: {
        product_roadmap: true,
        builder: true,
        product_roadmap_manage: false,
      },
      owner: {
        product_roadmap: true,
        builder: true,
        product_roadmap_manage: true,
      },
    });
    for (const role of Object.keys(
      ROLE_TOGGLES,
    ) as (keyof typeof ROLE_TOGGLES)[]) {
      expect(settingFromToggles(ROLE_TOGGLES[role])).toBe(role);
    }
  });

  it('writes the three toggles together and busts the person’s caches', async () => {
    const { service, toggles, cache } = build({ roles: { 2: 'builder' } });
    const entry = await service.set(OWNER, 2, 'builder');
    expect(toggles.setToggles).toHaveBeenCalledWith(
      2,
      [
        { featureKey: FeatureToggleKey.PRODUCT_ROADMAP, enabled: true },
        { featureKey: FeatureToggleKey.BUILDER, enabled: true },
        { featureKey: FeatureToggleKey.PRODUCT_ROADMAP_MANAGE, enabled: false },
      ],
      OWNER,
    );
    expect(cache.del).toHaveBeenCalledWith('user:groups:2');
    expect(cache.del).toHaveBeenCalledWith('user:roles:2');
    expect(entry).toMatchObject({ userId: 2, name: 'Ravi', role: 'builder' });
  });

  it('turns all three off for None', async () => {
    const { service, toggles } = build();
    await service.set(OWNER, 3, 'none');
    expect(
      (toggles.setToggles.mock.calls[0] as any[])[1].every(
        (t: { enabled: boolean }) => !t.enabled,
      ),
    ).toBe(true);
  });

  it('is the Owner’s alone', async () => {
    const { service, toggles } = build({ roles: { 4: 'builder' } });
    await expect(service.set(4, 2, 'owner')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(service.list(4)).rejects.toBeInstanceOf(ForbiddenException);
    expect(toggles.setToggles).not.toHaveBeenCalled();
  });

  it('never lets an Owner change their own role, so the last Owner stays', async () => {
    const { service, toggles } = build();
    await expect(service.set(OWNER, OWNER, 'idea')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(toggles.setToggles).not.toHaveBeenCalled();
  });

  it('refuses someone who is not a platform admin, and an unknown role', async () => {
    const { service } = build();
    await expect(service.set(OWNER, 99, 'idea')).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    await expect(
      service.set(OWNER, 2, 'viewer' as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.get(OWNER, 99)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('lists platform admins by name with the radio value and the effective role', async () => {
    const { service } = build({
      roles: { 2: 'viewer', 3: 'idea' },
      stored: [
        { userId: 2, featureKey: 'builder', enabled: true },
        { userId: 3, featureKey: 'product_roadmap', enabled: false },
      ],
      restricted: [2],
    });
    const { users } = await service.list(OWNER);
    expect(users).toEqual([
      // product_roadmap is on by default: Asha turned it off.
      {
        userId: 3,
        name: 'Asha',
        role: 'idea',
        restricted: false,
        setting: 'none',
      },
      {
        userId: 2,
        name: 'Ravi',
        role: 'viewer',
        restricted: true,
        setting: 'builder',
      },
    ]);
  });
});
