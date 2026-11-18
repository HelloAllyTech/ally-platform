import { DataSource, In, Repository } from 'typeorm';
import { ChatbotConversation } from 'src/chatbot/entity/chatbot-conversation.entity';
import { ChatbotMessage } from 'src/chatbot/entity/chatbot-message.entity';
import { ConversationChannel } from 'src/chatbot/enum/conversation.enum';
import { ConversationService } from 'src/chatbot/service/conversation.service';
import { WaContact } from '../entity/wa-contact.entity';
import { WaConversation } from '../entity/wa-conversation.entity';
import { WaMessage } from '../entity/wa-message.entity';
import {
  contactIdsFor,
  sharedMessageOf,
  whatsappIdentityOf,
} from './wa-shared-store.mapper';

/**
 * Copies WhatsApp's history into the shared conversation store (Agents v2, chunk 12): threads with
 * their contacts first, then messages, in keyset batches.
 *
 * Every write is an upsert by the `wa_*` id, the same mapping the dual-write uses, so a run can be
 * repeated or resumed at any point, and a re-run also repairs whatever the dual-write missed or
 * the retention sweep has blanked since.
 *
 * Not copied, and counted instead: inbound rows discarded before their contact was known (their
 * thread is the placeholder id), and threads with no bot.
 */

/** Where a run stopped: the last row done in the current phase. */
export interface BackfillCursor {
  phase: 'conversations' | 'messages' | 'done';
  after?: { at: string; id: string };
}

export interface BackfillReport {
  conversations: number;
  messages: number;
  skippedNoBot: number;
  skippedNoThread: number;
  /** wa contacts that wrote to more than one bot: the later bots have derived contact ids. */
  splits: { waContactId: string; chatbotId: string; contactId: string }[];
  /** wa contacts whose number already had a contact on that bot (two numbers, one bot). */
  merges: { waContactId: string; chatbotId: string; contactId: string }[];
  cursor: BackfillCursor;
}

export interface BackfillOptions {
  batchSize?: number;
  dryRun?: boolean;
  from?: BackfillCursor;
  /** Called after every batch with the cursor to resume from. */
  onBatch?: (cursor: BackfillCursor, report: BackfillReport) => void;
}

/** The columns a re-run brings up to date on a message it already copied. */
const MUTABLE_MESSAGE_COLUMNS = [
  'status',
  'provider_message_id',
  'handled_by',
  'error_message',
  'text',
  'citations',
  'retrieval_meta',
];

