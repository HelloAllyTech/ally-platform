import 'reflect-metadata';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { FEATURE_TOGGLE_KEY } from 'src/auth/decorators/feature-toggle.decorator';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { ManualAdminController } from '../controller/manual-admin.controller';
import { ManualController } from '../controller/manual.controller';
import { ManualWriteError } from '../type/manual.types';

type Ctor = new (...args: never[]) => object;

/** Every routed handler of a controller: [name, route label]. */
function routes(controller: Ctor): [string, string][] {
  const out: [string, string][] = [];
  const proto = controller.prototype as Record<string, unknown>;
  for (const name of Object.getOwnPropertyNames(proto)) {
    const fn = proto[name];
    if (name === 'constructor' || typeof fn !== 'function') continue;
    if (Reflect.getMetadata(PATH_METADATA, fn) === undefined) continue;
    out.push([
      name,
      `${Reflect.getMetadata(METHOD_METADATA, fn)} ${Reflect.getMetadata(PATH_METADATA, fn)}`,
    ]);
  }
  return out;
}
const toggleOf = (controller: Ctor, handler: string) =>
  Reflect.getMetadata(
    FEATURE_TOGGLE_KEY,
    (controller.prototype as any)[handler],
  );

describe('Product Manual controller metadata', () => {
  it('serves under /v1/product-manual', () => {
    expect(Reflect.getMetadata(PATH_METADATA, ManualController)).toEqual(
      'product-manual',
    );
    expect(Reflect.getMetadata(PATH_METADATA, ManualAdminController)).toEqual(
      'product-manual/admin',
    );
  });

  it('exposes exactly the contract routes', () => {
    expect(
      routes(ManualController)
        .map(([, r]) => r)
        .sort(),
    ).toEqual(
      [
        '0 tree',
        '0 pages/:slug',
        '0 search',
        '0 graph',
        '0 changes',
        '1 pages/:slug/revert',
        '0 state',
      ].sort(),
    );
    expect(
      routes(ManualAdminController)
        .map(([, r]) => r)
        .sort(),
    ).toEqual(
      [
        '0 settings',
        '4 settings',
        '0 runs',
        '0 proposals',
        '1 proposals/:id/dismiss',
        '1 import',
        '1 mark-released',
      ].sort(),
    );
  });

  it.each(routes(ManualController))(
    'reader route %s has the Product Manual toggle and view permission',
    (name) => {
      expect(toggleOf(ManualController, name)).toMatchObject({
        featureKey: FeatureToggleKey.PRODUCT_MANUAL,
      });
      const permissions = Reflect.getMetadata(
        'permissions',
        (ManualController.prototype as any)[name],
      );
      // PermissionsGuard metadata: whichever key the repo uses, the view permission must be listed.
      expect(JSON.stringify(permissions ?? [])).toContain(
        PERMISSIONS.VIEW_PRODUCT_ROADMAP,
      );
    },
  );

  it.each(routes(ManualAdminController))(
    'admin route %s has the Roadmap Manage toggle',
    (name) => {
      expect(toggleOf(ManualAdminController, name)).toMatchObject({
        featureKey: FeatureToggleKey.PRODUCT_ROADMAP_MANAGE,
      });
    },
  );
});

const user = { id: 5 } as never;
const detail = { slug: 'a', title: 'A' };

