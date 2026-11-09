import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ClUseCase } from '../../enum/context-library.enum';
import { ContextKbCopyService } from '../context-kb-copy.service';
import {
  ALLY_GUIDE_CORPUS_MIGRATION,
  CHARACTER_CORPUS_MIGRATION,
  DEBRIEF_CORPUS_MIGRATION,
} from '../context-kb-import.service';

jest.mock('src/logger/logger.service', () => ({
  LoggerService: {
    getInstance: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
  },
}));

const ORG = '11111111-1111-4111-8111-111111111111';
const actor = { userId: 1, tenantId: null };

function build(
  opts: {
    old?: Array<{ query: string; tenant_id: string | null }>;
    current?: Array<{ queries: string[]; audience: any }>;
    answers?: Record<string, string[] | Error>;
    restricted?: boolean;
    topics?: Array<{ label: string; queries: number }>;
    unlabelled?: number;
  } = {},
) {
  const dataSource = {
    query: jest.fn(async (sql: string) => {
      if (sql.includes('FROM kb_retrievals')) return opts.old ?? [];
      if (sql.includes('FROM cl_retrievals')) return opts.current ?? [];
      if (sql.includes('COUNT(*) AS n')) return [{ n: '0' }];
      return [];
    }),
  };
  const kbImport = {
    assertPlatformAdmin: jest.fn(async () => {
      if (opts.restricted)
        throw new ForbiddenException('Only a platform admin can do this.');
    }),
  };
  const retrieval = {
    search: jest.fn(async (req: any) => {
      const answer = opts.answers?.[req.queries[0]] ?? [];
      if (answer instanceof Error) throw answer;
      return {
        results: answer.map((band) => ({ band, chunk: {} })),
        noConfidentMatch: !answer.some((b) => b !== 'low'),
      };
    }),
  };
  const gaps = {
    topicsFor: jest.fn(async (texts: string[]) => ({
      topics: opts.topics ?? [{ label: 'Night shifts', queries: texts.length }],
      unlabelled: opts.unlabelled ?? 0,
    })),
  };
  const service = new ContextKbCopyService(
    dataSource as any,
    {} as any,
    {} as any,
    kbImport as any,
    retrieval as any,
    gaps as any,
  );
  return { service, dataSource, retrieval, gaps };
}

