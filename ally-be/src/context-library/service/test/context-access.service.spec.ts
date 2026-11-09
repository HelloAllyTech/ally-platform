import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ClCollectionId, ClUseCase } from '../../enum/context-library.enum';
import { COLLECTION_PROFILES } from '../../profiles';
import { ContextAccessService } from '../context-access.service';

function repo(rows: any[] = []) {
  return {
    rows,
    find: jest.fn(async (opts?: any) =>
      opts?.where
        ? rows.filter((r) =>
            Object.entries(opts.where).every(([k, v]) => r[k] === v),
          )
        : rows,
    ),
    findOne: jest.fn(
      async (opts: any) =>
        rows.find((r) =>
          Object.entries(opts.where).every(([k, v]) => r[k] === v),
        ) ?? null,
    ),
    create: jest.fn((x: any) => x),
    save: jest.fn(async (x: any) => {
      const list = Array.isArray(x) ? x : [x];
      for (const item of list) {
        if (!rows.includes(item))
          rows.push({ id: `id-${rows.length}`, ...item });
      }
      return x;
    }),
  };
}

const collections = [{ id: ClCollectionId.FIRST_PRINCIPLES, status: 'active' }];

describe('ContextAccessService', () => {
  it('falls back to the use case defaults, limited to live collections with a profile', async () => {
    const service = new ContextAccessService(
      repo() as any,
      repo() as any,
      repo(collections) as any,
    );
    // Builder defaults to First Principles and Builder Lessons; only the first exists yet.
    expect(
      await service.grantedCollections(ClUseCase.BUILDER_INTERVIEW),
    ).toEqual([{ collectionId: ClCollectionId.FIRST_PRINCIPLES, weight: 1 }]);
  });

  it('refuses collections outside the grants instead of filtering them silently', async () => {
    const service = new ContextAccessService(
      repo() as any,
      repo() as any,
      repo(collections) as any,
    );
    const { grants, denied } = await service.resolve(
      ClUseCase.BUILDER_INTERVIEW,
      [ClCollectionId.FIRST_PRINCIPLES, ClCollectionId.CHARACTER_INSIGHTS],
    );
    expect(grants.map((g) => g.collectionId)).toEqual([
      ClCollectionId.FIRST_PRINCIPLES,
    ]);
    expect(denied).toEqual([ClCollectionId.CHARACTER_INSIGHTS]);
  });

  it('requires an audience for organisation-scoped use cases', () => {
    const service = new ContextAccessService(
      repo() as any,
      repo() as any,
      repo(collections) as any,
    );
    expect(() =>
      service.assertAudience(ClUseCase.ALLY_GUIDE, undefined),
    ).toThrow(BadRequestException);
    expect(
      service.assertAudience(ClUseCase.ALLY_GUIDE, { tenantId: null }),
    ).toEqual({ tenantId: null });
    expect(
      service.assertAudience(ClUseCase.BUILDER_INTERVIEW, undefined),
    ).toBeNull();
    // A platform use case may still be narrowed: the Library search as an organisation sees it.
    expect(
      service.assertAudience(ClUseCase.ADMIN_PREVIEW, { tenantId: 'org-1' }),
    ).toEqual({ tenantId: 'org-1' });
  });

  it('never lets Settings grant a locked collection', async () => {
    const profile = COLLECTION_PROFILES[ClCollectionId.FIRST_PRINCIPLES]!;
    const original = profile.neverGrantTo;
    (profile as any).neverGrantTo = [ClUseCase.MCP_DEV];
    try {
      const service = new ContextAccessService(
        repo() as any,
        repo() as any,
        repo(collections) as any,
      );
      await expect(
        service.setGrant(
          ClUseCase.MCP_DEV,
          ClCollectionId.FIRST_PRINCIPLES,
          true,
          1,
          1,
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(await service.grantedCollections(ClUseCase.MCP_DEV)).toEqual([]);
    } finally {
      (profile as any).neverGrantTo = original;
    }
  });

  it('changes one grant without touching the defaults of other pairs', async () => {
    const grants = repo();
    const log = repo();
    const live = [
      ...collections,
      { id: ClCollectionId.LEARNING_DESIGN, status: 'active' },
    ];
    // Pretend Learning Design has a profile, as it will once it ships.
    (COLLECTION_PROFILES as any)[ClCollectionId.LEARNING_DESIGN] = {
      ...COLLECTION_PROFILES[ClCollectionId.FIRST_PRINCIPLES],
      id: ClCollectionId.LEARNING_DESIGN,
      neverGrantTo: [],
    };
    try {
      const service = new ContextAccessService(
        grants as any,
        log as any,
        repo(live) as any,
      );
      await service.setGrant(
        ClUseCase.MCP_DEV,
        ClCollectionId.FIRST_PRINCIPLES,
        false,
        undefined,
        7,
      );
      service.invalidate();
      expect(
        (await service.grantedCollections(ClUseCase.MCP_DEV)).map(
          (g) => g.collectionId,
        ),
      ).toEqual([ClCollectionId.LEARNING_DESIGN]);
      expect(log.save).toHaveBeenCalled();
    } finally {
      delete (COLLECTION_PROFILES as any)[ClCollectionId.LEARNING_DESIGN];
    }
  });
});
