import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Tenant } from 'src/tenant/entity/tenant.entity';
import { TenantScopeService } from 'src/authorization/service/tenant-scope.service';
import { AiService } from 'src/ai/service/ai.service';
import { KnowledgeAudienceRequest } from 'src/ai/dto/knowledge.dto';
import { S3Service } from 'src/aws/service/s3.service';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { AppConfigService } from 'src/config/config.service';
import { LoggerService } from 'src/logger/logger.service';
import { ConfigurationException } from 'src/exception/configuration.exception';
import {
  KB_DOCUMENT_S3_PREFIX,
  KB_MAX_FILE_SIZE_BYTES,
  KB_MAX_PASSAGES_PER_DOCUMENT,
  KB_MIN_SIMILARITY_DEFAULT,
  RETIRED_KB_CORPORA,
} from '../constants/knowledge-base.constants';
import {
  CreateKbDocumentDto,
  CreateKbOwnedDocumentDto,
  CreateKbUploadUrlDto,
  GetKbDocumentsQueryDto,
  GetKbStatsQueryDto,
  KbDocumentResponseDto,
  KbSearchDto,
  ReplaceKbDocumentContentDto,
  UpdateKbDocumentAudienceDto,
  UpdateKbDocumentDto,
} from '../dto/knowledge-base.dto';
import { KbDocument } from '../entity/kb-document.entity';
import {
  KbCorpus,
  KbDocumentSourceType,
  KbDocumentStatus,
  KbRetrievalConsumer,
  KbRetrievalPass,
} from '../enum/knowledge-base.enum';

/**
 * Who is retrieving, and on whose behalf. Not part of the DTO because none of it comes from
 * the request body — the consumer is decided by which code path called, and letting a client
 * assert it would let the admin preview file its experiments as agent traffic.
 */
export interface RetrievalContext {
  consumer?: KbRetrievalConsumer;
  sessionId?: string | null;
  userId?: number | null;
}

/** The source fields every document is created from, whichever route created it. */
type KbDocumentSource = Pick<
  CreateKbDocumentDto,
  | 'title'
  | 'sourceType'
  | 'text'
  | 'sourceUrl'
  | 'fileUrl'
  | 'fileName'
  | 'contentType'
  | 'sizeBytes'
  | 'language'
  | 'tags'
>;
import { KbIngestProducer } from '../producer/kb-ingest.producer';
import { KbDocumentChunkRepository } from '../repository/kb-document-chunk.repository';
import { KbDocumentTenantRepository } from '../repository/kb-document-tenant.repository';
import { KbDocumentRepository } from '../repository/kb-document.repository';
import { KbIngestService } from './kb-ingest.service';
import { shapeWithDecisions } from '../util/retrieval';
import {
  KbRetrievalRepository,
  RetrievalPassageRecord,
} from '../repository/kb-retrieval.repository';

/** MIME types accepted for an uploaded corpus document, mapped to their source type. */
const UPLOAD_CONTENT_TYPES: Record<string, KbDocumentSourceType> = {
  'application/pdf': KbDocumentSourceType.PDF,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    KbDocumentSourceType.DOCX,
  'application/epub+zip': KbDocumentSourceType.EPUB,
};

@Injectable()
export class KnowledgeBaseService {
  private readonly logger = LoggerService.getInstance(
    KnowledgeBaseService.name,
  );

  constructor(
    private readonly documentRepository: KbDocumentRepository,
    private readonly chunkRepository: KbDocumentChunkRepository,
    private readonly documentTenantRepository: KbDocumentTenantRepository,
    private readonly ingestProducer: KbIngestProducer,
    private readonly aiService: AiService,
    private readonly s3Service: S3Service,
    private readonly configService: AppConfigService,
    private readonly retrievalRepository: KbRetrievalRepository,
    // The Tenant entity's plain repository rather than TenantsRepository: this needs one
    // existence check, and importing the tenant module for it would couple two modules that
    // otherwise share nothing (and this codebase has a live circular-import DI trap).
    @InjectRepository(Tenant)
    private readonly tenantRepository: Repository<Tenant>,
    private readonly tenantScope: TenantScopeService,
  ) {}

  /**
   * The organisations an org-restricted admin may manage documents for; `null` for everyone
   * else. Keyed on `restricted`, not on the tenant list, so a background caller with no user (the
   * WhatsApp "create from unanswered" path runs inside an admin request, but ingest does not) is
   * never narrowed to whatever tenant the execution context happens to carry.
   */
  private async managedTenantIds(): Promise<string[] | null> {
    const scope = await this.tenantScope.resolveScope();
    return scope.restricted ? (scope.tenantIds ?? []) : null;
  }

