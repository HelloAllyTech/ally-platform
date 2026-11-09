import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { ClCollectionId } from '../../enum/context-library.enum';
import {
  ALLY_GUIDE_CORPUS_MIGRATION,
  CHARACTER_CORPUS_MIGRATION,
  ContextKbImportService,
  DEBRIEF_CORPUS_MIGRATION,
  KbStoredChunk,
  rebuildFromChunks,
  stripByline,
} from '../context-kb-import.service';

jest.mock('src/logger/logger.service', () => ({
  LoggerService: {
    getInstance: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
  },
}));

const chunk = (over: Partial<KbStoredChunk>): KbStoredChunk => ({
  text: '',
  char_start: 0,
  char_end: 0,
  page_from: 0,
  page_to: 0,
  section_path: null,
  ...over,
});

describe('rebuildFromChunks', () => {
  const raw =
    'Speech changes slowly. Words go missing first. Then whole sentences trail off.';

  it('drops the overlap between neighbouring passages, so nothing is distilled twice', () => {
    const a = { start: 0, end: 46 }; // "Speech changes slowly. Words go missing first."
    const b = { start: 23, end: raw.length }; // overlaps "Words go missing first."
    const doc = rebuildFromChunks([
      chunk({
        text: raw.slice(a.start, a.end),
        char_start: a.start,
        char_end: a.end,
        section_path: 'How speech changes',
      }),
      chunk({
        text: raw.slice(b.start, b.end),
        char_start: b.start,
        char_end: b.end,
        section_path: 'How speech changes',
      }),
    ]);
    expect(doc.text).toBe(
      'Speech changes slowly. Words go missing first.\n\nThen whole sentences trail off.',
    );
    expect(doc.text.match(/Words go missing/g)).toHaveLength(1);
    // Consecutive passages under one heading become one section span.
    expect(doc.sections).toEqual([
      { path: 'How speech changes', start: 0, end: doc.text.length },
    ]);
  });

  it('keeps a passage whole when its offsets do not match its text', () => {
    const doc = rebuildFromChunks([
      chunk({ text: 'First idea.', char_start: 0, char_end: 11 }),
      chunk({ text: 'Second idea, longer.', char_start: 5, char_end: 9 }),
    ]);
    expect(doc.text).toBe('First idea.\n\nSecond idea, longer.');
  });

  it('turns page numbers into page spans, both ends of a page break included', () => {
    const doc = rebuildFromChunks([
      chunk({
        text: 'Alpha beta.',
        char_start: 0,
        char_end: 11,
        page_from: 3,
        page_to: 4,
      }),
    ]);
    expect(doc.pages.map((p) => p.number)).toEqual([3, 4]);
    expect(doc.pages[0].start).toBe(0);
    expect(doc.pages[1].end).toBe(doc.text.length);
  });
});

describe('stripByline', () => {
  it('drops a trailing "by Name", keeping the title', () => {
    expect(stripByline('Living With Memory Loss by Jane Q. Doe')).toBe(
      'Living With Memory Loss',
    );
    expect(stripByline('Stand by Me')).toBe('Stand by Me');
    expect(stripByline('Notes on caregiving')).toBe('Notes on caregiving');
  });
});

