import { NotFoundException } from '@nestjs/common';
import { RoadmapWatchLevel } from 'src/product-planning/enum/product-planning.enum';
import { RoadmapItemController } from '../roadmap-item.controller';

const user = { id: 5 } as any;
const ITEM: {
  id: string;
  code: string;
  createdBy: number;
  builderSessionId: string | null;
} = {
  id: '11111111-1111-1111-1111-111111111111',
  code: 'OPP-388',
  createdBy: 1,
  builderSessionId: '22222222-2222-2222-2222-222222222222',
};

function build(opts: { enabled?: boolean; role?: string } = {}) {
  const settings = {
    assertRoadmapV2: jest.fn(async () => {
      if (opts.enabled === false) throw new NotFoundException();
      return { enabled: true };
    }),
  };
  const roles = {
    roleOf: jest.fn(async () => opts.role ?? 'idea'),
    previewPromotions: jest.fn(async () => [
      { userId: 3, name: 'Asha', role: 'owner' },
    ]),
  };
  const ceiling = { setCeiling: jest.fn(async () => ({ ceilingUsd: 150 })) };
  const inbox = {
    listGrouped: jest.fn(async () => []),
    markRead: jest.fn(async () => 2),
    setWatch: jest.fn(async (_u, itemId, level) => ({ itemId, level })),
  };
  const items = { get: jest.fn(async () => ({ ...ITEM })) };
  const reader = {
    list: jest.fn(async () => ({ rows: [], total: 0 })),
    search: jest.fn(async () => ({ items: [], recent: [] })),
    detail: jest.fn(async () => ({ code: ITEM.code })),
  };
  const editor = {
    patch: jest.fn(async () => ({ code: ITEM.code })),
    markRead: jest.fn(async () => undefined),
    setStar: jest.fn(async () => ({ starred: true, starredBy: null })),
  };
  const controller = new RoadmapItemController(
    settings as never,
    roles as never,
    ceiling as never,
    inbox as never,
    items as never,
    reader as never,
    editor as never,
  );
  return { controller, roles, ceiling, inbox, items, reader, editor };
}

describe('RoadmapItemController', () => {
  it('answers 404 on every route while roadmap_v2 is off, before doing anything', async () => {
    const { controller, roles, ceiling, inbox, items, reader, editor } = build({
      enabled: false,
    });
    const calls = [
      () => controller.myRole(user),
      () => controller.previewRoles(user),
      () => controller.setCeiling('OPP-388', { ceilingUsd: 150 }, user),
      () => controller.notifications(user),
      () => controller.markRead(user, { all: true }),
      () => controller.watch('OPP-388', { level: RoadmapWatchLevel.ALL }, user),
      () => controller.list(user, { view: 'all' }),
      () => controller.search(user, 'streak'),
      () => controller.detail('OPP-388', user),
      () => controller.patch('OPP-388', { title: 'x' }, user),
      () => controller.markItemRead('OPP-388', user),
      () => controller.star('OPP-388', user),
      () => controller.unstar('OPP-388', user),
    ];
    for (const call of calls) {
      await expect(call()).rejects.toBeInstanceOf(NotFoundException);
    }
    expect(roles.roleOf).not.toHaveBeenCalled();
    expect(items.get).not.toHaveBeenCalled();
    expect(ceiling.setCeiling).not.toHaveBeenCalled();
    expect(inbox.listGrouped).not.toHaveBeenCalled();
    expect(inbox.markRead).not.toHaveBeenCalled();
    for (const fn of [
      ...Object.values(reader),
      ...Object.values(editor),
    ] as jest.Mock[]) {
      expect(fn).not.toHaveBeenCalled();
    }
  });

  it('parses the queue query before handing it to the read model', async () => {
    const { controller, reader } = build();
    await controller.list(user, {
      view: 'leading',
      stage: 'planning,building,nonsense',
      starred: '1',
      sort: 'votes',
    });
    expect(reader.list).toHaveBeenCalledWith(5, {
      view: 'leading',
      filters: { stage: ['planning', 'building'], starred: true },
      sort: 'votes',
      offset: 0,
      limit: 50,
    });
  });

  it('routes star and unstar to the same write', async () => {
    const { controller, editor } = build();
    await controller.star('OPP-388', user);
    await controller.unstar('OPP-388', user);
    expect(editor.setStar).toHaveBeenNthCalledWith(1, 5, 'OPP-388', true);
    expect(editor.setStar).toHaveBeenNthCalledWith(2, 5, 'OPP-388', false);
  });

  it('returns the role with its global switches', async () => {
    const { controller } = build({ role: 'owner' });
    expect(await controller.myRole(user)).toEqual({
      role: 'owner',
      can: { configure: true, pinView: true, review: true, submit: true },
    });
  });

  it('shows the cutover preview to Owners only', async () => {
    await expect(
      build({ role: 'builder' }).controller.previewRoles(user),
    ).rejects.toMatchObject({ status: 403 });
    expect(
      await build({ role: 'owner' }).controller.previewRoles(user),
    ).toEqual([{ userId: 3, name: 'Asha', role: 'owner' }]);
  });

  it('raises the ceiling on the idea’s plan session', async () => {
    const { controller, ceiling } = build();
    await controller.setCeiling('OPP-388', { ceilingUsd: 150 }, user);
    expect(ceiling.setCeiling).toHaveBeenCalledWith(
      ITEM.builderSessionId,
      5,
      150,
    );
  });

  it('refuses a ceiling on an idea with no session', async () => {
    const { controller, items, ceiling } = build();
    items.get.mockResolvedValueOnce({ ...ITEM, builderSessionId: null });
    await expect(
      controller.setCeiling('OPP-388', { ceilingUsd: 150 }, user),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(ceiling.setCeiling).not.toHaveBeenCalled();
  });

  it('lets the Idea role and up watch, and not a Viewer', async () => {
    await expect(
      build({ role: 'viewer' }).controller.watch(
        'OPP-388',
        { level: RoadmapWatchLevel.ALL },
        user,
      ),
    ).rejects.toMatchObject({ status: 403 });
    const { controller, inbox } = build({ role: 'idea' });
    await controller.watch(
      'OPP-388',
      { level: RoadmapWatchLevel.MILESTONES },
      user,
    );
    expect(inbox.setWatch).toHaveBeenCalledWith(5, ITEM.id, 'milestones');
  });

  it('marks read for the caller only', async () => {
    const { controller, inbox } = build();
    expect(await controller.markRead(user, { groupKeys: ['g1'] })).toEqual({
      updated: 2,
    });
    expect(inbox.markRead).toHaveBeenCalledWith(5, { groupKeys: ['g1'] });
  });
});
