import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { DataSource, Repository } from 'typeorm';
import { AiService } from 'src/ai/service/ai.service';
import { TenantScopeService } from 'src/authorization/service/tenant-scope.service';
import { S3Service } from 'src/aws/service/s3.service';
import { AppConfigService } from 'src/config/config.service';
import { ExtractedDocument } from 'src/knowledge-base/extractor';
import { LoggerService } from 'src/logger/logger.service';
import { ClSource } from '../entity/cl-source.entity';
import {
  ClCollectionId,
  ClSourceKind,
  ClSourceStatus,
} from '../enum/context-library.enum';
import { segmentDocument } from '../util/segment.util';
import { ClActor } from './context-chunk.service';
import { ContextUploadService, titleKey } from './context-upload.service';
import { ContextWorkerService } from './context-worker.service';

/**
 * A Knowledge Base corpus retired into the Context Library (PLAN.md §6.5). Literal values, not
 * `KbCorpus` members: the corpus value leaves the Knowledge Base's enum in the same phase, and
 * this job has to keep reading — and finally deleting — rows that still carry it.
 */
export interface KbCorpusMigration {
  /** `kb_documents.corpus` of the old documents. */
  corpus: string;
  /** Where they are distilled. */
  collectionId: ClCollectionId;
  /** The old corpus's Weaviate collection, dropped when it is retired. */
  retiredIndex: string;
  /** What the admin must type to retire it. */
  confirmation: string;
}

export const CHARACTER_CORPUS_MIGRATION: KbCorpusMigration = {
  corpus: 'character_library',
  collectionId: ClCollectionId.CHARACTER_INSIGHTS,
  retiredIndex: 'CharacterChunk',
  confirmation: 'retire character_library',
};

/** One stored passage of an old document, as the import reads it. */
export interface KbStoredChunk {
  text: string;
  char_start: number;
  char_end: number;
  page_from: number;
  page_to: number;
  section_path: string | null;
}

export interface KbImportStatus {
  corpus: string;
  collectionId: string;
  /** Every document still stored for the corpus, archived or not. */
  documents: number;
  /** Not archived and with passages: the documents the import distils. */
  importable: number;
  archived: number;
  /** Not archived but with no passages (ingest never finished): nothing to distil. */
  withoutPassages: number;
  notStarted: number;
  inProgress: number;
  /** Distilled into every target collection, with no failed part. */
  complete: number;
  /** Finished, but some parts failed: retry them, or cancel the source and import again. */
  withFailedParts: number;
  /** True once every importable document is complete — the only state retirement accepts. */
  importComplete: boolean;
}

export interface KbImportResult extends KbImportStatus {
  queued: number;
  alreadyImported: number;
  noText: number;
}

export interface KbRetireResult {
  indexDropped: boolean;
  documentsDeleted: number;
  passagesDeleted: number;
  filesDeleted: number;
  /** Files that could not be deleted. Their documents are kept, so a retry finds them. */
  filesFailed: number;
  retrievalLogsDeleted: number;
}

/**
 * A removed document's stored passages back into one text, for segmenting.
 *
 * Passages overlap their neighbours (the old chunker carried ~15% of each into the next), so a
 * passage that starts inside the text already covered is trimmed to the uncovered part —
 * otherwise every overlap would be distilled twice. That trim is only safe when a passage's
 * offsets agree with its length; one that does not is kept whole, which costs a repeated
 * sentence, never a lost one. Section paths become heading spans and page numbers page spans,
 * so segments keep their location metadata. Pure, so it is unit-tested directly.
 */
export function rebuildFromChunks(chunks: KbStoredChunk[]): ExtractedDocument {
  let text = '';
  const sections: ExtractedDocument['sections'] = [];
  const pages: ExtractedDocument['pages'] = [];
  let coveredTo = -1;

  for (const chunk of chunks) {
    let piece = chunk.text ?? '';
    const consistent =
      chunk.char_end - chunk.char_start === piece.length && chunk.char_end > 0;
    if (consistent && chunk.char_start < coveredTo) {
      piece = piece.slice(coveredTo - chunk.char_start);
    }
    if (consistent) coveredTo = Math.max(coveredTo, chunk.char_end);
    piece = piece.trim();
    if (!piece) continue;

    if (text) text += '\n\n';
    const start = text.length;
    text += piece;
    const end = text.length;

    const path = chunk.section_path?.trim() || null;
    const last = sections[sections.length - 1];
    if (path && last && last.path === path && last.end === start - 2) {
      last.end = end;
    } else if (path) {
      sections.push({ path, start, end });
    }

    if (chunk.page_from > 0) {
      const to = chunk.page_to > chunk.page_from ? chunk.page_to : 0;
      const mid = to ? start + Math.floor((end - start) / 2) : end;
      pages.push({ number: chunk.page_from, start, end: mid });
      if (to) pages.push({ number: to, start: mid, end });
    }
  }
  return { text, sections, pages };
}

