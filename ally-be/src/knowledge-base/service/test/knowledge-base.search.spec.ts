import { KbCorpus } from '../../enum/knowledge-base.enum';
import { KnowledgeBaseService } from '../knowledge-base.service';

/**
 * The two things this covers are both silent failures.
 *
 * A scope that is dropped rather than applied answers one consumer's question from another
 * consumer's material — and reads perfectly, because the retrieved prose is real prose. And a
 * retrieval log that records only the survivors hides the drops that explain a thin result.
 */

const passage = (over: Record<string, any> = {}) => ({
  chunk_id: 'c1',
  document_id: 'd1',
  document_title: 'Doc',
  chunk_index: 0,
  text: 'text',
  char_start: 0,
  char_end: 100,
  page_from: 1,
  page_to: 1,
  section_path: '',
  source_url: '',
  language: 'en',
  token_count: 20,
  similarity: 0.9,
  ...over,
});

describe('KnowledgeBaseService.search', () => {
  let service: KnowledgeBaseService;
  let documentRepository: { retrievableIds: jest.Mock };
  let aiService: { searchKnowledgeChunks: jest.Mock };
  let retrievalRepository: { record: jest.Mock };

  const build = (ids: string[], responses: any[][]) => {
    documentRepository = { retrievableIds: jest.fn().mockResolvedValue(ids) };
    aiService = { searchKnowledgeChunks: jest.fn() };
    responses.forEach((passages) =>
      aiService.searchKnowledgeChunks.mockResolvedValueOnce({ passages }),
    );
    aiService.searchKnowledgeChunks.mockResolvedValue({ passages: [] });
    retrievalRepository = { record: jest.fn().mockResolvedValue('r1') };
    service = new KnowledgeBaseService(
      documentRepository as any,
      {} as any,
      // documentTenantRepository — the organisation assignment, unused on this path: the
      // audience travels as a filter on the query, not as a per-row lookup.
      {} as any,
      {} as any,
      aiService as any,
      {} as any,
      {} as any,
      retrievalRepository as any,
      // tenantRepository, for the existence check on a write path this spec never takes.
      {} as any,
      {
        resolveScope: async () => ({ tenantIds: null, restricted: false }),
      } as any,
    );
  };

  it('sends the corpus scope as the query, never as an unscoped search', async () => {
    build(['d1', 'd2'], [[passage()]]);

    await service.search({
      corpus: KbCorpus.WHATSAPP_QA,
      query: 'q',
    } as any);

    expect(documentRepository.retrievableIds).toHaveBeenCalledWith({
      corpus: KbCorpus.WHATSAPP_QA,
      tags: undefined,
    });
    expect(
      aiService.searchKnowledgeChunks.mock.calls[0][0].document_ids,
    ).toEqual(['d1', 'd2']);
  });

  it('carries WHO is asking alongside WHICH documents are in scope', async () => {
    // Two different scopes on one query. The corpus decides which documents exist; the
    // audience decides whether this organisation may be answered from them. ally-ai refuses
    // a request carrying neither, so the omission cannot be silent.
    build(['d1'], [[passage()]]);

    await service.search({
      corpus: KbCorpus.WHATSAPP_QA,
      query: 'q',
      tenantId: 'tenant-a',
    } as any);

    expect(aiService.searchKnowledgeChunks.mock.calls[0][0].audience).toEqual({
      tenant_id: 'tenant-a',
      include_global: true,
    });
  });

  it('ignores targeting when no organisation is named', async () => {
    // The admin console's job is to show what is INDEXED, which is deliberately not what a
    // worker receives — and the result echoes which of the two ran.
    build(['d1'], [[passage()]]);

    await service.search({ corpus: KbCorpus.WHATSAPP_QA, query: 'q' } as any);

    expect(aiService.searchKnowledgeChunks.mock.calls[0][0].audience).toEqual({
      unrestricted: true,
    });
  });

  it('returns nothing, and asks ally-ai nothing, when the corpus has no retrievable documents', async () => {
    // The dangerous alternative is an unscoped call: it would succeed and answer from
    // whatever else is indexed.
    build([], []);

    const result = await service.search({
      corpus: KbCorpus.WHATSAPP_QA,
      query: 'q',
    } as any);

    expect(result.passages).toEqual([]);
    expect(aiService.searchKnowledgeChunks).not.toHaveBeenCalled();
  });

  it("applies each corpus's own similarity floor, and lets a caller override it", async () => {
    build(['d1'], [[]]);
    await service.search({
      corpus: KbCorpus.WHATSAPP_QA,
      query: 'q',
    } as any);
    // 0.35 for every corpus. Precision is the agent's job (it reads the passage and can
    // decline); recall is retrieval's. See KB_MIN_SIMILARITY_DEFAULT.
    expect(
      aiService.searchKnowledgeChunks.mock.calls[0][0].min_similarity,
    ).toBe(0.35);

    build(['d1'], [[]]);
    await service.search({ corpus: KbCorpus.WHATSAPP_QA, query: 'q' } as any);
    expect(
      aiService.searchKnowledgeChunks.mock.calls[0][0].min_similarity,
    ).toBe(0.35);

    build(['d1'], [[]]);
    await service.search({
      corpus: KbCorpus.WHATSAPP_QA,
      query: 'q',
      minSimilarity: 0.2,
    } as any);
    expect(
      aiService.searchKnowledgeChunks.mock.calls[0][0].min_similarity,
    ).toBe(0.2);
  });

  it('over-fetches so shaping cannot silently shrink the result below the limit', async () => {
    build(['d1'], [[]]);
    await service.search({
      corpus: KbCorpus.WHATSAPP_QA,
      query: 'q',
      limit: 8,
    } as any);
    expect(aiService.searchKnowledgeChunks.mock.calls[0][0].limit).toBe(24);
  });

  it('caps the over-fetch so a large limit cannot become an unbounded query', async () => {
    build(['d1'], [[]]);
    await service.search({
      corpus: KbCorpus.WHATSAPP_QA,
      query: 'q',
      limit: 50,
    } as any);
    expect(aiService.searchKnowledgeChunks.mock.calls[0][0].limit).toBe(50);
  });

  it('passes tags through as a document-level narrowing', async () => {
    build(['d1'], [[]]);
    await service.search({
      corpus: KbCorpus.WHATSAPP_QA,
      query: 'q',
      tags: ['dementia'],
    } as any);
    expect(documentRepository.retrievableIds).toHaveBeenCalledWith({
      corpus: KbCorpus.WHATSAPP_QA,
      tags: ['dementia'],
    });
  });
});

