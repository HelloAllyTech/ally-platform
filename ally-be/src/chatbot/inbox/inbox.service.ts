import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ExecutionManager } from '../../common/execution/execution-manager';
import { ChatbotMemberRole } from '../enum/chatbot.enum';
import { ConversationChannel } from '../enum/conversation.enum';
import { WHATSAPP_WINDOW_MS } from '../handover/handover';
import { ChatbotAccessService } from '../service/chatbot-access.service';

/** "Live now": a message in the last this many minutes. */
const LIVE_MINUTES = 15;
/** Chats per page of the list. */
const INBOX_PAGE = 50;

export type InboxView = 'needs_person' | 'live' | 'all';

/** A channel, or `widget`: the web chats that came from the website widget (chunk 13). */
export type InboxChannelFilter = ConversationChannel | 'widget';

export interface InboxFilters {
  view?: InboxView;
  channel?: InboxChannelFilter;
  chatbotId?: string;
  /** Older than this `last_message_at` (ISO), for the next page. */
  before?: string;
}

export interface InboxItem {
  id: string;
  chatbotId: string;
  assistant: string;
  channel: ConversationChannel;
  /** `widget` for a chat started in the website widget (chunk 13): shown as "Website". */
  source: 'widget' | null;
  visitor: string;
  preview: string;
  lastMessageAt: string;
  unread: number;
  state: 'assistant' | 'needs_person' | 'held';
  needsPersonReason: string | null;
  heldBy: { id: number; name: string | null } | null;
  safety: boolean;
  /** TF1 S5: the person (contact) this chat is with, and how many chats they have here. */
  contactId: string | null;
  chats: number;
}

const userId = (): number => Number(ExecutionManager.getUserId() ?? 0);

