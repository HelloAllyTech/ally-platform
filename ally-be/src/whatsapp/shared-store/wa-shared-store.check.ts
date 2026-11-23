import { isDeepStrictEqual } from 'util';
import { DataSource } from 'typeorm';
import { PLACEHOLDER_ID } from './wa-shared-store.mapper';

/**
 * Compares WhatsApp's tables with the shared conversation store (Agents v2, chunk 12) and lists
 * every difference. `wa_*` is the source of truth, so every difference is the shared store's.
 *
 *  1. Per bot: threads and messages in each store.
 *  2. A sample of threads (plus any named): the thread itself and its last 100 messages, field by
 *     field.
 *  3. Identities: every wa thread's shared contact is recognised by that thread's number (or both
 *     sides are erased).
 *  4. Orphans: no shared WhatsApp thread or message without its wa row.
 *
 * Rows written in the last `settleMinutes` are left out: the dual-write may still be on its way.
 * Timestamps are compared to the millisecond, the precision a copied row keeps.
 */
export interface CheckOptions {
  sample?: number;
  conversationIds?: string[];
  settleMinutes?: number;
  /** Most messages compared per sampled thread. */
  messagesPerThread?: number;
}

export interface CheckReport {
  mismatches: string[];
  bots: number;
  sampledThreads: number;
  comparedMessages: number;
}

/** The message fields compared, as `wa_messages` names them, each with its shared column. */
const MESSAGE_FIELDS: [string, string][] = [
  ['id', 'id'],
  ['conversation_id', 'conversation_id'],
  ['direction', 'direction'],
  ['body', 'text'],
  ['status', 'status'],
  ['handled_by', 'handled_by'],
  ['provider_message_id', 'provider_message_id'],
  ['"createdAt"', '"createdAt"'],
  ['citations', 'citations'],
  ['retrieval_meta', 'retrieval_meta'],
  ['agent_run_id', 'agent_run_id'],
  ['agent_runtime', 'agent_runtime'],
  ['language', 'language'],
  ['template_id', 'template_id'],
  ['latency_ms', 'latency_ms'],
  ['error_message', 'error_message'],
  ['in_reply_to_id', 'in_reply_to_id'],
];