/**
 * The retrieval log's job is to make retrieval's numbers answerable from data — the floor
 * above all, which was set by reasoning and turned out to be one paraphrase from rejecting a
 * direct hit. These assert the two things that would quietly destroy that: recording only the
 * survivors (so the drops that explain a thin result are invisible), and letting a logging
 * failure reach the caller (so analytics can break a working search).
 */
describe('KnowledgeBaseService.search — retrieval log', () => {
  let service: KnowledgeBaseService;
  let documentRepository: { retrievableIds: jest.Mock };
  let aiService: { searchKnowledgeChunks: jest.Mock };
  let retrievalRepository: { record: jest.Mock };

  const build = (ids: string[], responses: any[][]) => {
    documentRepository = { retrievableIds: jest.fn().mockResolvedValue(ids) };
    aiService = { searchKnowledgeChunks: jest.fn() };
    responses.forEach((passages) =>
      aiService.searchKnowledgeChunks.mockResolvedValueOnce({ passages }),
    );
    aiService.searchKnowledgeChunks.mockResolvedValue({ passages: [] });
    retrievalRepository = { record: jest.fn().mockResolvedValue('r1') };
    service = new KnowledgeBaseService(
      documentRepository as any,
      {} as any,
      // documentTenantRepository — the organisation assignment, unused on this path: the
      // audience travels as a filter on the query, not as a per-row lookup.
      {} as any,
      {} as any,
      aiService as any,
      {} as any,
      {} as any,
      retrievalRepository as any,
      // tenantRepository, for the existence check on a write path this spec never takes.
      {} as any,
      {
        resolveScope: async () => ({ tenantIds: null, restricted: false }),
      } as any,
    );
  };

  const recorded = () => retrievalRepository.record.mock.calls[0];

  it('records the floor that was actually used, not the current default', async () => {
    // A row storing "the default" would be worthless the first time the default moved —
    // which is the entire reason this table exists.
    build(['d1'], [[]]);
    await service.search({
      corpus: KbCorpus.WHATSAPP_QA,
      query: 'q',
      minSimilarity: 0.31,
    } as any);
    expect(recorded()[0].minSimilarity).toBe(0.31);
  });

  it('records dropped candidates with the reason, not just the survivors', async () => {
    const overlapping = [
      passage({
        chunk_id: 'a',
        document_id: 'd1',
        char_start: 0,
        char_end: 100,
      }),
      passage({
        chunk_id: 'b',
        document_id: 'd1',
        char_start: 80,
        char_end: 180,
      }),
      passage({
        chunk_id: 'c',
        document_id: 'd1',
        char_start: 200,
        char_end: 300,
      }),
      passage({
        chunk_id: 'd',
        document_id: 'd1',
        char_start: 400,
        char_end: 500,
      }),
      passage({
        chunk_id: 'e',
        document_id: 'd1',
        char_start: 600,
        char_end: 700,
      }),
    ];
    build(['d1'], [overlapping]);

    const result = await service.search({
      corpus: KbCorpus.WHATSAPP_QA,
      query: 'q',
      limit: 8,
    } as any);

    // Three returned (the per-document cap), one dropped for overlap, one for the cap.
    expect(result.passages.map((p) => p.chunk_id)).toEqual(['a', 'c', 'd']);
    expect(recorded()[1].map((p: any) => [p.chunkId, p.outcome])).toEqual([
      ['a', 'returned'],
      ['b', 'dropped_span_overlap'],
      ['c', 'returned'],
      ['d', 'returned'],
      ['e', 'dropped_document_cap'],
    ]);
  });

  it('logs one pass over the corpus, with null meaning there was nothing to search', async () => {
    // null vs 0 on secondPassHits: 0 means the corpus was searched and had nothing (a gap),
    // null that there were no documents to search. Collapsing them hides which happened.
    build(['d1', 'd2'], [[passage({ chunk_id: 'a' })]]);
    await service.search({
      corpus: KbCorpus.WHATSAPP_QA,
      query: 'q',
    } as any);
    expect(aiService.searchKnowledgeChunks).toHaveBeenCalledTimes(1);
    expect(recorded()[0]).toMatchObject({
      preferredDocumentCount: 0,
      restDocumentCount: 2,
      firstPassHits: 0,
      secondPassHits: 1,
    });
    expect(recorded()[1].map((p: any) => p.pass)).toEqual(['rest']);

    build([], []);
    await service.search({
      corpus: KbCorpus.WHATSAPP_QA,
      query: 'q',
    } as any);
    expect(recorded()[0].secondPassHits).toBeNull();
  });

  it('records a retrieval that found nothing', async () => {
    // The most diagnostically valuable row there is: reading the queries that returned
    // nothing is how a corpus gap gets found. A skipped row would hide exactly those.
    build(['d1'], [[]]);
    await service.search({
      corpus: KbCorpus.WHATSAPP_QA,
      query: 'nothing covers this',
    } as any);
    expect(retrievalRepository.record).toHaveBeenCalledTimes(1);
    expect(recorded()[0].returnedCount).toBe(0);
    expect(recorded()[1]).toEqual([]);
  });

  it('defaults the consumer to the admin preview rather than the agent', async () => {
    // An unattributed retrieval must not be filed as agent traffic — that is the population
    // the floor gets calibrated against.
    build(['d1'], [[]]);
    await service.search({
      corpus: KbCorpus.WHATSAPP_QA,
      query: 'q',
    } as any);
    expect(recorded()[0].consumer).toBe('admin_preview');
  });

  it('carries the session and consumer through when given them', async () => {
    build(['d1'], [[]]);
    await service.search({ corpus: KbCorpus.WHATSAPP_QA, query: 'q' } as any, {
      consumer: 'debrief' as any,
      sessionId: 'session-1',
      userId: 42,
    });
    expect(recorded()[0]).toMatchObject({
      consumer: 'debrief',
      sessionId: 'session-1',
      createdBy: 42,
    });
  });

  it('returns passages even when the log write fails', async () => {
    // Analytics are worth a table, not a retrieval. A locked table must not turn a working
    // search into a 500 for the admin who asked.
    build(['d1'], [[passage({ chunk_id: 'a' })]]);
    retrievalRepository.record.mockRejectedValue(new Error('table is locked'));

    const result = await service.search({
      corpus: KbCorpus.WHATSAPP_QA,
      query: 'q',
    } as any);

    expect(result.passages.map((p) => p.chunk_id)).toEqual(['a']);
  });
});
