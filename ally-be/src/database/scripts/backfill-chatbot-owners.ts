/**
 * A1: give every assistant with no owner its creator as owner, and list the ones nobody can be
 * given that way. See docs/agents-v2/CHUNK-A1-NOTES.md.
 *
 *   npm run backfill:chatbot-owners -- --dry-run   # list what would change; writes nothing
 *   npm run backfill:chatbot-owners                # assign
 *
 * Exits 2 when some assistants still need an owner assigned by hand (the list is printed).
 */
import { config as loadEnv } from 'dotenv';
loadEnv();

import dataSource from '../data-source';
import { backfillOwners } from '../../chatbot/access/backfill-owners';

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  await dataSource.initialize();
  try {
    const report = await backfillOwners(dataSource, { dryRun });
    const verb = dryRun ? 'Would give' : 'Gave';
    console.log(
      `${verb} ${report.assigned.length} assistant(s) their creator as owner${dryRun ? ' (dry run, nothing written)' : ''}.`,
    );
    for (const bot of report.assigned) {
      console.log(
        `  ${bot.id}  ${bot.name}${bot.archived ? ' (archived)' : ''} → user ${bot.ownerUserId}`,
      );
    }
    if (report.needsOwner.length) {
      console.log(
        `\n${report.needsOwner.length} assistant(s) have no creator who is still an Ally user. Assign an owner by hand:`,
      );
      for (const bot of report.needsOwner) {
        console.log(
          `  ${bot.id}  ${bot.name}${bot.archived ? ' (archived)' : ''}  created_by=${bot.createdBy ?? 'none'}`,
        );
      }
      process.exitCode = 2;
    }
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
