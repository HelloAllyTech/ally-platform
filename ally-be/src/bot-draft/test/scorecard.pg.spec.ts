import { DataSource } from 'typeorm';
import {
  closeTestDataSource,
  describePg,
  openTestDataSource,
  resetTables,
  seedChatbot,
} from '../../whatsapp/shared-store/test/shared-store.pg';
import { ScorecardService } from '../scorecard/scorecard.service';

jest.mock('src/common/execution/execution-manager', () => ({
  ExecutionManager: {
    getUserId: () => 7,
    getTenantId: () => null,
    getExecutionId: () => undefined,
  },
}));

/**
 * The scorecard's rollup on real Postgres (chunk Q2a): a seeded week of messages becomes the
 * right numbers per India day, the job writes them, and the Overview reads the same numbers the
 * service computes. Runs only with CHATBOT_STORE_TEST_DB (see shared-store.pg.ts).
 */
describePg('Scorecard rollup (Postgres)', () => {
  let dataSource: DataSource;
  let service: ScorecardService;
  let bot: string;

  beforeAll(async () => {
    dataSource = await openTestDataSource();
    service = new ScorecardService(
      dataSource,
      { assert: async () => ({}) } as never,
      { latestFor: async () => null } as never,
      {} as never,
      {} as never,
    );
  });
  afterAll(() => closeTestDataSource(dataSource));

  beforeEach(async () => {
    await resetTables(dataSource);
    await dataSource.query(
      `TRUNCATE chatbot_daily_stats, chatbot_message_feedback`,
    );
    bot = await seedChatbot(dataSource);
  });

  /** One web conversation on `at` (UTC): a question and the reply. */
  async function exchange(
    at: string,
    reply: { handledBy: string; citations?: number; top?: number; ms?: number },
    rating?: 'up' | 'down',
  ) {
    const [contact] = await dataSource.query(
      `INSERT INTO chatbot_contacts (chatbot_id) VALUES ($1) RETURNING id`,
      [bot],
    );
    const [conversation] = await dataSource.query(
      `INSERT INTO chatbot_conversations (chatbot_id, contact_id, channel, started_at, last_message_at)
       VALUES ($1, $2, 'web', $3, $3) RETURNING id`,
      [bot, contact.id, at],
    );
    const [question] = await dataSource.query(
      `INSERT INTO chatbot_messages (conversation_id, channel, direction, role, text, "createdAt")
       VALUES ($1, 'web', 'inbound', 'user', 'How much is a session?', $2) RETURNING id`,
      [conversation.id, at],
    );
    const [answer] = await dataSource.query(
      `INSERT INTO chatbot_messages (conversation_id, channel, direction, role, text, handled_by,
         citations, retrieval_meta, latency_ms, in_reply_to_id, "createdAt")
       VALUES ($1, 'web', 'outbound', 'assistant', 'Reply.', $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        conversation.id,
        reply.handledBy,
        JSON.stringify(
          Array.from({ length: reply.citations ?? 0 }, (_, i) => ({ n: i })),
        ),
        JSON.stringify({
          top_similarity: reply.top ?? 0.2,
          decline_similarity: 0.42,
        }),
        reply.ms ?? 5000,
        question.id,
        at,
      ],
    );
    if (rating) {
      await dataSource.query(
        `INSERT INTO chatbot_message_feedback (message_id, chatbot_id, conversation_id, rating)
         VALUES ($1, $2, $3, $4)`,
        [answer.id, bot, conversation.id, rating],
      );
    }
  }

  it('counts each signal on the India day it happened', async () => {
    // Monday 9 Nov in India.
    await exchange(
      '2026-11-09T05:00:00Z',
      { handledBy: 'rag', citations: 2 },
      'up',
    );
    await exchange('2026-11-09T06:00:00Z', { handledBy: 'rag', citations: 0 });
    await exchange(
      '2026-11-09T07:00:00Z',
      { handledBy: 'declined', top: 0.6 },
      'down',
    );
    await exchange('2026-11-09T08:00:00Z', { handledBy: 'declined', top: 0.1 });
    await exchange('2026-11-09T09:00:00Z', { handledBy: 'crisis' });
    // 20:00 UTC on Monday is Tuesday in India.
    await exchange('2026-11-09T20:00:00Z', { handledBy: 'rag', citations: 1 });

    const days = (await service.compute([bot], '2026-11-09', '2026-11-11')).get(
      bot,
    )!;
    const monday = days.find((d) => d.day === '2026-11-09')!;
    expect(monday).toMatchObject({
      conversations: 5,
      answers: 4,
      answeredWithSource: 1,
      declined: 2,
      wrongDeclineSuspected: 1,
      crisis: 1,
      thumbsUp: 1,
      thumbsDown: 1,
      handedOver: 0,
    });
    expect(days.find((d) => d.day === '2026-11-10')).toMatchObject({
      conversations: 1,
      answeredWithSource: 1,
    });
  });

  it('the job writes what the service computes, and the Overview reads it back', async () => {
    await exchange('2026-11-10T05:00:00Z', { handledBy: 'rag', citations: 1 });
    await exchange('2026-11-11T05:00:00Z', { handledBy: 'declined' });
    await dataSource.query(
      `UPDATE chatbot_conversations SET last_message_at = now()`,
    );
    const now = new Date('2026-11-11T12:00:00Z');
    await service.rollupRecent(now);
    const computed = (
      await service.compute([bot], '2026-11-10', '2026-11-12')
    ).get(bot)!;
    const read = await service.days(bot, '2026-11-10', '2026-11-12', now);
    expect(read).toEqual(computed);
    const rows = await dataSource.query(
      `SELECT day::text, answers FROM chatbot_daily_stats ORDER BY day`,
    );
    expect(rows).toEqual([
      { day: '2026-11-10', answers: 1 },
      { day: '2026-11-11', answers: 1 },
    ]);
  });
});
