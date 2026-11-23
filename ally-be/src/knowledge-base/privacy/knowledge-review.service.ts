import {
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { DataSource } from 'typeorm';
import { LoggerService } from '../../logger/logger.service';
import { LlmCompletionService } from '../../llm-agent/service/llm-completion.service';
import { SWITCHES, switchOn } from '../../chatbot/safety/switches';
import { TEMPLATE_KNOWLEDGE_TAG } from '../constants/template-knowledge';
import { MIGRATION_COPY_TAG } from '../constants/migration-copy';
import type { KbDocument } from '../entity/kb-document.entity';
import {
  KbDocumentSourceType,
  KbDocumentStatus,
} from '../enum/knowledge-base.enum';
import { KbIngestProducer } from '../producer/kb-ingest.producer';
import { contactValuesIn, maskValue, PiiFinding, scanForPii } from './pii-scan';

/** Tags of the builder's own typed documents (Owner notes, What we learned). */
const OWNER_TYPED_TAGS = ['owner-notes', 'learned-facts'];

/**
 * Whether a document is the builder's own typed text rather than an upload or a crawled page:
 * tagged Owner notes / learned facts, or pasted text with no source address. Crawled pages are
 * stored as pasted text too, but always carry their `sourceUrl`.
 */
export function ownerTyped(
  document: Partial<Pick<KbDocument, 'tags' | 'sourceType' | 'sourceUrl'>>,
): boolean {
  if ((document.tags ?? []).some((t) => OWNER_TYPED_TAGS.includes(t)))
    return true;
  return (
    document.sourceType === KbDocumentSourceType.PASTE && !document.sourceUrl
  );
}

/** The AI task registry row of the names scan. */
export const PII_NAMES_TASK_ID = 'knowledge-personal-data-scan';

/** Text sent to the names scan: the start of the document is enough to tell. */
const NAMES_SCAN_CHARS = 12_000;

const hashOf = (text: string) =>
  createHash('sha256')
    .update(text ?? '', 'utf8')
    .digest('hex');

export interface ReviewItem {
  id: string;
  title: string;
  findings: PiiFinding[];
  status: string;
}

/**
 * Personal-data review of a chatbot's own documents before they are indexed (stage 5). The
 * ingest calls `holdIfPersonal` after reading the text: when personal data is found the document
 * stops at `needs_review` with its findings, and nothing is indexed until the owner approves it.
 * Excluding a document archives it and drops its text.
 *
 * Ally's template knowledge and the library are not scanned (Ally reviewed them). Approved and
 * excluded documents are not scanned again; a document whose text changes is.
 * Behind ASSISTANT_KNOWLEDGE_PII_REVIEW_ENABLED.
 */
@Injectable()
export class KnowledgeReviewService {
  private readonly logger = LoggerService.getInstance(
    KnowledgeReviewService.name,
  );

  constructor(
    private readonly dataSource: DataSource,
    private readonly producer: KbIngestProducer,
    @Optional() private readonly llm?: LlmCompletionService,
    @Optional() private readonly config?: ConfigService,
  ) {}

  /**
   * True when the document is held for review (the caller stops before indexing). Never throws:
   * a failed scan is logged and the regex result alone decides.
   */
  async holdIfPersonal(
    document: Pick<
      KbDocument,
      'id' | 'ownerChatbotId' | 'tags' | 'piiReview' | 'piiFindings'
    > &
      Partial<Pick<KbDocument, 'sourceType' | 'sourceUrl'>>,
    text: string,
  ): Promise<boolean> {
    if (!document.ownerChatbotId) return false;
    if (document.piiReview === 'excluded') return true;
    // The builder's own typed text (Owner notes, setup answers, facts added by hand, pasted
    // text) is never held: only uploaded files and crawled pages are scanned. A document held
    // before this rule is released so it indexes and leaves the review list.
    if (ownerTyped(document)) {
      if (document.piiReview === 'needs_review') {
        await this.dataSource
          .query(
            `UPDATE kb_documents SET pii_review = NULL, pii_findings = NULL, status_message = NULL WHERE id = $1`,
            [document.id],
          )
          .catch(() => undefined);
      }
      return false;
    }
    // Approved text is not scanned again; changed text is.
    if (
      document.piiReview === 'approved' &&
      (document.piiFindings as { approvedHash?: string } | null)
        ?.approvedHash === hashOf(text)
    )
      return false;
    // Ally's own content: template knowledge and copies of the shared library.
    if (
      (document.tags ?? []).includes(TEMPLATE_KNOWLEDGE_TAG) ||
      (document.tags ?? []).includes(MIGRATION_COPY_TAG)
    )
      return false;
    if (!switchOn(this.config, SWITCHES.knowledgePiiReview)) return false;
    try {
      const publicValues = await this.publicContacts(document.ownerChatbotId);
      const regex = scanForPii(text, publicValues);
      const names = await this.scanNames(text);
      const findings = [...regex.findings, ...names];
      if (!findings.length) return false;
      await this.dataSource.query(
        `UPDATE kb_documents
            SET status = $2, pii_review = 'needs_review', pii_findings = $3::jsonb,
                status_message = $4, "updatedAt" = now()
          WHERE id = $1`,
        [
          document.id,
          KbDocumentStatus.NEEDS_REVIEW,
          JSON.stringify({ findings, scannedAt: new Date().toISOString() }),
          // COPY: needs approval
          'This source may contain personal details. Review it before your assistant can use it.',
        ],
      );
      this.logger.info(
        `Document ${document.id} held for review: ${findings.map((f) => `${f.kind}×${f.count}`).join(', ')}`,
      );
      return true;
    } catch (error) {
      this.logger.warn(
        `Personal-data scan failed for document ${document.id}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
      return false;
    }
  }

  /** Names, by a model. Empty when no model is wired or the call fails. */
  private async scanNames(text: string): Promise<PiiFinding[]> {
    if (!this.llm || !text.trim()) return [];
    try {
      const result = await this.llm.complete({
        taskId: PII_NAMES_TASK_ID,
        task: null,
        system:
          'You check documents a business uploads for its customer assistant. List the full names of private individuals ' +
          '(customers, patients, students, staff personal details) that appear in the text. Do NOT list the organisation, ' +
          'its brands, public figures, authors of cited works, or staff named only in a public role (e.g. "Dr Rao, our dentist"). ' +
          'Answer JSON only: {"names": ["..."]}, at most 20, an empty list when there are none.',
        prompt: text.slice(0, NAMES_SCAN_CHARS),
        maxTokens: 400,
        jsonMode: true,
        timeoutMs: 20_000,
      });
      const parsed = JSON.parse(result.text || '{}') as { names?: unknown };
      const names = Array.isArray(parsed.names)
        ? parsed.names.filter(
            (n): n is string => typeof n === 'string' && n.trim().length > 2,
          )
        : [];
      return names.length
        ? [{ kind: 'name', sample: maskValue(names[0]), count: names.length }]
        : [];
    } catch (error) {
      this.logger.warn(
        `Names scan unavailable: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      return [];
    }
  }

  /**
   * The organisation's own contact details, never findings: those the owner marked public
   * (`settings.knowledgePublicContacts`), the way to reach a person (`settings.humanContact`)
   * and the numbers in `settings.helplineNumbers`.
   */
  private async publicContacts(chatbotId: string): Promise<string[]> {
    const [row] = (await this.dataSource.query(
      `SELECT settings->'knowledgePublicContacts' AS v,
              settings->'humanContact' AS hc,
              settings->>'helplineNumbers' AS hn
         FROM chatbots WHERE id = $1`,
      [chatbotId],
    )) as { v: unknown; hc: unknown; hn: string | null }[];
    const marked = Array.isArray(row?.v)
      ? row.v.filter((x): x is string => typeof x === 'string')
      : [];
    const human =
      row?.hc && typeof row.hc === 'object'
        ? Object.values(row.hc as Record<string, unknown>)
            .filter((x): x is string => typeof x === 'string')
            .flatMap((x) => contactValuesIn(x))
        : [];
    return [...marked, ...human, ...contactValuesIn(row?.hn)];
  }

  /** The chatbot's documents waiting for review. */
  async listForReview(chatbotId: string): Promise<ReviewItem[]> {
    const rows = (await this.dataSource.query(
      `SELECT id, title, status, pii_findings FROM kb_documents
        WHERE owner_chatbot_id = $1 AND pii_review = 'needs_review' AND archived_at IS NULL
        ORDER BY "updatedAt" DESC`,
      [chatbotId],
    )) as {
      id: string;
      title: string;
      status: string;
      pii_findings: { findings?: PiiFinding[] } | null;
    }[];
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      findings: r.pii_findings?.findings ?? [],
    }));
  }

  /** The owner approves: indexing runs from the stored text. */
  async approve(chatbotId: string, documentId: string): Promise<void> {
    const doc = await this.held(chatbotId, documentId);
    await this.dataSource.query(
      `UPDATE kb_documents
          SET pii_review = 'approved', status = $2, status_message = NULL,
              pii_findings = COALESCE(pii_findings, '{}'::jsonb) || jsonb_build_object('approvedHash', $3::text),
              "updatedAt" = now()
        WHERE id = $1`,
      [doc.id, KbDocumentStatus.PENDING, hashOf(doc.raw_text)],
    );
    await this.producer.enqueue({ documentId: doc.id, action: 'reindex' });
  }

  /** The owner excludes: archived, never indexed, its text dropped. */
  async exclude(chatbotId: string, documentId: string): Promise<void> {
    const doc = await this.held(chatbotId, documentId);
    await this.dataSource.query(
      `UPDATE kb_documents
          SET pii_review = 'excluded', archived_at = COALESCE(archived_at, now()), raw_text = '',
              status_message = NULL, "updatedAt" = now()
        WHERE id = $1`,
      [doc.id],
    );
  }

  private async held(chatbotId: string, documentId: string) {
    const [doc] = (await this.dataSource.query(
      `SELECT id, pii_review, raw_text FROM kb_documents WHERE id = $1 AND owner_chatbot_id = $2`,
      [documentId, chatbotId],
    )) as { id: string; pii_review: string | null; raw_text: string }[];
    if (!doc)
      throw new NotFoundException(`Document ${documentId} was not found`);
    if (doc.pii_review !== 'needs_review') {
      throw new ConflictException('This source is not waiting for review.');
    }
    return doc;
  }
}