/** The inbox's list and counts (chunk 11a), from the shared store, for the assistants you can see. */
@Injectable()
export class InboxService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly access: ChatbotAccessService,
  ) {}

  /** The assistants whose chats the caller can see: the ones they are a member of. */
  scope(): Promise<string[]> {
    return this.access.accessibleChatbotIds(userId());
  }

  /** `scope`: stage 8, the one chatbot an Ally staff read was authorised for (else the caller's). */
  async list(
    filters: InboxFilters = {},
    scope?: string[],
  ): Promise<InboxItem[]> {
    const ids = scope ?? (await this.scope());
    if (!ids.length) return [];
    const params: unknown[] = [userId()];
    const where: string[] = [];
    const add = (sql: string, value: unknown) => {
      params.push(value);
      where.push(sql.replace('?', `$${params.length}`));
    };
    add('c.chatbot_id = ANY(?::uuid[])', ids);
    if (filters.chatbotId) add('c.chatbot_id = ?', filters.chatbotId);
    // The website widget's chats are web chats marked `source.kind = widget` (chunk 13): "Website"
    // shows only those, and "Bot page" the rest.
    if (filters.channel === 'widget') {
      add('c.channel = ?', ConversationChannel.WEB);
      where.push(`c.metadata->'source'->>'kind' = 'widget'`);
    } else if (filters.channel) {
      add('c.channel = ?', filters.channel);
      if (filters.channel === ConversationChannel.WEB) {
        where.push(`COALESCE(c.metadata->'source'->>'kind', '') <> 'widget'`);
      }
    }
    if (filters.before) add('c.last_message_at < ?', filters.before);
    if (filters.view === 'needs_person')
      where.push('c.needs_person_since IS NOT NULL');
    if (filters.view === 'live') {
      where.push(
        `c.last_message_at >= now() - interval '${LIVE_MINUTES} minutes'`,
      );
    }
    // TF1 S5: one row per person (contact): their most urgent, then latest, chat, with how many
    // chats they have; labelled by who they are, not by the chat.
    const rows = (await this.dataSource.query(
      `SELECT * FROM (
         SELECT c.id, c.chatbot_id, c.contact_id, b.name AS assistant, c.channel, c.last_message_at,
                c.handled_by_user_id, u.name AS held_by_name, c.needs_person_since,
                c.needs_person_reason, c.safety_at, c.metadata->'intake' AS intake,
                c.metadata->'source'->>'kind' AS source, ident.external_id,
                ${CONTACT_COLUMNS},
                (SELECT m.text FROM chatbot_messages m WHERE m.conversation_id = c.id
                  ORDER BY m."createdAt" DESC LIMIT 1) AS preview,
                (SELECT COUNT(*) FROM chatbot_messages m
                  WHERE m.conversation_id = c.id AND m.direction = 'inbound'
                    AND m."createdAt" > COALESCE(r.read_at, 'epoch')) AS unread,
                (c.safety_at IS NOT NULL AND c.safety_at > COALESCE(r.read_at, 'epoch')) AS safety_unread,
                (c.needs_person_since IS NOT NULL AND c.handled_by_user_id IS NULL) AS waiting,
                COUNT(*) OVER (PARTITION BY COALESCE(c.contact_id, c.id)) AS chats,
                ROW_NUMBER() OVER (
                  PARTITION BY COALESCE(c.contact_id, c.id)
                  ORDER BY (c.safety_at IS NOT NULL AND c.safety_at > COALESCE(r.read_at, 'epoch')) DESC,
                           (c.needs_person_since IS NOT NULL AND c.handled_by_user_id IS NULL) DESC,
                           c.last_message_at DESC
                ) AS pick
           FROM chatbot_conversations c
           JOIN chatbots b ON b.id = c.chatbot_id AND b.archived_at IS NULL
           LEFT JOIN users u ON u.id = c.handled_by_user_id
           LEFT JOIN chatbot_conversation_reads r
                  ON r.conversation_id = c.id AND r.user_id = $1
           LEFT JOIN LATERAL (
             SELECT i.external_id FROM chatbot_contact_identities i
              WHERE i.contact_id = c.contact_id AND i.channel = c.channel LIMIT 1
           ) ident ON true
          ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ) x
       WHERE x.pick = 1
       ORDER BY x.safety_unread DESC, x.waiting DESC, x.last_message_at DESC
       LIMIT ${INBOX_PAGE}`,
      params,
    )) as Record<string, unknown>[];
    return rows.map((row) => toItem(row));
  }

  /** Unread chats and the two lists the nav and the notifications need: the reconnect snapshot. */
  async counts(scope?: string[]): Promise<{
    unread: number;
    needsPerson: number;
    safety: number;
  }> {
    const ids = scope ?? (await this.scope());
    if (!ids.length) return { unread: 0, needsPerson: 0, safety: 0 };
    const [row] = (await this.dataSource.query(
      `SELECT
         COUNT(*) FILTER (WHERE EXISTS (
           SELECT 1 FROM chatbot_messages m WHERE m.conversation_id = c.id
              AND m.direction = 'inbound' AND m."createdAt" > COALESCE(r.read_at, 'epoch')
         )) AS unread,
         COUNT(*) FILTER (WHERE c.needs_person_since IS NOT NULL
                            AND c.handled_by_user_id IS NULL) AS needs_person,
         COUNT(*) FILTER (WHERE c.safety_at > COALESCE(r.read_at, 'epoch')) AS safety
         FROM chatbot_conversations c
         JOIN chatbots b ON b.id = c.chatbot_id AND b.archived_at IS NULL
         LEFT JOIN chatbot_conversation_reads r
                ON r.conversation_id = c.id AND r.user_id = $1
        WHERE c.last_message_at >= now() - interval '30 days'
          AND c.chatbot_id = ANY($2::uuid[])`,
      [userId(), ids],
    )) as { unread: string; needs_person: string; safety: string }[];
    return {
      unread: Number(row?.unread ?? 0),
      needsPerson: Number(row?.needs_person ?? 0),
      safety: Number(row?.safety ?? 0),
    };
  }

  /** One chat: the thread, pre-chat answers, ratings and who has it. */
  async thread(chatbotId: string, conversationId: string) {
    await this.access.assert(chatbotId, ChatbotMemberRole.VIEWER);
    const [conversation] = (await this.dataSource.query(
      `SELECT c.id, c.chatbot_id, c.contact_id, b.name AS assistant, c.channel,
              ${CONTACT_COLUMNS},
              (SELECT i.external_id FROM chatbot_contact_identities i
                WHERE i.contact_id = c.contact_id AND i.channel = c.channel LIMIT 1) AS external_id,
              c.metadata->'intake' AS intake,
              c.metadata->'source'->>'kind' AS source,
              c.handled_by_user_id, u.name AS held_by_name, c.needs_person_since,
              c.needs_person_reason, c.safety_at, c.last_message_at
         FROM chatbot_conversations c
         JOIN chatbots b ON b.id = c.chatbot_id
         LEFT JOIN users u ON u.id = c.handled_by_user_id
        WHERE c.id = $1 AND c.chatbot_id = $2`,
      [conversationId, chatbotId],
    )) as Record<string, unknown>[];
    if (!conversation) return null;
    const messages = (await this.dataSource.query(
      `SELECT m.id, m.role, m.text, m.citations, m.handled_by, m."createdAt" AS at,
              m.sent_by_user_id, su.name AS sent_by_name, f.rating, f.reason
         FROM chatbot_messages m
         LEFT JOIN users su ON su.id = m.sent_by_user_id
         LEFT JOIN chatbot_message_feedback f ON f.message_id = m.id
        WHERE m.conversation_id = $1
        ORDER BY m."createdAt" ASC
        LIMIT 500`,
      [conversationId],
    )) as Record<string, unknown>[];
    const lastInbound = [...messages].reverse().find((m) => m.role === 'user')
      ?.at as Date | undefined;
    // TF1 S5: the person's other chats with this assistant, newest first. A reply goes to the chat
    // they are in now (their latest on this channel), so an older one says where to reply instead.
    const others = conversation.contact_id
      ? ((await this.dataSource.query(
          `SELECT c.id, c.channel, c.last_message_at,
                  (SELECT m.text FROM chatbot_messages m WHERE m.conversation_id = c.id
                    ORDER BY m."createdAt" DESC LIMIT 1) AS preview
             FROM chatbot_conversations c
            WHERE c.contact_id = $1 AND c.chatbot_id = $2 AND c.id <> $3
            ORDER BY c.last_message_at DESC LIMIT 20`,
          [conversation.contact_id, chatbotId, conversationId],
        )) as Record<string, unknown>[])
      : [];
    const latestElsewhere = others.find(
      (o) =>
        o.channel === conversation.channel &&
        new Date(o.last_message_at as string) >
          new Date(conversation.last_message_at as string),
    );
    return {
      ...toItem({
        ...conversation,
        preview: '',
        unread: 0,
        chats: others.length + 1,
      }),
      otherChats: others.map((o) => ({
        id: String(o.id),
        channel: o.channel as ConversationChannel,
        lastMessageAt: new Date(o.last_message_at as string).toISOString(),
        preview: String(o.preview ?? '').slice(0, 140),
      })),
      /** Set when the person has a newer chat on this channel: replies belong there. */
      newerChatId: latestElsewhere ? String(latestElsewhere.id) : null,
      // Whose chat it is, for what the assistant remembers about them (chunk 8a).
      contactId: (conversation.contact_id as string | null) ?? null,
      intake:
        (conversation.intake as { answers?: unknown[] } | null)?.answers ?? [],
      // WhatsApp only lets the team reply within 24 hours of the visitor's last message.
      replyWindowClosesAt:
        conversation.channel === ConversationChannel.WHATSAPP && lastInbound
          ? new Date(
              new Date(lastInbound).getTime() + WHATSAPP_WINDOW_MS,
            ).toISOString()
          : null,
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        text: m.text,
        citations: m.citations ?? [],
        handledBy: m.handled_by,
        at: m.at,
        sentBy:
          m.sent_by_user_id === null
            ? null
            : { id: m.sent_by_user_id, name: m.sent_by_name ?? null },
        rating: m.rating ?? null,
        ratingReason: m.reason ?? null,
      })),
    };
  }

  /** Opening a chat marks it read for you (and keeps it out of the owners' "nobody opened" email). */
  async markRead(chatbotId: string, conversationId: string): Promise<void> {
    await this.access.assert(chatbotId, ChatbotMemberRole.VIEWER);
    await this.dataSource.query(
      `INSERT INTO chatbot_conversation_reads (conversation_id, user_id, read_at)
       VALUES ($1, $2, now())
       ON CONFLICT (conversation_id, user_id) DO UPDATE SET read_at = now()`,
      [conversationId, userId()],
    );
  }
}

