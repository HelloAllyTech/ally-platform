import { Case } from 'src/case/entity/case.entity';
import { Competency } from 'src/learn/entity/competency.entity';
import { Scenarios } from 'src/learn/entity/scenarios.entity';
import { ScenarioCharacter } from 'src/scenario-character/entity/scenario-character.entity';
import { TrackComponentTemplate } from 'src/track/entity/track-component-template.entity';
import {
  ClChunkOrigin,
  ClChunkStatus,
  ClCollectionId,
} from '../../enum/context-library.enum';
import {
  CatalogueItem,
  ContextCatalogueSyncService,
  catalogueChunkFields,
  chunkMatches,
  oneLine,
} from '../context-catalogue-sync.service';
import { ContextCatalogueSubscriber } from '../context-catalogue.subscriber';

const item = (over: Partial<CatalogueItem> = {}): CatalogueItem => ({
  kind: 'roleplay',
  id: '42',
  title: 'Grief at work',
  summary: 'A colleague asks for help after a loss',
  competencyIds: ['c-1'],
  competencies: ['Active listening'],
  difficulty: 'MEDIUM',
  languages: ['en'],
  detail: null,
  ownerTenantId: null,
  ...over,
});

describe('catalogue chunk fields', () => {
  it('writes the title and its one line, the facets and an audience from the owner', () => {
    const fields = catalogueChunkFields(item());
    expect(fields).toEqual({
      statement: 'Grief at work — A colleague asks for help after a loss',
      facets: {
        itemKind: 'roleplay',
        competencies: ['Active listening'],
        difficulty: 'MEDIUM',
        languages: ['en'],
      },
      attributes: {
        title: 'Grief at work',
        summary: 'A colleague asks for help after a loss',
        competencyIds: ['c-1'],
      },
      topics: ['active-listening'],
      isGlobal: true,
      tenantIds: [],
    });
  });

  it('gives an organisation’s own item to that organisation alone', () => {
    const fields = catalogueChunkFields(
      item({ kind: 'character', ownerTenantId: 'org-1', summary: null }),
    );
    expect(fields.isGlobal).toBe(false);
    expect(fields.tenantIds).toEqual(['org-1']);
    expect(fields.statement).toBe('Grief at work');
  });

  it('flattens HTML descriptions to one short line', () => {
    expect(oneLine('<p>Hello   <b>there</b></p>')).toBe('Hello there');
    expect(oneLine('x'.repeat(200), 10)).toHaveLength(10);
    expect(oneLine('   ')).toBeNull();
    expect(oneLine(undefined)).toBeNull();
  });

  it('knows when a chunk already says what its item says', () => {
    const fields = catalogueChunkFields(item());
    expect(chunkMatches({ ...fields, tenantIds: [] } as any, fields)).toBe(
      true,
    );
    expect(
      chunkMatches({ ...fields, statement: 'old title' } as any, fields),
    ).toBe(false);
  });
});

