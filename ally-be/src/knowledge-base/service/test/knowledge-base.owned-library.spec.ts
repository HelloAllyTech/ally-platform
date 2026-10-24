import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import {
  KbCorpus,
  KbDocumentScope,
  KbDocumentSourceType,
  KbRetrievalConsumer,
} from '../../enum/knowledge-base.enum';
import { KnowledgeBaseService } from '../knowledge-base.service';

/**
 * Tenant isolation for the Ally guide's library (plans/ally-guide/plan.md §7.14).
 *
 * The library holds the platform's documents beside each organisation's own protocols. The
 * failure these pin is always the same silent one: a learner at organisation A answered out
 * of organisation B's handbook — real prose, plausibly relevant, and nowhere on any screen.
 * So every layer is asserted on its own: the Postgres allow-list, the audience sent to the
 * vector search, the filter on what comes back, and the owner checks on every write.
 */

const LIB = KbCorpus.ALLY_GUIDE_LIBRARY;
const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const GLOBAL_DOC = 'aaaaaaaa-0000-4000-8000-000000000001';
const A_DOC = 'aaaaaaaa-0000-4000-8000-00000000000a';
const B_DOC = 'aaaaaaaa-0000-4000-8000-00000000000b';
const BUCKET = 'assets-bucket';

const passage = (documentId: string, over: Record<string, unknown> = {}) => ({
  chunk_id: `chunk-${documentId}`,
  document_id: documentId,
  document_title: `Title ${documentId}`,
  chunk_index: 0,
  text: `text of ${documentId}`,
  char_start: 0,
  char_end: 100,
  page_from: 0,
  page_to: 0,
  section_path: '',
  source_url: '',
  language: 'en',
  token_count: 20,
  similarity: 0.8,
  ...over,
});

