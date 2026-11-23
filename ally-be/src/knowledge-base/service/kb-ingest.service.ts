import { LimitsService } from 'src/billing/service/limits.service';
import { usageContext } from 'src/billing/context/usage-context';
import { UsageChannel, UsageKind } from 'src/billing/enum/billing.enum';
import { createHash } from 'crypto';
import {
  KB_PAUSED_MESSAGES,
  KB_PAUSED_PREFIX,
  creditPauseKind,
} from 'src/billing/util/credit-pause';
import { TEMPLATE_KNOWLEDGE_TAG } from '../constants/template-knowledge';
import { KnowledgeReviewService } from '../privacy/knowledge-review.service';
import { MIGRATION_COPY_TAG } from '../constants/migration-copy';
import { Injectable, Optional } from '@nestjs/common';
import { AiService } from 'src/ai/service/ai.service';
import { KnowledgeChunkItemRequest } from 'src/ai/dto/knowledge.dto';
import { S3Service } from 'src/aws/service/s3.service';
import { LoggerService } from 'src/logger/logger.service';
import {
  KB_CHUNK_PROFILES,
  KB_INDEX_BATCH_SIZE,
  KB_MAX_CHUNKS_PER_DOCUMENT,
} from '../constants/knowledge-base.constants';
import { KbDocument } from '../entity/kb-document.entity';
import {
  KbChunkUploadStatus,
  KbCorpus,
  KbDocumentSourceType,
  KbDocumentStatus,
} from '../enum/knowledge-base.enum';
import { ExtractedDocument, extractDocument } from '../extractor';
import { KbDocumentChunkRepository } from '../repository/kb-document-chunk.repository';
import { KbDocumentTenantRepository } from '../repository/kb-document-tenant.repository';
import { KbDocumentRepository } from '../repository/kb-document.repository';
import { Chunk, chunkDocument } from '../util/chunker';

/** The paused-job kind for indexing (stage 6, `credit_paused_jobs.kind`). */
export const INDEXING_JOB = 'indexing';
/** Stage 6: a document's status message while its indexing waits for credits. */
export const KB_PAUSED_OUT_OF_CREDITS = KB_PAUSED_MESSAGES.out_of_credits;
/** The resume sweep's name for documents left paused with no job row. */
export const KB_PAUSED_SWEEP = 'paused-documents';

/**
 * Runs one document from raw source to searchable passages.
 *
 * Walks `extracting → chunking → indexing → indexed`, persisting the stage on the row as it goes so
 * the admin table shows real progress rather than flipping from pending to done. Every failure sets
 * `status=failed` with an admin-readable `statusMessage`, because "Processing failed" makes an
 * encrypted PDF indistinguishable from an oversized one and the admin is the only person who can
 * fix either.
 */
@Injectable()
export class KbIngestService {
  private readonly logger = LoggerService.getInstance(KbIngestService.name);

  constructor(
    private readonly documentRepository: KbDocumentRepository,
    private readonly chunkRepository: KbDocumentChunkRepository,
    private readonly documentTenantRepository: KbDocumentTenantRepository,
    private readonly aiService: AiService,
    private readonly s3Service: S3Service,
    // CR1: owner-side runs and tokens (optional, so existing specs build without it).
    @Optional() private readonly limits?: LimitsService,
    // Stage 5: personal-data review before a chatbot's own document is indexed. Optional for specs.
    @Optional() private readonly review?: KnowledgeReviewService,
  ) {
    // Stage 6: indexing paused at $0 runs again once the builder has credits.
    this.limits?.onResume(INDEXING_JOB, async (job) => {
      const action = job.payload.action === 'reindex' ? 'reindex' : 'ingest';
      await this.run(String(job.payload.documentId), action);
    });
    this.limits?.onSweep(KB_PAUSED_SWEEP, () => this.resumePausedDocuments());
  }

  /**
   * Run again every document left waiting at a "Paused:" status message with no paused job to
   * resume it (its job was claimed but the run failed, or the pause row was never written). Its
   * own gate pauses it again if the reason still holds, so this is safe to repeat.
   */
  async resumePausedDocuments(limit = 200): Promise<number> {
    const rows: Array<{ id: string }> = await this.documentRepository.query(
      `SELECT d.id FROM kb_documents d
        WHERE d.status = $1 AND d.status_message LIKE $2 AND d.archived_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM credit_paused_jobs j
                           WHERE j.kind = $3 AND j.subject_id = d.id::text)
        ORDER BY d."updatedAt" LIMIT $4`,
      [KbDocumentStatus.PENDING, `${KB_PAUSED_PREFIX}%`, INDEXING_JOB, limit],
    );
    for (const row of rows) {
      // A document indexed before has text to re-chunk; the gate re-checks credits either way.
      await this.run(row.id, 'ingest');
    }
    return rows.length;
  }

