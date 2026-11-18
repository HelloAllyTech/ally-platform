import { BadRequestException } from '@nestjs/common';
import {
  ClChunkOrigin,
  ClChunkStatus,
  ClCollectionId,
  ClEmbeddingStatus,
  ClUseCase,
} from '../../enum/context-library.enum';
import { ContextAgentChunkService } from '../context-agent-chunk.service';
import { inFacetScope } from '../context-retrieval.service';

function setup(options: { rows?: any[]; shownRows?: any[] } = {}) {
  const chunkService = {
    enrich: jest.fn(async (_profile: any, input: any) => ({
      statement: input.statement,
      situations: ['when a suite flakes on CI'],
      exampleQueries: [{ text: 'flaky suite', origin: 'enriched' }],
      keywords: ['flaky'],
      // Enrichment proposes a category the agent did not give, and a wrong one it did.
      facets: { ...input.facets, category: 'estimate', tags: ['from-enrich'] },
    })),
    create: jest.fn(async (input: any) => ({
      id: 'new-id',
      code: 'BL-0042',
      ...input,
    })),
    resolveCodes: jest.fn(async () => []),
  };
  const retrieval = {
    search: jest.fn(async () => ({
      retrievalId: 'r1',
      results: [],
      noConfidentMatch: true,
      block: '',
    })),
    recordUsage: jest.fn(async () => undefined),
  };
  const execute = jest.fn(async () => ({ affected: 1 }));
  const qb: any = {
    update: () => qb,
    set: jest.fn(() => qb),
    whereInIds: jest.fn(() => qb),
    execute,
  };
  const chunks = {
    update: jest.fn(),
    find: jest.fn(async () => options.rows ?? []),
    query: jest.fn(async () => options.shownRows ?? []),
    createQueryBuilder: jest.fn(() => qb),
  };
  const service = new ContextAgentChunkService(
    chunkService as any,
    retrieval as any,
    chunks as any,
  );
  return { service, chunkService, retrieval, chunks, qb };
}