describe('ContextCatalogueSyncService', () => {
  let repos: Map<unknown, { find: jest.Mock; count: jest.Mock }>;
  let chunks: { find: jest.Mock; findOne: jest.Mock };
  let chunkService: {
    create: jest.Mock;
    snapshot: jest.Mock;
    saveChanged: jest.Mock;
    enrich: jest.Mock;
  };
  let service: ContextCatalogueSyncService;

  const repo = (rows: unknown[] = []) => ({
    find: jest.fn().mockResolvedValue(rows),
    count: jest.fn().mockResolvedValue(rows.length),
  });

  beforeEach(() => {
    repos = new Map<unknown, { find: jest.Mock; count: jest.Mock }>([
      [Scenarios, repo()],
      [Case, repo()],
      [ScenarioCharacter, repo()],
      [TrackComponentTemplate, repo()],
      [Competency, repo([{ id: 'c-1', name: 'Active listening' }])],
    ]);
    chunks = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
    };
    chunkService = {
      create: jest.fn(async (input) => ({ ...input, code: 'CC-0001' })),
      snapshot: jest.fn().mockResolvedValue(undefined),
      saveChanged: jest.fn(async (chunk) => chunk),
      enrich: jest.fn(),
    };
    service = new ContextCatalogueSyncService(
      { getRepository: (entity: unknown) => repos.get(entity) } as any,
      chunks as any,
      chunkService as any,
      {
        acquireLock: jest.fn().mockResolvedValue(true),
        releaseLock: jest.fn().mockResolvedValue(undefined),
      } as any,
    );
  });

  afterEach(() => service.onModuleDestroy());

  const scenario = (over: Record<string, unknown> = {}) => ({
    id: 42,
    title: 'Grief at work',
    description: '<p>A colleague asks for help</p>',
    competencyId: 'c-1',
    competencyIds: ['c-1'],
    difficultyLevel: 'MEDIUM',
    metadata: { languageVoices: { en: 'v1' } },
    ...over,
  });

  it('creates a synced, global item for a new Ally roleplay, waiting for enrichment', async () => {
    repos.get(Scenarios)!.find.mockResolvedValue([scenario()]);

    const report = await service.reconcileKind('roleplay');

    expect(report).toMatchObject({ kind: 'roleplay', active: 1, created: 1 });
    expect(chunkService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        collectionId: ClCollectionId.CONTENT_CATALOGUE,
        origin: ClChunkOrigin.SYNCED,
        syncKey: 'scenarios:42',
        statement: 'Grief at work — A colleague asks for help',
        facets: {
          itemKind: 'roleplay',
          competencies: ['Active listening'],
          difficulty: 'MEDIUM',
          languages: ['en'],
        },
        isGlobal: true,
        tenantIds: [],
        quality: { enrichment: 'pending' },
      }),
    );
  });

  it('rewrites only what the row decides, keeping learned searches', async () => {
    repos
      .get(Scenarios)!
      .find.mockResolvedValue([scenario({ title: 'Grief at work, revised' })]);
    const existing = {
      id: 'ch-1',
      code: 'CC-0001',
      syncKey: 'scenarios:42',
      status: ClChunkStatus.ACTIVE,
      statement: 'Grief at work — A colleague asks for help',
      facets: { itemKind: 'roleplay' },
      attributes: {},
      topics: [],
      isGlobal: true,
      tenantIds: [],
      exampleQueries: [{ text: 'bereavement roleplay', origin: 'learned' }],
      quality: { enrichment: 'done' },
    };
    chunks.find.mockResolvedValue([existing]);

    const report = await service.reconcileKind('roleplay');

    expect(report.updated).toBe(1);
    expect(chunkService.snapshot).toHaveBeenCalledWith(
      existing,
      'synced',
      null,
    );
    const saved = chunkService.saveChanged.mock.calls[0][0];
    expect(saved.statement).toBe(
      'Grief at work, revised — A colleague asks for help',
    );
    expect(saved.exampleQueries).toEqual([
      { text: 'bereavement roleplay', origin: 'learned' },
    ]);
    expect(saved.quality).toEqual({ enrichment: 'done' });
  });

  it('archives an item whose row is gone, and restores it when the row is back', async () => {
    const existing = {
      id: 'ch-1',
      syncKey: 'scenarios:42',
      status: ClChunkStatus.ACTIVE,
      statement: 'Grief at work — A colleague asks for help',
      facets: {},
      attributes: {},
      topics: [],
      isGlobal: true,
      tenantIds: [],
    };
    chunks.find.mockResolvedValue([existing]);

    const gone = await service.reconcileKind('roleplay');
    expect(gone.archived).toBe(1);
    expect(existing.status).toBe(ClChunkStatus.ARCHIVED);

    repos.get(Scenarios)!.find.mockResolvedValue([scenario()]);
    const back = await service.reconcileKind('roleplay');
    expect(back.restored).toBe(1);
    expect(existing.status).toBe(ClChunkStatus.ACTIVE);
    expect(chunkService.create).not.toHaveBeenCalled();
  });

  it('leaves an item alone when nothing changed', async () => {
    repos.get(Scenarios)!.find.mockResolvedValue([scenario()]);
    await service.reconcileKind('roleplay');
    const created = chunkService.create.mock.calls[0][0];
    chunks.find.mockResolvedValue([
      { ...created, id: 'ch-1', status: ClChunkStatus.ACTIVE },
    ]);
    chunkService.create.mockClear();

    const report = await service.reconcileKind('roleplay');

    expect(report).toMatchObject({ created: 0, updated: 0, archived: 0 });
    expect(chunkService.saveChanged).not.toHaveBeenCalled();
  });

  it('scopes a character an organisation made to that organisation', async () => {
    repos.get(ScenarioCharacter)!.find.mockResolvedValue([
      {
        id: 'c-9',
        name: 'Asha',
        age: 34,
        gender: 'female',
        profession: 'teacher',
        currentLocation: 'Pune',
        tenantId: 'org-1',
      },
    ]);
    await service.reconcileKind('character');
    expect(chunkService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        syncKey: 'scenario_characters:c-9',
        statement: 'Asha — 34, female, teacher',
        isGlobal: false,
        tenantIds: ['org-1'],
        ownerTenantId: null,
      }),
    );
  });

  it('syncs one queued row after the pause, and a whole kind for a write that named none', async () => {
    jest.useFakeTimers();
    try {
      const syncItem = jest
        .spyOn(service, 'syncItem')
        .mockResolvedValue(undefined);
      const reconcileKind = jest
        .spyOn(service, 'reconcileKind')
        .mockResolvedValue({} as any);
      jest.spyOn(service, 'enrichPending').mockResolvedValue({
        enriched: 0,
        failed: 0,
      });
      const subscriber = new ContextCatalogueSubscriber(
        { subscribers: [] } as any,
        service,
      );

      subscriber.afterInsert({
        metadata: { tableName: 'scenarios' },
        entity: { id: 7 },
      } as any);
      subscriber.afterUpdate({
        metadata: { tableName: 'scenarios' },
        entity: { id: 7 },
      } as any);
      subscriber.afterUpdate({
        metadata: { tableName: 'track_component_templates' },
      } as any);
      subscriber.afterInsert({
        metadata: { tableName: 'users' },
        entity: { id: 1 },
      } as any);
      expect(syncItem).not.toHaveBeenCalled();

      jest.runOnlyPendingTimers();
      await service.flush();

      expect(syncItem).toHaveBeenCalledTimes(1);
      expect(syncItem).toHaveBeenCalledWith('roleplay', '7');
      expect(reconcileKind).toHaveBeenCalledWith('template');
    } finally {
      jest.useRealTimers();
    }
  });

  it('registers the subscriber with TypeORM', () => {
    const dataSource = { subscribers: [] as unknown[] };
    const subscriber = new ContextCatalogueSubscriber(
      dataSource as any,
      service,
    );
    expect(dataSource.subscribers).toEqual([subscriber]);
  });

  it('backfills once, only while the collection is empty', async () => {
    const reconcile = jest.spyOn(service, 'reconcile').mockResolvedValue([]);
    chunks.findOne.mockResolvedValueOnce({ id: 'ch-1' });
    expect(await service.backfillIfEmpty()).toBe(false);
    expect(reconcile).not.toHaveBeenCalled();

    chunks.findOne.mockResolvedValueOnce(null);
    expect(await service.backfillIfEmpty()).toBe(true);
    expect(reconcile).toHaveBeenCalledWith({ enrich: true });
  });

  it('enriches a pending item with searches, never touching its text or facets', async () => {
    const pending = {
      id: 'ch-1',
      code: 'CC-0001',
      statement: 'Grief at work',
      facets: { itemKind: 'roleplay' },
      attributes: { title: 'Grief at work' },
      situations: [],
      exampleQueries: [],
      keywords: [],
      topics: [],
      quality: { enrichment: 'pending' },
    };
    (chunks as any).createQueryBuilder = () => {
      const qb: any = {
        where: () => qb,
        andWhere: () => qb,
        orderBy: () => qb,
        take: () => qb,
        getMany: async () => [pending],
      };
      return qb;
    };
    chunkService.enrich.mockResolvedValue({
      statement: 'Grief at work',
      situations: ['a course on loss'],
      exampleQueries: [{ text: 'bereavement practice', origin: 'enriched' }],
      keywords: ['grief'],
      facets: { itemKind: 'roleplay', competencies: ['made up'] },
    });

    const totals = await service.enrichPending(5);

    expect(totals).toEqual({ enriched: 1, failed: 0 });
    const input = chunkService.enrich.mock.calls[0][1];
    // Every facet is passed as known, so none is proposed.
    expect(Object.keys(input.facets).sort()).toEqual([
      'competencies',
      'difficulty',
      'itemKind',
      'languages',
    ]);
    const saved = chunkService.saveChanged.mock.calls[0][0];
    expect(saved.statement).toBe('Grief at work');
    expect(saved.facets).toEqual({ itemKind: 'roleplay' });
    expect(saved.exampleQueries).toEqual([
      { text: 'bereavement practice', origin: 'enriched' },
    ]);
    expect(saved.quality).toEqual({ enrichment: 'done' });
  });
});
