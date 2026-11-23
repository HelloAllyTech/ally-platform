import { DataSource } from 'typeorm';
import {
  closeTestDataSource,
  describePg,
  openTestDataSource,
  resetTables,
  seedChatbot,
} from '../../../whatsapp/shared-store/test/shared-store.pg';

/**
 * Stage 7 on real Postgres (migration 1987600000000): an older instance that inserts a page without
 * `public_id` still gets a valid address from the column default, and the unique indexes keep
 * addresses and custom domains unique.
 */
describePg('Bot page address and custom domains (Postgres)', () => {
  let dataSource: DataSource;
  let bot: string;

  beforeAll(async () => {
    dataSource = await openTestDataSource();
  });
  afterAll(async () => closeTestDataSource(dataSource));
  beforeEach(async () => {
    await resetTables(dataSource);
    await dataSource.query(
      `TRUNCATE chatbot_pages, chatbot_domains, widget_sites CASCADE`,
    );
    bot = await seedChatbot(dataSource, 'Sunrise');
  });

  const insertPage = (chatbotId: string, slug: string, publicId?: string) =>
    dataSource.query(
      publicId
        ? `INSERT INTO chatbot_pages (chatbot_id, slug, public_id) VALUES ($1, $2, $3) RETURNING public_id`
        : `INSERT INTO chatbot_pages (chatbot_id, slug) VALUES ($1, $2) RETURNING public_id`,
      publicId ? [chatbotId, slug, publicId] : [chatbotId, slug],
    );

  it('gives a page inserted without an address (an older instance) a valid one', async () => {
    const [row] = await insertPage(bot, 'sunrise');
    expect(row.public_id).toMatch(/^[a-z0-9]{8}$/);
  });

  it('refuses a second page with the same address', async () => {
    const other = await seedChatbot(dataSource, 'Other');
    await insertPage(bot, 'sunrise', 'k7m2p9qa');
    await expect(insertPage(other, 'other', 'k7m2p9qa')).rejects.toMatchObject({
      code: '23505',
    });
  });

  it('refuses the same custom domain twice, ignoring case', async () => {
    const other = await seedChatbot(dataSource, 'Other');
    const add = (chatbotId: string, host: string) =>
      dataSource.query(
        `INSERT INTO chatbot_domains (chatbot_id, host, verification_token) VALUES ($1, $2, 'tok')`,
        [chatbotId, host],
      );
    await add(bot, 'chat.sunrisemind.in');
    await expect(add(other, 'CHAT.sunrisemind.in')).rejects.toMatchObject({
      code: '23505',
    });
    await expect(
      dataSource.query(
        `INSERT INTO chatbot_domains (chatbot_id, host, verification_token, status) VALUES ($1, 'x.example.org', 't', 'bogus')`,
        [bot],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('keeps one widget-site row per assistant and host', async () => {
    const add = () =>
      dataSource.query(
        `INSERT INTO widget_sites (chatbot_id, host) VALUES ($1, 'www.example.org')`,
        [bot],
      );
    await add();
    await expect(add()).rejects.toMatchObject({ code: '23505' });
  });
});