/** The person's name and identities, for the inbox label (TF1 S5). */
const CONTACT_COLUMNS = `
  (SELECT co.display_name FROM chatbot_contacts co WHERE co.id = c.contact_id) AS contact_name,
  (SELECT i.external_id FROM chatbot_contact_identities i
    WHERE i.contact_id = c.contact_id AND i.channel = 'email' AND i.verified
    ORDER BY i."createdAt" LIMIT 1) AS contact_email,
  (SELECT i.external_id FROM chatbot_contact_identities i
    WHERE i.contact_id = c.contact_id AND i.channel = 'whatsapp'
    ORDER BY i."createdAt" LIMIT 1) AS contact_phone`;

/** Who the visitor is, as the list shows them: a pre-chat name, a phone's last 4, or "Visitor". */
function visitorLabel(row: Record<string, unknown>): string {
  const answers = (
    row.intake as {
      answers?: { label?: string; type?: string; value?: string }[];
    } | null
  )?.answers;
  const name = answers?.find(
    (a) => a.type === 'text' && /name/i.test(a.label ?? ''),
  )?.value;
  if (name?.trim()) return name.trim();
  const external = String(row.external_id ?? '');
  if (row.channel === ConversationChannel.WHATSAPP && /\d{4}$/.test(external)) {
    return `…${external.slice(-4)}`;
  }
  return 'Visitor';
}

