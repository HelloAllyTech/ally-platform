import { DataSource, QueryRunner } from 'typeorm';
import { SHARED_STORE_ENTITIES } from '../wa-shared-store.data-source';

/**
 * Specs that need real Postgres: the shared store's upserts, unique indexes and jsonb merges are
 * exactly what mocked repositories cannot check.
 *
 * They run only when `CHATBOT_STORE_TEST_DB` is a connection URL to a scratch database migrated to
 * the latest schema, and are skipped otherwise (as in CI). The database is TRUNCATED between tests,
 * so its name must end in `_test` or `_fresh`; anything else is refused. CHUNK-12-NOTES.md says
 * how to make one.
 */
const URL = process.env.CHATBOT_STORE_TEST_DB;

export const describePg = URL ? describe : describe.skip;

const SUITE_LOCK = 1_201_212;
const locks = new Map<DataSource, QueryRunner>();

export async function openTestDataSource(): Promise<DataSource> {
  const name = new globalThis.URL(URL!).pathname.replace(/^\//, '');
  if (!/(_test|_fresh)$/.test(name)) {
    throw new Error(
      `Refusing to run against "${name}": these specs truncate tables, so the database name ` +
        `must end in _test or _fresh.`,
    );
  }
  const dataSource = new DataSource({
    type: 'postgres',
    url: URL,
    entities: SHARED_STORE_ENTITIES,
    synchronize: false,
    logging: false,
  });
  await dataSource.initialize();
  // One suite at a time: they share the database and truncate it, and jest runs suites in
  // parallel workers. The lock is held by its own connection until closeTestDataSource.
  const lock = dataSource.createQueryRunner();
  await lock.connect();
  await lock.query(`SELECT pg_advisory_lock($1)`, [SUITE_LOCK]);
  locks.set(dataSource, lock);
  return dataSource;
}

export async function closeTestDataSource(
  dataSource: DataSource | undefined,
): Promise<void> {
  if (!dataSource) return;
  const lock = locks.get(dataSource);
  if (lock) {
    await lock.query(`SELECT pg_advisory_unlock($1)`, [SUITE_LOCK]);
    await lock.release();
  }
  await dataSource.destroy();
}

export async function resetTables(dataSource: DataSource): Promise<void> {
  await dataSource.query(
    `TRUNCATE chatbot_messages, chatbot_conversations, chatbot_contact_identities,
              chatbot_contacts, wa_unanswered_questions, wa_messages, wa_conversations,
              wa_contacts, chatbots CASCADE`,
  );
}

export async function seedChatbot(
  dataSource: DataSource,
  name = 'Test bot',
): Promise<string> {
  const [row] = await dataSource.query(
    `INSERT INTO chatbots (name, created_by, status) VALUES ($1, 1, 'live') RETURNING id`,
    [name],
  );
  return row.id;
}

/** A WhatsApp contact, thread and messages as the inbound handler would have written them. */
export async function seedWhatsAppThread(
  dataSource: DataSource,
  options: {
    chatbotId: string;
    phone?: string;
    contactId?: string;
    startedAt?: Date;
    messages: {
      body: string;
      direction?: 'inbound' | 'outbound';
      at: Date;
      providerMessageId?: string | null;
      status?: string;
    }[];
  },
): Promise<{
  contactId: string;
  conversationId: string;
  messageIds: string[];
}> {
  const phone = options.phone ?? '919800000001';
  const first = options.messages[0]?.at ?? new Date();
  const last = options.messages[options.messages.length - 1]?.at ?? first;
  const contactId =
    options.contactId ??
    (
      await dataSource.query(
        `INSERT INTO wa_contacts (phone_e164, phone_last4, first_seen_at, last_seen_at, message_count)
         VALUES ($1::varchar, right($1::text, 4), $2, $3, $4) RETURNING id`,
        [phone, first, last, options.messages.length],
      )
    )[0].id;
  const [conversation] = await dataSource.query(
    `INSERT INTO wa_conversations (contact_id, chatbot_id, started_at, last_message_at, message_count)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [
      contactId,
      options.chatbotId,
      options.startedAt ?? first,
      last,
      options.messages.length,
    ],
  );
  const messageIds: string[] = [];
  for (const [index, message] of options.messages.entries()) {
    const [row] = await dataSource.query(
      `INSERT INTO wa_messages (conversation_id, contact_id, direction, provider_message_id, body, status, "createdAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        conversation.id,
        contactId,
        message.direction ?? (index % 2 ? 'outbound' : 'inbound'),
        message.providerMessageId === undefined
          ? `wamid.${conversation.id}.${index}`
          : message.providerMessageId,
        message.body,
        message.status ?? 'sent',
        message.at,
      ],
    );
    messageIds.push(row.id);
  }
  return { contactId, conversationId: conversation.id, messageIds };
}