  /**
   * An org-restricted admin may only target their own organisations: never the global corpus,
   * never nobody, never an organisation outside their allowlist.
   */
  private async assertAudienceManageable(
    isGlobal: boolean,
    tenantIds: string[],
  ): Promise<void> {
    const managed = await this.managedTenantIds();
    if (managed === null) return;
    if (isGlobal || !tenantIds.length) {
      throw new ForbiddenException(
        'Documents you add must be targeted at your organisation.',
      );
    }
    if (tenantIds.some((id) => !managed.includes(id))) {
      throw new ForbiddenException(
        'You can only target documents at your own organisations.',
      );
    }
  }

  private getBucket(): string {
    const bucket = this.configService.s3.assetsBucket;
    if (!bucket) {
      // Detail is logged, not returned — see ConfigurationException.
      throw new ConfigurationException(
        'S3 bucket name for assetsBucket (S3_ASSETS_BUCKET) is not defined; ' +
          'knowledge-base uploads cannot be stored.',
      );
    }
    return bucket;
  }

  private currentUserId(): number {
    const userId = ExecutionManager.getUserId();
    if (!userId) throw new BadRequestException('unauthorized access');
    return Number(userId);
  }

  private toResponse(
    entity: KbDocument,
    tenantIds: string[] = [],
  ): KbDocumentResponseDto {
    return {
      id: entity.id,
      corpus: entity.corpus,
      title: entity.title,
      sourceType: entity.sourceType,
      sourceUrl: entity.sourceUrl ?? null,
      fileName: entity.fileName ?? null,
      contentType: entity.contentType ?? null,
      sizeBytes:
        entity.sizeBytes === null || entity.sizeBytes === undefined
          ? null
          : Number(entity.sizeBytes),
      language: entity.language ?? null,
      tags: entity.tags ?? [],
      status: entity.status,
      statusMessage: entity.statusMessage ?? null,
      chunkCount: entity.chunkCount,
      indexedChunkCount: entity.indexedChunkCount,
      isGlobal: entity.isGlobal,
      // Empty for a global document even when rows exist. The rows are not consulted while
      // isGlobal is true, and returning them would invite a UI that renders a document
      // available to everyone as if it were restricted to three organisations.
      tenantIds: entity.isGlobal ? [] : tenantIds,
      ownerTenantId: entity.ownerTenantId ?? null,
      isArchived: entity.archivedAt != null,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }

  /**
   * A response with the document's organisations loaded.
   *
   * The single-document path. `list` loads a page's worth in one query instead — see there.
   */
  private async respond(entity: KbDocument): Promise<KbDocumentResponseDto> {
    if (entity.isGlobal) return this.toResponse(entity);
    const tenantIds = await this.documentTenantRepository.tenantIdsForDocument(
      entity.id,
    );
    return this.toResponse(entity, tenantIds);
  }

  /**
   * Reject organisation ids that do not exist, before anything is written.
   *
   * Checked rather than trusted because the ids reach a Weaviate filter, where a nonexistent one
   * is indistinguishable from a real one that simply never matches: the document would look
   * correctly targeted in the admin UI and be retrievable by nobody.
   */
  private async assertTenantsExist(tenantIds: string[]): Promise<void> {
    if (!tenantIds.length) return;
    const unique = [...new Set(tenantIds)];
    const found = await this.tenantRepository.count({
      where: { id: In(unique) },
    });
    if (found !== unique.length) {
      throw new BadRequestException(
        'One or more of those organisations no longer exists. Reload the page and pick again.',
      );
    }
  }

  /**
   * Push a document's audience onto its indexed chunks.
   *
   * Separate from the Postgres write, and deliberately AFTER it: Postgres is the system of record,
   * so a vector index that lags is recoverable (a reindex re-sends the audience with the chunks)
   * while a vector index that leads is not.
   *
   * Failures are RETHROWN as a 500 rather than logged. The half-applied state is the one that
   * matters: passages of a document still answering for an organisation an admin just removed,
   * on a screen that said the change was saved.
   */
  private async syncAudienceToIndex(
    document: KbDocument,
    tenantIds: string[],
  ): Promise<void> {
    try {
      await this.aiService.setKnowledgeChunkAudience(document.id, {
        is_global: document.isGlobal,
        tenant_ids: document.isGlobal ? [] : tenantIds,
      });
    } catch (error) {
      throw new InternalServerErrorException(
        `The organisations were saved, but the search index could not be updated, so ` +
          `retrieval may still use the previous audience. Use Retry on the document to ` +
          `re-index it: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }

  /**
   * Presigned PUT for an uploaded document.
   *
   * Presigned rather than a multipart POST through this API: `express.json({limit:'1mb'})` is
   * applied globally in main.ts, so a 40 MB upload would be rejected long before it reached a
   * controller. The browser PUTs straight to S3 and hands the resulting URL back on create.
   */
  async createUploadUrl(
    dto: CreateKbUploadUrlDto,
    folder: string = KB_DOCUMENT_S3_PREFIX,
  ) {
    const bucket = this.getBucket();
    if (!UPLOAD_CONTENT_TYPES[dto.contentType]) {
      throw new BadRequestException(
        'Only PDF, Word (.docx) and EPUB files can be uploaded. Paste text or use a URL for ' +
          'anything else.',
      );
    }
    this.currentUserId();

    const { presignedUrl, imageUrl } =
      await this.s3Service.getPresignedUrlForImageUpload(
        bucket,
        folder,
        dto.fileName,
        dto.fileSize,
        dto.contentType,
        KB_MAX_FILE_SIZE_BYTES,
      );

    return { presignedUrl, fileUrl: imageUrl };
  }

  /**
   * Create a document row and queue its ingest.
   *
   * Returns immediately at `pending`. Ingest is minutes of work for a large PDF, so doing it inline
   * would hold the admin's request open and lose the upload on any transient failure.
   */
  async create(dto: CreateKbDocumentDto): Promise<KbDocumentResponseDto> {
    const userId = this.currentUserId();
    this.validateSource(dto);

    const isGlobal = dto.isGlobal ?? false;
    const tenantIds = isGlobal ? [] : (dto.tenantIds ?? []);
    await this.assertAudienceManageable(isGlobal, tenantIds);
    await this.assertTenantsExist(tenantIds);

    return this.insertAndQueue(
      userId,
      dto,
      { corpus: dto.corpus },
      { isGlobal, tenantIds, ownerTenantId: null },
    );
  }

  /**
   * Write a document row and its organisations, then queue its ingest — the part every
   * create path shares once its own checks have passed.
   */
  private async insertAndQueue(
    userId: number,
    dto: KbDocumentSource,
    placement: { corpus: KbCorpus },
    audience: {
      isGlobal: boolean;
      tenantIds: string[];
      ownerTenantId: string | null;
      /** The chatbot the document belongs to (chunk 3d); absent for every other document. */
      ownerChatbotId?: string;
    },
  ): Promise<KbDocumentResponseDto> {
    const { isGlobal, tenantIds } = audience;
    const document = this.documentRepository.create({
      // Explicit, not left to the column default. The default exists for rows written before
      // this column did; a row written now must say which corpus it belongs to, or the day the
      // default changes every new document silently lands in the wrong one.
      corpus: placement.corpus,
      title: dto.title.trim(),
      sourceType: dto.sourceType,
      sourceUrl: dto.sourceUrl ?? null,
      fileUrl: dto.fileUrl ?? null,
      fileName: dto.fileName ?? null,
      contentType: dto.contentType ?? null,
      sizeBytes: dto.sizeBytes ?? null,
      language: dto.language ?? null,
      tags: dto.tags ?? [],
      isGlobal,
      ownerTenantId: audience.ownerTenantId,
      ownerChatbotId: audience.ownerChatbotId ?? null,
      // Pasted text is stored up front so the row is self-sufficient; the extractor still runs over
      // it to derive sections, and every other source type fills this in during ingest.
      rawText:
        dto.sourceType === KbDocumentSourceType.PASTE ? (dto.text ?? '') : '',
      contentHash: '',
      status: KbDocumentStatus.PENDING,
      chunkVersion: 1,
      createdBy: userId,
    });

    const saved = await this.documentRepository.save(document);
    // Written BEFORE the ingest is queued, so the consumer that indexes the chunks reads the
    // final audience and stamps it onto every one of them. Queued first, the first generation of
    // chunks would carry an empty audience and the document would be retrievable by nobody until
    // something happened to re-index it.
    if (tenantIds.length) {
      await this.documentTenantRepository.replaceForDocument(
        saved.id,
        tenantIds,
      );
    }

    // The row is committed before the message is sent, so a failed enqueue would otherwise
    // leave a phantom: a document sitting at PENDING that no consumer will ever pick up,
    // rendering in the corpus as "Queued" forever. That is not hypothetical — the ingest queue
    // was unprovisioned in production for the knowledge base's entire life, so every upload
    // 500'd AND left one of these behind, and the only way to notice was to read the table.
    //
    // Marked FAILED with the real reason rather than deleted: the admin asked for this
    // document, and a row they can see and retry is more use than a silent disappearance. The
    // error is still surfaced, so the request does not pretend to have succeeded.
    try {
      await this.ingestProducer.enqueue({
        documentId: saved.id,
        action: 'ingest',
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown queueing failure';
      await this.documentRepository.update(
        { id: saved.id },
        {
          status: KbDocumentStatus.FAILED,
          statusMessage: `Could not be queued for indexing: ${message}`,
        },
      );
      this.logger.error(
        `Knowledge-base document ${saved.id} saved but not queued: ${message}`,
      );
      throw error;
    }

    this.logger.info(`Knowledge-base document created: ${saved.id}`);
    return this.toResponse(saved, tenantIds);
  }

  private validateSource(dto: KbDocumentSource): void {
    switch (dto.sourceType) {
      case KbDocumentSourceType.PASTE:
        if (!dto.text?.trim()) {
          throw new BadRequestException(
            'Pasted documents need some body text.',
          );
        }
        return;
      case KbDocumentSourceType.URL:
        if (!dto.sourceUrl?.trim()) {
          throw new BadRequestException('URL documents need a source URL.');
        }
        return;
      default: {
        if (!dto.fileUrl?.trim()) {
          throw new BadRequestException(
            'Upload the file first, then create the document with the returned fileUrl.',
          );
        }
        const expected = dto.contentType
          ? UPLOAD_CONTENT_TYPES[dto.contentType]
          : undefined;
        if (expected && expected !== dto.sourceType) {
          // Catching this here rather than at extraction time means the admin is told at the point
          // they can still fix it, instead of watching the document fail a minute later.
          throw new BadRequestException(
            `The uploaded file is a ${expected} but the document was created as a ` +
              `${dto.sourceType}. Pick the matching type and try again.`,
          );
        }
      }
    }
  }

  async list(dto: GetKbDocumentsQueryDto) {
    const managed = await this.managedTenantIds();
    const { documents, count } = await this.documentRepository.list({
      ...(managed === null ? {} : { ownedByTenantIds: managed }),
      corpus: dto.corpus,
      limit: dto.limit,
      offset: dto.offset,
      search: dto.search,
      status: dto.status,
      sourceType: dto.sourceType,
      tags: dto.tags,
      tenantId: dto.tenantId,
      excludeGlobal: dto.excludeGlobal,
      includeArchived: dto.includeArchived,
      sortBy: dto.sortBy,
      sortDir: dto.sortDir,
    });

    // One query for the page's organisations rather than one per row: the corpus table renders
    // that cell on every line.
    const byDocument = await this.documentTenantRepository.tenantIdsByDocument(
      documents.filter((d) => !d.isGlobal).map((d) => d.id),
    );

    return {
      documents: documents.map((d) =>
        this.toResponse(d, byDocument.get(d.id) ?? []),
      ),
      count,
    };
  }

  /**
   * One document WITH its text, so the edit panel can show what the passages were cut from and
   * an admin can correct pasted text rather than retyping it. The list omits it.
   */
  async get(id: string): Promise<KbDocumentResponseDto> {
    const document = await this.findOrFail(id);
    return {
      ...(await this.respond(document)),
      rawText: document.rawText ?? '',
    };
  }

  /**
   * Retarget a document at one, some or all organisations.
   *
   * Deliberately NOT part of PATCH /documents/:id, which documents itself as metadata-only and
   * "never triggers a re-index". This one does touch the index — it rewrites the audience on
   * every chunk — so it is its own endpoint rather than a field that quietly behaves differently
   * from its neighbours.
   *
   * Order: validate, write Postgres, then push to the index. An archived document is allowed
   * through: archiving deleted its vectors, so the sweep updates nothing, and the audience is
   * waiting correctly for whenever it is unarchived and re-indexed.
   */
  async setAudience(
    id: string,
    dto: UpdateKbDocumentAudienceDto,
  ): Promise<KbDocumentResponseDto> {
    const document = await this.findOrFail(id);
    const userId = this.currentUserId();

    const tenantIds = dto.isGlobal ? [] : (dto.tenantIds ?? []);
    await this.assertAudienceManageable(dto.isGlobal, tenantIds);
    await this.assertTenantsExist(tenantIds);

    const { added, removed } =
      await this.documentTenantRepository.replaceForDocument(id, tenantIds);
    const globalChanged = document.isGlobal !== dto.isGlobal;

    if (globalChanged) {
      await this.documentRepository.update(
        { id },
        { isGlobal: dto.isGlobal, updatedBy: userId },
      );
    }

    const updated = { ...document, isGlobal: dto.isGlobal } as KbDocument;

    // Nothing changed, so nothing is swept. An admin who opens the panel and saves without
    // editing should not trigger hundreds of vector writes over a 300-page book.
    if (!globalChanged && !added.length && !removed.length) {
      return this.toResponse(updated, tenantIds);
    }

    await this.syncAudienceToIndex(updated, tenantIds);

    this.logger.info(
      `Document ${id} retargeted: isGlobal=${dto.isGlobal}, ` +
        `+${added.length}/-${removed.length} organisation(s)`,
    );
    return this.toResponse(updated, tenantIds);
  }

  /**
   * Load a document the caller may act on. For an org-restricted admin, a document that is
   * global or reaches any organisation outside their allowlist answers exactly like a missing
   * one — every per-document route goes through here, so none can touch another customer's.
   */
  private async findOrFail(id: string): Promise<KbDocument> {
    const document = await this.documentRepository.findOne({ where: { id } });
    // A document of a corpus retired into the Context Library is the retirement job's alone:
    // nothing here may re-index, retarget or archive it under a corpus this module no longer
    // has a profile for.
    if (!document || RETIRED_KB_CORPORA.includes(document.corpus)) {
      throw new NotFoundException(`Document ${id} was not found`);
    }
    const managed = await this.managedTenantIds();
    if (managed !== null) {
      const audience = document.isGlobal
        ? []
        : await this.documentTenantRepository.tenantIdsForDocument(id);
      if (
        !audience.length ||
        audience.some((tenantId) => !managed.includes(tenantId))
      ) {
        throw new NotFoundException(`Document ${id} was not found`);
      }
    }
    return document;
  }

  /** Metadata only — never triggers a re-index. */
  async update(
    id: string,
    dto: UpdateKbDocumentDto,
  ): Promise<KbDocumentResponseDto> {
    const document = await this.findOrFail(id);
    const userId = this.currentUserId();

    // A title change DOES leave the denormalised copy on already-indexed chunks stale. Accepted
    // deliberately: a citation naming a document's previous title still identifies the right
    // document, whereas re-indexing every chunk on a typo fix would be minutes of embedding work
    // for no retrieval gain. A Retry re-syncs it for anyone who cares.
    await this.documentRepository.update(
      { id },
      {
        ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
        ...(dto.tags !== undefined ? { tags: dto.tags } : {}),
        ...(dto.language !== undefined ? { language: dto.language } : {}),
        updatedBy: userId,
      },
    );

    return this.respond({ ...document, ...dto } as KbDocument);
  }

  /**
   * Replace a pasted document's body and re-index if it actually changed.
   *
   * Only pasted text is editable in place. For a file-backed document the file IS the content, so
   * changing it means uploading a new one — editing the extracted text would silently disagree with
   * the PDF an admin can still download.
   */
  async replaceContent(
    id: string,
    dto: ReplaceKbDocumentContentDto,
  ): Promise<KbDocumentResponseDto> {
    const document = await this.findOrFail(id);
    if (document.sourceType !== KbDocumentSourceType.PASTE) {
      throw new BadRequestException(
        'Only pasted documents can be edited here. Replace the file instead.',
      );
    }

    const text = dto.text.trim();
    const hash = KbIngestService.hash(text);
    if (hash === document.contentHash) {
      // Re-embedding hundreds of unchanged passages costs real money and time for no change in
      // behaviour, so an identical edit is a deliberate no-op.
      this.logger.info(
        `Content unchanged for document ${id}; skipping re-index`,
      );
      return this.respond(document);
    }

    await this.documentRepository.update(
      { id },
      {
        rawText: text,
        contentHash: hash,
        status: KbDocumentStatus.PENDING,
        statusMessage: null,
        updatedBy: this.currentUserId(),
      },
    );
    await this.ingestProducer.enqueue({ documentId: id, action: 'reindex' });

    return this.get(id);
  }

  /** Re-chunk and re-index from the retained rawText. Also the Retry action. */
  async reindex(id: string): Promise<KbDocumentResponseDto> {
    const document = await this.findOrFail(id);
    if (document.archivedAt) {
      throw new BadRequestException(
        'Unarchive this document before re-indexing it.',
      );
    }

    await this.documentRepository.update(
      { id },
      { status: KbDocumentStatus.PENDING, statusMessage: null },
    );
    // 'ingest' rather than 'reindex' when there is no retained text yet — a document that failed
    // during its first extraction has nothing to re-chunk and needs the file parsed again.
    await this.ingestProducer.enqueue({
      documentId: id,
      action: document.rawText ? 'reindex' : 'ingest',
    });

    return this.get(id);
  }

  /**
   * Archive: drop the vectors, keep every row.
   *
   * The document stops being retrievable immediately, but its chunks stay in Postgres so citations
   * already recorded in the conversation log still resolve to the exact passage that was quoted.
   * Deleting the rows would orphan that history.
   */
  async archive(id: string): Promise<KbDocumentResponseDto> {
    const document = await this.findOrFail(id);
    if (document.archivedAt) return this.respond(document);
    await this.archiveFound(document);
    return this.get(id);
  }

  /** Archive a document the caller has already found and checked. */
  private async archiveFound(document: KbDocument): Promise<void> {
    const { id } = document;
    try {
      await this.aiService.deleteKnowledgeChunksByDocument(id, document.corpus);
    } catch (error) {
      // Reported, not swallowed: if the vectors survive, an "archived" document keeps answering
      // questions, which is precisely what the admin just asked it to stop doing.
      throw new InternalServerErrorException(
        `Archived nothing — the search index could not be updated: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }

    await this.documentRepository.update(
      { id },
      {
        archivedAt: new Date(),
        indexedChunkCount: 0,
        updatedBy: this.currentUserId(),
      },
    );
  }

  /** Unarchive and re-index, since archiving deleted the vectors. */
  async unarchive(id: string): Promise<KbDocumentResponseDto> {
    const document = await this.findOrFail(id);
    if (!document.archivedAt) return this.respond(document);

    await this.documentRepository.update(
      { id },
      {
        archivedAt: null,
        status: KbDocumentStatus.PENDING,
        statusMessage: null,
        updatedBy: this.currentUserId(),
      },
    );
    await this.ingestProducer.enqueue({
      documentId: id,
      action: document.rawText ? 'reindex' : 'ingest',
    });
    return this.get(id);
  }

  /**
   * Hard delete is refused.
   *
   * Deleting a document orphans every citation recorded against it, so the conversation log would
   * show answers whose sources cannot be resolved. Archive removes it from retrieval, which is what
   * "delete" is nearly always intended to mean here.
   */
  async remove(id: string): Promise<never> {
    await this.findOrFail(id);
    throw new ConflictException(
      'Documents are archived rather than deleted, so citations already recorded in the ' +
        'conversation log keep resolving. Archive it instead.',
    );
  }

  /** A document's chunks — literally what the bot can see. */
  async listChunks(
    id: string,
    options: { limit?: number; offset?: number } = {},
  ) {
    const document = await this.findOrFail(id);
    const { chunks, count } = await this.chunkRepository.listForDocument(
      id,
      document.chunkVersion,
      options,
    );
    return {
      chunks: chunks.map((chunk) => ({
        id: chunk.id,
        chunkIndex: chunk.chunkIndex,
        text: chunk.text,
        charStart: chunk.charStart,
        charEnd: chunk.charEnd,
        pageFrom: chunk.pageFrom,
        pageTo: chunk.pageTo,
        sectionPath: chunk.sectionPath ?? null,
        tokenCount: chunk.tokenCount,
        uploadStatus: chunk.uploadStatus,
        uploadError: chunk.uploadError ?? null,
      })),
      count,
    };
  }

  /** Resolve one chunk — how the conversation log turns a citation into real text. */
  async getChunk(chunkId: string) {
    const chunk = await this.chunkRepository.findOne({
      where: { id: chunkId },
    });
    if (!chunk) {
      throw new NotFoundException(`Chunk ${chunkId} was not found`);
    }
    const document = await this.documentRepository.findOne({
      where: { id: chunk.documentId },
      select: ['id', 'title', 'sourceUrl', 'sourceType'],
    });
    return {
      id: chunk.id,
      documentId: chunk.documentId,
      documentTitle: document?.title ?? '',
      sourceUrl: document?.sourceUrl ?? null,
      chunkIndex: chunk.chunkIndex,
      text: chunk.text,
      pageFrom: chunk.pageFrom,
      pageTo: chunk.pageTo,
      sectionPath: chunk.sectionPath ?? null,
    };
  }

  /**
   * The unrestricted retrieval path — the admin retrieval preview. The WhatsApp answering
   * agent retrieves inside ally-ai with the same scope rules, for the contact's organisation.
   * (Searches for a learner — the Ally guide's library, Debrief's guidance — moved to the
   * Context Library, whose use cases carry the asker's audience.)
   *
   * Two things happen that a bare vector search does not do:
   *
   * 1. Scope becomes the query. `retrievableIds` resolves ONE corpus's indexed, unarchived
   *    document ids in Postgres and they travel as ally-ai's `document_ids`. There is no
   *    "search everything" branch to fall into — an empty id set returns no passages rather
   *    than the whole shared collection, which is the failure this shape exists to make
   *    impossible.
   * 2. The ranking is shaped for reading, not scoring — see `shapeWithDecisions`.
   *
   * One pass. The two-pass topic boost (mapped documents first, the rest as a top-up) served
   * only the character corpus, and went with it into the Context Library; the log keeps the
   * same shape, with the pass recorded as `rest`.
   *
   * And every retrieval is recorded — see `KbRetrieval`. Not for an audit trail: the numbers
   * above (the floor most of all) were chosen by reasoning, and the first measurement showed
   * the floor was one paraphrase from rejecting a direct hit. The log is how they stop being
   * guesses.
   */
  async search(dto: KbSearchDto, context: RetrievalContext = {}) {
    const startedAt = Date.now();
    const ids = await this.documentRepository.retrievableIds({
      corpus: dto.corpus,
      tags: dto.tags,
    });

    const limit = dto.limit ?? 8;
    const minSimilarity =
      dto.minSimilarity ?? KB_MIN_SIMILARITY_DEFAULT[dto.corpus];

    // WHO is asking, as distinct from WHICH documents are in scope. The corpus decides the
    // second (its ids travel as `document_ids`); this decides the first, and ally-ai refuses
    // a request that carries neither.
    //
    // Naming an organisation previews what one of its workers would actually retrieve — the
    // question an admin has when a customer reports a gap. Omitting it searches the corpus
    // regardless of targeting, which is right for a console whose job is to show what is
    // indexed, and is NOT what any worker gets. The WhatsApp answering path does not come
    // through here; it sends the contact's own organisation with its own call.
    const audience: KnowledgeAudienceRequest = dto.tenantId
      ? { tenant_id: dto.tenantId, include_global: true }
      : { unrestricted: true };

    // Over-fetch, because shaping only ever removes passages: asking for `limit` and then
    // dropping the overlapping neighbours would quietly return three passages for a limit of
    // eight. Capped so a large limit cannot turn into an unbounded ally-ai query.
    const fetchLimit = Math.min(limit * 3, 50);

    const raw = ids.length
      ? await this.searchDocuments(
          dto.corpus,
          dto.query,
          ids,
          fetchLimit,
          minSimilarity,
          audience,
        )
      : [];

    const { kept: passages, decisions } = shapeWithDecisions(raw, {
      limit,
      perDocumentLimit: KB_MAX_PASSAGES_PER_DOCUMENT,
    });

    this.logger.info(
      `[KB_RETRIEVAL] corpus=${dto.corpus} docs=${ids.length} ` +
        `min_similarity=${minSimilarity} raw=${raw.length} ` +
        `returned=${passages.length}/${limit}`,
    );

    await this.recordRetrieval(
      {
        corpus: dto.corpus,
        consumer: context.consumer ?? KbRetrievalConsumer.ADMIN_PREVIEW,
        query: dto.query,
        tags: dto.tags ?? [],
        minSimilarity,
        requestedLimit: limit,
        fetchLimit,
        // One pass over the corpus: no preferred bucket, and null when there was nothing to
        // search — the shape the WhatsApp bot's rows also have.
        preferredDocumentCount: 0,
        restDocumentCount: ids.length,
        firstPassHits: 0,
        secondPassHits: ids.length ? raw.length : null,
        returnedCount: passages.length,
        latencyMs: Date.now() - startedAt,
        sessionId: context.sessionId ?? null,
        createdBy: context.userId ?? null,
        // An admin's console query is not someone else's words, so it is not withheld. The
        // WhatsApp bot's rows arrive from ally-ai with this set.
        querySensitive: false,
      },
      decisions.map((decision, index) => ({
        chunkId: decision.passage.chunk_id,
        documentId: decision.passage.document_id,
        rank: index + 1,
        similarity: decision.passage.similarity,
        pass: KbRetrievalPass.REST,
        outcome: decision.outcome,
      })),
    );

    return { passages };
  }

  // ─────────────────────────────────────────────── a chatbot's own documents (chunk 3d)
  //
  // Uploaded on a chatbot's Knowledge tab, in the WhatsApp corpus, and seen and managed there
  // only. The caller (ChatbotService) checks that the user may edit that chatbot; these methods
  // only keep a document tied to its chatbot.

  private chatbotFolder(chatbotId: string): string {
    return `${KB_DOCUMENT_S3_PREFIX}/chatbots/${chatbotId}`;
  }

  /** Presigned upload into this chatbot's folder. */
  async createChatbotUploadUrl(chatbotId: string, dto: CreateKbUploadUrlDto) {
    return this.createUploadUrl(dto, this.chatbotFolder(chatbotId));
  }

  /**
   * Create a document that belongs to one chatbot and queue its ingest. Its audience is nobody
   * by targeting (not global, no organisations): it is reached only through the chatbot's own
   * `document_ids`, which is how a chatbot that answers from selected documents searches.
   */
  async createForChatbot(
    chatbotId: string,
    dto: CreateKbOwnedDocumentDto,
  ): Promise<KbDocumentResponseDto> {
    const userId = this.currentUserId();
    this.validateSource(dto);
    if (
      dto.sourceType !== KbDocumentSourceType.PASTE &&
      dto.sourceType !== KbDocumentSourceType.URL
    ) {
      this.assertIssuedFileUrl(
        dto.fileUrl ?? '',
        this.chatbotFolder(chatbotId),
      );
    }
    return this.insertAndQueue(
      userId,
      dto,
      { corpus: KbCorpus.WHATSAPP_QA },
      {
        isGlobal: false,
        tenantIds: [],
        ownerTenantId: null,
        ownerChatbotId: chatbotId,
      },
    );
  }

  /**
   * Remove one of this chatbot's own documents: an archive, as everywhere in this module. A
   * shared document, or another chatbot's, is the same 404 as a missing id.
   */
  async archiveForChatbot(chatbotId: string, id: string): Promise<void> {
    const document = await this.documentRepository.findOne({ where: { id } });
    if (!document || document.ownerChatbotId !== chatbotId) {
      throw new NotFoundException(`Document ${id} was not found`);
    }
    // Not `archive(id)`: its organisation check would refuse an organisation's editor, and a
    // chatbot's own document is targeted at no organisation. The chatbot check is the gate here.
    if (!document.archivedAt) await this.archiveFound(document);
  }

  /**
   * One document with its text, for a chatbot's Knowledge tab. The caller (ChatbotService) has
   * checked the document is on that chatbot, so the library's organisation check doesn't apply.
   */
  async getForChatbot(id: string): Promise<KbDocumentResponseDto> {
    const document = await this.documentRepository.findOne({ where: { id } });
    if (!document) throw new NotFoundException(`Document ${id} was not found`);
    return {
      ...(await this.respond(document)),
      rawText: document.rawText ?? '',
    };
  }

  /**
   * Rename one of this chatbot's own documents, or replace its text. New text is stored as the
   * document's text and it is trained again (re-chunked and re-indexed); unchanged text does
   * nothing. A PDF edited this way keeps no page numbers for its citations.
   */
  async updateForChatbot(
    chatbotId: string,
    id: string,
    dto: { title?: string; text?: string },
  ): Promise<KbDocumentResponseDto> {
    const document = await this.documentRepository.findOne({ where: { id } });
    if (!document || document.ownerChatbotId !== chatbotId) {
      throw new NotFoundException(`Document ${id} was not found`);
    }
    if (document.archivedAt) {
      throw new BadRequestException('This document has been removed.');
    }
    const userId = this.currentUserId();
    const patch: Partial<KbDocument> = { updatedBy: userId };
    if (dto.title !== undefined) patch.title = dto.title.trim();
    let retrain = false;
    if (dto.text !== undefined) {
      const text = dto.text.trim();
      const hash = KbIngestService.hash(text);
      if (hash !== document.contentHash) {
        Object.assign(patch, {
          rawText: text,
          contentHash: hash,
          status: KbDocumentStatus.PENDING,
          statusMessage: null,
        });
        retrain = true;
      }
    }
    await this.documentRepository.update({ id }, patch);
    if (retrain) {
      await this.ingestProducer.enqueue({ documentId: id, action: 'reindex' });
    }
    return this.getForChatbot(id);
  }

  private assertIssuedFileUrl(fileUrl: string, folder: string): void {
    const parsed = this.s3Service.parseS3Url(fileUrl);
    if (
      !parsed ||
      parsed.bucket !== this.getBucket() ||
      !parsed.key.startsWith(`${folder}/`)
    ) {
      throw new BadRequestException(
        'That file was not uploaded here. Upload it again from this page, then add it.',
      );
    }
  }

  /**
   * Persist one retrieval, and never let that failure become the caller's.
   *
   * Analytics are worth a table, not a retrieval. A full disk, a lock, a schema not yet
   * migrated on one instance — any of those would otherwise turn a working search into a 500
   * for an admin who asked a question, which is a straightforwardly worse product than having
   * no distribution to calibrate against. Warned rather than swallowed silently, so a log that
   * has quietly stopped writing is visible before someone builds a decision on the gap.
   */
  private async recordRetrieval(
    retrieval: Parameters<KbRetrievalRepository['record']>[0],
    passages: RetrievalPassageRecord[],
  ): Promise<void> {
    try {
      await this.retrievalRepository.record(retrieval, passages);
    } catch (error) {
      this.logger.warn(
        `[KB_RETRIEVAL] could not record the retrieval log: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }

  private async searchDocuments(
    corpus: KbCorpus,
    query: string,
    documentIds: string[],
    limit: number,
    minSimilarity: number,
    audience: KnowledgeAudienceRequest,
  ) {
    const response = await this.aiService.searchKnowledgeChunks(
      {
        query,
        limit,
        min_similarity: minSimilarity,
        // Scopes WITHIN the corpus — the corpus itself is the collection.
        document_ids: documentIds,
        // And WHO is asking, applied as a filter inside the query rather than to its
        // results.
        audience,
      },
      corpus,
    );
    return response.passages ?? [];
  }

  async stats(dto: GetKbStatsQueryDto) {
    const [byStatus, totals] = await Promise.all([
      this.documentRepository.countsByStatus(dto.corpus),
      this.documentRepository.totals(dto.corpus),
    ]);
    return {
      byStatus,
      totalChunks: totals.chunkCount,
      indexedChunks: totals.indexedChunkCount,
    };
  }
}