/**
 * Who the visitor is in the inbox (chunk 20d-2): their name when they gave one before the chat,
 * otherwise "Visitor · 4821": a phone's last 4 on WhatsApp, else 4 digits from the conversation's
 * id, so the same chat always has the same tag.
 */
export function inboxVisitor(row: Record<string, unknown>): string {
  // TF1 S5: who the person is, from their contact: the name they gave, else their verified email,
  // else their WhatsApp number. Then the pre-chat name, then a short tag.
  const contactName = String(row.contact_name ?? '').trim();
  if (contactName) return contactName;
  const intakeName = visitorLabel(row);
  if (intakeName !== 'Visitor' && !intakeName.startsWith('…'))
    return intakeName;
  const email = String(row.contact_email ?? '').trim();
  if (email) return email;
  const phone = String(row.contact_phone ?? '').trim();
  if (/^\d{8,15}$/.test(phone)) return `+${phone}`;
  const label = intakeName;
  if (label.startsWith('…')) return `Visitor · ${label.slice(1)}`;
  if (label === 'Visitor')
    return `Visitor · ${visitorTag(String(row.id ?? ''))}`;
  return label;
}

/** Four digits from an id, the same every time (not a secret, just a short name for a chat). */
export function visitorTag(id: string): string {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return String(hash % 10000).padStart(4, '0');
}

function toItem(row: Record<string, unknown>): InboxItem {
  const held = row.handled_by_user_id as number | null;
  return {
    id: String(row.id),
    chatbotId: String(row.chatbot_id),
    assistant: String(row.assistant ?? ''),
    channel: row.channel as ConversationChannel,
    source: row.source === 'widget' ? 'widget' : null,
    visitor: inboxVisitor(row),
    preview: String(row.preview ?? '').slice(0, 140),
    lastMessageAt: new Date(row.last_message_at as string).toISOString(),
    unread: Number(row.unread ?? 0),
    state: held
      ? 'held'
      : row.needs_person_since
        ? 'needs_person'
        : 'assistant',
    needsPersonReason: (row.needs_person_reason as string | null) ?? null,
    heldBy: held
      ? { id: held, name: (row.held_by_name as string | null) ?? null }
      : null,
    safety: Boolean(row.safety_at),
    contactId: (row.contact_id as string | null) ?? null,
    chats: Number(row.chats ?? 1),
  };
}
