/**
 * Assistants stage 5: the data migration. Idempotent; a dry run reports what it would do.
 *
 *   npx ts-node -r tsconfig-paths/register src/database/scripts/assistants-stage5-migrate.ts --dry-run
 *   npx ts-node -r tsconfig-paths/register src/database/scripts/assistants-stage5-migrate.ts
 *   ... --all-shared    also copy library documents attached to only one chatbot
 *   ... --no-queue      leave the copies `pending` (requeue later); default queues them on
 *                       SQS_KB_INGEST_QUEUE_URL, indexed in the background and charged to nobody
 *
 * Steps (each skips what an earlier run did):
 *   1. shared library documents attached to several chatbots become per-chatbot copies
 *      (tag `ally-migration-copy`), replacing the shared attachment;
 *   2. every active global quick reply is copied into every chatbot (crisis/STOP/START locked),
 *      and the copy is marked done, so builders stop resolving the globals;
 *   3. unbound connectors and chatbot-less WhatsApp threads are parked (hidden from builders);
 *   4. chatbots with no retention or audience age get 90 days and `unstated`;
 *   5. chatbots with no owner get their creator (`backfillOwners`).
 * Rollback per step: see the comment on `runStage5Migration` in
 * src/chatbot/privacy/stage5-migration.ts. Memory deletion (D7) and the retention sweep (D11)
 * are separate, irreversible runbook steps: assistants-retention-report.ts and
 * POST /v1/staff/memory-cutover.
 */
import { config as loadEnv } from 'dotenv';
loadEnv();

import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { DataSource } from 'typeorm';
import { dataSourceOptions } from '../data-source';
import { runStage5Migration } from '../../chatbot/privacy/stage5-migration';

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const queue = !process.argv.includes('--no-queue');
  const queueUrl = process.env.SQS_KB_INGEST_QUEUE_URL;
  if (!dryRun && queue && !queueUrl) {
    throw new Error('SQS_KB_INGEST_QUEUE_URL is not set (or pass --no-queue)');
  }
  const dataSource = await new DataSource({
    ...dataSourceOptions,
    entities: [],
    migrations: [],
  }).initialize();
  try {
    const sqs =
      !dryRun && queue
        ? new SQSClient({
            region: process.env.AWS_REGION ?? 'us-east-1',
            ...(process.env.AWS_ENDPOINT_URL
              ? { endpoint: process.env.AWS_ENDPOINT_URL }
              : {}),
          })
        : null;
    const report = await runStage5Migration(dataSource, {
      dryRun,
      allShared: process.argv.includes('--all-shared'),
      enqueue: sqs
        ? async (message) => {
            await sqs.send(
              new SendMessageCommand({
                QueueUrl: queueUrl,
                MessageBody: JSON.stringify(message),
              }),
            );
          }
        : undefined,
    });
    console.log(JSON.stringify(report, null, 2));
    if (report.owners.needsOwner.length) process.exitCode = 2;
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error: unknown) => {
  console.error(
    `Stage 5 migration failed: ${error instanceof Error ? error.message : 'unknown error'}`,
  );
  process.exit(1);
});
