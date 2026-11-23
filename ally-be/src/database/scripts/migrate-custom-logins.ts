/**
 * CR1 Part B: move custom logins from platform admin to the Assistant owner role.
 * See docs/agents-v2/CHUNK-CR1-NOTES.md.
 *
 *   npm run custom-logins:migrate -- --dry-run   # list who would move and who stays; writes nothing
 *   npm run custom-logins:migrate                # move them
 *
 * Exits 2 when some custom logins have other Ally admin pages ticked and were left alone.
 */
import { config as loadEnv } from 'dotenv';
loadEnv();

import dataSource from '../data-source';
import { migrateCustomLogins } from '../../user/custom-login/migrate-custom-logins';

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  await dataSource.initialize();
  try {
    const report = await migrateCustomLogins(dataSource, { dryRun });
    console.log(
      `${dryRun ? 'Would move' : 'Moved'} ${report.moved.length} custom login(s) to Assistant owner${dryRun ? ' (dry run, nothing written)' : ''}:`,
    );
    for (const login of report.moved) {
      console.log(
        `  user ${login.userId}  ${login.email}  [${login.enabled.join(', ')}]`,
      );
    }
    if (report.kept.length) {
      console.log(
        `\n${report.kept.length} custom login(s) have other Ally admin pages ticked and stay platform admins. Untick them in Ally admins, then run this again:`,
      );
      for (const login of report.kept) {
        console.log(
          `  user ${login.userId}  ${login.email}  [${login.enabled.join(', ')}]`,
        );
      }
      process.exitCode = 2;
    }
    if (!dryRun && report.moved.length) {
      console.log(
        '\nRole caches expire within 30 minutes; flush Redis `user:*` keys to apply at once.',
      );
    }
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
