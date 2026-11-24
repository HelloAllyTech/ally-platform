/**
 * Assistants stage 5 (D11): the retention sweep's dry-run report, per store. Writes nothing
 * unless `--apply` is passed, and `--apply` still refuses until the crisis backfill has finished
 * (global setting `crisis_flag_backfill.doneAt`) and ASSISTANT_RETENTION_SWEEP_ENABLED is not off.
 *
 *   npx ts-node -r tsconfig-paths/register src/database/scripts/assistants-retention-report.ts
 *   npx ts-node -r tsconfig-paths/register src/database/scripts/assistants-retention-report.ts --apply
 *
 * Take the pre-sweep snapshot (runbook, stage 10) before the first `--apply`.
 */
import { config as loadEnv } from 'dotenv';
loadEnv();

import dataSource from '../data-source';
import { AssistantRetentionService } from '../../chatbot/privacy/assistant-retention.service';

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  await dataSource.initialize();
  try {
    const service = new AssistantRetentionService(dataSource);
    const report = await service.run({ dryRun: !apply });
    console.log(
      `${apply ? 'Sweep' : 'Dry run'} over ${report.chatbots} chatbot(s); ` +
        `${report.exemptConversations} flagged conversation(s) kept.` +
        (report.blocked ? ` Blocked for a real run: ${report.blocked}.` : ''),
    );
    for (const [store, n] of Object.entries(report.counts)) {
      console.log(`  ${store.padEnd(26)} ${n}`);
    }
    if (apply && report.blocked) process.exitCode = 2;
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