describe('KnowledgeBaseService — the Ally guide library', () => {
  let service: KnowledgeBaseService;
  let documentRepository: Record<string, jest.Mock>;
  let documentTenantRepository: Record<string, jest.Mock>;
  let aiService: Record<string, jest.Mock>;
  let ingestProducer: { enqueue: jest.Mock };
  let retrievalRepository: { record: jest.Mock };
  let tenantRepository: { count: jest.Mock };

  /** What Postgres says each audience may read. */
  const allowedFor = (tenantId: string | null) =>
    new Map(
      tenantId === TENANT_A
        ? [
            [GLOBAL_DOC, { isGlobal: true }],
            [A_DOC, { isGlobal: false }],
          ]
        : tenantId === TENANT_B
          ? [
              [GLOBAL_DOC, { isGlobal: true }],
              [B_DOC, { isGlobal: false }],
            ]
          : [[GLOBAL_DOC, { isGlobal: true }]],
    );

  beforeEach(() => {
    jest.spyOn(ExecutionManager, 'getUserId').mockReturnValue(42 as any);
    documentRepository = {
      retrievableForAudience: jest.fn(async ({ tenantId }) =>
        allowedFor(tenantId),
      ),
      findOwned: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn((v: any) => ({ ...v, id: 'new-doc' })),
      save: jest.fn(async (v: any) => v),
      update: jest.fn(),
      list: jest.fn().mockResolvedValue({ documents: [], count: 0 }),
    };
    documentTenantRepository = {
      replaceForDocument: jest.fn(),
      tenantIdsByDocument: jest.fn().mockResolvedValue(new Map()),
      tenantIdsForDocument: jest.fn().mockResolvedValue([]),
    };
    aiService = {
      searchKnowledgeChunks: jest.fn().mockResolvedValue({ passages: [] }),
      deleteKnowledgeChunksByDocument: jest.fn(),
      setKnowledgeChunkAudience: jest.fn(),
    };
    ingestProducer = { enqueue: jest.fn() };
    retrievalRepository = { record: jest.fn().mockResolvedValue('r1') };
    tenantRepository = { count: jest.fn().mockResolvedValue(1) };
    const s3Service = {
      parseS3Url: (url: string) => {
        const match =
          /^https:\/\/([^.]+)\.s3\.[^.]+\.amazonaws\.com\/(.+)$/.exec(url);
        return match ? { bucket: match[1], key: match[2] } : null;
      },
    };
    // Positional order matches the constructor: document, chunk, documentTenant, ingest,
    // ai, s3, config, retrieval, tenant.
    service = new KnowledgeBaseService(
      documentRepository as any,
      {} as any,
      documentTenantRepository as any,
      ingestProducer as any,
      aiService as any,
      s3Service as any,
      { s3: { assetsBucket: BUCKET } } as any,
      retrievalRepository as any,
      tenantRepository as any,
    );
  });

  const searchAs = (tenantId: string | null) =>
    service.searchForAudience(
      { corpus: LIB, query: 'what do I do if a client mentions self-harm' },
      { tenantId },
      { consumer: KbRetrievalConsumer.ALLY_GUIDE },
    );

  describe('searchForAudience', () => {
    it("scopes a learner's search to the global documents and their own organisation's", async () => {
      await searchAs(TENANT_A);

      expect(documentRepository.retrievableForAudience).toHaveBeenCalledWith({
        corpus: LIB,
        tenantId: TENANT_A,
      });
      const [request, corpus] = aiService.searchKnowledgeChunks.mock.calls[0];
      expect(corpus).toBe(LIB);
      // The allow-list IS the query: organisation B's document is never asked about.
      expect(request.document_ids.sort()).toEqual([A_DOC, GLOBAL_DOC].sort());
      expect(request.document_ids).not.toContain(B_DOC);
      expect(request.audience).toEqual({
        tenant_id: TENANT_A,
        include_global: true,
      });
    });

    it('gives an anonymous visitor the global documents only', async () => {
      await searchAs(null);

      expect(documentRepository.retrievableForAudience).toHaveBeenCalledWith({
        corpus: LIB,
        tenantId: null,
      });
      const [request] = aiService.searchKnowledgeChunks.mock.calls[0];
      expect(request.document_ids).toEqual([GLOBAL_DOC]);
      expect(request.audience).toEqual({
        tenant_id: null,
        include_global: true,
      });
    });

    it('never searches unrestricted, for anyone', async () => {
      for (const tenantId of [TENANT_A, TENANT_B, null]) {
        await searchAs(tenantId);
      }
      for (const [request] of aiService.searchKnowledgeChunks.mock.calls) {
        expect(request.audience.unrestricted).toBeUndefined();
      }
    });

    it("drops another organisation's passage even if the vector index returns it", async () => {
      // The index and Postgres disagreeing — a stale audience on B's chunks — must not
      // become A's learner reading B's protocol.
      aiService.searchKnowledgeChunks.mockResolvedValue({
        passages: [passage(B_DOC, { similarity: 0.95 }), passage(A_DOC)],
      });

      const { passages } = await searchAs(TENANT_A);

      expect(passages.map((p) => p.document_id)).toEqual([A_DOC]);
      const [, rows] = retrievalRepository.record.mock.calls[0];
      expect(rows.map((r: any) => r.documentId)).not.toContain(B_DOC);
    });

    it('labels each passage global or organisation from Postgres, not from the index', async () => {
      aiService.searchKnowledgeChunks.mockResolvedValue({
        passages: [passage(GLOBAL_DOC), passage(A_DOC)],
      });

      const { passages } = await searchAs(TENANT_A);

      expect(
        Object.fromEntries(passages.map((p) => [p.document_id, p.scope])),
      ).toEqual({
        [GLOBAL_DOC]: KbDocumentScope.GLOBAL,
        [A_DOC]: KbDocumentScope.ORGANISATION,
      });
    });

    it('asks ally-ai nothing when the audience can read no document', async () => {
      documentRepository.retrievableForAudience.mockResolvedValue(new Map());

      const { passages } = await searchAs(TENANT_A);

      expect(passages).toEqual([]);
      expect(aiService.searchKnowledgeChunks).not.toHaveBeenCalled();
    });

    it('refuses a malformed organisation id rather than quietly searching global only', async () => {
      await expect(searchAs('')).rejects.toThrow(/organisation id or null/);
      await expect(searchAs('acme')).rejects.toThrow(/organisation id or null/);
      expect(aiService.searchKnowledgeChunks).not.toHaveBeenCalled();
    });

    it("logs under Ally's consumer, with the query withheld as sensitive", async () => {
      await searchAs(TENANT_A);

      const [row] = retrievalRepository.record.mock.calls[0];
      expect(row.consumer).toBe(KbRetrievalConsumer.ALLY_GUIDE);
      expect(row.querySensitive).toBe(true);
      expect(row.corpus).toBe(LIB);
    });
  });

  describe('search() on the library', () => {
    it('refuses any caller but the admin preview — there, no tenant means every organisation', async () => {
      await expect(
        service.search({ corpus: LIB, query: 'q' } as any),
      ).rejects.toThrow(/searchForAudience/);
      await expect(
        service.search({ corpus: LIB, query: 'q' } as any, {
          consumer: KbRetrievalConsumer.ALLY_GUIDE,
        }),
      ).rejects.toThrow(/searchForAudience/);
      expect(aiService.searchKnowledgeChunks).not.toHaveBeenCalled();
    });

    it('still answers the admin preview, asked for by name', async () => {
      documentRepository.retrievableIds = jest
        .fn()
        .mockResolvedValue({ preferred: [], rest: [GLOBAL_DOC] });

      await service.search({ corpus: LIB, query: 'q' } as any, {
        consumer: KbRetrievalConsumer.ADMIN_PREVIEW,
      });

      expect(aiService.searchKnowledgeChunks).toHaveBeenCalled();
    });
  });

  describe('writes', () => {
    const pasted = {
      title: 'Escalation protocol',
      sourceType: KbDocumentSourceType.PASTE,
      text: 'Call the duty supervisor first.',
    };

    it("files an organisation's document as theirs, readable by them only", async () => {
      const result = await service.createOwned(
        { corpus: LIB, tenantId: TENANT_A },
        pasted as any,
      );

      expect(documentRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          corpus: LIB,
          isGlobal: false,
          ownerTenantId: TENANT_A,
        }),
      );
      expect(documentTenantRepository.replaceForDocument).toHaveBeenCalledWith(
        'new-doc',
        [TENANT_A],
      );
      expect(result.ownerTenantId).toBe(TENANT_A);
    });

    it('files a platform document as global, with no owner and no organisations', async () => {
      await service.createOwned({ corpus: LIB, tenantId: null }, pasted as any);

      expect(documentRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ isGlobal: true, ownerTenantId: null }),
      );
      expect(
        documentTenantRepository.replaceForDocument,
      ).not.toHaveBeenCalled();
    });

    it("refuses a file uploaded into another organisation's folder", async () => {
      // Ingest reads the object with the backend's own credentials, so accepting B's
      // fileUrl on A's route would index B's upload into A's library.
      await expect(
        service.createOwned({ corpus: LIB, tenantId: TENANT_A }, {
          title: 'Handbook',
          sourceType: KbDocumentSourceType.PDF,
          contentType: 'application/pdf',
          fileUrl: `https://${BUCKET}.s3.eu-west-1.amazonaws.com/knowledge-base/${LIB}/${TENANT_B}/1-handbook.pdf`,
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(documentRepository.save).not.toHaveBeenCalled();
    });

    it('refuses a file from another bucket', async () => {
      await expect(
        service.createOwned({ corpus: LIB, tenantId: TENANT_A }, {
          title: 'Handbook',
          sourceType: KbDocumentSourceType.PDF,
          fileUrl: `https://other.s3.eu-west-1.amazonaws.com/knowledge-base/${LIB}/${TENANT_A}/1-x.pdf`,
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("accepts a file from the owner's own folder", async () => {
      await service.createOwned({ corpus: LIB, tenantId: TENANT_A }, {
        title: 'Handbook',
        sourceType: KbDocumentSourceType.PDF,
        contentType: 'application/pdf',
        fileUrl: `https://${BUCKET}.s3.eu-west-1.amazonaws.com/knowledge-base/${LIB}/${TENANT_A}/1-handbook.pdf`,
      } as any);

      expect(documentRepository.save).toHaveBeenCalled();
    });

    it('refuses URL import for organisation documents', async () => {
      await expect(
        service.createOwned({ corpus: LIB, tenantId: TENANT_A }, {
          title: 'Page',
          sourceType: KbDocumentSourceType.URL,
          sourceUrl: 'http://169.254.169.254/latest/meta-data',
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses a library document through the generic console', async () => {
      await expect(
        service.create({
          ...pasted,
          corpus: LIB,
          isGlobal: false,
          tenantIds: [TENANT_A, TENANT_B],
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(documentRepository.save).not.toHaveBeenCalled();
    });

    it("refuses to retarget a library document's audience", async () => {
      documentRepository.findOne.mockResolvedValue({
        id: A_DOC,
        corpus: LIB,
        isGlobal: false,
        ownerTenantId: TENANT_A,
      });

      await expect(
        service.setAudience(A_DOC, { isGlobal: false, tenantIds: [TENANT_B] }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(
        documentTenantRepository.replaceForDocument,
      ).not.toHaveBeenCalled();
      expect(aiService.setKnowledgeChunkAudience).not.toHaveBeenCalled();
    });
  });

  describe('scoped removal and listing', () => {
    it('is a 404 for a document this owner does not own, and touches nothing', async () => {
      documentRepository.findOwned.mockResolvedValue(null);

      await expect(
        service.archiveOwned({ corpus: LIB, tenantId: TENANT_A }, B_DOC),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        service.archiveOwned({ corpus: LIB, tenantId: null }, A_DOC),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(documentRepository.findOwned).toHaveBeenCalledWith(B_DOC, {
        corpus: LIB,
        tenantId: TENANT_A,
      });
      expect(documentRepository.findOwned).toHaveBeenCalledWith(A_DOC, {
        corpus: LIB,
        tenantId: null,
      });
      expect(aiService.deleteKnowledgeChunksByDocument).not.toHaveBeenCalled();
      expect(documentRepository.update).not.toHaveBeenCalled();
    });

    it('archives a document the owner does own', async () => {
      const own = { id: A_DOC, corpus: LIB, isGlobal: false };
      documentRepository.findOwned.mockResolvedValue(own);
      documentRepository.findOne.mockResolvedValue(own);

      await service.archiveOwned({ corpus: LIB, tenantId: TENANT_A }, A_DOC);

      expect(aiService.deleteKnowledgeChunksByDocument).toHaveBeenCalledWith(
        A_DOC,
        LIB,
      );
    });

    it("lists one owner's documents only, never archived ones", async () => {
      await service.listOwned({ corpus: LIB, tenantId: TENANT_A }, {});
      await service.listOwned({ corpus: LIB, tenantId: null }, {});

      expect(documentRepository.list.mock.calls[0][0]).toEqual(
        expect.objectContaining({
          corpus: LIB,
          owner: { tenantId: TENANT_A },
          includeArchived: false,
        }),
      );
      expect(documentRepository.list.mock.calls[1][0]).toEqual(
        expect.objectContaining({ owner: { tenantId: null } }),
      );
    });

    it('refuses owner-scoped calls on a corpus without owners', async () => {
      await expect(
        service.listOwned(
          { corpus: KbCorpus.WHATSAPP_QA, tenantId: TENANT_A },
          {},
        ),
      ).rejects.toThrow(/not a corpus whose documents have owners/);
    });
  });
});