function reader(opts: { enabled?: boolean; role?: string } = {}) {
  const settings = {
    assertRoadmapV2: jest.fn(async () => {
      if (opts.enabled === false) throw new NotFoundException();
      return { enabled: true };
    }),
  };
  const roles = { roleOf: jest.fn(async () => opts.role ?? 'idea') };
  const pages = {
    list: jest.fn(async () => [
      {
        slug: 'a',
        title: 'A',
        summary: '',
        parentSlug: null,
        position: 0,
        kind: 'page',
        roles: [],
        surfaces: [],
        journeys: [],
        releaseState: 'live',
        verifiedAt: null,
        updatedAt: new Date('2026-11-01T00:00:00Z'),
      },
    ]),
    detail: jest.fn(async () => detail),
    revert: jest.fn(async () => ({})),
  };
  const search = { search: jest.fn(async () => []) };
  const graph = { graph: jest.fn(async () => ({ nodes: [], edges: [] })) };
  const changes = { list: jest.fn(async () => []) };
  const state = { state: jest.fn(async () => ({ agentState: 'idle' })) };
  const controller = new ManualController(
    settings as never,
    roles as never,
    pages as never,
    search as never,
    graph as never,
    changes as never,
    state as never,
  );
  return { controller, settings, roles, pages, search, graph, changes, state };
}

