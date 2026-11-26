import { Injectable, Optional } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { S3Service } from '../../aws/service/s3.service';
import { AppConfigService } from '../../config/config.service';
import {
  deleteWaMedia,
  waMediaKeysOf,
} from '../../whatsapp/media/wa-attachment';
import { DataSource, EntityManager } from 'typeorm';
import { LoggerService } from '../../logger/logger.service';
import { AlertOutboxService } from '../safety/alert-outbox.service';
import {
  ERASE_OWNER_NOTICE,
  ErasedPart,
  KeptPart,
  keptWhy,
} from './erase-copy';
import type { ErasePending } from './erase-intent';
import { ERASED_TEXT, affectedOf } from './erased';

/** Who asks. On WhatsApp the thread's number authenticates the request; on the web, the sign-in. */
export interface ErasureIdentity {
  contactId?: string | null;
  phone?: string | null;
  email?: string | null;
  endPersonId?: string | null;
}

export interface ErasureCounts {
  contacts: number;
  conversations: number;
  messages: number;
  waMessages: number;
  summaries: number;
  memoryLines: number;
  toolRuns: number;
  feedbackNotes: number;
  unansweredQuestions: number;
  searchQueries: number;
  consents: number;
}

export interface ErasureResult {
  /** What went, for the customer-facing message. */
  erased: ErasedPart[];
  /** What stayed, each with why (English; the message builder has the translations). */
  kept: { what: KeptPart; why: string; count?: number }[];
  counts: ErasureCounts;
  /** Conversation ids kept because they are flagged for safety. */
  keptConversationIds: string[];
  /** False when nobody matched the identity on this chatbot (nothing to erase). */
  found: boolean;
}

const PENDING_KEY = 'erasePending';

const digits = (v: string) => v.replace(/[^\d]/g, '');

/**
 * Erase in chat (R5), per the section-5 table:
 * - conversations, messages, transcripts, their attachments (images, audio), citations, search
 *   queries and the WhatsApp copies: erased (text blanked; derived rows deleted);
 * - summaries and memory: erased; the memory consent is reset, so it is asked again;
 * - contact name and details: blanked, identity kept so the person can still sign in (access list
 *   entries and identities are not touched);
 * - list records: kept (the owner's data), and the customer is told;
 * - conversations flagged for safety (retain_until > now): kept with their memory and name until
 *   their 12-month keep ends, then the retention sweep blanks them.
 *
 * Scoped to one chatbot: a number shared by several chatbots keeps its data on the others.
 * The owners get a notice through the alert outbox, with no message content.
 */
