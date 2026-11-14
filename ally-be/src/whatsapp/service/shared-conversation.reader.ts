import { NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { ConversationChannel } from 'src/chatbot/enum/conversation.enum';
import { WaHandledBy, WaMessageDirection } from '../enum/whatsapp.enum';

/** The channels a dashboard list can be filtered to. */
export type DashboardChannel = 'whatsapp' | 'web';

export interface SharedListOptions {
  limit?: number;
  offset?: number;
  from?: Date;
  to?: Date;
  handledBy?: WaHandledBy;
  language?: string;
  declinedOnly?: boolean;
  search?: string;
  sortBy?: string;
  sortDir?: string;
  chatbotId?: string;
  channel?: DashboardChannel;
}

/** What a caller may sort by: the same keys as the WhatsApp list, on the shared store. */
const SORT_COLUMNS: Record<string, string> = {
  lastMessageAt: 'c.last_message_at',
  startedAt: 'c.started_at',
  messageCount: '"messageCount"',
};

/** A web thread's message count and language, computed the way WhatsApp keeps them on the thread. */
const WEB_MESSAGE_COUNT = `(SELECT COUNT(*)::int FROM chatbot_messages mc
                             WHERE mc.conversation_id = c.id AND mc.direction = '${WaMessageDirection.INBOUND}')`;
const WEB_LAST_LANGUAGE = `(SELECT ml.language FROM chatbot_messages ml
                             WHERE ml.conversation_id = c.id AND ml.language IS NOT NULL
                             ORDER BY ml."createdAt" DESC LIMIT 1)`;
const MESSAGE_COUNT = `COALESCE(w.message_count, ${WEB_MESSAGE_COUNT})`;
const LAST_LANGUAGE = `CASE WHEN w.id IS NOT NULL THEN w.last_language ELSE ${WEB_LAST_LANGUAGE} END`;

/**
 * The dashboard's Conversations, languages and Unanswered scope read from the shared store
 * (`chatbot_*`), for every channel, while `dashboardReadsFrom` is `shared` (chunk 12b).
 *
 * The thread list's spine is `chatbot_conversations`. What only WhatsApp knows (the thread's message
 * count and language, the masked number, consent, block and organisation) comes from the `wa_*` row
 * with the same id, so a WhatsApp row reads exactly as it does from `wa_*`; a bot page row computes
 * the count and language from its messages and names the visitor by their masked, verified email.
 */
export class SharedConversationReader {
  constructor(private readonly manager: EntityManager) {}

  async listConversations(options: SharedListOptions) {
    const params: unknown[] = [];
    const bind = (value: unknown) => {
      params.push(value);
      return `$${params.length}`;
    };
    // A WhatsApp thread whose contact row is gone is not listed, as the WhatsApp list's inner join
    // leaves it out.
    const where: string[] = [
      `(c.channel <> '${ConversationChannel.WHATSAPP}' OR contact.id IS NOT NULL)`,
    ];
    if (options.chatbotId)
      where.push(`c.chatbot_id = ${bind(options.chatbotId)}`);
    if (options.channel) where.push(`c.channel = ${bind(options.channel)}`);
    if (options.from) where.push(`c.last_message_at >= ${bind(options.from)}`);
    if (options.to) where.push(`c.last_message_at < ${bind(options.to)}`);
    if (options.language)
      where.push(`${LAST_LANGUAGE} = ${bind(options.language)}`);
    if (options.handledBy || options.declinedOnly) {
      where.push(
        `EXISTS (SELECT 1 FROM chatbot_messages m
                  WHERE m.conversation_id = c.id AND m.handled_by = ${bind(
                    options.declinedOnly
                      ? WaHandledBy.DECLINED
                      : options.handledBy,
                  )})`,
      );
    }
    if (options.search?.trim()) {
      where.push(
        `EXISTS (SELECT 1 FROM chatbot_messages m
                  WHERE m.conversation_id = c.id
                    AND LOWER(m.text) LIKE ${bind(`%${options.search.trim().toLowerCase()}%`)})`,
      );
    }

    const from = `FROM chatbot_conversations c
      LEFT JOIN wa_conversations w ON w.id = c.id
      LEFT JOIN wa_contacts contact ON contact.id = w.contact_id
      LEFT JOIN tenants tenant ON tenant.id::text = contact.tenant_id
      WHERE ${where.join(' AND ')}`;

    const sortColumn =
      options.sortBy &&
      Object.prototype.hasOwnProperty.call(SORT_COLUMNS, options.sortBy)
        ? SORT_COLUMNS[options.sortBy]
        : SORT_COLUMNS.lastMessageAt;
    const direction = options.sortDir?.toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    const countParams = [...params];
    const limit = bind(options.limit ?? 25);
    const offset = bind(options.offset ?? 0);

    const [rows, [{ count }]] = await Promise.all([
      this.manager.query(
        `SELECT c.id AS id,
                COALESCE(w.contact_id, c.contact_id) AS "contactId",
                c.started_at AS "startedAt",
                c.last_message_at AS "lastMessageAt",
                ${MESSAGE_COUNT} AS "messageCount",
                ${LAST_LANGUAGE} AS "lastLanguage",
                contact.phone_last4 AS "phoneLast4",
                contact.consent_status AS "consentStatus",
                contact.blocked_at AS "blockedAt",
                contact.tenant_id AS "tenantId",
                tenant.name AS "tenantName",
                c.channel AS channel,
                (SELECT i.external_id FROM chatbot_contact_identities i
                  WHERE i.contact_id = c.contact_id AND i.channel = '${ConversationChannel.EMAIL}' AND i.verified
                  ORDER BY i."updatedAt" DESC LIMIT 1) AS "visitorEmail"
           ${from}
          ORDER BY ${sortColumn} ${direction}
          LIMIT ${limit} OFFSET ${offset}`,
        params,
      ),
      this.manager.query(`SELECT COUNT(*)::int AS count ${from}`, countParams),
    ]);

    return {
      conversations: rows.map(
        ({
          visitorEmail,
          ...row
        }: Record<string, unknown> & { visitorEmail: string | null }) => ({
          ...row,
          visitor:
            row.channel === ConversationChannel.WEB
              ? visitorLabel(visitorEmail)
              : null,
        }),
      ),
      count: Number(count),
    };
  }

  async listLanguages(chatbotId?: string): Promise<string[]> {
    const rows: { language: string }[] = await this.manager.query(
      `SELECT DISTINCT language FROM (
         SELECT ${LAST_LANGUAGE} AS language
           FROM chatbot_conversations c
           LEFT JOIN wa_conversations w ON w.id = c.id
          ${chatbotId ? 'WHERE c.chatbot_id = $1' : ''}
       ) l
       WHERE language IS NOT NULL
       ORDER BY language ASC`,
      chatbotId ? [chatbotId] : [],
    );
    return rows.map((row) => row.language).filter(Boolean);
  }

  /** The bot and channel a thread belongs to, or 404. */
  async thread(id: string): Promise<{
    id: string;
    chatbotId: string;
    channel: ConversationChannel;
    contactId: string;
    waContactId: string | null;
  }> {
    const [row] = await this.manager.query(
      `SELECT c.id, c.chatbot_id AS "chatbotId", c.channel, c.contact_id AS "contactId",
              w.contact_id AS "waContactId"
         FROM chatbot_conversations c
         LEFT JOIN wa_conversations w ON w.id = c.id
        WHERE c.id = $1`,
      [id],
    );
    if (!row) throw new NotFoundException(`Conversation ${id} was not found`);
    return row;
  }

  /** A web thread as the detail drawer reads it: the WhatsApp shape, plus the channel and intake. */
  async getWebConversation(id: string) {
    const [conversation] = await this.manager.query(
      `SELECT c.id, c.contact_id AS "contactId", c.chatbot_id AS "chatbotId",
              c.connector_id AS "connectorId", c.started_at AS "startedAt",
              c.last_message_at AS "lastMessageAt", ${MESSAGE_COUNT} AS "messageCount",
              ${LAST_LANGUAGE} AS "lastLanguage", c."createdAt", c."updatedAt",
              c.channel, c.status, c.metadata -> 'intake' AS intake
         FROM chatbot_conversations c
         LEFT JOIN wa_conversations w ON w.id = c.id
        WHERE c.id = $1`,
      [id],
    );
    const [identity] = await this.manager.query(
      `SELECT external_id AS email FROM chatbot_contact_identities
        WHERE contact_id = $1 AND channel = $2 AND verified
        ORDER BY "updatedAt" DESC LIMIT 1`,
      [conversation.contactId, ConversationChannel.EMAIL],
    );
    return {
      conversation,
      visitor: {
        id: conversation.contactId,
        label: visitorLabel(identity?.email ?? null),
      },
      messages: await this.messages(id),
    };
  }

  /** Every message of a thread, oldest first, in the WhatsApp drawer's shape. */
  async messages(conversationId: string) {
    const rows = await this.manager.query(
      `SELECT id, direction, text AS body, language, handled_by AS "handledBy",
              citations, retrieval_meta AS "retrievalMeta", latency_ms AS "latencyMs",
              status, error_message AS "errorMessage", "createdAt"
         FROM chatbot_messages
        WHERE conversation_id = $1
        ORDER BY "createdAt" ASC`,
      [conversationId],
    );
    return rows.map((row: Record<string, unknown>) => ({
      ...row,
      citations: row.citations ?? [],
      retrievalMeta: row.retrievalMeta ?? null,
    }));
  }

  /** The channel of each thread, for labelling unanswered questions. */
  async channelsOf(
    conversationIds: string[],
  ): Promise<Map<string, ConversationChannel>> {
    if (!conversationIds.length) return new Map();
    const rows: { id: string; channel: ConversationChannel }[] =
      await this.manager.query(
        `SELECT id, channel FROM chatbot_conversations WHERE id = ANY($1::uuid[])`,
        [conversationIds],
      );
    return new Map(rows.map((r) => [r.id, r.channel]));
  }
}

/** "a***@example.com", or "Visitor" for a public page's anonymous visitor. */
export function visitorLabel(email: string | null): string {
  if (!email) return 'Visitor';
  const at = email.lastIndexOf('@');
  return at < 1 ? 'Visitor' : `${email[0]}***${email.slice(at)}`;
}

/** Unanswered questions belong to a bot through the shared thread (WhatsApp's ids are the same). */
export const sharedConversationInBotSql = (conversationIdColumn: string) =>
  `${conversationIdColumn} IN (SELECT sc.id FROM chatbot_conversations sc WHERE sc.chatbot_id = :scopeBot)`;

/** In `wa` mode the queue stays WhatsApp's: a bot page's questions (filed in the same table) are left out. */
export const notWebQuestionSql = (conversationIdColumn: string) =>
  `NOT EXISTS (SELECT 1 FROM chatbot_conversations wc
                WHERE wc.id = ${conversationIdColumn} AND wc.channel <> '${ConversationChannel.WHATSAPP}')`;
