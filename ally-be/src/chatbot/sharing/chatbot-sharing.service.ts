import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { ExecutionManager } from '../../common/execution/execution-manager';
import { LoggerService } from '../../logger/logger.service';
import { TEMPLATE_KNOWLEDGE_TAG } from '../../knowledge-base/constants/template-knowledge';
import { KbIngestProducer } from '../../knowledge-base/producer/kb-ingest.producer';
import { ChatbotMemberRole } from '../enum/chatbot.enum';
import { ChatbotAccessService } from '../service/chatbot-access.service';

const currentUserId = (): number => Number(ExecutionManager.getUserId() ?? 0);

export interface CopiedDocuments {
  /** New document ids, owned by the target chatbot and queued for indexing. */
  documentIds: string[];
  /** Source documents skipped (already copied into the target). */
  skipped: number;
}

export interface DuplicateResult extends CopiedDocuments {
  chatbotId: string;
  quickReplies: number;
  lists: number;
}

export interface CuratedDocument {
  id: string;
  title: string;
  language: string | null;
  sourceType: string;
  updatedAt: Date;
}

export interface CopyJob {
  id: string;
  hasText: boolean;
  /** Forced action: the migration's copies are first indexed by `ingest` (charged to nobody). */
  action?: 'ingest' | 'reindex';
}

/**
 * Copy documents into `targetId` inside a transaction. The source is a chatbot (its own and
 * attached documents, optionally narrowed by `ids`) or, with `sourceId` null, exactly `ids`.
 * A document already copied into the target (same `copied_from_document_id`) is skipped.
 * Also used by the stage 5 migration script.
 */
export async function copyDocumentsTx(
  m: EntityManager,
  sourceId: string | null,
  targetId: string,
  userId: number,
  ids: string[] | null,
  options: { tag?: string; keepCreator?: boolean } = {},
): Promise<{ jobs: CopyJob[]; skipped: number }> {
  const sources = (await m.query(
    sourceId
      ? `SELECT d.id FROM kb_documents d
          WHERE d.archived_at IS NULL AND d.corpus = 'whatsapp_qa'
            AND (d.owner_chatbot_id = $1
                 OR d.id IN (SELECT document_id FROM chatbot_documents WHERE chatbot_id = $1))
            AND ($2::uuid[] IS NULL OR d.id = ANY($2::uuid[]))`
      : `SELECT d.id FROM kb_documents d
          WHERE d.archived_at IS NULL AND d.id = ANY($2::uuid[]) AND $1::uuid IS NULL`,
    [sourceId, ids],
  )) as { id: string }[];
  if (ids && sourceId && sources.length !== new Set(ids).size) {
    throw new BadRequestException(
      'Some of those documents are not on that chatbot.',
    );
  }
  const jobs: CopyJob[] = [];
  let skipped = 0;
  for (const { id } of sources) {
    const [row] = (await m.query(
      `INSERT INTO kb_documents
         (title, source_type, source_url, file_url, file_name, content_type, size_bytes, raw_text,
          language, tags, status, chunk_count, indexed_chunk_count, content_hash, chunk_version,
          created_by, is_global, corpus, owner_chatbot_id, copied_from_document_id, pii_review,
          pii_findings, last_read_at, curated)
       SELECT d.title, d.source_type, d.source_url, d.file_url, d.file_name, d.content_type,
              d.size_bytes, d.raw_text, d.language,
              array_remove(d.tags, $4) || COALESCE($5::text[], '{}'::text[]), 'pending', 0, 0,
              d.content_hash, 1, CASE WHEN $6 THEN d.created_by ELSE $3 END, false, 'whatsapp_qa', $2, d.id,
              CASE WHEN d.pii_review = 'approved' THEN 'approved' END,
              CASE WHEN d.pii_review = 'approved' THEN d.pii_findings END,
              d.last_read_at, false
         FROM kb_documents d
        WHERE d.id = $1
          AND NOT EXISTS (SELECT 1 FROM kb_documents x
                           WHERE x.owner_chatbot_id = $2 AND x.copied_from_document_id = d.id
                             AND x.archived_at IS NULL)
       RETURNING id, (raw_text <> '') AS has_text`,
      [
        id,
        targetId,
        userId,
        TEMPLATE_KNOWLEDGE_TAG,
        options.tag ? [options.tag] : null,
        Boolean(options.keepCreator),
      ],
    )) as { id: string; has_text: boolean }[];
    if (!row) {
      skipped += 1;
      continue;
    }
    await m.query(
      `INSERT INTO chatbot_documents (chatbot_id, document_id, created_by) VALUES ($1, $2, $3)`,
      [targetId, row.id, userId || null],
    );
    jobs.push({
      id: row.id,
      hasText: row.has_text,
      ...(options.tag ? { action: 'ingest' as const } : {}),
    });
  }
  return { jobs, skipped };
}

