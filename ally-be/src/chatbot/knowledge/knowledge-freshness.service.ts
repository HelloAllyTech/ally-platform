import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { DataSource } from 'typeorm';
import { LoggerService } from '../../logger/logger.service';
import { extractDocument } from '../../knowledge-base/extractor';
import {
  KbDocumentSourceType,
  KbDocumentStatus,
} from '../../knowledge-base/enum/knowledge-base.enum';
import { KbIngestProducer } from '../../knowledge-base/producer/kb-ingest.producer';

/** The nudge to read sources again shows past this many days (stage 5). */
export const KNOWLEDGE_STALE_NUDGE_DAYS = 30;

export interface KnowledgeStaleness {
  /** Days since the oldest source was last read; null with no sources. */
  knowledgeStaleDays: number | null;
  /** True past KNOWLEDGE_STALE_NUDGE_DAYS. */
  knowledgeStaleNudge: boolean;
  /** The chatbot's own source read longest ago: what "Read again" on the Overview reads. */
  knowledgeStaleDocumentId?: string | null;
}

export interface ReadAgainResult {
  documentId: string;
  /** True when the text changed and the source is indexed again. */
  changed: boolean;
  /** A file has nothing to fetch: reading it again records that the owner confirmed it. */
  confirmed: boolean;
  lastReadAt: string;
}

const hashOf = (text: string) =>
  createHash('sha256').update(text, 'utf8').digest('hex');

/** Days since the oldest of a chatbot's sources was read (attached and not archived). */
export async function knowledgeStalenessOf(
  dataSource: Pick<DataSource, 'query'>,
  chatbotId: string,
  now: Date = new Date(),
): Promise<KnowledgeStaleness> {
  const [row] = (await dataSource.query(
    `SELECT min(COALESCE(d.last_read_at, d."updatedAt")) AS oldest,
            (SELECT o.id FROM kb_documents o
              WHERE o.owner_chatbot_id = $1 AND o.archived_at IS NULL
              ORDER BY COALESCE(o.last_read_at, o."updatedAt") ASC LIMIT 1) AS oldest_owned
       FROM kb_documents d
      WHERE d.archived_at IS NULL
        AND (d.owner_chatbot_id = $1
             OR d.id IN (SELECT document_id FROM chatbot_documents WHERE chatbot_id = $1))`,
    [chatbotId],
  )) as { oldest: Date | null; oldest_owned?: string | null }[];
  if (!row?.oldest) {
    return { knowledgeStaleDays: null, knowledgeStaleNudge: false };
  }
  const days = Math.max(
    0,
    Math.floor((now.getTime() - new Date(row.oldest).getTime()) / 86_400_000),
  );
  return {
    knowledgeStaleDays: days,
    knowledgeStaleNudge: days > KNOWLEDGE_STALE_NUDGE_DAYS,
    knowledgeStaleDocumentId: row.oldest_owned ?? null,
  };
}

/**
 * Staleness of a chatbot's knowledge (stage 5): when each source was last read, "Read again" and
 * the 30-day nudge on the home.
 */
@Injectable()
export class KnowledgeFreshnessService {
  private readonly logger = LoggerService.getInstance(
    KnowledgeFreshnessService.name,
  );

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly producer: KbIngestProducer,
  ) {}

  /** Days since the oldest of the chatbot's sources was read (attached and not archived). */
  staleness(chatbotId: string, now: Date = new Date()) {
    return knowledgeStalenessOf(this.dataSource, chatbotId, now);
  }

  /**
   * Read one of the chatbot's own sources again. A web page is fetched; unchanged text (same
   * content hash) only records the read, changed text is stored and indexed again. A file or
   * pasted text without an address has nothing to fetch: the read is recorded as confirmed.
   */
  async readAgain(
    chatbotId: string,
    documentId: string,
    now: Date = new Date(),
  ): Promise<ReadAgainResult> {
    const [doc] = (await this.dataSource.query(
      `SELECT id, source_type, source_url, content_hash, pii_review FROM kb_documents
        WHERE id = $1 AND owner_chatbot_id = $2 AND archived_at IS NULL`,
      [documentId, chatbotId],
    )) as {
      id: string;
      source_type: KbDocumentSourceType;
      source_url: string | null;
      content_hash: string;
      pii_review: string | null;
    }[];
    if (!doc) throw new NotFoundException(`Source ${documentId} was not found`);
    const touch = async () =>
      this.dataSource.query(
        `UPDATE kb_documents SET last_read_at = $2 WHERE id = $1`,
        [doc.id, now],
      );
    if (!doc.source_url) {
      await touch();
      return {
        documentId: doc.id,
        changed: false,
        confirmed: true,
        lastReadAt: now.toISOString(),
      };
    }
    const extracted = await extractDocument({
      sourceType: KbDocumentSourceType.URL,
      sourceUrl: doc.source_url,
    });
    const hash = hashOf(extracted.text);
    if (hash === doc.content_hash) {
      await touch();
      return {
        documentId: doc.id,
        changed: false,
        confirmed: false,
        lastReadAt: now.toISOString(),
      };
    }
    await this.dataSource.query(
      `UPDATE kb_documents
          SET raw_text = $2, content_hash = $3, last_read_at = $4, status = $5, status_message = NULL,
              "updatedAt" = now()
        WHERE id = $1`,
      [doc.id, extracted.text, hash, now, KbDocumentStatus.PENDING],
    );
    // A reindex re-chunks the stored text (and the personal-data review sees the new text).
    await this.producer.enqueue({ documentId: doc.id, action: 'reindex' });
    this.logger.info(`Source ${doc.id} read again: changed, queued`);
    return {
      documentId: doc.id,
      changed: true,
      confirmed: false,
      lastReadAt: now.toISOString(),
    };
  }
}