describe('ContextAgentChunkService.writeAgentChunk', () => {
  it('lands an agent lesson as a never-indexed candidate, with its facets, repos and evidence', async () => {
    const { service, chunkService, chunks } = setup();
    const chunk = await service.writeAgentChunk({
      collection: ClCollectionId.BUILDER_LESSONS,
      agent: 'builder',
      statement: '  Run NX_DAEMON=false before the admin suite.  ',
      facets: { category: 'Gotcha', bogus: 'x' },
      repos: ['Ally-Web', 'ally-web'],
      evidence: { sessionId: 's-1', runId: 'ignored-here' },
    });

    const created = chunkService.create.mock.calls[0][0];
    expect(created).toMatchObject({
      collectionId: 'builder_lessons',
      origin: ClChunkOrigin.AGENT,
      status: ClChunkStatus.CANDIDATE,
      agent: 'builder',
      statement: 'Run NX_DAEMON=false before the admin suite.',
      body: null,
      attributes: { sessionIds: ['s-1'] },
      situations: ['when a suite flakes on CI'],
    });
    // The agent's category wins over enrichment's; enrichment only fills gaps.
    expect(created.facets).toEqual({
      category: 'gotcha',
      repos: ['ally-web'],
      tags: ['from-enrich'],
    });
    expect(chunks.update).toHaveBeenCalledWith(
      { id: 'new-id' },
      { embeddingStatus: ClEmbeddingStatus.SKIPPED },
    );
    expect(chunk.embeddingStatus).toBe(ClEmbeddingStatus.SKIPPED);
  });

  it('keeps a long lesson whole in the body behind a clipped statement', async () => {
    const { service, chunkService } = setup();
    const text = 'trap '.repeat(200).trim();
    await service.writeAgentChunk({
      collection: ClCollectionId.BUG_HUNTER_NOTES,
      agent: 'bug_hunter',
      statement: text,
      facets: { tags: ['link:held'] },
    });
    const created = chunkService.create.mock.calls[0][0];
    expect(created.statement.length).toBeLessThanOrEqual(600);
    expect(created.body).toBe(text);
    expect(created.facets.tags).toEqual(['link:held']);
  });

  it('refuses an empty lesson, a collection agents do not write to, and the wrong agent', async () => {
    const { service } = setup();
    await expect(
      service.writeAgentChunk({
        collection: ClCollectionId.BUG_HUNTER_NOTES,
        agent: 'bug_hunter',
        statement: '   ',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.writeAgentChunk({
        collection: ClCollectionId.FIRST_PRINCIPLES,
        agent: 'builder',
        statement: 'x',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.writeAgentChunk({
        collection: ClCollectionId.BUG_HUNTER_NOTES,
        agent: 'builder',
        statement: 'x',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('ContextAgentChunkService.search', () => {
  it('searches one collection for the use case, scoped to the repos in play', async () => {
    const { service, retrieval } = setup();
    await service.search({
      useCase: ClUseCase.BUG_HUNTER,
      collection: ClCollectionId.BUG_HUNTER_NOTES,
      queries: ['flaky scheduler spec'],
      repos: ['Ally-BE'],
      limit: 3,
      sessionId: 'run-1',
    });
    expect(retrieval.search).toHaveBeenCalledWith(
      expect.objectContaining({
        useCase: 'bug_hunter',
        collections: ['bug_hunter_notes'],
        sessionId: 'run-1',
        facetScope: { key: 'repos', values: ['ally-be'] },
      }),
    );
  });
});

describe('ContextAgentChunkService.recordFeedback', () => {
  it('records applied and contradicted as usage, counts them, and marks the rest of the run unused', async () => {
    const applied = {
      id: '11111111-1111-4111-8111-111111111111',
      code: 'BN-0001',
    };
    const wrong = {
      id: '22222222-2222-4222-8222-222222222222',
      code: 'BN-0002',
    };
    const { service, retrieval, chunks, qb } = setup({
      shownRows: [{ chunk_id: 'shown-not-used' }],
    });
    chunks.find
      .mockResolvedValueOnce([applied])
      .mockResolvedValueOnce([wrong, applied]);

    const result = await service.recordFeedback({
      useCase: ClUseCase.BUG_HUNTER,
      collection: ClCollectionId.BUG_HUNTER_NOTES,
      sessionId: 'run-1',
      applied: [applied.id],
      contradicted: [wrong.code, applied.id],
    });

    expect(result).toEqual({ applied: 1, contradicted: 1, unused: 1 });
    expect(retrieval.recordUsage).toHaveBeenCalledWith(
      'bug_hunter',
      { ids: [applied.id] },
      'agent_applied',
      { sessionId: 'run-1' },
    );
    expect(retrieval.recordUsage).toHaveBeenCalledWith(
      'bug_hunter',
      { ids: [wrong.id] },
      'agent_contradicted',
      { sessionId: 'run-1' },
    );
    expect(retrieval.recordUsage).toHaveBeenCalledWith(
      'bug_hunter',
      { ids: ['shown-not-used'] },
      'unused',
      { sessionId: 'run-1' },
    );
    expect(qb.whereInIds).toHaveBeenCalledWith([applied.id]);
    expect(qb.whereInIds).toHaveBeenCalledWith([wrong.id]);
    // Only this collection's chunks can be credited, by id or by code.
    expect((chunks.find.mock.calls as any[])[0][0].where[0]).toMatchObject({
      collectionId: 'bug_hunter_notes',
    });
  });

  it('marks nothing unused for a caller that only knows about contradictions', async () => {
    const { service, chunks, retrieval } = setup();
    chunks.find.mockResolvedValue([{ id: 'x', code: 'BL-0001' }]);
    const result = await service.recordFeedback({
      useCase: ClUseCase.BUILDER_BUILD,
      collection: ClCollectionId.BUILDER_LESSONS,
      sessionId: 'session-1',
      applied: [],
      contradicted: ['BL-0001'],
      markUnused: false,
    });
    expect(result.unused).toBe(0);
    expect(chunks.query).not.toHaveBeenCalled();
    expect(retrieval.recordUsage).toHaveBeenCalledTimes(1);
  });
});

describe('inFacetScope', () => {
  const scope = { key: 'repos', values: ['ally-be'] };
  it('lets platform-wide chunks through, and repo chunks only for their repo', () => {
    expect(inFacetScope({ facets: {} }, scope)).toBe(true);
    expect(inFacetScope({ facets: { repos: [] } }, scope)).toBe(true);
    expect(
      inFacetScope({ facets: { repos: ['ally-be', 'ally-web'] } }, scope),
    ).toBe(true);
    expect(inFacetScope({ facets: { repos: ['ally-mobile'] } }, scope)).toBe(
      false,
    );
    expect(
      inFacetScope(
        { facets: { repos: ['ally-mobile'] } },
        { key: 'repos', values: [] },
      ),
    ).toBe(false);
  });
});