export async function checkSharedStore(
  dataSource: DataSource,
  options: CheckOptions = {},
): Promise<CheckReport> {
  const settle = new Date(Date.now() - (options.settleMinutes ?? 5) * 60_000);
  const perThread = options.messagesPerThread ?? 100;
  const mismatches: string[] = [];
  const report: CheckReport = {
    mismatches,
    bots: 0,
    sampledThreads: 0,
    comparedMessages: 0,
  };

  // ── 1. Counts per bot.
  const counts: {
    chatbot_id: string;
    wa_threads: number;
    shared_threads: number;
    wa_messages: number;
    shared_messages: number;
  }[] = await dataSource.query(
    `WITH wa AS (
       SELECT c.chatbot_id,
              COUNT(DISTINCT c.id)::int AS threads,
              COUNT(m.id) FILTER (WHERE m."createdAt" < $1)::int AS messages
         FROM wa_conversations c
         LEFT JOIN wa_messages m ON m.conversation_id = c.id
        WHERE c.chatbot_id IS NOT NULL AND c.started_at < $1
        GROUP BY c.chatbot_id),
     shared AS (
       SELECT c.chatbot_id,
              COUNT(DISTINCT c.id)::int AS threads,
              COUNT(m.id) FILTER (WHERE m."createdAt" < $1)::int AS messages
         FROM chatbot_conversations c
         LEFT JOIN chatbot_messages m ON m.conversation_id = c.id
        WHERE c.channel = 'whatsapp' AND c.started_at < $1
        GROUP BY c.chatbot_id)
     SELECT COALESCE(wa.chatbot_id, shared.chatbot_id) AS chatbot_id,
            COALESCE(wa.threads, 0) AS wa_threads,
            COALESCE(shared.threads, 0) AS shared_threads,
            COALESCE(wa.messages, 0) AS wa_messages,
            COALESCE(shared.messages, 0) AS shared_messages
       FROM wa FULL JOIN shared ON shared.chatbot_id = wa.chatbot_id`,
    [settle],
  );
  report.bots = counts.length;
  for (const row of counts) {
    if (row.wa_threads !== row.shared_threads) {
      mismatches.push(
        `bot ${row.chatbot_id}: ${row.wa_threads} wa thread(s), ${row.shared_threads} shared`,
      );
    }
    if (row.wa_messages !== row.shared_messages) {
      mismatches.push(
        `bot ${row.chatbot_id}: ${row.wa_messages} wa message(s), ${row.shared_messages} shared`,
      );
    }
  }

  // ── 2. A sample of threads, field by field.
  const sampled: { id: string }[] = await dataSource.query(
    `SELECT id FROM wa_conversations
      WHERE chatbot_id IS NOT NULL AND started_at < $1
      ORDER BY random() LIMIT $2`,
    [settle, options.sample ?? 50],
  );
  const threadIds = [
    ...new Set([
      ...sampled.map((row) => row.id),
      ...(options.conversationIds ?? []),
    ]),
  ];
  report.sampledThreads = threadIds.length;
  for (const id of threadIds) {
    const [wa] = await dataSource.query(
      `SELECT chatbot_id, started_at, connector_id FROM wa_conversations WHERE id = $1`,
      [id],
    );
    const [shared] = await dataSource.query(
      `SELECT chatbot_id, started_at, connector_id FROM chatbot_conversations WHERE id = $1`,
      [id],
    );
    if (!wa) {
      mismatches.push(`thread ${id}: not in wa_conversations`);
      continue;
    }
    if (!shared) {
      mismatches.push(`thread ${id}: missing from the shared store`);
      continue;
    }
    for (const field of Object.keys(wa)) {
      if (!same(wa[field], shared[field])) {
        mismatches.push(`thread ${id}: ${field} differs`);
      }
    }

    const waMessages = await lastMessages(
      dataSource,
      'wa_messages',
      MESSAGE_FIELDS.map(([waColumn]) => waColumn),
      id,
      settle,
      perThread,
    );
    const sharedMessages = await lastMessages(
      dataSource,
      'chatbot_messages',
      MESSAGE_FIELDS.map(
        ([waColumn, column]) => `${column} AS "${waColumn.replace(/"/g, '')}"`,
      ),
      id,
      settle,
      perThread,
    );
    report.comparedMessages += waMessages.length;
    const sharedById = new Map(sharedMessages.map((m) => [m.id, m]));
    for (const message of waMessages) {
      const copy = sharedById.get(message.id);
      if (!copy) {
        mismatches.push(`message ${message.id} (thread ${id}): missing`);
        continue;
      }
      for (const [waColumn] of MESSAGE_FIELDS) {
        const field = waColumn.replace(/"/g, '');
        if (!same(message[field], copy[field])) {
          mismatches.push(
            `message ${message.id} (thread ${id}): ${field} differs`,
          );
        }
      }
    }
    if (sharedMessages.length !== waMessages.length) {
      mismatches.push(
        `thread ${id}: last ${perThread} hold ${waMessages.length} wa message(s), ` +
          `${sharedMessages.length} shared`,
      );
    }
  }

  // ── 3. Identities.
  const identities: { thread: string; problem: string }[] =
    await dataSource.query(
      `SELECT w.id AS thread,
            CASE WHEN s.id IS NULL THEN 'no shared thread'
                 WHEN i.id IS NULL THEN 'its contact has no whatsapp identity on this bot'
                 ELSE 'its contact is recognised by another number' END AS problem
       FROM wa_conversations w
       JOIN wa_contacts k ON k.id = w.contact_id
       LEFT JOIN chatbot_conversations s ON s.id = w.id
       LEFT JOIN chatbot_contact_identities i
              ON i.contact_id = s.contact_id AND i.channel = 'whatsapp'
             AND i.chatbot_id = w.chatbot_id
      WHERE w.chatbot_id IS NOT NULL AND w.started_at < $1
        AND (s.id IS NULL OR i.id IS NULL
             OR NOT (i.external_id = k.phone_e164
                     OR (i.external_id LIKE 'erased:%' AND k.phone_e164 LIKE 'erased:%')))
      LIMIT 100`,
      [settle],
    );
  for (const row of identities) {
    mismatches.push(`thread ${row.thread}: ${row.problem}`);
  }

  // ── 4. Orphans: shared WhatsApp rows with no wa row behind them.
  const [orphans] = await dataSource.query(
    `SELECT
       (SELECT COUNT(*)::int FROM chatbot_conversations s
         WHERE s.channel = 'whatsapp'
           AND NOT EXISTS (SELECT 1 FROM wa_conversations w WHERE w.id = s.id)) AS threads,
       (SELECT COUNT(*)::int FROM chatbot_messages s
         WHERE s.channel = 'whatsapp'
           AND NOT EXISTS (SELECT 1 FROM wa_messages w WHERE w.id = s.id)) AS messages`,
  );
  if (orphans.threads) {
    mismatches.push(
      `${orphans.threads} shared thread(s) with no wa_conversations row`,
    );
  }
  if (orphans.messages) {
    mismatches.push(
      `${orphans.messages} shared message(s) with no wa_messages row`,
    );
  }

  return report;
}

/** What the backfill skips by design, for the report: never mismatches. */
export async function skippedByDesign(
  dataSource: DataSource,
): Promise<{ noThread: number; noBot: number }> {
  const [row] = await dataSource.query(
    `SELECT
       (SELECT COUNT(*)::int FROM wa_messages WHERE conversation_id = $1) AS no_thread,
       (SELECT COUNT(*)::int FROM wa_conversations WHERE chatbot_id IS NULL) AS no_bot`,
    [PLACEHOLDER_ID],
  );
  return { noThread: row.no_thread, noBot: row.no_bot };
}

async function lastMessages(
  dataSource: DataSource,
  table: 'wa_messages' | 'chatbot_messages',
  columns: string[],
  conversationId: string,
  settle: Date,
  limit: number,
): Promise<Record<string, any>[]> {
  return dataSource.query(
    `SELECT ${columns.join(', ')} FROM ${table}
      WHERE conversation_id = $1 AND "createdAt" < $2
      ORDER BY "createdAt" DESC, id DESC
      LIMIT ${Number(limit)}`,
    [conversationId, settle],
  );
}

/** Equal, with timestamps compared to the millisecond a copied row keeps. */
function same(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) {
    return a.getTime() === b.getTime();
  }
  return isDeepStrictEqual(a ?? null, b ?? null);
}
