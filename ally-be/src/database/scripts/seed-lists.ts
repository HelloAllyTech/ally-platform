/**
 * `npm run lists:seed -- --bot <chatbot id>` (Agents v2, chunk 5a): Slots, Appointments, Classes
 * and Bookings on a local test bot, with next week's slots and a "Test person" contact. Running it
 * again changes nothing. Refuses to run in production.
 *
 * In the local Docker stack: `docker exec -w /app ally-be-app-1 npm run lists:seed -- --bot <id>`.
 */
import { config as loadEnv } from 'dotenv';
loadEnv();

import { DataSource } from 'typeorm';
import { LIST_ENTITIES } from '../../chatbot/lists/list-entities';
import { seedLists } from '../../chatbot/lists/list-seed';

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'lists:seed is for building and testing; it never runs in production.',
    );
  }
  const index = process.argv.indexOf('--bot');
  const chatbotId = index >= 0 ? process.argv[index + 1] : undefined;
  if (!chatbotId || !/^[0-9a-f-]{36}$/i.test(chatbotId)) {
    throw new Error('Usage: npm run lists:seed -- --bot <chatbot id>');
  }
  if (!process.env.DB_DATABASE) {
    throw new Error('DB_DATABASE is not defined. Did you load your .env file?');
  }
  const dataSource = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    entities: LIST_ENTITIES,
    synchronize: false,
  });
  await dataSource.initialize();
  try {
    const result = await seedLists(dataSource, chatbotId);
    console.log(`Bot ${chatbotId}`);
    for (const list of result.lists) {
      console.log(
        `  ${list.key.padEnd(13)} ${list.id}  ${list.created ? 'created' : 'already there'}, ${list.records} entries`,
      );
    }
    console.log(`Test person: ${result.testPersonId}`);
  } finally {
    await dataSource.destroy();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
