import { DataSource } from 'typeorm';
import {
  closeTestDataSource,
  describePg,
  openTestDataSource,
  resetTables,
  seedChatbot,
} from '../../../whatsapp/shared-store/test/shared-store.pg';
import { HandoverService } from '../../handover/handover.service';
import { InboxService } from '../inbox.service';

jest.mock('src/common/execution/execution-manager', () => ({
  ExecutionManager: {
    getUserId: () => 7,
    getTenantId: () => null,
    getExecutionId: () => undefined,
  },
}));

/**
 * The inbox on real Postgres (chunk 11a): two people taking over at the same instant (one wins),
 * and the list's order and unread counts. Runs only with CHATBOT_STORE_TEST_DB.
 */
describePg('Inbox (Postgres)', () => {
  let dataSource: DataSource;
  let bot: string;

  beforeAll(async () => {
    dataSource = await openTestDataSource();
  });
  afterAll(() => closeTestDataSource(dataSource));

  beforeEach(async () => {
    await resetTables(dataSource);
    await dataSource.query(`TRUNCATE chatbot_conversation_reads`);
    bot = await seedChatbot(dataSource);
    await dataSource
      .query(
        `INSERT INTO users (id, name, email, "createdAt", "updatedAt")
       VALUES (7, 'Asha Rao', 'asha@example.com', now(), now()), (8, 'Ravi Kumar', 'ravi@example.com', now(), now())
       ON CONFLICT (id) DO NOTHING`,
      )
      .catch(() => undefined);
  });

  async function chat(text: string, at: string, extra = ''): Promise<string> {
    const [contact] = await dataSource.query(
      `INSERT INTO chatbot_contacts (chatbot_id) VALUES ($1) RETURNING id`,
      [bot],
    );
    const [conversation] = await dataSource.query(
      `INSERT INTO chatbot_conversations (chatbot_id, contact_id, channel, started_at, last_message_at)
       VALUES ($1, $2, 'web', $3, $3) RETURNING id`,
      [bot, contact.id, at],
    );
    await dataSource.query(
      `INSERT INTO chatbot_messages (conversation_id, channel, direction, role, text, "createdAt")
       VALUES ($1, 'web', 'inbound', 'user', $2, $3)`,
      [conversation.id, text, at],
    );
    if (extra) {
      await dataSource.query(
        `UPDATE chatbot_conversations SET ${extra} WHERE id = $1`,
        [conversation.id],
      );
    }
    return conversation.id;
  }

  const handover = () =>
    new HandoverService(
      dataSource,
      {} as never,
      { publishInbox: jest.fn(), publishVisitor: jest.fn() } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

  it('two people taking over at once: exactly one wins', async () => {
    const id = await chat('Hello', '2026-11-09T10:00:00Z');
    const results = await Promise.allSettled([
      handover().takeOver(bot, id, 7),
      handover().takeOver(bot, id, 8),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    const [row] = await dataSource.query(
      `SELECT handled_by_user_id FROM chatbot_conversations WHERE id = $1`,
      [id],
    );
    expect([7, 8]).toContain(row.handled_by_user_id);
  });

  it('lists Safety first, then Needs a person, then the newest; unread until opened', async () => {
    const older = await chat('Old question', '2026-11-09T08:00:00Z');
    const needs = await chat(
      'Talk to a person',
      '2026-11-09T09:00:00Z',
      `needs_person_since = now(), needs_person_reason = 'asked'`,
    );
    const safety = await chat(
      'Crisis',
      '2026-11-09T07:00:00Z',
      'safety_at = now()',
    );
    const newest = await chat('New question', '2026-11-09T11:00:00Z');
    const inbox = new InboxService(dataSource, {
      accessibleChatbotIds: async () => null,
    } as never);

    const list = await inbox.list();
    expect(list.map((c) => c.id)).toEqual([safety, needs, newest, older]);
    expect(list.find((c) => c.id === needs)).toMatchObject({
      state: 'needs_person',
      needsPersonReason: 'asked',
      unread: 1,
      visitor: 'Visitor',
    });
    expect(
      (await inbox.list({ view: 'needs_person' })).map((c) => c.id),
    ).toEqual([needs]);

    await dataSource.query(
      `INSERT INTO chatbot_conversation_reads (conversation_id, user_id, read_at) VALUES ($1, 7, now())`,
      [newest],
    );
    expect((await inbox.list()).find((c) => c.id === newest)?.unread).toBe(0);
    expect(await inbox.counts()).toEqual({
      unread: 3,
      needsPerson: 1,
      safety: 1,
    });
  });
});