describe('ContextKbImportService', () => {
  const build = (
    opts: {
      docs?: any[];
      sources?: any[];
      previous?: any[];
      scope?: string[] | null;
      dropFails?: boolean;
      s3Fails?: boolean;
    } = {},
  ) => {
    const manager = { query: jest.fn().mockResolvedValue([[], 2]) };
    const dataSource = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes('FROM kb_documents d')) return opts.docs ?? [];
        if (sql.includes('failed_runs')) return opts.sources ?? [];
        if (sql.includes('SELECT status, generation FROM cl_sources'))
          return opts.previous ?? [];
        if (sql.includes('FROM kb_document_chunks'))
          return [
            {
              text: 'A whole observation about how a carer spends a morning.',
              char_start: 0,
              char_end: 55,
              page_from: 0,
              page_to: 0,
              section_path: 'Mornings',
            },
          ];
        if (sql.includes('SELECT id, file_url FROM kb_documents'))
          return [
            {
              id: 'doc-1',
              file_url:
                'https://assets.s3.eu-west-1.amazonaws.com/knowledge-base/a.pdf',
            },
          ];
        return [];
      }),
      transaction: jest.fn(async (fn: any) => fn(manager)),
    };
    const uploads = {
      queuePrepared: jest.fn().mockResolvedValue({
        source: { id: 's1' },
        segments: 1,
        runs: 1,
        estimate: 0.01,
      }),
    };
    const worker = { kick: jest.fn() };
    const ai = {
      dropRetiredKnowledgeCollection: opts.dropFails
        ? jest.fn().mockRejectedValue(new Error('ally-ai down'))
        : jest.fn().mockResolvedValue({ deleted: true }),
    };
    const s3 = {
      parseS3Url: jest.fn(() => ({
        bucket: 'assets',
        key: 'knowledge-base/a.pdf',
      })),
      deleteObject: opts.s3Fails
        ? jest.fn().mockRejectedValue(new Error('denied'))
        : jest.fn().mockResolvedValue({}),
    };
    const config = { s3: { assetsBucket: 'assets' } };
    const tenantScope = {
      resolveTenantIds: jest
        .fn()
        .mockResolvedValue(opts.scope === undefined ? null : opts.scope),
    };
    const service = new ContextKbImportService(
      dataSource as any,
      {} as any,
      uploads as any,
      worker as any,
      ai as any,
      s3 as any,
      config as any,
      tenantScope as any,
    );
    return { service, dataSource, manager, uploads, worker, ai, s3 };
  };

  const doc = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    title: `Document ${id}`,
    language: 'en',
    chunk_version: 1,
    archived: false,
    passages: '3',
    ...over,
  });
  const actor = { userId: 1, tenantId: null };
  const hash = (id: string) =>
    ContextKbImportService.importHash(CHARACTER_CORPUS_MIGRATION, id);

  it('queues one kb_migration source per document into Character Insights, and kicks the worker', async () => {
    const { service, uploads, worker } = build({ docs: [doc('a')] });
    const result = await service.import(actor);

    expect(result.queued).toBe(1);
    const [args] = uploads.queuePrepared.mock.calls[0];
    expect(args.targets).toEqual([ClCollectionId.CHARACTER_INSIGHTS]);
    expect(args.source).toMatchObject({
      kind: 'kb_migration',
      fileHash: hash('a'),
      ownerTenantId: null,
      generation: 1,
    });
    // The text goes to the staging path, never onto the source row.
    expect(JSON.stringify(args.source)).not.toContain('carer');
    expect(args.prepared[0].text).toContain('carer');
    expect(worker.kick).toHaveBeenCalled();
  });

  it('is idempotent: a document with a live source is skipped', async () => {
    const { service, uploads, worker } = build({
      docs: [doc('a')],
      previous: [{ status: 'extracting', generation: 1 }],
    });
    const result = await service.import(actor);
    expect(result.alreadyImported).toBe(1);
    expect(uploads.queuePrepared).not.toHaveBeenCalled();
    expect(worker.kick).not.toHaveBeenCalled();
  });

  it('imports again, as a new generation, after a cancelled attempt', async () => {
    const { service, uploads } = build({
      docs: [doc('a')],
      previous: [{ status: 'cancelled', generation: 1 }],
    });
    await service.import(actor);
    expect(uploads.queuePrepared.mock.calls[0][0].source.generation).toBe(2);
  });

  it('skips archived documents and ones with no passages', async () => {
    const { service, uploads } = build({
      docs: [doc('a', { archived: true }), doc('b', { passages: '0' })],
    });
    const result = await service.import(actor);
    expect(uploads.queuePrepared).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      documents: 2,
      importable: 0,
      archived: 1,
      withoutPassages: 1,
    });
  });

  it('refuses an organisation-restricted admin', async () => {
    const { service } = build({ docs: [doc('a')], scope: ['t1'] });
    await expect(service.import(actor)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('reports complete only when every importable document is distilled with no failed part', async () => {
    const incomplete = build({
      docs: [doc('a'), doc('b')],
      sources: [
        { file_hash: hash('a'), status: 'complete', failed_runs: '0' },
        { file_hash: hash('b'), status: 'complete', failed_runs: '2' },
      ],
    });
    expect(await incomplete.service.status()).toMatchObject({
      complete: 1,
      withFailedParts: 1,
      importComplete: false,
    });

    const done = build({
      docs: [doc('a')],
      sources: [{ file_hash: hash('a'), status: 'complete', failed_runs: '0' }],
    });
    expect((await done.service.status()).importComplete).toBe(true);
  });

  describe('retire', () => {
    const finished = {
      docs: [doc('doc-1')],
      sources: [
        { file_hash: hash('doc-1'), status: 'complete', failed_runs: '0' },
      ],
    };

    it('deletes nothing without the exact confirmation', async () => {
      const { service, ai, dataSource } = build(finished);
      await expect(service.retire('yes', actor)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(ai.dropRetiredKnowledgeCollection).not.toHaveBeenCalled();
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('deletes nothing until the import is complete', async () => {
      const { service, ai } = build({ docs: [doc('doc-1')], sources: [] });
      await expect(
        service.retire('retire character_library', actor),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(ai.dropRetiredKnowledgeCollection).not.toHaveBeenCalled();
    });

    it('drops the old index, deletes the files, then the rows and logs', async () => {
      const { service, ai, s3, manager } = build(finished);
      const result = await service.retire('retire character_library', actor);

      expect(ai.dropRetiredKnowledgeCollection).toHaveBeenCalledWith(
        'CharacterChunk',
      );
      expect(s3.deleteObject).toHaveBeenCalledWith({
        bucket: 'assets',
        key: 'knowledge-base/a.pdf',
      });
      const statements = manager.query.mock.calls.map(([sql]: [string]) => sql);
      expect(
        statements.some((q) => q.includes('DELETE FROM kb_document_chunks')),
      ).toBe(true);
      expect(
        statements.some((q) => q.includes('DELETE FROM kb_documents')),
      ).toBe(true);
      expect(
        statements.some((q) => q.includes('DELETE FROM kb_retrievals')),
      ).toBe(true);
      expect(result).toMatchObject({
        indexDropped: true,
        filesDeleted: 1,
        filesFailed: 0,
      });
    });

    it('keeps a document whose file could not be deleted, so a retry finds it', async () => {
      const { service, manager } = build({ ...finished, s3Fails: true });
      const result = await service.retire('retire character_library', actor);
      expect(result.filesFailed).toBe(1);
      const statements = manager.query.mock.calls.map(([sql]: [string]) => sql);
      expect(
        statements.some((q) => q.includes('DELETE FROM kb_documents')),
      ).toBe(false);
      expect(
        statements.some((q) => q.includes('DELETE FROM kb_retrievals')),
      ).toBe(false);
    });

    it('deletes nothing when the old index cannot be dropped', async () => {
      const { service, s3, dataSource } = build({
        ...finished,
        dropFails: true,
      });
      await expect(
        service.retire('retire character_library', actor),
      ).rejects.toThrow(/Nothing was deleted/);
      expect(s3.deleteObject).not.toHaveBeenCalled();
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });
  });

  describe('a corpus copied word for word (phase 6)', () => {
    const copied = (
      id: string,
      passages: number,
      copiedCount: number,
      over: Record<string, unknown> = {},
    ) => ({
      id,
      archived: false,
      served: true,
      passages: String(passages),
      copied: String(copiedCount),
      ...over,
    });

    it('is complete only when every passage of every served document has its copy', async () => {
      const partial = build({
        docs: [
          copied('a', 3, 3),
          copied('b', 2, 1),
          copied('c', 4, 0, { served: false }),
          copied('d', 1, 0, { archived: true }),
        ],
      });
      expect(
        await partial.service.status(ALLY_GUIDE_CORPUS_MIGRATION),
      ).toMatchObject({
        corpus: 'ally_guide_library',
        documents: 4,
        importable: 2,
        complete: 1,
        inProgress: 1,
        notServed: 1,
        archived: 1,
        passages: 5,
        passagesCopied: 4,
        importComplete: false,
      });

      const done = build({ docs: [copied('a', 3, 3)] });
      expect(
        (await done.service.status(DEBRIEF_CORPUS_MIGRATION)).importComplete,
      ).toBe(true);
    });

    it('has nothing to queue', async () => {
      const { service, uploads } = build({ docs: [copied('a', 3, 0)] });
      await expect(
        service.import(actor, ALLY_GUIDE_CORPUS_MIGRATION),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(uploads.queuePrepared).not.toHaveBeenCalled();
    });

    it('retires only with its own phrase, dropping its own collection', async () => {
      const { service, ai } = build({ docs: [copied('doc-1', 2, 2)] });
      await expect(
        service.retire(
          'retire character_library',
          actor,
          ALLY_GUIDE_CORPUS_MIGRATION,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      await service.retire(
        'retire ally_guide_library',
        actor,
        ALLY_GUIDE_CORPUS_MIGRATION,
      );
      expect(ai.dropRetiredKnowledgeCollection).toHaveBeenCalledWith(
        'GuideLibraryChunk',
      );
    });

    it('refuses to retire Debrief guidance until every passage is copied', async () => {
      const { service, ai } = build({ docs: [copied('doc-1', 2, 1)] });
      await expect(
        service.retire(
          'retire debrief_knowledge',
          actor,
          DEBRIEF_CORPUS_MIGRATION,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(ai.dropRetiredKnowledgeCollection).not.toHaveBeenCalled();
    });
  });
});
