import { DataSource } from 'typeorm';
import { ChatbotConversation } from '../../entity/chatbot-conversation.entity';
import { ChatbotMessage } from '../../entity/chatbot-message.entity';
import { ListFieldType } from '../../enum/list.enum';
import { ConversationService } from '../../service/conversation.service';
import {
  closeTestDataSource,
  describePg,
  openTestDataSource,
  resetTables,
  seedChatbot,
} from '../../../whatsapp/shared-store/test/shared-store.pg';
import { ListDefinitionsService } from '../list-definitions.service';
import { LIST_ENTITIES } from '../list-entities';
import { ListRecordsService } from '../list-records.service';
import { seedLists } from '../list-seed';
import type { ListActor } from '../list-types';

const OWNER: ListActor = { kind: 'user', userId: 1 };
const PLACEHOLDERS = { text: '[erased]', erasedPrefix: 'erased:' };

/**
 * Chunk 6b, item 13: erasing a person reaches their list entries. Entries of a list whose person
 * field is them go; any other relation-to-contact field pointing at them is blanked, in the entry
 * and in its history. Only an explicit erase: the retention sweep leaves list entries alone.
 */
describePg('Erasure reaches list entries (Postgres)', () => {
  let ds: DataSource;
  let conversations: ConversationService;
  let records: ListRecordsService;
  let definitions: ListDefinitionsService;
  let bot: string;
  let person: string;
  let other: string;
  let booking: string;
  let referral: string;
  let keptBooking: string;

  beforeAll(async () => {
    ds = await openTestDataSource(LIST_ENTITIES);
    conversations = new ConversationService(
      ds,
      ds.getRepository(ChatbotConversation),
      ds.getRepository(ChatbotMessage),
    );
    records = new ListRecordsService(ds);
    definitions = new ListDefinitionsService(ds);
  });
  afterAll(async () => closeTestDataSource(ds));

  beforeEach(async () => {
    await resetTables(ds);
    bot = await seedChatbot(ds, 'Lakeview');
    person = (await seedLists(ds, bot)).testPersonId;
    const [row] = await ds.query(
      `INSERT INTO chatbot_contacts (chatbot_id, display_name) VALUES ($1, 'Other') RETURNING id`,
      [bot],
    );
    other = row.id;
    // A list where a contact is named but isn't the list's person.
    await definitions.createList(bot, {
      key: 'referrals',
      name: 'Referrals',
      fields: [
        { key: 'note', label: 'Note', type: ListFieldType.TEXT },
        {
          key: 'referred_by',
          label: 'Referred by',
          type: ListFieldType.RELATION,
          options: { to: 'contact' },
        },
      ],
    });
    const slots = (await records.query(bot, 'slots', OWNER, { limit: 10 }))
      .records;
    booking = (
      await records.create(bot, 'appointments', OWNER, {
        slot: slots[0].id,
        client: person,
      })
    ).record.id;
    keptBooking = (
      await records.create(bot, 'appointments', OWNER, {
        slot: slots[1].id,
        client: other,
      })
    ).record.id;
    referral = (
      await records.create(bot, 'referrals', OWNER, {
        note: 'Walk-in',
        referred_by: person,
      })
    ).record.id;
    // A history entry for the referral, as an edit leaves one.
    await records.update(
      bot,
      'referrals',
      OWNER,
      referral,
      { note: 'Walk-in, Thursday' },
      1,
    );
  });

  const live = async (id: string) =>
    (
      await ds.query(
        `SELECT data FROM collection_records WHERE id = $1 AND deleted_at IS NULL`,
        [id],
      )
    )[0]?.data as Record<string, unknown> | undefined;

  it('an erase deletes their entries and blanks every other link to them', async () => {
    await conversations.eraseContact(person, PLACEHOLDERS);

    expect(await live(booking)).toBeUndefined();
    const [{ n: events }] = await ds.query(
      `SELECT count(*)::int AS n FROM record_events WHERE record_id = $1`,
      [booking],
    );
    expect(events).toBe(0);
    // Someone else's entry stays.
    expect(await live(keptBooking)).toMatchObject({ client: other });
    // The referral stays, without them.
    const data = await live(referral);
    expect(data).toEqual({ note: 'Walk-in, Thursday' });
    const history = await ds.query(
      `SELECT before, after FROM record_events WHERE record_id = $1`,
      [referral],
    );
    expect(history.length).toBeGreaterThan(0);
    expect(JSON.stringify(history)).not.toContain(person);
    const [{ n: links }] = await ds.query(
      `SELECT count(*)::int AS n FROM record_links WHERE target_id = $1`,
      [person],
    );
    expect(links).toBe(0);
  });

  it('a retention pass leaves list entries untouched', async () => {
    const before = await ds.query(
      `SELECT id, data FROM collection_records ORDER BY id`,
    );
    await conversations.blankBefore(
      new Date(Date.now() + 86_400_000),
      PLACEHOLDERS,
    );
    expect(
      await ds.query(`SELECT id, data FROM collection_records ORDER BY id`),
    ).toEqual(before);
    expect(await live(booking)).toMatchObject({ client: person });
  });
});
