import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { DirectoryService } from '../directory.service';
import { DirectoryVisibility } from '../../entity/directory-entry.entity';

/** A tiny in-memory stand-in for the three repositories, enough for the ownership rules. */
function build() {
  const entries: any[] = [];
  const collections: any[] = [];
  const links: any[] = [];
  const entryRepo: any = {
    create: (v: any) => ({ id: `e${entries.length + 1}`, ...v }),
    save: async (v: any) => {
      if (!entries.includes(v)) entries.push(v);
      return v;
    },
    findOne: async ({ where: { id } }: any) =>
      entries.find((e) => e.id === id) ?? null,
    delete: jest.fn(),
  };
  const collectionRepo: any = {
    findOne: async ({ where: { id } }: any) =>
      collections.find((c) => c.id === id) ?? null,
    update: jest.fn(),
    save: async (v: any) => v,
  };
  const linkRepo: any = {
    createQueryBuilder: () => {
      const qb: any = {
        insert: () => qb,
        values: (v: any) => {
          qb.v = v;
          return qb;
        },
        orIgnore: () => qb,
        execute: async () => links.push(qb.v),
        innerJoin: () => qb,
        where: () => qb,
        select: () => qb,
        getRawMany: async () => [],
      };
      return qb;
    },
    delete: jest.fn(),
  };
  const service = new DirectoryService(entryRepo, collectionRepo, linkRepo);
  // visibleEntries is a query-builder read; the rules under test do not need it.
  jest.spyOn(service, 'visibleEntries').mockResolvedValue([]);
  return { service, entries, collections, links };
}

describe('DirectoryService ownership rules', () => {
  it('a new entry is private and owned by its creator', async () => {
    const { service } = build();
    const view = await service.createEntry(1, { title: 'Crisis line' });
    expect(view.visibility).toBe(DirectoryVisibility.PRIVATE);
    expect(view.isOwner).toBe(true);
  });

  it("hides another user's private entry as not found, shows a public one", async () => {
    const { service } = build();
    const priv = await service.createEntry(1, { title: 'Mine' });
    const pub = await service.createEntry(1, {
      title: 'Shared',
      visibility: DirectoryVisibility.PUBLIC,
    });
    await expect(service.getEntry(2, priv.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    const seen = await service.getEntry(2, pub.id);
    expect(seen.isOwner).toBe(false);
    expect(seen).not.toHaveProperty('ownerId');
  });

  it('lets only the owner edit or delete a public entry', async () => {
    const { service } = build();
    const pub = await service.createEntry(1, {
      title: 'Shared',
      visibility: DirectoryVisibility.PUBLIC,
    });
    await expect(
      service.updateEntry(2, pub.id, { title: 'Hijacked' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.deleteEntry(2, pub.id)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    const edited = await service.updateEntry(1, pub.id, { title: 'Renamed' });
    expect(edited.title).toBe('Renamed');
  });

  it('lets only the owner change a collection', async () => {
    const { service, collections } = build();
    collections.push({ id: 'c1', ownerId: 1 });
    await expect(
      service.updateCollection(2, 'c1', { name: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.deleteCollection(2, 'c1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("saves a public entry or your own, never someone else's private one", async () => {
    const { service, collections, links } = build();
    collections.push({ id: 'c2', ownerId: 2, settings: {} });
    const theirPrivate = await service.createEntry(1, { title: 'Private' });
    const theirPublic = await service.createEntry(1, {
      title: 'Public',
      visibility: DirectoryVisibility.PUBLIC,
    });
    const myOwn = await service.createEntry(2, { title: 'Own' });
    await expect(
      service.addEntry(2, 'c2', theirPrivate.id),
    ).rejects.toBeInstanceOf(NotFoundException);
    await service.addEntry(2, 'c2', theirPublic.id);
    await service.addEntry(2, 'c2', myOwn.id);
    expect(links.map((l) => l.entryId)).toEqual([theirPublic.id, myOwn.id]);
  });

  describe('custom domains', () => {
    it.each([
      ['Resources.Example.org', 'resources.example.org'],
      ['https://resources.example.org/path', 'resources.example.org'],
    ])('normalises %s', (raw, want) => {
      expect(build().service.normaliseDomain(raw)).toBe(want);
    });

    it.each([
      'localhost',
      'example',
      'a b.org',
      'helloally.ai',
      'x.helloally.ai',
    ])('refuses %s', (raw) => {
      expect(() => build().service.normaliseDomain(raw)).toThrow();
    });
  });
});