export async function backfillSharedStore(
  dataSource: DataSource,
  options: BackfillOptions = {},
): Promise<BackfillReport> {
  const batchSize = options.batchSize ?? 500;
  const conversations = new ConversationService(
    dataSource,
    dataSource.getRepository(ChatbotConversation),
    dataSource.getRepository(ChatbotMessage),
  );
  const report: BackfillReport = {
    conversations: 0,
    messages: 0,
    skippedNoBot: 0,
    skippedNoThread: 0,
    splits: [],
    merges: [],
    cursor: options.from ?? { phase: 'conversations' },
  };
  const advance = (cursor: BackfillCursor) => {
    report.cursor = cursor;
    options.onBatch?.(cursor, report);
  };

  // ── Threads, with their contacts. Oldest first, so a number's first bot keeps the wa id.
  if (report.cursor.phase === 'conversations') {
    let after = report.cursor.after;
    for (;;) {
      const page = await nextPage(
        dataSource,
        'wa_conversations',
        'started_at',
        after,
        batchSize,
      );
      const batch = await loadInOrder(
        dataSource.getRepository(WaConversation),
        page,
      );
      if (!page.length) break;

      const contacts = new Map(
        (
          await dataSource.getRepository(WaContact).findBy({
            id: In([...new Set(batch.map((c) => c.contactId))]),
          })
        ).map((contact) => [contact.id, contact]),
      );
      for (const thread of batch) {
        const contact = contacts.get(thread.contactId);
        if (!thread.chatbotId || !contact) {
          report.skippedNoBot += 1;
          continue;
        }
        report.conversations += 1;
        if (options.dryRun) continue;

        const preferredIds = contactIdsFor(contact.id, thread.chatbotId);
        const identity = whatsappIdentityOf(contact);
        const shared = await conversations.resolveContact(
          { chatbotId: thread.chatbotId },
          ConversationChannel.WHATSAPP,
          identity.externalId,
          {
            verified: identity.verified,
            verifiedAt: identity.verifiedAt,
            preferredIds,
          },
        );
        const pair = {
          waContactId: contact.id,
          chatbotId: thread.chatbotId,
          contactId: shared.id,
        };
        if (shared.id === preferredIds[1]) {
          addOnce(report.splits, pair);
        } else if (shared.id !== preferredIds[0]) {
          addOnce(report.merges, pair);
        }
        await conversations.openConversation(
          thread.chatbotId,
          shared.id,
          ConversationChannel.WHATSAPP,
          {
            id: thread.id,
            startedAt: thread.startedAt,
            now: thread.lastMessageAt,
            connectorId: thread.connectorId ?? null,
          },
        );
      }
      after = page[page.length - 1];
      advance({ phase: 'conversations', after });
      if (page.length < batchSize) break;
    }
    advance({ phase: 'messages' });
  }

  // ── Messages, in the order they were written.
  if (report.cursor.phase === 'messages') {
    let after = report.cursor.after;
    for (;;) {
      const page = await nextPage(
        dataSource,
        'wa_messages',
        '"createdAt"',
        after,
        batchSize,
      );
      const batch = await loadInOrder(
        dataSource.getRepository(WaMessage),
        page,
      );
      if (!page.length) break;

      const threads = new Set(
        (
          await dataSource.getRepository(ChatbotConversation).findBy({
            id: In([...new Set(batch.map((m) => m.conversationId))]),
          })
        ).map((thread) => thread.id),
      );
      if (options.dryRun) {
        const copyable = await countWithThread(dataSource, batch);
        report.messages += copyable;
        report.skippedNoThread += batch.length - copyable;
      } else {
        const rows = batch.filter((m) => threads.has(m.conversationId));
        report.skippedNoThread += batch.length - rows.length;
        if (rows.length) {
          await dataSource
            .getRepository(ChatbotMessage)
            .createQueryBuilder()
            .insert()
            .into(ChatbotMessage)
            .values(
              rows.map((row) => ({
                ...sharedMessageOf(row),
                conversationId: row.conversationId,
              })),
            )
            .orUpdate(MUTABLE_MESSAGE_COLUMNS, ['id'])
            .execute();
          report.messages += rows.length;
        }
      }

      after = page[page.length - 1];
      advance({ phase: 'messages', after });
      if (page.length < batchSize) break;
    }
    advance({ phase: 'done' });
  }
  return report;
}

/**
 * The next page of ids after the cursor, in (timestamp, id) order. The cursor keeps Postgres's own
 * text of the timestamp: a JS Date holds milliseconds and the column holds microseconds, so a
 * cursor rebuilt from a Date would select the same rows again.
 */
async function nextPage(
  dataSource: DataSource,
  table: 'wa_conversations' | 'wa_messages',
  column: string,
  after: BackfillCursor['after'],
  limit: number,
): Promise<{ at: string; id: string }[]> {
  return dataSource.query(
    `SELECT id, ${column}::text AS at FROM ${table}
      ${after ? `WHERE (${column}, id) > ($1::timestamp, $2::uuid)` : ''}
      ORDER BY ${column}, id
      LIMIT ${Number(limit)}`,
    after ? [after.at, after.id] : [],
  );
}

async function loadInOrder<T extends { id: string }>(
  repository: Repository<T>,
  page: { id: string }[],
): Promise<T[]> {
  if (!page.length) return [];
  const rows = await repository.findBy({
    id: In(page.map((p) => p.id)),
  } as never);
  const byId = new Map(rows.map((row) => [row.id, row]));
  return page.map((p) => byId.get(p.id)).filter((row): row is T => !!row);
}

function addOnce(
  list: BackfillReport['splits'],
  pair: BackfillReport['splits'][number],
) {
  if (
    !list.some(
      (p) =>
        p.waContactId === pair.waContactId && p.chatbotId === pair.chatbotId,
    )
  ) {
    list.push(pair);
  }
}

/** How many of these messages sit in a wa thread that has a bot (what a real run would copy). */
async function countWithThread(
  dataSource: DataSource,
  batch: WaMessage[],
): Promise<number> {
  const [{ count }] = await dataSource.query(
    `SELECT COUNT(*)::int AS count
       FROM wa_messages m
       JOIN wa_conversations c ON c.id = m.conversation_id
      WHERE m.id = ANY($1::uuid[]) AND c.chatbot_id IS NOT NULL`,
    [batch.map((m) => m.id)],
  );
  return count;
}
