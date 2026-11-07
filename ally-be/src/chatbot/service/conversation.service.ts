import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { ChatbotContactIdentity } from '../entity/chatbot-contact-identity.entity';
import { ChatbotContact } from '../entity/chatbot-contact.entity';
import { ChatbotConversation } from '../entity/chatbot-conversation.entity';
import { ChatbotMessage } from '../entity/chatbot-message.entity';
import { MAX_HISTORY_MESSAGES } from '../engine/knowledge-request';
import {
  ConversationChannel,
  ConversationMessageRole,
} from '../enum/conversation.enum';

/** The scope a contact belongs to: one bot. */
export interface ContactScope {
  chatbotId: string;
}

/** A message to store. The id and `createdAt` are passed when copying from another store. */
export type AppendMessageInput = Pick<
  ChatbotMessage,
  'channel' | 'direction' | 'role' | 'text' | 'status'
> &
  Partial<
    Pick<
      ChatbotMessage,
      | 'id'
      | 'createdAt'
      | 'attachments'
      | 'handledBy'
      | 'citations'
      | 'retrievalMeta'
      | 'agentRunId'
      | 'agentRuntime'
      | 'providerMessageId'
      | 'language'
      | 'templateId'
      | 'latencyMs'
      | 'errorMessage'
      | 'inReplyToId'
    >
  >;

/** What can change on a stored message: its delivery, and blanking. */
export type MessagePatch = Partial<
  Pick<
    ChatbotMessage,
    | 'status'
    | 'providerMessageId'
    | 'handledBy'
    | 'errorMessage'
    | 'text'
    | 'citations'
    | 'retrievalMeta'
  >
>;

/** Rows blanked per pass by `blankBefore`, as in the WhatsApp retention sweep. */
const BLANK_BATCH_SIZE = 500;

/**
 * The one way to read and write conversations on any channel (Agents v2, chunk 12).
 *
 * Contacts are scoped per bot and recognised through `chatbot_contact_identities`; threads follow
 * WhatsApp's rules (one bot, one contact, one channel, open while messages keep arriving within the
 * idle window); messages are deduped on (channel, provider id). WhatsApp writes here through
 * WaSharedStoreWriter while `wa_*` stays its source of truth; the bot page (12b) writes here only.
 */