describe('ManualController', () => {
  it('answers 404 on every route while Roadmap v2 is off, before touching any service', async () => {
    const r = reader({ enabled: false });
    const calls: Promise<unknown>[] = [
      r.controller.tree(user),
      r.controller.page('a', user),
      r.controller.find(user, 'abc'),
      r.controller.map(user),
      r.controller.changeLog(user),
      r.controller.revert('a', { revisionId: 'x' }, user),
      r.controller.state(user),
    ];
    for (const call of calls)
      await expect(call).rejects.toBeInstanceOf(NotFoundException);
    expect(r.pages.list).not.toHaveBeenCalled();
    expect(r.state.state).not.toHaveBeenCalled();
  });

  it('answers 403 to a caller with no roadmap role', async () => {
    const r = reader({ role: 'none' });
    await expect(r.controller.tree(user)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(r.controller.state(user)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(r.roles.roleOf).toHaveBeenCalledWith(5);
  });

  it('lets a Viewer read but not revert', async () => {
    const r = reader({ role: 'viewer' });
    await expect(r.controller.tree(user)).resolves.toBeDefined();
    await expect(
      r.controller.revert('a', { revisionId: 'x' }, user),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(r.pages.revert).not.toHaveBeenCalled();
  });

  it('tree returns PageRow[] with ISO dates', async () => {
    const r = reader();
    const { pages } = await r.controller.tree(user);
    expect(pages[0]).toMatchObject({
      slug: 'a',
      updatedAt: '2026-11-01T00:00:00.000Z',
      verifiedAt: null,
    });
  });

  it('page 404s for an unknown or malformed slug', async () => {
    const r = reader();
    r.pages.detail.mockResolvedValueOnce(null as never);
    await expect(r.controller.page('missing', user)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(r.controller.page('Bad Slug', user)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(r.controller.page('a', user)).resolves.toBe(detail);
  });

  it('search wraps the hits and passes a clamped limit', async () => {
    const r = reader();
    await expect(r.controller.find(user, 'roleplay', '999')).resolves.toEqual({
      results: [],
    });
    expect(r.search.search).toHaveBeenCalledWith('roleplay', 50);
    await r.controller.find(user, undefined, undefined);
    expect(r.search.search).toHaveBeenLastCalledWith('', 20);
  });

  it('changes passes slug and a limit clamped to 100 (default 30)', async () => {
    const r = reader();
    await r.controller.changeLog(user, '500', 'a');
    expect(r.changes.list).toHaveBeenLastCalledWith({ slug: 'a', limit: 100 });
    await r.controller.changeLog(user);
    expect(r.changes.list).toHaveBeenLastCalledWith({ slug: null, limit: 30 });
  });

  it('revert returns the refreshed PageDetail and maps write errors to HTTP errors', async () => {
    const r = reader();
    await expect(
      r.controller.revert('a', { revisionId: 'rev' }, user),
    ).resolves.toBe(detail);
    expect(r.pages.revert).toHaveBeenCalledWith('a', 'rev', 5);

    r.pages.revert.mockRejectedValueOnce(
      new ManualWriteError('not_found', 'gone'),
    );
    await expect(
      r.controller.revert('a', { revisionId: 'rev' }, user),
    ).rejects.toBeInstanceOf(NotFoundException);
    r.pages.revert.mockRejectedValueOnce(
      new ManualWriteError('invalid', 'same'),
    );
    await expect(
      r.controller.revert('a', { revisionId: 'rev' }, user),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('ManualAdminController', () => {
  function admin(enabled = true) {
    const settings = {
      assertRoadmapV2: jest.fn(async () => {
        if (!enabled) throw new NotFoundException();
        return { enabled: true };
      }),
    };
    const manualSettings = {
      get: jest.fn(async () => ({ enabled: false, monthlyBudgetUsd: 100 })),
      update: jest.fn(async () => ({ enabled: true, monthlyBudgetUsd: 150 })),
    };
    const state = { listRuns: jest.fn(async () => []) };
    const proposals = {
      list: jest.fn(async () => []),
      dismiss: jest.fn(async () => undefined),
    };
    const importer = {
      import: jest.fn(async () => ({
        created: 1,
        updated: 0,
        unchanged: 0,
        errors: [],
      })),
    };
    const pages = { markAllReleased: jest.fn(async () => 4) };
    const controller = new ManualAdminController(
      settings as never,
      manualSettings as never,
      state as never,
      proposals as never,
      importer as never,
      pages as never,
    );
    return {
      controller,
      settings,
      manualSettings,
      state,
      proposals,
      importer,
      pages,
    };
  }

  it('answers 404 on every route while Roadmap v2 is off', async () => {
    const a = admin(false);
    const calls: Promise<unknown>[] = [
      a.controller.getSettings(),
      a.controller.updateSettings({}, user),
      a.controller.runs(),
      a.controller.listProposals(),
      a.controller.dismiss('id'),
      a.controller.importPages({ pages: [] }, user),
      a.controller.markReleased(),
    ];
    for (const call of calls)
      await expect(call).rejects.toBeInstanceOf(NotFoundException);
  });

  it('patches settings as the caller', async () => {
    const a = admin();
    await a.controller.updateSettings(
      { enabled: true, monthlyBudgetUsd: 150 },
      user,
    );
    expect(a.manualSettings.update).toHaveBeenCalledWith(
      { enabled: true, monthlyBudgetUsd: 150 },
      5,
    );
  });

  it('lists runs with a clamped limit and proposals as views', async () => {
    const a = admin();
    await a.controller.runs('9999');
    expect(a.state.listRuns).toHaveBeenCalledWith(50);
    a.proposals.list.mockResolvedValueOnce([
      {
        id: 'p',
        kind: 'gap',
        pageSlug: null,
        summary: 's',
        detail: '',
        prRef: null,
        source: 'chat',
        keyId: 'secret-key-id',
        submittedBy: 2,
        status: 'open',
        appliedRevisionId: null,
        resolvedAt: null,
        createdAt: new Date('2026-11-02T00:00:00Z'),
      },
    ] as never);
    const { proposals } = await a.controller.listProposals('open');
    expect(proposals[0]).toMatchObject({
      id: 'p',
      createdAt: '2026-11-02T00:00:00.000Z',
    });
    expect(proposals[0]).not.toHaveProperty('keyId');
    expect(a.proposals.list).toHaveBeenCalledWith('open');
  });

  it('maps a bad status filter to a 400', async () => {
    const a = admin();
    a.proposals.list.mockImplementationOnce(() => {
      throw new ManualWriteError('invalid', 'status must be ...');
    });
    await expect(a.controller.listProposals('weird')).rejects.toMatchObject({
      status: 400,
    });
  });

  it('import and mark-released delegate and return the contract shapes', async () => {
    const a = admin();
    await expect(
      a.controller.importPages({ pages: [{ slug: 'a' }] }, user),
    ).resolves.toEqual({
      created: 1,
      updated: 0,
      unchanged: 0,
      errors: [],
    });
    expect(a.importer.import).toHaveBeenCalledWith([{ slug: 'a' }], 5);
    await expect(a.controller.markReleased()).resolves.toEqual({ cleared: 4 });
  });
});