/**
 * Old titles occasionally carry "… by First Last"; the library keeps no names. Two to four
 * capitalised words after a final "by", so a title such as "Stand by Me" is left alone.
 */
export function stripByline(title: string): string {
  return title
    .replace(/\s+by\s+[A-Z][\w.'-]*(?:\s+[A-Z][\w.'-]*){1,3}\s*$/, '')
    .trim();
}

/**
 * One-off jobs that move a retired Knowledge Base corpus into the Context Library (§6.5), and
 * then delete it.
 *
 * IMPORT is idempotent and writes no document text to Postgres or S3: it reads each old
 * document's stored passages with raw SQL (so it keeps working after the corpus value has left
 * the Knowledge Base's enum), creates one `kb_migration` source per document, and hands the
 * text to the upload path's own staging and queueing — Redis for at most a day — so the worker
 * distils it exactly as it would a dropped file. A document whose source exists (and was not
 * cancelled, archived or failed) is skipped, so running it twice queues nothing twice.
 *
 * RETIRE is the confirmed platform-admin action that deletes the old corpus: its Weaviate
 * collection, its stored files, and its documents, passages and retrieval logs. Refused until
 * the import reports complete, and without the exact confirmation phrase.
 */
@Injectable()
export class ContextKbImportService {
  private readonly logger = LoggerService.getInstance(
    ContextKbImportService.name,
  );

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(ClSource) private readonly sources: Repository<ClSource>,
    private readonly uploads: ContextUploadService,
    private readonly worker: ContextWorkerService,
    private readonly ai: AiService,
    private readonly s3: S3Service,
    private readonly config: AppConfigService,
    private readonly tenantScope: TenantScopeService,
  ) {}

  /** Both jobs act on platform-wide content: an organisation-restricted admin is refused. */
  private async assertPlatformAdmin(actor: ClActor): Promise<void> {
    if (actor.tenantId) {
      throw new ForbiddenException('Only a platform admin can do this.');
    }
    if (actor.userId != null) {
      const scope = await this.tenantScope.resolveTenantIds(actor.userId);
      if (scope !== null) {
        throw new ForbiddenException('Only a platform admin can do this.');
      }
    }
  }

  /** Stable per old document, so a second run finds the first run's source. */
  static importHash(migration: KbCorpusMigration, documentId: string): string {
    return createHash('sha256')
      .update(`kb_migration:${migration.corpus}:${documentId}`)
      .digest('hex');
  }

  private async oldDocuments(migration: KbCorpusMigration) {
    const rows: Array<{
      id: string;
      title: string;
      language: string | null;
      chunk_version: number;
      archived: boolean;
      passages: string;
    }> = await this.dataSource.query(
      `SELECT d.id, d.title, d.language, d.chunk_version,
              (d.archived_at IS NOT NULL) AS archived,
              (SELECT COUNT(*) FROM kb_document_chunks c
                WHERE c.document_id = d.id AND c.chunk_version = d.chunk_version) AS passages
         FROM kb_documents d
        WHERE d.corpus = $1
        ORDER BY d."createdAt" ASC`,
      [migration.corpus],
    );
    return rows.map((r) => ({
      ...r,
      passages: Number(r.passages),
      importable: !r.archived && Number(r.passages) > 0,
    }));
  }

  async status(
    migration: KbCorpusMigration = CHARACTER_CORPUS_MIGRATION,
  ): Promise<KbImportStatus> {
    const documents = await this.oldDocuments(migration);
    const importable = documents.filter((d) => d.importable);
    const hashes = importable.map((d) =>
      ContextKbImportService.importHash(migration, d.id),
    );
    const sourceRows: Array<{
      file_hash: string;
      status: ClSourceStatus;
      failed_runs: string;
    }> = hashes.length
      ? await this.dataSource.query(
          `SELECT s.file_hash, s.status,
                  (SELECT COUNT(*) FROM cl_segment_runs r
                    WHERE r.source_id = s.id AND r.status = 'failed') AS failed_runs
             FROM cl_sources s
            WHERE s.kind = $1 AND s.file_hash = ANY($2)
              AND s.status NOT IN ('cancelled', 'archived', 'failed')
            ORDER BY s.generation DESC`,
          [ClSourceKind.KB_MIGRATION, hashes],
        )
      : [];
    const byHash = new Map<string, (typeof sourceRows)[number]>();
    for (const row of sourceRows)
      if (!byHash.has(row.file_hash)) byHash.set(row.file_hash, row);

    let notStarted = 0;
    let inProgress = 0;
    let complete = 0;
    let withFailedParts = 0;
    for (const hash of hashes) {
      const row = byHash.get(hash);
      if (!row) notStarted++;
      else if (row.status !== ClSourceStatus.COMPLETE) inProgress++;
      else if (Number(row.failed_runs) > 0) withFailedParts++;
      else complete++;
    }
    return {
      corpus: migration.corpus,
      collectionId: migration.collectionId,
      documents: documents.length,
      importable: importable.length,
      archived: documents.filter((d) => d.archived).length,
      withoutPassages: documents.filter((d) => !d.archived && !d.passages)
        .length,
      notStarted,
      inProgress,
      complete,
      withFailedParts,
      importComplete: complete === importable.length,
    };
  }

  async import(
    actor: ClActor,
    migration: KbCorpusMigration = CHARACTER_CORPUS_MIGRATION,
  ): Promise<KbImportResult> {
    await this.assertPlatformAdmin(actor);
    const documents = (await this.oldDocuments(migration)).filter(
      (d) => d.importable,
    );
    let queued = 0;
    let alreadyImported = 0;
    let noText = 0;

    for (const [index, doc] of documents.entries()) {
      const fileHash = ContextKbImportService.importHash(migration, doc.id);
      const previous: Array<{ status: ClSourceStatus; generation: number }> =
        await this.dataSource.query(
          `SELECT status, generation FROM cl_sources
            WHERE kind = $1 AND file_hash = $2
            ORDER BY generation DESC`,
          [ClSourceKind.KB_MIGRATION, fileHash],
        );
      const live = previous.find(
        (p) =>
          ![
            ClSourceStatus.CANCELLED,
            ClSourceStatus.ARCHIVED,
            ClSourceStatus.FAILED,
          ].includes(p.status),
      );
      if (live) {
        alreadyImported++;
        continue;
      }

      const chunks: KbStoredChunk[] = await this.dataSource.query(
        `SELECT text, char_start, char_end, page_from, page_to, section_path
           FROM kb_document_chunks
          WHERE document_id = $1 AND chunk_version = $2
          ORDER BY chunk_index ASC`,
        [doc.id, doc.chunk_version],
      );
      const extracted = rebuildFromChunks(chunks);
      const title = stripByline(doc.title) || 'Untitled';
      const result = await this.uploads.queuePrepared({
        prepared: extracted.text.trim() ? segmentDocument(extracted) : [],
        targets: [migration.collectionId],
        source: {
          title,
          kind: ClSourceKind.KB_MIGRATION,
          language: doc.language ?? null,
          fileHash,
          titleKey: titleKey(title),
          ownerTenantId: null,
          pageCount: extracted.pages.length
            ? Math.max(...extracted.pages.map((p) => p.number))
            : 0,
          extractionWarnings: [
            `Imported from the retired ${migration.corpus} corpus.`,
          ],
          queuePosition: String(Date.now() * 1000 + index),
          generation: (previous[0]?.generation ?? 0) + 1,
          uploadedBy: actor.userId,
        },
      });
      if (result) queued++;
      else noText++;
    }

    if (queued) this.worker.kick();
    this.logger.info(
      `Knowledge Base import (${migration.corpus} → ${migration.collectionId}): ` +
        `${queued} queued, ${alreadyImported} already imported, ${noText} without text`,
    );
    return {
      ...(await this.status(migration)),
      queued,
      alreadyImported,
      noText,
    };
  }

  /**
   * Delete the old corpus. Order matters for a retry: the index is dropped first (nothing
   * reads it any more, and dropping it twice is a no-op), then each document's stored file,
   * then the rows — only for documents whose file is gone, so a file that failed to delete
   * keeps the row that points at it, and running this again finishes the job.
   */
  async retire(
    confirm: string,
    actor: ClActor,
    migration: KbCorpusMigration = CHARACTER_CORPUS_MIGRATION,
  ): Promise<KbRetireResult> {
    await this.assertPlatformAdmin(actor);
    if ((confirm ?? '').trim() !== migration.confirmation) {
      throw new BadRequestException(
        `Nothing was deleted. To confirm, send "${migration.confirmation}".`,
      );
    }
    const status = await this.status(migration);
    if (!status.importComplete) {
      throw new ConflictException(
        `Nothing was deleted: the import into ${migration.collectionId} has not finished ` +
          `(${status.complete} of ${status.importable} documents complete).`,
      );
    }

    let indexDropped = false;
    try {
      const response = await this.ai.dropRetiredKnowledgeCollection(
        migration.retiredIndex,
      );
      indexDropped = Boolean(response?.deleted);
    } catch (error) {
      throw new InternalServerErrorException(
        `Nothing was deleted: the old search index could not be dropped (${
          error instanceof Error ? error.message : 'unknown error'
        }). Try again.`,
      );
    }

    const files: Array<{ id: string; file_url: string | null }> =
      await this.dataSource.query(
        `SELECT id, file_url FROM kb_documents WHERE corpus = $1`,
        [migration.corpus],
      );
    const bucket = this.config.s3.assetsBucket;
    const removable: string[] = [];
    let filesDeleted = 0;
    let filesFailed = 0;
    for (const row of files) {
      const parsed = row.file_url ? this.s3.parseS3Url(row.file_url) : null;
      // Only objects this platform stored; a URL pointing anywhere else is not ours to delete.
      if (parsed && bucket && parsed.bucket === bucket) {
        try {
          await this.s3.deleteObject({ bucket, key: parsed.key });
          filesDeleted++;
        } catch (error) {
          filesFailed++;
          this.logger.warn(
            `Retiring ${migration.corpus}: the file of document ${row.id} could not be deleted: ${
              error instanceof Error ? error.message : 'unknown error'
            }`,
          );
          continue;
        }
      }
      removable.push(row.id);
    }

    const deleted = await this.dataSource.transaction(async (manager) => {
      const count = async (sql: string, params: unknown[]) => {
        const result = await manager.query(sql, params);
        return Array.isArray(result) && typeof result[1] === 'number'
          ? result[1]
          : 0;
      };
      if (!removable.length) {
        return {
          passages: 0,
          documents: 0,
          logs: filesFailed
            ? 0
            : await count(`DELETE FROM kb_retrievals WHERE corpus = $1`, [
                migration.corpus,
              ]),
        };
      }
      const passages = await count(
        `DELETE FROM kb_document_chunks WHERE document_id = ANY($1::uuid[])`,
        [removable],
      );
      await count(
        `DELETE FROM kb_document_tenants WHERE document_id = ANY($1::uuid[])`,
        [removable],
      );
      const documents = await count(
        `DELETE FROM kb_documents WHERE id = ANY($1::uuid[]) AND corpus = $2`,
        [removable, migration.corpus],
      );
      // The retrieval log (and, by cascade, its passages and judgments) goes once nothing of
      // the corpus is left for a retry to finish.
      const logs = filesFailed
        ? 0
        : await count(`DELETE FROM kb_retrievals WHERE corpus = $1`, [
            migration.corpus,
          ]);
      return { passages, documents, logs };
    });

    this.logger.info(
      `Retired ${migration.corpus}: index dropped=${indexDropped}, ` +
        `${deleted.documents} documents, ${deleted.passages} passages, ` +
        `${filesDeleted} files deleted (${filesFailed} failed), ${deleted.logs} retrieval logs`,
    );
    return {
      indexDropped,
      documentsDeleted: deleted.documents,
      passagesDeleted: deleted.passages,
      filesDeleted,
      filesFailed,
      retrievalLogsDeleted: deleted.logs,
    };
  }
}