/**
 * Copy, not share (stage 5). Knowledge is never shared between chatbots any more: duplicating a
 * chatbot, copying another chatbot's knowledge and adding from Ally's curated pool all make
 * private copies owned by the target chatbot, created by the caller (so their indexing is charged
 * to the copying builder, never the original's owner) and queued for indexing in the background.
 *
 * Duplicate copies the persona, settings, rules, quick replies, list definitions (not records)
 * and documents. It never copies channel bindings, members, the access list, memory, contacts or
 * conversations; the caller is the copy's only owner, and it starts as a draft.
 */
@Injectable()
export class ChatbotSharingService {
  private readonly logger = LoggerService.getInstance(
    ChatbotSharingService.name,
  );

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly access: ChatbotAccessService,
    private readonly producer: KbIngestProducer,
  ) {}

  async duplicate(
    sourceId: string,
    userId = currentUserId(),
  ): Promise<DuplicateResult> {
    await this.access.assert(sourceId, ChatbotMemberRole.EDITOR, userId);
    await this.access.assertCanCreate(userId);
    const staff = await this.access.isPlatformAdmin(userId);
    let jobs: CopyJob[] = [];
    let skipped = 0;
    let quickReplies = 0;
    let lists = 0;
    const chatbotId = await this.dataSource.transaction(async (m) => {
      const [created] = (await m.query(
        `INSERT INTO chatbots
           (name, description, status, access_mode, answer_mode, knowledge_source, persona, model,
            settings, created_by, updated_by, safety_pack, safety_pack_version, rules, purpose,
            purpose_note, copied_from_chatbot_id)
         SELECT left(b.name || ' (copy)', 120), b.description, 'draft', b.access_mode, b.answer_mode,
                CASE WHEN $3 THEN b.knowledge_source ELSE 'selected' END,
                b.persona, b.model, b.settings, $2, $2, b.safety_pack, b.safety_pack_version,
                b.rules, b.purpose, b.purpose_note, b.id
           FROM chatbots b WHERE b.id = $1
         RETURNING id`,
        [sourceId, userId, staff],
      )) as { id: string }[];
      if (!created) throw new NotFoundException('Chatbot not found');
      const id = created.id;
      await m.query(
        `INSERT INTO chatbot_members (chatbot_id, user_id, role, roles, created_by)
         VALUES ($1, $2, 'owner', ARRAY['owner'], $2)`,
        [id, userId],
      );
      quickReplies = await this.copyQuickReplies(m, sourceId, id);
      lists = await this.copyListDefinitions(m, sourceId, id);
      const copied = await this.copyDocumentsTx(m, sourceId, id, userId, null);
      jobs = copied.jobs;
      skipped = copied.skipped;
      return id;
    });
    await this.queue(jobs);
    this.logger.info(
      `Chatbot ${sourceId} duplicated as ${chatbotId}: ${jobs.length} documents, ${quickReplies} quick replies, ${lists} lists`,
    );
    return {
      chatbotId,
      documentIds: jobs.map((j) => j.id),
      skipped,
      quickReplies,
      lists,
    };
  }

  /**
   * Copy documents from another chatbot the caller can edit. `documentIds` narrows the copy;
   * without it, every document the source answers from is copied.
   */
  async copyKnowledgeFrom(
    targetId: string,
    sourceId: string,
    documentIds?: string[] | null,
    userId = currentUserId(),
  ): Promise<CopiedDocuments> {
    if (targetId === sourceId) {
      throw new BadRequestException('Pick another chatbot to copy from.');
    }
    await this.access.assert(targetId, ChatbotMemberRole.EDITOR, userId);
    await this.access.assert(sourceId, ChatbotMemberRole.EDITOR, userId);
    const { jobs, skipped } = await this.dataSource.transaction((m) =>
      this.copyDocumentsTx(m, sourceId, targetId, userId, documentIds ?? null),
    );
    await this.queue(jobs);
    return { documentIds: jobs.map((j) => j.id), skipped };
  }

  /** Ally's curated pool: documents staff marked curated (not `is_global`). */
  async listCurated(): Promise<CuratedDocument[]> {
    const rows = (await this.dataSource.query(
      `SELECT id, title, language, source_type, "updatedAt" FROM kb_documents
        WHERE curated = true AND archived_at IS NULL AND corpus = 'whatsapp_qa'
        ORDER BY title`,
    )) as {
      id: string;
      title: string;
      language: string | null;
      source_type: string;
      updatedAt: Date;
    }[];
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      language: r.language,
      sourceType: r.source_type,
      updatedAt: r.updatedAt,
    }));
  }

  /** Copy-on-choice from the curated pool: a private, re-indexed copy on the chatbot. */
  async addFromPool(
    chatbotId: string,
    documentId: string,
    userId = currentUserId(),
  ): Promise<CopiedDocuments> {
    await this.access.assert(chatbotId, ChatbotMemberRole.EDITOR, userId);
    const [doc] = (await this.dataSource.query(
      `SELECT id FROM kb_documents WHERE id = $1 AND curated = true AND archived_at IS NULL`,
      [documentId],
    )) as { id: string }[];
    if (!doc) throw new NotFoundException('That document is not in the pool.');
    const { jobs, skipped } = await this.dataSource.transaction((m) =>
      this.copyDocumentsTx(m, null, chatbotId, userId, [doc.id]),
    );
    await this.queue(jobs);
    return { documentIds: jobs.map((j) => j.id), skipped };
  }

  /** Staff: put a library document in the curated pool, or take it out. */
  async setCurated(documentId: string, curated: boolean): Promise<void> {
    await this.access.assertPlatformAdmin();
    const [doc] = (await this.dataSource.query(
      `UPDATE kb_documents SET curated = $2, "updatedAt" = now()
        WHERE id = $1 AND owner_chatbot_id IS NULL AND corpus = 'whatsapp_qa'
        RETURNING id`,
      [documentId, curated],
    )) as unknown[];
    const rows = Array.isArray(doc) ? doc : [doc];
    if (!rows.filter(Boolean).length) {
      throw new NotFoundException(
        'Only library documents (not a chatbot’s own) can be in the pool.',
      );
    }
  }

  // ── copying ─────────────────────────────────────────────────────────

  /** See `copyDocumentsTx`. */
  copyDocumentsTx(
    m: EntityManager,
    sourceId: string | null,
    targetId: string,
    userId: number,
    ids: string[] | null,
    options: { tag?: string; keepCreator?: boolean } = {},
  ): Promise<{ jobs: CopyJob[]; skipped: number }> {
    return copyDocumentsTx(m, sourceId, targetId, userId, ids, options);
  }

  /** Queue the copies' indexing after the transaction committed. A failed enqueue marks FAILED. */
  async queue(jobs: CopyJob[]): Promise<void> {
    for (const job of jobs) {
      try {
        // With text, a reindex chunks the copied text and never re-reads the original file
        // (which lives in the source chatbot's folder).
        await this.producer.enqueue({
          documentId: job.id,
          action: job.action ?? (job.hasText ? 'reindex' : 'ingest'),
        });
      } catch (error) {
        await this.dataSource.query(
          `UPDATE kb_documents SET status = 'failed', status_message = $2 WHERE id = $1`,
          [
            job.id,
            `Could not be queued for indexing: ${error instanceof Error ? error.message : 'unknown'}`,
          ],
        );
      }
    }
  }

  private async copyQuickReplies(
    m: EntityManager,
    sourceId: string,
    targetId: string,
  ): Promise<number> {
    const rows = (await m.query(
      `INSERT INTO wa_keyword_templates
         (kind, name, match_type, patterns, language_code, priority, response_text, bypass_rag,
          terminal, active, mandatory, chatbot_id, overrides_template_id, locked, extra_numbers)
       SELECT kind, name, match_type, patterns, language_code, priority, response_text, bypass_rag,
              terminal, active, mandatory, $2, overrides_template_id, locked, extra_numbers
         FROM wa_keyword_templates
        WHERE chatbot_id = $1 AND archived_at IS NULL
       RETURNING id`,
      [sourceId, targetId],
    )) as unknown[];
    return Array.isArray(rows) ? rows.length : 0;
  }

  private async copyListDefinitions(
    m: EntityManager,
    sourceId: string,
    targetId: string,
  ): Promise<number> {
    const collections = (await m.query(
      `SELECT id FROM collections WHERE chatbot_id = $1 AND deleted_at IS NULL`,
      [sourceId],
    )) as { id: string }[];
    for (const c of collections) {
      const [created] = (await m.query(
        `INSERT INTO collections (chatbot_id, key, name, settings, agent_read, agent_write)
         SELECT $2, key, name, settings, agent_read, agent_write FROM collections WHERE id = $1
         RETURNING id`,
        [c.id, targetId],
      )) as { id: string }[];
      await m.query(
        `INSERT INTO collection_fields
           (collection_id, key, label, type, options, required, "default", privacy, agent_read, agent_write, position)
         SELECT $2, key, label, type, options, required, "default", privacy, agent_read, agent_write, position
           FROM collection_fields WHERE collection_id = $1 AND archived_at IS NULL`,
        [c.id, created.id],
      );
      await m.query(
        `INSERT INTO collection_constraints (collection_id, kind, config)
         SELECT $2, kind, config FROM collection_constraints WHERE collection_id = $1`,
        [c.id, created.id],
      );
    }
    return collections.length;
  }
}
