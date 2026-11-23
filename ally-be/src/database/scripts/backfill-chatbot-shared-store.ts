/**
 * Copies WhatsApp's conversations (wa_contacts, wa_conversations, wa_messages) into the shared
 * conversation store (chatbot_*), Agents v2 chunk 12. See docs/agents-v2/CHUNK-12-NOTES.md.
 *
 * Safe to re-run: every write is an upsert by the wa_* id, and a re-run also repairs whatever the
 * dual-write missed. Resumable: the cursor is saved after every batch.
 *
 *   npm run backfill:chatbot-shared-store -- --dry-run          # count only
 *   npm run backfill:chatbot-shared-store                       # full run
 *   npm run backfill:chatbot-shared-store -- --batch 200 --cursor-file /tmp/cursor.json
 *   npm run backfill:chatbot-shared-store -- --from-cursor '{"phase":"messages"}'
 */

import { config as loadEnv } from 'dotenv';
loadEnv();

import { existsSync, readFileSync, writeFileSync } from 'fs';
import {
  BackfillCursor,
  backfillSharedStore,
} from '../../whatsapp/shared-store/wa-shared-store.backfill';
import { sharedStoreDataSource } from '../../whatsapp/shared-store/wa-shared-store.data-source';

const arg = (name: string): string | undefined => {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
};

const DRY_RUN = process.argv.includes('--dry-run');
const BATCH = Number(arg('--batch') ?? 500);
const CURSOR_FILE =
  arg('--cursor-file') ?? '.backfill-chatbot-shared-store.cursor.json';

function startingCursor(): BackfillCursor | undefined {
  const given = arg('--from-cursor');
  if (given) return JSON.parse(given) as BackfillCursor;
  if (process.argv.includes('--resume') && existsSync(CURSOR_FILE)) {
    return JSON.parse(readFileSync(CURSOR_FILE, 'utf8')) as BackfillCursor;
  }
  return undefined;
}

async function main(): Promise<void> {
  const dataSource = await sharedStoreDataSource().initialize();
  try {
    const from = startingCursor();
    console.log(
      `Backfilling the shared store${DRY_RUN ? ' (dry run)' : ''}, batches of ${BATCH}` +
        (from ? `, from ${JSON.stringify(from)}` : ''),
    );
    const report = await backfillSharedStore(dataSource, {
      batchSize: BATCH,
      dryRun: DRY_RUN,
      from,
      onBatch: (cursor, progress) => {
        if (!DRY_RUN) writeFileSync(CURSOR_FILE, JSON.stringify(cursor));
        console.log(
          `  ${cursor.phase}: ${progress.conversations} thread(s), ` +
            `${progress.messages} message(s) · cursor ${JSON.stringify(cursor)}`,
        );
      },
    });
    console.log(
      `Done. Threads: ${report.conversations}. Messages: ${report.messages}. ` +
        `Skipped: ${report.skippedNoBot} thread(s) with no bot, ` +
        `${report.skippedNoThread} message(s) with no thread.`,
    );
    if (report.splits.length) {
      console.log(
        `Contacts that wrote to more than one bot (the later bots got derived ids): ${report.splits.length}`,
      );
      for (const pair of report.splits)
        console.log(`  ${JSON.stringify(pair)}`);
    }
    if (report.merges.length) {
      console.log(
        `Numbers already known to the bot through another wa contact (merged): ${report.merges.length}`,
      );
      for (const pair of report.merges)
        console.log(`  ${JSON.stringify(pair)}`);
    }
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
