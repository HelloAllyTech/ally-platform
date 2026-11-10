import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ClUseCase } from '../../enum/context-library.enum';
import { ContextLibraryOrgController } from '../context-library-org.controller';

const MINE = '11111111-1111-4111-8111-111111111111';
const THEIRS = '22222222-2222-4222-8222-222222222222';
const user = { id: 7 } as any;

const chunk = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  code: 'AG-0001',
  collectionId: 'ally_guide_library',
  isGlobal: false,
  ownerTenantId: MINE,
  ...over,
});

function build(
  opts: { found?: any; inScope?: boolean; tenantExists?: boolean } = {},
) {
  const chunkService = {
    findByCode: jest.fn(async () => opts.found ?? chunk()),
    list: jest.fn(async () => ({ items: [], total: 0 })),
    createAuthored: jest.fn(async () => chunk()),
    updateAuthored: jest.fn(async () => chunk()),
    setStatus: jest.fn(async () => chunk()),
    setPinned: jest.fn(async () => chunk()),
    bulk: jest.fn(async () => ({})),
  };
  const retrieval = {
    search: jest.fn(async () => ({ results: [], noConfidentMatch: true })),
  };
  const loops = { insights: jest.fn(async () => ({})) };
  const tenantScope = {
    assertTenantInScope: jest.fn(async () => {
      if (opts.inScope === false) throw new ForbiddenException('out of scope');
    }),
  };
  const collections = {
    find: jest.fn(async () => [
      { id: 'ally_guide_library' },
      { id: 'debrief_guidance' },
      { id: 'first_principles' },
    ]),
    manager: {
      query: jest.fn(async (sql: string) => {
        if (sql.includes('FROM tenants'))
          return opts.tenantExists === false ? [] : [{ id: MINE }];
        if (sql.includes('FROM cl_chunks'))
          return [
            {
              collection_id: 'ally_guide_library',
              status: 'active',
              n: '12',
              own: '0',
            },
          ];
        return [];
      }),
    },
  };
  const controller = new ContextLibraryOrgController(
    chunkService as any,
    retrieval as any,
    loops as any,
    tenantScope as any,
    collections as any,
    { find: jest.fn(async () => []) } as any,
    { find: jest.fn(async () => []) } as any,
  );
  return { controller, chunkService, retrieval, loops, tenantScope };
}

describe('ContextLibraryOrgController', () => {
  it('lists only collections that take organisation entries, with its own count', async () => {
    const { controller } = build();
    const collections = await controller.listCollections(user, MINE);
    expect(collections.map((c) => c.id)).toEqual(['ally_guide_library']);
    expect(collections[0]).toMatchObject({
      takesDocuments: false,
      counts: { active: 12 },
      // The organisation has written nothing yet: the page says so.
      ownActive: 0,
    });
  });

  it("lists this organisation's entries and the global ones, never another's", async () => {
    const { controller, chunkService } = build();
    await controller.listChunks(user, MINE, {
      collectionId: 'ally_guide_library',
    } as any);
    expect(chunkService.list).toHaveBeenCalledWith(
      expect.objectContaining({ ownerTenantId: MINE }),
    );

    await controller.listChunks(user, MINE, {
      collectionId: 'ally_guide_library',
      audience: 'mine',
    } as any);
    expect(chunkService.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ ownerTenantId: MINE, ownedBy: MINE }),
    );

    await controller.listChunks(user, MINE, {
      collectionId: 'ally_guide_library',
      audience: 'global',
    } as any);
    expect(chunkService.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ globalOnly: true }),
    );
  });

  it('refuses a collection organisations cannot write to, or another organisation as an audience', async () => {
    const { controller } = build();
    await expect(
      controller.listChunks(user, MINE, {
        collectionId: 'debrief_guidance',
      } as any),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      controller.listChunks(user, MINE, {
        collectionId: 'ally_guide_library',
        audience: THEIRS,
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses an organisation outside the admin’s allowlist, or one that does not exist', async () => {
    await expect(
      build({ inScope: false }).controller.listCollections(user, THEIRS),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      build({ tenantExists: false }).controller.listCollections(user, MINE),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("answers another organisation's entry, or one outside the guide library, as missing", async () => {
    for (const found of [
      chunk({ ownerTenantId: THEIRS }),
      chunk({
        collectionId: 'debrief_guidance',
        isGlobal: true,
        ownerTenantId: null,
      }),
    ]) {
      await expect(
        build({ found }).controller.getChunk(user, 'AG-0001', MINE),
      ).rejects.toBeInstanceOf(NotFoundException);
    }
    // A global entry is readable.
    await expect(
      build({
        found: chunk({ isGlobal: true, ownerTenantId: null }),
      }).controller.getChunk(user, 'AG-0001', MINE),
    ).resolves.toMatchObject({ code: 'AG-0001' });
  });

  it('writes as the organisation, so the entry is its own', async () => {
    const { controller, chunkService } = build();
    await controller.createChunk(user, 'ally_guide_library', MINE, {
      statement: 'Our out-of-hours escalation',
      isGlobal: true,
      tenantIds: [THEIRS],
    } as any);
    const [, , actor] = chunkService.createAuthored.mock.calls[0] as any[];
    expect(actor).toEqual({ userId: 7, tenantId: MINE });
  });

  it('keeps global entries read-only, and another organisation’s out of reach', async () => {
    const global = build({
      found: chunk({ isGlobal: true, ownerTenantId: null }),
    });
    await expect(
      global.controller.chunkAction(user, 'AG-0001', 'archive', MINE),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(global.chunkService.setStatus).not.toHaveBeenCalled();

    const theirs = build({ found: chunk({ ownerTenantId: THEIRS }) });
    await expect(
      theirs.controller.chunkAction(user, 'AG-0001', 'archive', MINE),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      theirs.controller.updateChunk(user, 'AG-0001', MINE, {
        statement: 'x',
      } as any),
    ).rejects.toBeInstanceOf(NotFoundException);

    const own = build();
    await own.controller.chunkAction(user, 'AG-0001', 'archive', MINE);
    expect(own.chunkService.setStatus).toHaveBeenCalled();
  });

  it('searches as its learners would be served: global plus its own, guide library only', async () => {
    const { controller, retrieval } = build();
    await controller.search(user, MINE, { query: 'who to call' } as any);
    expect(retrieval.search).toHaveBeenCalledWith(
      expect.objectContaining({
        useCase: ClUseCase.ADMIN_PREVIEW,
        audience: { tenantId: MINE },
        collections: ['ally_guide_library'],
      }),
    );
    await expect(
      controller.search(user, MINE, {
        query: 'q',
        collectionId: 'first_principles',
      } as any),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('scopes Insights to the organisation', async () => {
    const { controller, loops } = build();
    await controller.insights(user, 'ally_guide_library', MINE);
    expect(loops.insights).toHaveBeenCalledWith('ally_guide_library', 30, {
      tenantId: MINE,
    });
  });
});
