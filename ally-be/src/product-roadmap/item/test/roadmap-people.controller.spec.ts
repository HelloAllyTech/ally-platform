import { NotFoundException } from '@nestjs/common';
import { RoadmapPeopleController } from '../roadmap-people.controller';

const user = { id: 5 } as any;

function build(enabled: boolean) {
  const settings = {
    assertRoadmapV2: jest.fn(async () => {
      if (!enabled) throw new NotFoundException();
      return { enabled: true };
    }),
  };
  const roleAdmin = {
    list: jest.fn(async () => ({ users: [] })),
    get: jest.fn(async () => ({})),
    set: jest.fn(async () => ({})),
  };
  const preferences = {
    get: jest.fn(async () => ({ weeklyDigest: false })),
    set: jest.fn(async () => ({ weeklyDigest: true })),
  };
  const controller = new RoadmapPeopleController(
    settings as never,
    roleAdmin as never,
    preferences as never,
  );
  return { controller, roleAdmin, preferences };
}

describe('RoadmapPeopleController', () => {
  it('answers 404 on every route while roadmap_v2 is off, before doing anything', async () => {
    const { controller, roleAdmin, preferences } = build(false);
    const calls = [
      () => controller.listRoles(user),
      () => controller.getRole(2, user),
      () => controller.setRole(2, { role: 'builder' }, user),
      () => controller.myPreferences(user),
      () => controller.setMyPreferences({ weeklyDigest: true }, user),
    ];
    for (const call of calls) {
      await expect(call()).rejects.toBeInstanceOf(NotFoundException);
    }
    for (const mock of [
      roleAdmin.list,
      roleAdmin.get,
      roleAdmin.set,
      preferences.get,
      preferences.set,
    ]) {
      expect(mock).not.toHaveBeenCalled();
    }
  });

  it('passes the caller through when it is on', async () => {
    const { controller, roleAdmin, preferences } = build(true);
    await controller.setRole(2, { role: 'owner' }, user);
    await controller.setMyPreferences({ weeklyDigest: true }, user);
    expect(roleAdmin.set).toHaveBeenCalledWith(5, 2, 'owner');
    expect(preferences.set).toHaveBeenCalledWith(5, { weeklyDigest: true });
  });
});