@Injectable()
export class CustomerErasureService {
  private readonly logger = LoggerService.getInstance(
    CustomerErasureService.name,
  );

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Optional() private readonly outbox?: AlertOutboxService,
    // WA-A: the person's stored voice notes, images and documents are deleted too.
    @Optional() private readonly s3?: S3Service,
    @Optional() private readonly appConfig?: AppConfigService,
  ) {}

  async eraseEndPerson(
    chatbotId: string,
    identity: ErasureIdentity,
    now: Date = new Date(),
  ): Promise<ErasureResult> {
    const contactIds = await this.contactsFor(chatbotId, identity);
    const endPersonIds = await this.endPersonsFor(
      chatbotId,
      identity,
      contactIds,
    );
    const counts: ErasureCounts = {
      contacts: contactIds.length,
      conversations: 0,
      messages: 0,
      waMessages: 0,
      summaries: 0,
      memoryLines: 0,
      toolRuns: 0,
      feedbackNotes: 0,
      unansweredQuestions: 0,
      searchQueries: 0,
      consents: 0,
    };
    const listRecords = contactIds.length
      ? Number(
          (
            (await this.dataSource.query(
              `SELECT count(*)::int AS n FROM collection_records WHERE chatbot_id = $1 AND contact_id = ANY($2::uuid[])`,
              [chatbotId, contactIds],
            )) as { n: number }[]
          )[0]?.n ?? 0,
        )
      : 0;

    let keptConversationIds: string[] = [];
    await this.dataSource.transaction(async (m) => {
      const chats = contactIds.length
        ? ((await m.query(
            `SELECT id, (retain_until IS NOT NULL AND retain_until > $3) AS exempt
               FROM chatbot_conversations
              WHERE chatbot_id = $1 AND contact_id = ANY($2::uuid[])
              FOR UPDATE`,
            [chatbotId, contactIds, now],
          )) as { id: string; exempt: boolean }[])
        : [];
      const erase = chats.filter((c) => !c.exempt).map((c) => c.id);
      keptConversationIds = chats.filter((c) => c.exempt).map((c) => c.id);
      counts.conversations = erase.length;
      if (erase.length) await this.eraseConversations(m, erase, counts);
      if (contactIds.length) {
        counts.memoryLines = affectedOf(
          await m.query(
            `DELETE FROM memory_entries x
              WHERE x.chatbot_id = $1 AND x.contact_id = ANY($2::uuid[])
                AND NOT EXISTS (SELECT 1 FROM chatbot_messages sm
                                 WHERE sm.id = x.source_message_id
                                   AND sm.conversation_id = ANY($3::uuid[]))`,
            [chatbotId, contactIds, keptConversationIds],
          ),
        );
        // Name and details blanked, unless kept with a flagged conversation. Identities stay.
        await m.query(
          `UPDATE chatbot_contacts c SET display_name = NULL, "updatedAt" = now()
            WHERE c.chatbot_id = $1 AND c.id = ANY($2::uuid[]) AND c.display_name IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM chatbot_conversations k
                               WHERE k.contact_id = c.id AND k.id = ANY($3::uuid[]))`,
          [chatbotId, contactIds, keptConversationIds],
        );
      }
      if (endPersonIds.length && (await this.hasTable(m, 'end_persons'))) {
        await m.query(
          `UPDATE end_persons SET display = NULL WHERE chatbot_id = $1 AND id = ANY($2::uuid[])`,
          [chatbotId, endPersonIds],
        );
      }
      // Memory consent is asked again after an erase.
      const keys = [
        ...contactIds.map((id) => `contact:${id}`),
        ...endPersonIds.map((id) => `person:${id}`),
      ];
      if (keys.length && (await this.hasTable(m, 'memory_consents'))) {
        counts.consents = affectedOf(
          await m.query(
            `DELETE FROM memory_consents WHERE chatbot_id = $1 AND subject_key = ANY($2::text[])`,
            [chatbotId, keys],
          ),
        );
      }
    });

    const kept: ErasureResult['kept'] = [];
    if (keptConversationIds.length) {
      kept.push({
        what: 'flagged_conversations',
        why: keptWhy('flagged_conversations'),
        count: keptConversationIds.length,
      });
    }
    if (listRecords) {
      kept.push({
        what: 'list_records',
        why: keptWhy('list_records'),
        count: listRecords,
      });
    }
    kept.push({ what: 'sign_in', why: keptWhy('sign_in') });

    const result: ErasureResult = {
      erased: ['conversations', 'memory', 'contact_details'],
      kept,
      counts,
      keptConversationIds,
      found: contactIds.length > 0 || endPersonIds.length > 0,
    };
    if (result.found) await this.noticeOwners(chatbotId, result, now);
    // Counts only: no identity in the log.
    this.logger.info(
      `Erase on chatbot ${chatbotId}: ${JSON.stringify(counts)}, ${keptConversationIds.length} flagged kept`,
    );
    return result;
  }

  private async eraseConversations(
    m: EntityManager,
    ids: string[],
    counts: ErasureCounts,
  ): Promise<void> {
    // WA-A: the files their messages point at go first (best effort; the references go below).
    const withFiles = (await m.query(
      `SELECT attachments FROM chatbot_messages
        WHERE conversation_id = ANY($1::uuid[]) AND attachments IS NOT NULL`,
      [ids],
    )) as { attachments: unknown }[];
    await deleteWaMedia(
      this.s3,
      this.appConfig?.s3.audioBucket,
      waMediaKeysOf(Array.isArray(withFiles) ? withFiles : []),
    );
    counts.messages = affectedOf(
      await m.query(
        `UPDATE chatbot_messages
            SET text = $2, attachments = NULL, citations = NULL, retrieval_meta = NULL, "updatedAt" = now()
          WHERE conversation_id = ANY($1::uuid[])
            AND (text <> $2 OR attachments IS NOT NULL OR citations IS NOT NULL OR retrieval_meta IS NOT NULL)`,
        [ids, ERASED_TEXT],
      ),
    );
    counts.summaries = affectedOf(
      await m.query(
        `UPDATE chatbot_conversations
            SET summary = NULL,
                metadata = metadata - 'intake' - 'handover' - 'summaryUpto' - '${PENDING_KEY}',
                "updatedAt" = now()
          WHERE id = ANY($1::uuid[])
            AND (summary IS NOT NULL OR metadata ?| array['intake', 'handover', 'summaryUpto'])`,
        [ids],
      ),
    );
    counts.toolRuns = affectedOf(
      await m.query(
        `DELETE FROM tool_runs WHERE conversation_id = ANY($1::text[])`,
        [ids],
      ),
    );
    counts.feedbackNotes = affectedOf(
      await m.query(
        `UPDATE chatbot_message_feedback SET note = NULL, "updatedAt" = now()
          WHERE conversation_id = ANY($1::uuid[]) AND note IS NOT NULL`,
        [ids],
      ),
    );
    // The WhatsApp copies share the conversation and message ids (chunk 12).
    counts.waMessages = affectedOf(
      await m.query(
        `UPDATE wa_messages SET body = $2, citations = NULL, retrieval_meta = NULL, "updatedAt" = now()
          WHERE conversation_id = ANY($1::uuid[]) AND body <> $2`,
        [ids, ERASED_TEXT],
      ),
    );
    counts.unansweredQuestions = affectedOf(
      await m.query(
        `UPDATE wa_unanswered_questions SET question_text = $2, "updatedAt" = now()
          WHERE conversation_id = ANY($1::uuid[]) AND question_text <> $2`,
        [ids, ERASED_TEXT],
      ),
    );
    counts.searchQueries = affectedOf(
      await m.query(
        `UPDATE kb_retrievals SET query = $2, "updatedAt" = now()
          WHERE session_id = ANY($1::uuid[]) AND query <> $2`,
        [ids, ERASED_TEXT],
      ),
    );
  }

  /**
   * The person's contacts on this chatbot: the given contact, every contact holding one of the
   * given phone/email identities, and every contact holding an identity of the same end person
   * (one person invited by phone and email is one person).
   */
  private async contactsFor(
    chatbotId: string,
    identity: ErasureIdentity,
  ): Promise<string[]> {
    const values = new Set<string>();
    const ids = new Set<string>();
    if (identity.contactId) {
      const own = (await this.dataSource.query(
        `SELECT c.id, i.external_id FROM chatbot_contacts c
           LEFT JOIN chatbot_contact_identities i ON i.contact_id = c.id
          WHERE c.id = $1 AND c.chatbot_id = $2`,
        [identity.contactId, chatbotId],
      )) as { id: string; external_id: string | null }[];
      own.forEach((r) => {
        ids.add(r.id);
        if (r.external_id) values.add(r.external_id);
      });
    }
    this.identityValues(identity).forEach((v) => values.add(v));
    for (const v of await this.personValues(chatbotId, identity, values)) {
      values.add(v);
    }
    if (values.size) {
      const rows = (await this.dataSource.query(
        `SELECT DISTINCT contact_id FROM chatbot_contact_identities
          WHERE chatbot_id = $1 AND (lower(external_id) = ANY($2::text[])
             OR regexp_replace(external_id, '[^0-9]', '', 'g') = ANY($3::text[]))`,
        [
          chatbotId,
          [...values].map((v) => v.toLowerCase()),
          [...values].map(digits).filter((d) => d.length >= 10),
        ],
      )) as { contact_id: string }[];
      rows.forEach((r) => ids.add(r.contact_id));
    }
    return [...ids];
  }

  private identityValues(identity: ErasureIdentity): string[] {
    const out: string[] = [];
    if (identity.phone && digits(identity.phone).length >= 10) {
      out.push(identity.phone.trim());
    }
    if (identity.email?.includes('@')) {
      out.push(identity.email.trim().toLowerCase());
    }
    return out;
  }

  /** Every identity value of the end person behind these values (when the table exists). */
  private async personValues(
    chatbotId: string,
    identity: ErasureIdentity,
    values: Set<string>,
  ): Promise<string[]> {
    if (
      !(await this.hasTable(this.dataSource.manager, 'end_person_identities'))
    )
      return [];
    const persons = await this.endPersonsFor(chatbotId, identity, [], values);
    if (!persons.length) return [];
    const rows = (await this.dataSource.query(
      `SELECT value FROM end_person_identities WHERE chatbot_id = $1 AND end_person_id = ANY($2::uuid[])`,
      [chatbotId, persons],
    )) as { value: string }[];
    return rows.map((r) => r.value);
  }

  private async endPersonsFor(
    chatbotId: string,
    identity: ErasureIdentity,
    contactIds: string[],
    known?: Set<string>,
  ): Promise<string[]> {
    if (
      !(await this.hasTable(this.dataSource.manager, 'end_person_identities'))
    )
      return [];
    const values = new Set(known ?? []);
    this.identityValues(identity).forEach((v) => values.add(v));
    if (contactIds.length) {
      const rows = (await this.dataSource.query(
        `SELECT external_id FROM chatbot_contact_identities WHERE contact_id = ANY($1::uuid[])`,
        [contactIds],
      )) as { external_id: string }[];
      rows.forEach((r) => values.add(r.external_id));
    }
    const ids = new Set<string>(
      identity.endPersonId ? [identity.endPersonId] : [],
    );
    if (values.size) {
      const rows = (await this.dataSource.query(
        `SELECT DISTINCT end_person_id FROM end_person_identities
          WHERE chatbot_id = $1 AND (lower(value) = ANY($2::text[])
             OR regexp_replace(value, '[^0-9]', '', 'g') = ANY($3::text[]))`,
        [
          chatbotId,
          [...values].map((v) => v.toLowerCase()),
          [...values].map(digits).filter((d) => d.length >= 10),
        ],
      )) as { end_person_id: string }[];
      rows.forEach((r) => ids.add(r.end_person_id));
    }
    return [...ids];
  }

  private tables = new Map<string, boolean>();
  private async hasTable(m: EntityManager, name: string): Promise<boolean> {
    if (this.tables.get(name)) return true;
    const [row] = (await m.query(`SELECT to_regclass($1) AS t`, [name])) as {
      t: string | null;
    }[];
    const has = Boolean(row?.t);
    if (has) this.tables.set(name, true);
    return has;
  }

  /** The owners' notice, once per erase: no message content, no contact details. */
  private async noticeOwners(
    chatbotId: string,
    result: ErasureResult,
    now: Date,
  ): Promise<void> {
    if (!this.outbox) return;
    try {
      const [bot] = (await this.dataSource.query(
        `SELECT name FROM chatbots WHERE id = $1`,
        [chatbotId],
      )) as { name: string }[];
      const owners = await this.ownerEmails(chatbotId);
      const assistant = bot?.name ?? 'your assistant';
      const fill = (t: string) =>
        t
          .replace(/\{assistant\}/g, assistant)
          .replace('{date}', now.toISOString().slice(0, 10))
          .replace(
            '{kept}',
            result.keptConversationIds.length
              ? ERASE_OWNER_NOTICE.keptFlagged
              : '',
          );
      for (const to of owners) {
        await this.outbox.enqueue({
          chatbotId,
          kind: 'erase_notice',
          recipient: to,
          channel: 'email',
          payload: {
            subject: fill(ERASE_OWNER_NOTICE.subject),
            body: fill(ERASE_OWNER_NOTICE.body).replace(/\s+/g, ' ').trim(),
          },
          dedupeKey: `erase:${now.getTime()}:${to}`,
        });
      }
    } catch (error) {
      this.logger.warn(
        `Erase notice for chatbot ${chatbotId} not queued: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }

  private async ownerEmails(chatbotId: string): Promise<string[]> {
    const [col] = (await this.dataSource.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name = 'chatbot_members' AND column_name = 'roles' LIMIT 1`,
    )) as unknown[];
    const holds = col
      ? `(m.role = 'owner' OR to_jsonb(m."roles") ? 'owner')`
      : `m.role = 'owner'`;
    const rows = (await this.dataSource.query(
      `SELECT DISTINCT u.email FROM chatbot_members m JOIN users u ON u.id = m.user_id
        WHERE m.chatbot_id = $1 AND ${holds} AND u.email IS NOT NULL`,
      [chatbotId],
    )) as { email: string }[];
    if (rows.length) return rows.map((r) => r.email);
    const creator = (await this.dataSource.query(
      `SELECT u.email FROM chatbots b JOIN users u ON u.id = b.created_by WHERE b.id = $1 AND u.email IS NOT NULL`,
      [chatbotId],
    )) as { email: string }[];
    return creator.map((r) => r.email);
  }

  // ── the two-step confirm's state, on the conversation ────────────────

  async pendingFor(conversationId: string): Promise<ErasePending | null> {
    const [row] = (await this.dataSource.query(
      `SELECT metadata->'${PENDING_KEY}' AS p FROM chatbot_conversations WHERE id = $1`,
      [conversationId],
    )) as { p: ErasePending | null }[];
    return row?.p ?? null;
  }

  async setPending(
    conversationId: string,
    pending: ErasePending | null,
  ): Promise<void> {
    await this.dataSource.query(
      pending
        ? `UPDATE chatbot_conversations SET metadata = jsonb_set(metadata, '{${PENDING_KEY}}', $2::jsonb), "updatedAt" = now() WHERE id = $1`
        : `UPDATE chatbot_conversations SET metadata = metadata - '${PENDING_KEY}', "updatedAt" = now() WHERE id = $1`,
      pending ? [conversationId, JSON.stringify(pending)] : [conversationId],
    );
  }
}