describe('ContextKbCopyService.smokeCheck', () => {
  it('replays each logged search as its asker, and counts good-or-better results', async () => {
    const { service, retrieval } = build({
      old: [
        { query: 'who do I call at night', tenant_id: ORG },
        { query: 'what is active listening', tenant_id: null },
        // A placeholder tenant reads the global library only.
        { query: 'burnout', tenant_id: 't1' },
      ],
      current: [
        { queries: ['who do I call at night'], audience: { tenantId: ORG } },
      ],
      answers: {
        'who do I call at night': ['good'],
        'what is active listening': ['strong', 'low'],
        burnout: ['low'],
      },
    });

    const report = await service.smokeCheck(ALLY_GUIDE_CORPUS_MIGRATION, actor);

    // Duplicates (same asker, same words) are replayed once.
    expect(retrieval.search).toHaveBeenCalledTimes(3);
    const [req, options] = retrieval.search.mock.calls[0] as unknown as [
      unknown,
      unknown,
    ];
    expect(req).toMatchObject({
      useCase: ClUseCase.ALLY_GUIDE,
      audience: { tenantId: ORG },
      collections: ['ally_guide_library'],
    });
    // A replay writes no log, usage or cache.
    expect(options).toEqual({ replay: true });
    expect(
      retrieval.search.mock.calls.find(([r]) => r.queries[0] === 'burnout')![0]
        .audience,
    ).toEqual({ tenantId: null });
    expect(report).toMatchObject({
      logged: 4,
      replayed: 3,
      answered: 2,
      inGaps: 1,
      failed: 0,
      passed: true,
      gaps: [{ label: 'Night shifts', queries: 1 }],
    });
  });

  it('never returns a learner’s words — counts and topic labels only', async () => {
    const { service, gaps } = build({
      old: [{ query: 'my client said she wants to die', tenant_id: ORG }],
      topics: [{ label: 'Responding to suicidal thoughts', queries: 1 }],
    });
    const report = await service.smokeCheck(DEBRIEF_CORPUS_MIGRATION, actor);
    expect(JSON.stringify(report)).not.toContain('wants to die');
    // The misses are named by the gap labeller as sensitive text.
    expect(gaps.topicsFor).toHaveBeenCalledWith(
      ['my client said she wants to die'],
      true,
    );
  });

  it('counts a failed replay apart from a miss, and does not pass', async () => {
    const { service } = build({
      old: [{ query: 'q', tenant_id: null }],
      answers: { q: new Error('ally-ai down') },
    });
    const report = await service.smokeCheck(ALLY_GUIDE_CORPUS_MIGRATION, actor);
    expect(report).toMatchObject({ failed: 1, answered: 0, passed: false });
  });

  it('does not pass while misses are left unlabelled', async () => {
    const { service } = build({
      old: [{ query: 'q', tenant_id: null }],
      topics: [],
      unlabelled: 1,
    });
    const report = await service.smokeCheck(ALLY_GUIDE_CORPUS_MIGRATION, actor);
    expect(report).toMatchObject({ unlabelled: 1, passed: false });
  });

  it('refuses an organisation-restricted admin and a corpus that was not copied', async () => {
    await expect(
      build({ restricted: true }).service.smokeCheck(
        ALLY_GUIDE_CORPUS_MIGRATION,
        actor,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      build().service.smokeCheck(CHARACTER_CORPUS_MIGRATION, actor),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('ContextKbCopyService.enrichOne', () => {
  const imported = (over: Record<string, unknown> = {}) =>
    ({
      id: 'c1',
      code: 'AG-0001',
      collectionId: 'ally_guide_library',
      origin: 'imported',
      statement: 'Self-care for helpers — Rest',
      body: 'Rest is part of the work, not a reward for it.',
      situations: [],
      exampleQueries: [],
      keywords: [],
      topics: ['self-care'],
      facets: { kind: 'material' },
      attributes: { clinical: false },
      quality: { statementFrom: 'citation', enrichment: 'pending' },
      ...over,
    }) as any;

  const withEnrichment = (value: Record<string, unknown>) => {
    const chunkService = {
      enrich: jest.fn(async () => value),
      snapshot: jest.fn(),
      saveChanged: jest.fn(async (c: any) => c),
    };
    const service = new ContextKbCopyService(
      {} as any,
      {} as any,
      chunkService as any,
      {} as any,
      {} as any,
      {} as any,
    );
    return { service, chunkService };
  };

  it('adds retrieval metadata and a one-line statement, and never touches the passage', async () => {
    const { service, chunkService } = withEnrichment({
      statement: 'Rest is part of a helper’s work',
      situations: ['a learner feels guilty for resting'],
      exampleQueries: [{ text: 'is it ok to rest', origin: 'enriched' }],
      keywords: ['rest'],
      facets: { kind: 'protocol', topic: ['rest'] },
    });
    const chunk = imported();
    expect(await service.enrichOne(chunk, 1)).toBe(true);

    // The heading the copy wrote is replaced: asked for with an empty statement.
    expect((chunkService.enrich.mock.calls[0] as any[])[1].statement).toBe('');
    const saved = chunkService.saveChanged.mock.calls[0][0];
    expect(saved.body).toBe('Rest is part of the work, not a reward for it.');
    expect(saved.statement).toBe('Rest is part of a helper’s work');
    expect(saved.situations).toEqual(['a learner feels guilty for resting']);
    // What the copy set stands; enrichment only fills what was missing.
    expect(saved.facets).toEqual({ kind: 'material', topic: ['rest'] });
    expect(saved.quality).toMatchObject({
      enrichment: 'done',
      statementFrom: 'enrichment',
    });
  });

  it('keeps a statement an admin already edited', async () => {
    const { service, chunkService } = withEnrichment({
      statement: 'Edited by an admin',
      situations: ['x'],
      exampleQueries: [],
      keywords: [],
      facets: {},
    });
    await service.enrichOne(
      imported({
        statement: 'Edited by an admin',
        quality: { enrichment: 'pending' },
      }),
      1,
    );
    expect((chunkService.enrich.mock.calls[0] as any[])[1].statement).toBe(
      'Edited by an admin',
    );
  });

  it('leaves the chunk pending when enrichment produced nothing', async () => {
    const { service, chunkService } = withEnrichment({
      statement: '',
      situations: [],
      exampleQueries: [],
      keywords: [],
      facets: {},
    });
    expect(await service.enrichOne(imported(), 1)).toBe(false);
    expect(chunkService.saveChanged).not.toHaveBeenCalled();
  });
});
