import { ManualLink } from '../entity/manual-link.entity';
import { ManualPage } from '../entity/manual-page.entity';
import { ManualRevision } from '../entity/manual-revision.entity';
import { ManualPageService } from '../service/manual-page.service';
import { ManualScrubService } from '../service/manual-scrub.service';
import { ManualWriteError } from '../type/manual.types';

/** An in-memory stand-in for the transaction's EntityManager: just the calls write() makes. */
function fakeDb() {
  const pages: any[] = [];
  const revisions: any[] = [];
  let links: { fromSlug: string; toSlug: string }[] = [];
  let seq = 0;
  const em = {
    findOne: jest.fn(async (cls: unknown, opts: any) => {
      if (cls === ManualPage) {
        return (
          pages.find((p) => p.slug === opts.where.slug && !p.deletedAt) ?? null
        );
      }
      return null;
    }),
    create: jest.fn((_cls: unknown, obj: any) => ({ ...obj })),
    save: jest.fn(async (cls: unknown, obj: any) => {
      if (!obj.id)
        obj.id = `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
      if (cls === ManualPage && !pages.includes(obj)) pages.push(obj);
      if (cls === ManualRevision && !revisions.includes(obj))
        revisions.push(obj);
      return obj;
    }),
    delete: jest.fn(async (cls: unknown, where: any) => {
      if (cls === ManualLink)
        links = links.filter((l) => l.fromSlug !== where.fromSlug);
    }),
    insert: jest.fn(async (cls: unknown, rows: any[]) => {
      if (cls === ManualLink) links.push(...rows);
    }),
  };
  const dataSource: any = {
    transaction: jest.fn(async (cb: any) => cb(em)),
    query: jest.fn(),
    getRepository: jest.fn(() => ({
      findOne: jest.fn(
        async ({ where }: any) =>
          revisions.find(
            (r) => r.id === where.id && r.pageId === where.pageId,
          ) ?? null,
      ),
    })),
  };
  const pageRepo: any = {
    findOne: jest.fn(
      async ({ where }: any) =>
        pages.find((p) => p.slug === where.slug) ?? null,
    ),
    find: jest.fn(async () => pages),
    update: jest.fn(),
  };
  const changes: any = { list: jest.fn(async () => []) };
  const service = new ManualPageService(
    dataSource,
    pageRepo,
    new ManualScrubService(),
    changes,
  );
  return {
    service,
    pages,
    revisions,
    getLinks: () => links,
    em,
    dataSource,
    pageRepo,
    changes,
  };
}

const seed = { kind: 'seed' as const, reason: 'Imported' };
const chat = { kind: 'chat_agent' as const, reason: 'Fixed a label' };

describe('ManualPageService.write', () => {
  it('creates a page and appends the first revision as a full copy', async () => {
    const db = fakeDb();
    const result = await db.service.write(
      {
        slug: 'running-a-roleplay',
        title: 'Running a roleplay',
        summary: 'How.',
        body: 'Body',
      },
      seed,
      7,
    );
    expect(result).toMatchObject({ changed: true, created: true });
    expect(result.revision).toMatchObject({
      title: 'Running a roleplay',
      summary: 'How.',
      body: 'Body',
      authorKind: 'seed',
      authorRef: '7',
      reason: 'Imported',
      revertOf: null,
    });
    expect(result.page).toMatchObject({
      kind: 'page',
      position: 0,
      createdBy: 7,
    });
    expect(db.revisions).toHaveLength(1);
  });

  it('leaves a seed write "live" and marks any other author "next" once', async () => {
    const db = fakeDb();
    const first = await db.service.write(
      { slug: 'a', title: 'A', body: 'one' },
      seed,
    );
    expect(first.page.releaseState).toBe('live');
    expect(first.page.nextSince).toBeNull();

    const edited = await db.service.write({ slug: 'a', body: 'two' }, chat);
    expect(edited.page.releaseState).toBe('next');
    const since = edited.page.nextSince;
    expect(since).toBeInstanceOf(Date);

    const again = await db.service.write({ slug: 'a', body: 'three' }, chat);
    expect(again.page.releaseState).toBe('next');
    expect(again.page.nextSince).toBe(since); // not bumped
  });

  it('a seed re-import does not move a page that is already "next" back to live', async () => {
    const db = fakeDb();
    await db.service.write({ slug: 'a', title: 'A', body: 'one' }, seed);
    await db.service.write({ slug: 'a', body: 'two' }, chat);
    const reimport = await db.service.write({ slug: 'a', body: 'three' }, seed);
    expect(reimport.page.releaseState).toBe('next');
  });

  it('is idempotent: identical text changes nothing and writes no revision', async () => {
    const db = fakeDb();
    const input = {
      slug: 'a',
      title: 'A',
      summary: 's',
      body: 'same',
      roles: ['learner'],
    };
    await db.service.write(input, seed);
    const second = await db.service.write(input, chat);
    expect(second).toMatchObject({
      changed: false,
      created: false,
      revision: null,
    });
    expect(db.revisions).toHaveLength(1);
    expect(second.page.releaseState).toBe('live');
  });

  it('a partial update keeps the fields it was not given', async () => {
    const db = fakeDb();
    await db.service.write(
      {
        slug: 'a',
        title: 'A',
        summary: 's',
        body: 'b',
        surfaces: ['admin'],
        position: 3,
      },
      seed,
    );
    const result = await db.service.write({ slug: 'a', body: 'b2' }, chat);
    expect(result.page).toMatchObject({
      title: 'A',
      summary: 's',
      surfaces: ['admin'],
      position: 3,
    });
    expect(result.revision).toMatchObject({
      title: 'A',
      summary: 's',
      body: 'b2',
    });
  });

  it('a metadata-only change updates the page without a revision or a "next" badge', async () => {
    const db = fakeDb();
    await db.service.write({ slug: 'a', title: 'A', body: 'b' }, seed);
    const result = await db.service.write(
      { slug: 'a', position: 4, parentSlug: 'top' },
      chat,
    );
    expect(result).toMatchObject({ changed: true, revision: null });
    expect(result.page).toMatchObject({
      position: 4,
      parentSlug: 'top',
      releaseState: 'live',
    });
    expect(db.revisions).toHaveLength(1);
  });

  it('rebuilds manual_links from [[slug]] and [[slug|label]] on every body change', async () => {
    const db = fakeDb();
    await db.service.write(
      {
        slug: 'a',
        title: 'A',
        body: 'See [[b]], [[c|the c page]], [[b]], [[Not A Slug]] and [[a]].',
      },
      seed,
    );
    expect(db.getLinks().map((l) => l.toSlug)).toEqual(['b', 'c']);
    expect(db.getLinks().every((l) => l.fromSlug === 'a')).toBe(true);

    await db.service.write({ slug: 'a', body: 'Now only [[d]].' }, chat);
    expect(db.getLinks().map((l) => l.toSlug)).toEqual(['d']);

    await db.service.write({ slug: 'a', body: 'No links.' }, chat);
    expect(db.getLinks()).toEqual([]);
  });

  it('allows a link to a page that does not exist yet', async () => {
    const db = fakeDb();
    await expect(
      db.service.write(
        { slug: 'a', title: 'A', body: '[[future-page]]' },
        seed,
      ),
    ).resolves.toMatchObject({ created: true });
    expect(db.getLinks()).toEqual([
      { fromSlug: 'a', toSlug: 'future-page', createdAt: expect.any(Date) },
    ]);
  });

  it('records the author, reason and sources on the revision', async () => {
    const db = fakeDb();
    const sourceRefs = [
      { kind: 'code' as const, label: 'x', repo: 'ally-be', path: 'src/x.ts' },
    ];
    const result = await db.service.write(
      { slug: 'a', title: 'A', body: 'b' },
      {
        kind: 'weekly_agent',
        ref: 'run-9',
        reason: 'Checked against master',
        sourceRefs,
      },
    );
    expect(result.revision).toMatchObject({
      authorKind: 'weekly_agent',
      authorRef: 'run-9',
      reason: 'Checked against master',
      sourceRefs,
    });
  });

  describe('refusals (nothing is written)', () => {
    const expectRefused = async (
      db: ReturnType<typeof fakeDb>,
      promise: Promise<unknown>,
      code: string,
    ) => {
      const error = await promise.then(
        () => null,
        (e) => e,
      );
      expect(error).toBeInstanceOf(ManualWriteError);
      expect(error.code).toBe(code);
      expect(db.pages).toHaveLength(0);
      expect(db.revisions).toHaveLength(0);
    };

    it.each(['Bad Slug', '', 'a--b', 'x'.repeat(121)])(
      'invalid slug %p',
      async (slug) => {
        const db = fakeDb();
        await expectRefused(
          db,
          db.service.write({ slug, title: 'T' }, seed),
          'invalid_slug',
        );
      },
    );

    it('a new page needs a title', async () => {
      const db = fakeDb();
      await expectRefused(
        db,
        db.service.write({ slug: 'a', body: 'b' }, seed),
        'invalid',
      );
    });

    it('a body over 200,000 characters is too large', async () => {
      const db = fakeDb();
      await expectRefused(
        db,
        db.service.write(
          { slug: 'a', title: 'A', body: 'x'.repeat(200_001) },
          seed,
        ),
        'too_large',
      );
      await expect(
        db.service.write(
          { slug: 'a', title: 'A', body: 'x'.repeat(200_000) },
          seed,
        ),
      ).resolves.toMatchObject({ created: true });
    });

    it('scrubs title, summary, body and reason', async () => {
      for (const input of [
        { slug: 'a', title: 'Mail me@x.org', body: '' },
        { slug: 'a', title: 'A', summary: 'pmk_' + 'a'.repeat(16) },
        { slug: 'a', title: 'A', body: 'ok\nStrategy: win' },
      ]) {
        const db = fakeDb();
        await expectRefused(db, db.service.write(input, seed), 'scrubbed');
      }
      const db = fakeDb();
      await expectRefused(
        db,
        db.service.write(
          { slug: 'a', title: 'A' },
          { kind: 'chat_agent', reason: 'see me@x.org' },
        ),
        'scrubbed',
      );
    });

    it('a page cannot be its own parent, nor a descendant of itself', async () => {
      const db = fakeDb();
      await expectRefused(
        db,
        db.service.write({ slug: 'a', title: 'A', parentSlug: 'a' }, seed),
        'invalid',
      );
      await db.service.write({ slug: 'a', title: 'A' }, seed);
      await db.service.write({ slug: 'b', title: 'B', parentSlug: 'a' }, seed);
      await expect(
        db.service.write({ slug: 'a', parentSlug: 'b' }, seed),
      ).rejects.toMatchObject({
        code: 'invalid',
      });
    });

    it('a duplicate-slug race becomes a readable error', async () => {
      const db = fakeDb();
      db.dataSource.transaction.mockRejectedValueOnce(
        Object.assign(new Error('dup'), { code: '23505' }),
      );
      await expect(
        db.service.write({ slug: 'a', title: 'A' }, seed),
      ).rejects.toMatchObject({
        code: 'invalid',
      });
    });
  });
});

describe('ManualPageService.revert', () => {
  it('copies an older revision into a new "revert" revision and marks the page next', async () => {
    const db = fakeDb();
    const created = await db.service.write(
      { slug: 'a', title: 'A', body: 'original' },
      seed,
    );
    await db.service.write({ slug: 'a', body: 'bad edit' }, chat);
    const result = await db.service.revert('a', created.revision!.id, 9);
    expect(result.page.body).toBe('original');
    expect(result.revision).toMatchObject({
      authorKind: 'revert',
      revertOf: created.revision!.id,
      authorRef: '9',
      body: 'original',
    });
    expect(db.revisions).toHaveLength(3); // history is appended, never rewritten
    expect(result.page.releaseState).toBe('next');
  });

  it('refuses an unknown page, an unknown revision and a no-op revert', async () => {
    const db = fakeDb();
    await expect(db.service.revert('missing', 'x', 1)).rejects.toMatchObject({
      code: 'not_found',
    });
    const created = await db.service.write(
      { slug: 'a', title: 'A', body: 'v1' },
      seed,
    );
    await expect(
      db.service.revert('a', '11111111-1111-1111-1111-111111111111', 1),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      db.service.revert('a', created.revision!.id, 1),
    ).rejects.toMatchObject({
      code: 'invalid',
    });
  });
});

describe('ManualPageService.detail', () => {
  it('returns the PageDetail shape: ancestors, children, links, last change', async () => {
    const db = fakeDb();
    await db.service.write({ slug: 'top', title: 'Top' }, seed);
    await db.service.write(
      { slug: 'mid', title: 'Mid', parentSlug: 'top' },
      seed,
    );
    await db.service.write(
      { slug: 'leaf', title: 'Leaf', parentSlug: 'mid', body: 'x' },
      seed,
    );
    db.changes.list.mockResolvedValue([{ id: 'c1', slug: 'leaf' }]);
    db.dataSource.query.mockImplementation(async (sql: string) => {
      if (sql.includes('p.slug = l.to_slug'))
        return [{ slug: 'other', title: 'Other' }];
      if (sql.includes('p.slug = l.from_slug'))
        return [{ slug: 'back', title: 'Back' }];
      if (sql.includes('parent_slug = $1'))
        return [{ slug: 'kid', title: 'Kid', summary: null }];
      return [];
    });
    const detail = await db.service.detail('leaf');
    expect(detail).toMatchObject({
      slug: 'leaf',
      body: 'x',
      verifiedRef: null,
      verifiedAt: null,
      releaseState: 'live',
      breadcrumb: [
        { slug: 'top', title: 'Top' },
        { slug: 'mid', title: 'Mid' },
      ],
      outlinks: [{ slug: 'other', title: 'Other' }],
      backlinks: [{ slug: 'back', title: 'Back' }],
      children: [{ slug: 'kid', title: 'Kid', summary: '' }],
      lastChange: { id: 'c1', slug: 'leaf' },
    });
    expect(db.changes.list).toHaveBeenCalledWith({ slug: 'leaf', limit: 1 });
  });

  it('returns null for a missing page or an invalid slug', async () => {
    const db = fakeDb();
    expect(await db.service.detail('nope')).toBeNull();
    expect(await db.service.detail('Bad Slug')).toBeNull();
  });

  it('survives a parent cycle in stored data and stops at six ancestors', async () => {
    const db = fakeDb();
    db.pages.push(
      {
        slug: 'x',
        title: 'X',
        parentSlug: 'y',
        body: '',
        summary: '',
        roles: [],
        surfaces: [],
        journeys: [],
        updatedAt: new Date(),
        releaseState: 'live',
        kind: 'page',
        position: 0,
      },
      {
        slug: 'y',
        title: 'Y',
        parentSlug: 'x',
        body: '',
        summary: '',
        roles: [],
        surfaces: [],
        journeys: [],
        updatedAt: new Date(),
        releaseState: 'live',
        kind: 'page',
        position: 0,
      },
    );
    db.dataSource.query.mockResolvedValue([]);
    const detail = await db.service.detail('x');
    expect(detail!.breadcrumb).toEqual([{ slug: 'y', title: 'Y' }]);

    // A deep chain is cut at six.
    const chain = fakeDb();
    for (let i = 0; i < 10; i++) {
      chain.pages.push({
        slug: `p${i}`,
        title: `P${i}`,
        parentSlug: i < 9 ? `p${i + 1}` : null,
        body: '',
        summary: '',
        roles: [],
        surfaces: [],
        journeys: [],
        updatedAt: new Date(),
        releaseState: 'live',
        kind: 'page',
        position: 0,
      });
    }
    chain.dataSource.query.mockResolvedValue([]);
    expect((await chain.service.detail('p0'))!.breadcrumb).toHaveLength(6);
  });
});

describe('ManualPageService.list', () => {
  it('orders by parent, position, then title', async () => {
    const db = fakeDb();
    const mk = (
      slug: string,
      parentSlug: string | null,
      position: number,
      title: string,
    ) => ({
      slug,
      parentSlug,
      position,
      title,
    });
    db.pageRepo.find.mockResolvedValue([
      mk('c', 'p', 2, 'Zed'),
      mk('b', 'p', 1, 'Beta'),
      mk('a', 'p', 1, 'Alpha'),
      mk('top', null, 0, 'Top'),
    ]);
    expect((await db.service.list()).map((p) => p.slug)).toEqual([
      'top',
      'a',
      'b',
      'c',
    ]);
  });
});
