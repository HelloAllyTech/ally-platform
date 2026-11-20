import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { RoadmapRoleService } from '../roadmap-role.service';

interface Person {
  keys: string[];
  perms: string[];
  restricted?: boolean;
}

const ALL_PERMS = [
  PERMISSIONS.VIEW_PRODUCT_ROADMAP,
  PERMISSIONS.EDIT_PRODUCT_ROADMAP,
  PERMISSIONS.EDIT_BUILDER,
];

function build(people: Record<number, Person>, names: Record<number, string>) {
  const toggles = {
    getEnabledKeys: jest.fn(async (id: number) => people[id]?.keys ?? []),
    isRestricted: jest.fn(async (id: number) => !!people[id]?.restricted),
    listEnabledHolderIds: jest.fn(async (key: string) =>
      Object.entries(people)
        .filter(([, p]) => p.keys.includes(key))
        .map(([id]) => Number(id)),
    ),
  };
  const permissions = {
    getUserPermissions: jest.fn(async (id: number) => people[id]?.perms ?? []),
  };
  const query = jest.fn(async (_sql: string, [ids]: [number[]]) =>
    ids
      .filter((id) => names[id] !== undefined)
      .map((id) => ({ id, name: names[id] })),
  );
  const service = new RoadmapRoleService(
    toggles as never,
    permissions as never,
    { query } as never,
  );
  return { service, query };
}

const R = FeatureToggleKey.PRODUCT_ROADMAP;
const B = FeatureToggleKey.BUILDER;
const M = FeatureToggleKey.PRODUCT_ROADMAP_MANAGE;

describe('RoadmapRoleService', () => {
  it('reads each grant the way the gate it replaces reads it', async () => {
    const { service } = build(
      {
        1: { keys: [R], perms: ALL_PERMS },
        2: { keys: [R, B], perms: ALL_PERMS },
        3: { keys: [R, B, M], perms: ALL_PERMS },
        // The Builder toggle without EDIT_BUILDER is not Builder (assertBuilderAccess).
        4: { keys: [R, B], perms: [PERMISSIONS.VIEW_PRODUCT_ROADMAP] },
        // Manage without EDIT_PRODUCT_ROADMAP is not Owner.
        5: { keys: [R, M], perms: [PERMISSIONS.VIEW_PRODUCT_ROADMAP] },
        // The board toggle without the view permission is no Roadmap.
        6: { keys: [R], perms: [] },
        7: { keys: [R, B, M], perms: ALL_PERMS, restricted: true },
      },
      {},
    );
    expect(await service.roleOf(1)).toBe('idea');
    expect(await service.roleOf(2)).toBe('builder');
    expect(await service.roleOf(3)).toBe('owner');
    expect(await service.roleOf(4)).toBe('idea');
    expect(await service.roleOf(5)).toBe('idea');
    expect(await service.roleOf(6)).toBe('none');
    expect(await service.roleOf(7)).toBe('viewer');
    expect(await service.roleOf(null)).toBe('none');
  });

  it('lists only confirmed Owners', async () => {
    const { service } = build(
      {
        1: { keys: [R, M], perms: ALL_PERMS },
        2: { keys: [R, M], perms: ALL_PERMS, restricted: true },
        3: { keys: [R, M], perms: [PERMISSIONS.VIEW_PRODUCT_ROADMAP] },
      },
      {},
    );
    expect(await service.owners()).toEqual([1]);
  });

  it('previews the Builder and Owner list with names and ids, never emails', async () => {
    const { service, query } = build(
      {
        1: { keys: [R], perms: ALL_PERMS },
        2: { keys: [R, B], perms: ALL_PERMS },
        3: { keys: [R, B, M], perms: ALL_PERMS },
        4: { keys: [R, B], perms: ALL_PERMS, restricted: true },
        5: { keys: [R, B], perms: ALL_PERMS },
      },
      { 2: 'Ravi', 3: 'Asha', 4: 'Org Admin', 5: 'Bina' },
    );
    expect(await service.previewPromotions()).toEqual([
      { userId: 3, name: 'Asha', role: 'owner' },
      { userId: 5, name: 'Bina', role: 'builder' },
      { userId: 2, name: 'Ravi', role: 'builder' },
    ]);
    expect(query.mock.calls[0][0]).not.toMatch(/email/i);
  });

  it('previews nobody when nobody holds Builder or Manage', async () => {
    const { service, query } = build(
      { 1: { keys: [R], perms: ALL_PERMS } },
      {},
    );
    expect(await service.previewPromotions()).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });
});