@Injectable()
export class ConversationService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(ChatbotConversation)
    private readonly conversationRepository: Repository<ChatbotConversation>,
    @InjectRepository(ChatbotMessage)
    private readonly messageRepository: Repository<ChatbotMessage>,
  ) {}

  /**
   * The contact this identity belongs to, created with the identity when it is new.
   *
   * `preferredIds` are tried in order for a new contact, and the first one no contact holds yet is
   * used — how a copy from WhatsApp keeps the `wa_contacts.id` (see `contactIdFor`). Two writers
   * racing to create the same identity both end up with the winner's contact.
   */
  async resolveContact(
    scope: ContactScope,
    channel: ConversationChannel,
    externalId: string,
    options: {
      verified?: boolean;
      verifiedAt?: Date | null;
      displayName?: string | null;
      preferredIds?: string[];
    } = {},
  ): Promise<ChatbotContact> {
    const existing = await this.contactFor(
      this.dataSource.manager,
      scope,
      channel,
      externalId,
    );
    if (existing) return existing;

    try {
      return await this.dataSource.transaction(async (manager) => {
        const id = await this.freeContactId(manager, options.preferredIds);
        const contact = await manager.save(
          manager.create(ChatbotContact, {
            ...(id ? { id } : {}),
            chatbotId: scope.chatbotId,
            displayName: options.displayName ?? null,
          }),
        );
        await manager.insert(ChatbotContactIdentity, {
          contactId: contact.id,
          chatbotId: scope.chatbotId,
          channel,
          externalId,
          verified: options.verified ?? false,
          verifiedAt: options.verified
            ? (options.verifiedAt ?? new Date())
            : null,
        });
        return contact;
      });
    } catch (error) {
      // The identity's unique index: someone else created it between the read and the insert,
      // and this transaction (contact included) rolled back. Theirs is the contact.
      const winner = await this.contactFor(
        this.dataSource.manager,
        scope,
        channel,
        externalId,
      );
      if (winner) return winner;
      throw error;
    }
  }

  /**
   * The open thread between this contact and bot on this channel, or a new one.
   *
   * WhatsApp's rules, generalised: a thread belongs to the bot that started it, and stays open while
   * the next message arrives within `idleWindowMinutes` of the last; reusing it moves
   * `last_message_at` to now. Replies do not move it — as on WhatsApp, the window runs from the
   * person's last message.
   *
   * With `id`, the caller has already decided the thread (WhatsApp, whose `wa_conversations` row is
   * the source of truth): that row is created or brought up to date instead.
   */
  async openConversation(
    chatbotId: string,
    contactId: string,
    channel: ConversationChannel,
    options: {
      /** Required unless `id` is given. */
      idleWindowMinutes?: number;
      connectorId?: string | null;
      now?: Date;
      id?: string;
      startedAt?: Date;
    },
  ): Promise<ChatbotConversation> {
    const now = options.now ?? new Date();
    if (options.id) {
      return this.upsertConversation({
        id: options.id,
        chatbotId,
        contactId,
        channel,
        connectorId: options.connectorId ?? null,
        startedAt: options.startedAt ?? now,
        lastMessageAt: now,
      });
    }

    if (options.idleWindowMinutes === undefined) {
      throw new Error('openConversation needs an idle window or an id');
    }
    const cutoff = new Date(now.getTime() - options.idleWindowMinutes * 60_000);
    const open = await this.conversationRepository
      .createQueryBuilder('c')
      .where('c.contactId = :contactId', { contactId })
      .andWhere('c.chatbotId = :chatbotId', { chatbotId })
      .andWhere('c.channel = :channel', { channel })
      .andWhere('c.lastMessageAt >= :cutoff', { cutoff })
      .orderBy('c.lastMessageAt', 'DESC')
      .getOne();

    if (open) {
      await this.conversationRepository.update(
        { id: open.id },
        { lastMessageAt: now },
      );
      return { ...open, lastMessageAt: now };
    }

    return this.conversationRepository.save(
      this.conversationRepository.create({
        chatbotId,
        contactId,
        channel,
        connectorId: options.connectorId ?? null,
        startedAt: now,
        lastMessageAt: now,
      }),
    );
  }

  /**
   * Store a message once. Idempotent on its id and on (channel, provider id): a repeat returns the
   * stored row unchanged — use `updateMessage` for what changes after a send.
   */
  async appendMessage(
    conversationId: string,
    message: AppendMessageInput,
  ): Promise<ChatbotMessage> {
    const inserted = await this.messageRepository
      .createQueryBuilder()
      .insert()
      .into(ChatbotMessage)
      .values({ ...message, conversationId })
      // No conflict target: both the primary key and the provider-id index make it a repeat.
      .orIgnore()
      .returning('id')
      .execute();
    const insertedId: string | undefined = inserted.raw?.[0]?.id;

    const stored = await this.messageRepository.findOne({
      where: insertedId
        ? { id: insertedId }
        : message.id
          ? { id: message.id }
          : {
              channel: message.channel,
              providerMessageId: message.providerMessageId ?? undefined,
            },
    });
    if (!stored) {
      throw new Error(
        `Message ${message.id ?? message.providerMessageId} was neither stored nor found`,
      );
    }
    return stored;
  }

  /** Record what changed on a stored message: its delivery status, provider id or blanking. */
  async updateMessage(id: string, patch: MessagePatch): Promise<void> {
    if (!Object.keys(patch).length) return;
    await this.messageRepository.update({ id }, patch);
  }

  /**
   * The last `n` messages of a thread, oldest first, as the engine takes them — the same as
   * WhatsApp's `recentHistory` today, quirks included: the message being answered is already
   * stored, so it is the last turn; blank messages are left out after the `n` are taken.
   */
  async recentHistory(
    conversationId: string,
    n: number = MAX_HISTORY_MESSAGES,
  ): Promise<{ role: string; content: string }[]> {
    const rows = await this.messageRepository.find({
      where: { conversationId },
      order: { createdAt: 'DESC' },
      take: n,
      select: ['role', 'text', 'createdAt'],
    });
    return rows
      .reverse()
      .map((row) => ({
        role: row.role === ConversationMessageRole.USER ? 'user' : 'assistant',
        content: row.text,
      }))
      .filter((turn) => turn.content?.trim());
  }

  /** Merge keys into a thread's metadata (the bot page's pre-chat answers, chunk 12b). */
  async setMetadata(
    conversationId: string,
    patch: Record<string, unknown>,
  ): Promise<void> {
    await this.dataSource.query(
      `UPDATE chatbot_conversations
          SET metadata = metadata || $2::jsonb, "updatedAt" = now()
        WHERE id = $1`,
      [conversationId, JSON.stringify(patch)],
    );
  }

  // ──────────────────────────────────────────────────── retention and erasure

  /**
   * Blank one person's messages and identity, for a right-to-erasure request.
   *
   * Takes the threads rather than a contact because WhatsApp erases by its own contact, whose
   * threads may belong to several shared contacts (one per bot). Each of those contacts loses the
   * identity on `channel`, replaced by `<erasedPrefix><contact id>`.
   */
  async eraseConversations(
    conversationIds: string[],
    channel: ConversationChannel,
    placeholders: { text: string; erasedPrefix: string },
  ): Promise<void> {
    if (!conversationIds.length) return;
    await this.messageRepository.update(
      { conversationId: In(conversationIds) },
      { text: placeholders.text, citations: null },
    );
    const contactIds = (
      await this.conversationRepository.find({
        where: { id: In(conversationIds) },
        select: ['contactId'],
      })
    ).map((row) => row.contactId);
    await this.eraseIdentities([...new Set(contactIds)], channel, placeholders);
  }

  /**
   * The retention sweep over this store: blank message text older than `cutoff`, and the
   * identities of contacts whose latest thread is older than it. The same rules as the WhatsApp
   * sweep, run on this store's own rows, so a pass that fails is finished by the next one.
   */
  async blankBefore(
    cutoff: Date,
    placeholders: { text: string; erasedPrefix: string },
  ): Promise<{ messages: number; identities: number }> {
    let messages = 0;
    for (;;) {
      const batch: { id: string }[] = await this.dataSource.query(
        `SELECT id FROM chatbot_messages
          WHERE "createdAt" < $1 AND text <> $2
          LIMIT ${BLANK_BATCH_SIZE}`,
        [cutoff, placeholders.text],
      );
      if (!batch.length) break;
      await this.messageRepository.update(
        { id: In(batch.map((row) => row.id)) },
        { text: placeholders.text, citations: null, retrievalMeta: null },
      );
      messages += batch.length;
      if (batch.length < BLANK_BATCH_SIZE) break;
    }

    const stale: { contact_id: string }[] = await this.dataSource.query(
      `SELECT c.contact_id
         FROM chatbot_conversations c
        GROUP BY c.contact_id
       HAVING MAX(c.last_message_at) < $1`,
      [cutoff],
    );
    const identities = await this.eraseIdentities(
      stale.map((row) => row.contact_id),
      null,
      placeholders,
    );
    return { messages, identities };
  }

  /** Replace identities' values with `<erasedPrefix><contact id>`; already-erased ones are skipped. */
  private async eraseIdentities(
    contactIds: string[],
    channel: ConversationChannel | null,
    placeholders: { erasedPrefix: string },
  ): Promise<number> {
    if (!contactIds.length) return 0;
    const result: [unknown[], number] = await this.dataSource.query(
      `UPDATE chatbot_contact_identities
          SET external_id = $2 || contact_id::text, verified = false, "updatedAt" = now()
        WHERE contact_id = ANY($1::uuid[])
          AND external_id NOT LIKE $2 || '%'
          ${channel ? 'AND channel = $3' : ''}`,
      channel
        ? [contactIds, placeholders.erasedPrefix, channel]
        : [contactIds, placeholders.erasedPrefix],
    );
    return Array.isArray(result) ? Number(result[1] ?? 0) : 0;
  }

  // ──────────────────────────────────────────────────────────────── plumbing

  private async contactFor(
    manager: EntityManager,
    scope: ContactScope,
    channel: ConversationChannel,
    externalId: string,
  ): Promise<ChatbotContact | null> {
    const identity = await manager.findOne(ChatbotContactIdentity, {
      where: { channel, externalId, chatbotId: scope.chatbotId },
    });
    if (!identity) return null;
    return manager.findOne(ChatbotContact, {
      where: { id: identity.contactId },
    });
  }

  private async freeContactId(
    manager: EntityManager,
    candidates: string[] | undefined,
  ): Promise<string | null> {
    for (const id of candidates ?? []) {
      const taken = await manager.exists(ChatbotContact, { where: { id } });
      if (!taken) return id;
    }
    return null;
  }

  /**
   * Create the thread with the caller's id, or bring it up to date. `last_message_at` only moves
   * forward, so a late or repeated copy never winds it back.
   */
  private async upsertConversation(
    row: Pick<
      ChatbotConversation,
      | 'id'
      | 'chatbotId'
      | 'contactId'
      | 'channel'
      | 'connectorId'
      | 'startedAt'
      | 'lastMessageAt'
    >,
  ): Promise<ChatbotConversation> {
    await this.dataSource.query(
      `INSERT INTO chatbot_conversations
              (id, chatbot_id, contact_id, channel, connector_id, started_at, last_message_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE
          SET last_message_at = GREATEST(chatbot_conversations.last_message_at, EXCLUDED.last_message_at),
              "updatedAt" = now()`,
      [
        row.id,
        row.chatbotId,
        row.contactId,
        row.channel,
        row.connectorId ?? null,
        row.startedAt,
        row.lastMessageAt,
      ],
    );
    const stored = await this.conversationRepository.findOne({
      where: { id: row.id },
    });
    if (!stored) throw new Error(`Conversation ${row.id} was not stored`);
    return stored;
  }
}
