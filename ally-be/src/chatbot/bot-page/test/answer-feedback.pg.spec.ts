import { DataSource } from 'typeorm';
import {
  closeTestDataSource,
  describePg,
  openTestDataSource,
  resetTables,
  seedChatbot,
} from '../../../whatsapp/shared-store/test/shared-store.pg';
import { FEEDBACK_UPSERT } from '../answer-feedback.sql';

/**
 * The thumbs-down note on real Postgres (Q3d; prod 18 Nov). The bot page sends a bare thumbs down
 * on the tap and the reason and note on Send, unordered; whichever lands last, the owner sees the
 * reason and note. Runs only with CHATBOT_STORE_TEST_DB (see shared-store.pg.ts).
 */
describePg('Answer feedback upsert (Postgres)', () => {
  let dataSource: DataSource;
  let bot: string;
  let conversation: string;
  let answer: string;

  beforeAll(async () => {
    dataSource = await openTestDataSource();
  });
  afterAll(() => closeTestDataSource(dataSource));

  beforeEach(async () => {
    await resetTables(dataSource);
    await dataSource.query(`TRUNCATE chatbot_message_feedback`);
    bot = await seedChatbot(dataSource);
    const [contact] = await dataSource.query(
      `INSERT INTO chatbot_contacts (chatbot_id) VALUES ($1) RETURNING id`,
      [bot],
    );
    [{ id: conversation }] = await dataSource.query(
      `INSERT INTO chatbot_conversations (chatbot_id, contact_id, channel, started_at, last_message_at)
       VALUES ($1, $2, 'web', now(), now()) RETURNING id`,
      [bot, contact.id],
    );
    [{ id: answer }] = await dataSource.query(
      `INSERT INTO chatbot_messages (conversation_id, channel, direction, role, text, handled_by)
       VALUES ($1, 'web', 'outbound', 'assistant', 'A session is 1,200.', 'rag') RETURNING id`,
      [conversation],
    );
  });

  const rate = (
    rating: 'up' | 'down',
    reason: string | null = null,
    note: string | null = null,
  ) =>
    dataSource.query(FEEDBACK_UPSERT, [
      answer,
      bot,
      conversation,
      rating,
      reason,
      note,
    ]);

  const stored = async () =>
    (
      await dataSource.query(
        `SELECT rating, reason, note, status FROM chatbot_message_feedback WHERE message_id = $1`,
        [answer],
      )
    )[0];

  it('keeps the reason and note when the bare thumbs down lands after them', async () => {
    await rate('down', 'wrong_info', "It's 2,000 now");
    await rate('down');
    expect(await stored()).toEqual({
      rating: 'down',
      reason: 'wrong_info',
      note: "It's 2,000 now",
      status: 'open',
    });
  });

  it('adds the reason and note to a bare thumbs down', async () => {
    await rate('down');
    await rate('down', 'other', 'Asked about parking');
    expect(await stored()).toMatchObject({
      reason: 'other',
      note: 'Asked about parking',
    });
  });

  it('a new reason replaces the old one', async () => {
    await rate('down', 'wrong_info', 'old');
    await rate('down', 'not_answered', 'new');
    expect(await stored()).toMatchObject({
      reason: 'not_answered',
      note: 'new',
    });
  });

  it('a thumbs up clears them', async () => {
    await rate('down', 'wrong_info', 'old');
    await rate('up');
    expect(await stored()).toMatchObject({
      rating: 'up',
      reason: null,
      note: null,
    });
  });

  it("a repeat that says nothing new doesn't reopen what the owner handled", async () => {
    await rate('down', 'wrong_info', 'old');
    await dataSource.query(
      `UPDATE chatbot_message_feedback SET status = 'fine', handled_at = now()`,
    );
    await rate('down');
    expect(await stored()).toMatchObject({
      status: 'fine',
      reason: 'wrong_info',
    });
    await rate('down', 'wrong_info', 'Still wrong');
    expect(await stored()).toMatchObject({
      status: 'open',
      note: 'Still wrong',
    });
  });
});
