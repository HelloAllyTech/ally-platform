/**
 * Compares WhatsApp's tables with the shared conversation store (Agents v2, chunk 12) and prints
 * every difference. Exits 1 on any. See docs/agents-v2/CHUNK-12-NOTES.md.
 *
 *   npm run check:chatbot-shared-store
 *   npm run check:chatbot-shared-store -- --sample 200 --settle-minutes 10
 *   npm run check:chatbot-shared-store -- --conversation <wa conversation id>
 */

import { config as loadEnv } from 'dotenv';
loadEnv();

import {
  checkSharedStore,
  skippedByDesign,
} from '../../whatsapp/shared-store/wa-shared-store.check';
import { sharedStoreDataSource } from '../../whatsapp/shared-store/wa-shared-store.data-source';

const arg = (name: string): string | undefined => {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
};
const all = (name: string): string[] =>
  process.argv.flatMap((value, index) =>
    process.argv[index - 1] === name ? [value] : [],
  );

async function main(): Promise<number> {
  const dataSource = await sharedStoreDataSource().initialize();
  try {
    const report = await checkSharedStore(dataSource, {
      sample: Number(arg('--sample') ?? 50),
      settleMinutes: Number(arg('--settle-minutes') ?? 5),
      conversationIds: all('--conversation'),
    });
    const skipped = await skippedByDesign(dataSource);
    console.log(
      `Checked ${report.bots} bot(s), ${report.sampledThreads} thread(s), ` +
        `${report.comparedMessages} message(s). Not copied by design: ` +
        `${skipped.noThread} message(s) with no thread, ${skipped.noBot} thread(s) with no bot.`,
    );
    if (!report.mismatches.length) {
      console.log('No mismatches.');
      return 0;
    }
    console.log(`${report.mismatches.length} mismatch(es):`);
    for (const line of report.mismatches) console.log(`  ${line}`);
    return 1;
  } finally {
    await dataSource.destroy();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