  static hash(text: string): string {
    return createHash('sha256').update(text, 'utf8').digest('hex');
  }

  /**
   * Full ingest: extract, chunk, index.
   *
   * `reindex` skips extraction and re-chunks the retained rawText instead. That is the whole reason
   * rawText is kept: re-parsing a 300-page PDF to change a chunk size would be slow, could fail
   * differently the second time, and needs an S3 object that may no longer exist.
   */
  async run(documentId: string, action: 'ingest' | 'reindex'): Promise<void> {
    const document = await this.documentRepository.findOne({
      where: { id: documentId },
    });
    if (!document) {
      this.logger.warn(
        `Ingest skipped — document ${documentId} no longer exists`,
      );
      return;
    }
    if (document.archivedAt) {
      this.logger.info(`Ingest skipped — document ${documentId} is archived`);
      return;
    }

    try {
      // A reindex re-chunks the retained rawText and never re-parses the original file. It
      // therefore has no page or section spans — those exist only in an extraction result — so a
      // reindexed PDF loses its page-level citations and falls back to document-level ones. That
      // is the deliberate cost of not depending on an S3 object that may no longer be there;
      // re-uploading the file restores page numbers.
      //
      // The exception is an onboarded assistant's pasted document (Agents v2 chunk 20a-2): it has
      // no file, only the stored text, so extracting again is cheap and recovers its headings,
      // which it keeps inside their sections (`headingAware`). Everything else reindexes as before.
      const extracted: ExtractedDocument =
        action === 'reindex' &&
        document.rawText &&
        !(await this.headingAware(document))
          ? { text: document.rawText, pages: [], sections: [] }
          : await this.extract(document);

      // Stage 5: a chatbot's own document with personal data waits at `needs_review` for its
      // owner, and nothing is indexed (`extract` records when the source was read).
      if (await this.review?.holdIfPersonal(document, extracted.text)) {
        return;
      }

      // CR1: indexing's embeddings are billed to the document's creator and, when an assistant
      // uses it, that assistant. One run id per ingest, so a redelivered SQS message re-meters
      // nothing it already recorded.
      // Stage 3 (R4): the first indexing of an Ally template's knowledge copied onto a chatbot is
      // Ally's cost: its own kind, no creator, never charged to the builder. A later edit by the
      // builder re-indexes as their own document, as below.
      // Stage 5: the migration's per-chatbot copies of shared documents are charged to nobody yet.
      const templateCopy =
        action === 'ingest' &&
        ((document.tags ?? []).includes(TEMPLATE_KNOWLEDGE_TAG) ||
          (document.tags ?? []).includes(MIGRATION_COPY_TAG));
      const chatbotId = templateCopy
        ? (document.ownerChatbotId ?? (await this.chatbotUsing(document.id)))
        : await this.chatbotUsing(document.id);
      // CR1: re-indexing an assistant's document is an owner-side run. Counted here, never
      // refused: the request was already accepted and nobody is waiting on this queue.
      if (action === 'reindex' && chatbotId && document.createdBy) {
        void this.limits
          ?.countOwnerRun(
            document.createdBy,
            `indexing:${document.id}:${document.updatedAt?.getTime?.() ?? 0}`,
            'indexing',
          )
          .catch(() => undefined);
      }
      // Stage 6: a builder's indexing is paid from their free balance; at $0 it is PAUSED (kept
      // and resumed by the ledger once credits exist), never failed. Ally's template copy is not.
      let payerAccountId: string | null = null;
      if (chatbotId && !templateCopy && this.limits) {
        const gate = await this.limits.backgroundGate({
          kind: INDEXING_JOB,
          subjectId: document.id,
          creatorUserId: document.createdBy ?? null,
          chatbotId,
          runKey: `indexing:${document.id}:${document.updatedAt?.getTime?.() ?? 0}`,
          ownerRunKind: 'indexing',
          payload: { documentId: document.id, action },
        });
        if (!gate.ok && gate.paused) {
          const kind = creditPauseKind(gate.reason);
          this.logger.info(
            `Indexing of document ${document.id} paused (${gate.reason})`,
          );
          // The visible paused state (never failed): waiting, with its real reason. The ledger's
          // resume sweep runs it again once the reason no longer holds.
          await this.documentRepository.update(
            { id: document.id },
            {
              status: KbDocumentStatus.PENDING,
              statusMessage: KB_PAUSED_MESSAGES[kind],
            },
          );
          return;
        }
        if (gate.ok) payerAccountId = gate.accountId;
      }
      await usageContext.run(
        {
          runId: `${action}:${document.id}:${document.updatedAt?.getTime?.() ?? 0}`,
          channel: UsageChannel.OWNER,
          runKind: templateCopy ? UsageKind.TEMPLATE_INDEX : UsageKind.INDEXING,
          creatorUserId: templateCopy ? null : (document.createdBy ?? null),
          chatbotId,
          payerAccountId,
        },
        () => this.chunkAndIndex(document, extracted, action),
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown ingest failure';
      this.logger.error(`Ingest failed for document ${documentId}: ${message}`);
      await this.documentRepository.update(
        { id: documentId },
        { status: KbDocumentStatus.FAILED, statusMessage: message },
      );
      // Swallowed rather than rethrown: the failure is already recorded where the admin will see
      // it, and rethrowing would make SQS redeliver a document that will fail identically every
      // time until someone fixes the file. The Retry action re-queues it deliberately.
    }
  }

  /** An assistant that answers from this document, if any (the first, for CR1's attribution). */
  private async chatbotUsing(documentId: string): Promise<string | null> {
    try {
      const rows: Array<{ chatbot_id: string }> =
        await this.documentRepository.manager.query(
          `SELECT chatbot_id FROM chatbot_documents WHERE document_id = $1 ORDER BY "createdAt" LIMIT 1`,
          [documentId],
        );
      return rows[0]?.chatbot_id ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Extract text, persist it, and hand the whole result to the caller.
   *
   * The page and section spans are returned rather than persisted: they are only meaningful against
   * this exact rawText, so storing them separately would create a second thing that can drift out
   * of sync with the text their offsets refer to. Chunking consumes them in the same pass.
   */
  private async extract(document: KbDocument): Promise<ExtractedDocument> {
    await this.documentRepository.update(
      { id: document.id },
      { status: KbDocumentStatus.EXTRACTING, statusMessage: null },
    );

    const buffer = await this.loadSourceBuffer(document);
    const extracted = await extractDocument({
      sourceType: document.sourceType,
      buffer,
      text: document.rawText || undefined,
      sourceUrl: document.sourceUrl ?? undefined,
      headingsInSections: await this.headingAware(document),
    });

    await this.documentRepository.update(
      { id: document.id },
      {
        rawText: extracted.text,
        contentHash: KbIngestService.hash(extracted.text),
        // Stage 5: when the source was last read (staleness, "Read again").
        lastReadAt: new Date(),
        // Only fill in a title or language the admin left blank — never overwrite what they typed.
        ...(document.title.trim()
          ? {}
          : { title: extracted.title ?? 'Untitled' }),
        ...(document.language ? {} : { language: extracted.language ?? null }),
      },
    );

    return extracted;
  }

  /**
   * Whether a pasted document keeps its headings inside their sections (Agents v2 chunk 20a-2):
   * only an onboarded assistant's own documents (crawled pages, Owner notes), which only the v2
   * agent answers from. v1 can still answer for any bot (the platform switch and v2's fallback),
   * so every other document chunks exactly as before.
   */
  private async headingAware(document: KbDocument): Promise<boolean> {
    if (document.sourceType !== KbDocumentSourceType.PASTE) return false;
    if (document.tags?.includes('onboarding')) return true;
    if (!document.ownerChatbotId) return false;
    const rows = await this.documentRepository.manager.query<
      { safety_pack: string | null }[]
    >(`SELECT safety_pack FROM chatbots WHERE id = $1`, [
      document.ownerChatbotId,
    ]);
    return Boolean(rows[0]?.safety_pack);
  }

  /**
   * A document's text with its page spans, read without writing anything (onboarding, chunk 20a,
   * reads an upload for "What we learned"). Re-extracts the file, because page spans are never
   * stored; for a file that's gone, falls back to the stored text with no pages.
   */
  async readForOnboarding(documentId: string): Promise<{
    title: string;
    fileName: string | null;
    ownerChatbotId: string | null;
    extracted: ExtractedDocument;
  } | null> {
    const document = await this.documentRepository.findOne({
      where: { id: documentId },
    });
    if (!document || document.archivedAt) return null;
    let extracted: ExtractedDocument;
    try {
      extracted = await extractDocument({
        sourceType: document.sourceType,
        buffer: await this.loadSourceBuffer(document),
        text: document.rawText || undefined,
        sourceUrl: document.sourceUrl ?? undefined,
      });
    } catch {
      if (!document.rawText) throw new Error('The document could not be read');
      extracted = { text: document.rawText, pages: [], sections: [] };
    }
    return {
      title: document.title,
      fileName: document.fileName ?? null,
      ownerChatbotId: document.ownerChatbotId ?? null,
      extracted,
    };
  }

  private async loadSourceBuffer(
    document: KbDocument,
  ): Promise<Buffer | undefined> {
    const needsFile = [
      KbDocumentSourceType.PDF,
      KbDocumentSourceType.DOCX,
      KbDocumentSourceType.EPUB,
    ].includes(document.sourceType);
    if (!needsFile) return undefined;

    if (!document.fileUrl) {
      throw new Error(
        'The uploaded file is missing from this document — upload it again.',
      );
    }
    const parsed = this.s3Service.parseS3Url(document.fileUrl);
    if (!parsed) {
      throw new Error(
        `The stored file URL could not be parsed, so the file cannot be read back: ${document.fileUrl}`,
      );
    }
    return this.s3Service.getObjectBuffer(parsed);
  }

  /** Chunk the text and push every chunk to the vector index. */
  private async chunkAndIndex(
    document: KbDocument,
    extracted: ExtractedDocument,
    action: 'ingest' | 'reindex',
  ): Promise<void> {
    await this.documentRepository.update(
      { id: document.id },
      { status: KbDocumentStatus.CHUNKING },
    );

    // Sized by the corpus, not by the document: how big a passage should be is a property of
    // what will read it. `corpus` is immutable, so a document's chunks are stable.
    const chunks = chunkDocument(extracted, KB_CHUNK_PROFILES[document.corpus]);

    if (!chunks.length) {
      throw new Error(
        'This document produced no chunks — it appears to contain no readable prose.',
      );
    }
    if (chunks.length > KB_MAX_CHUNKS_PER_DOCUMENT) {
      // Explicit failure naming the real numbers, never a silent truncation: a truncated document
      // reads as fully indexed while most of it is unsearchable.
      throw new Error(
        `This document produced ${chunks.length.toLocaleString()} chunks, over the ` +
          `${KB_MAX_CHUNKS_PER_DOCUMENT.toLocaleString()} limit. Split it into parts and ` +
          `upload them separately.`,
      );
    }

    // A re-chunk becomes a NEW version. Chunk rows are never edited in place, so the text behind a
    // citation cannot change under a conversation that already quoted it.
    const chunkVersion =
      action === 'reindex' ? document.chunkVersion + 1 : document.chunkVersion;

    const rows = await this.persistChunks(document, chunks, chunkVersion);

    await this.documentRepository.update(
      { id: document.id },
      {
        status: KbDocumentStatus.INDEXING,
        chunkCount: rows.length,
        indexedChunkCount: 0,
        chunkVersion,
      },
    );

    // Delete the OLD generation's vectors before writing the new ones.
    //
    // This ordering is deliberate and it accepts a brief window where the document is not
    // retrievable. The alternative — write new, then delete old — has a window where BOTH
    // generations are retrievable, and a duplicated passage produces a confidently wrong citation
    // to text the document no longer contains. A missing passage merely produces an honest decline.
    await this.deleteVectors(document.id, document.corpus);

    const indexed = await this.indexChunks(document, rows, chunkVersion);

    if (action === 'reindex') {
      await this.chunkRepository.deleteOtherVersions(document.id, chunkVersion);
    }

    const failed = rows.length - indexed;
    await this.documentRepository.update(
      { id: document.id },
      {
        indexedChunkCount: indexed,
        status: failed ? KbDocumentStatus.FAILED : KbDocumentStatus.INDEXED,
        statusMessage: failed
          ? `${indexed} of ${rows.length} passages indexed; ${failed} failed. ` +
            `Use Retry to index the rest.`
          : null,
      },
    );

    this.logger.info(
      `Document ${document.id} indexed ${indexed}/${rows.length} chunk(s) at version ${chunkVersion}`,
    );
  }

  private async persistChunks(
    document: KbDocument,
    chunks: Chunk[],
    chunkVersion: number,
  ) {
    const entities = chunks.map((chunk) =>
      this.chunkRepository.create({
        documentId: document.id,
        chunkIndex: chunk.chunkIndex,
        text: chunk.text,
        charStart: chunk.charStart,
        charEnd: chunk.charEnd,
        pageFrom: chunk.pageFrom,
        pageTo: chunk.pageTo,
        sectionPath: chunk.sectionPath,
        tokenCount: chunk.tokenCount,
        textHash: KbIngestService.hash(chunk.text),
        uploadStatus: KbChunkUploadStatus.PENDING,
        chunkVersion,
      }),
    );
    // Chunked save: a single insert of 3000 rows can exceed the driver's parameter limit.
    const saved = [];
    for (let i = 0; i < entities.length; i += 500) {
      saved.push(
        ...(await this.chunkRepository.save(entities.slice(i, i + 500))),
      );
    }
    return saved;
  }

  private async deleteVectors(
    documentId: string,
    corpus: KbCorpus,
  ): Promise<void> {
    try {
      await this.aiService.deleteKnowledgeChunksByDocument(documentId, corpus);
    } catch (error) {
      // Surfaced, not swallowed: proceeding to write the new generation while the old one may
      // still be live is exactly the double-retrieval case the ordering above exists to avoid.
      throw new Error(
        `Could not clear the previous version from the search index, so indexing was stopped ` +
          `to avoid serving two versions of the same passage: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
      );
    }
  }

  /** Push chunks in batches, recording per-chunk outcomes. Returns how many landed. */
  private async indexChunks(
    document: KbDocument,
    rows: { id: string; [key: string]: any }[],
    chunkVersion: number,
  ): Promise<number> {
    // The audience is read ONCE and stamped onto every chunk of this generation. Read here
    // rather than passed in because ingest runs on a queue, potentially minutes after the
    // document was created — the audience as it stands now is the correct one, and a value
    // captured at enqueue time would be stale for exactly the admin who fixed a mis-targeted
    // document while it was still processing.
    const tenantIds = document.isGlobal
      ? []
      : await this.documentTenantRepository.tenantIdsForDocument(document.id);

    for (let i = 0; i < rows.length; i += KB_INDEX_BATCH_SIZE) {
      const batch = rows.slice(i, i + KB_INDEX_BATCH_SIZE);
      const items: KnowledgeChunkItemRequest[] = batch.map((row) => ({
        chunk_id: row.id,
        document_id: document.id,
        document_title: document.title,
        chunk_index: row.chunkIndex,
        text: row.text,
        char_start: row.charStart,
        char_end: row.charEnd,
        page_from: row.pageFrom,
        page_to: row.pageTo,
        section_path: row.sectionPath ?? '',
        source_url: document.sourceUrl ?? '',
        language: document.language ?? '',
        tags: document.tags ?? [],
        token_count: row.tokenCount,
        is_global: document.isGlobal,
        tenant_ids: tenantIds,
      }));

      try {
        const response = await this.aiService.bulkUpsertKnowledgeChunks(
          { items },
          document.corpus,
        );
        await this.chunkRepository.markIndexed(
          response.succeeded.map((s) => s.chunk_id),
        );
        if (response.failed.length) {
          await this.chunkRepository.markFailed(
            response.failed.map((f) => ({
              chunkId: f.chunk_id,
              error: f.error,
            })),
          );
        }
      } catch (error) {
        // A whole-batch transport failure is recorded per chunk so the retry path knows exactly
        // which passages are still missing rather than starting the document over.
        const message =
          error instanceof Error ? error.message : 'unknown indexing error';
        await this.chunkRepository.markFailed(
          batch.map((row) => ({ chunkId: row.id, error: message })),
        );
        this.logger.error(
          `Indexing batch failed for document ${document.id}: ${message}`,
        );
      }

      // Progress is written per batch, not at the end, so the admin sees 128/500 while it runs.
      const indexedSoFar = await this.chunkRepository.countIndexed(
        document.id,
        chunkVersion,
      );
      await this.documentRepository.update(
        { id: document.id },
        { indexedChunkCount: indexedSoFar },
      );
    }

    return this.chunkRepository.countIndexed(document.id, chunkVersion);
  }
}
