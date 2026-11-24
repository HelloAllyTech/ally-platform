/**
 * Assistants cutover: every dry run in one command, one combined report. It never applies anything:
 *  - each step is called with its dry-run option;
 *  - connections are opened read-only (PGOPTIONS default_transaction_read_only=on), so a stray write
 *    fails instead of landing;
 *  - the alert sending, crisis job, crisis backfill, retention sweep, memory cutover and monitor
 *    kill switches are forced off for this process, and scheduled jobs are stopped after boot.
 *
 *   npx ts-node -r tsconfig-paths/register src/database/scripts/assistants-cutover-dry-run.ts
 *
 * Exit 0 when every step ran, 2 when one failed or reported that it applied something.
 * Run it against a COPY of production first (runbook: docs/assistants-cutover-runbook.md).
 */
import { config as loadEnv } from 'dotenv';
loadEnv();

// Before anything opens a connection.
process.env.PGOPTIONS = [
  process.env.PGOPTIONS,
  '-c default_transaction_read_only=on',
]
  .filter(Boolean)
  .join(' ');
for (const name of [
  'ASSISTANT_ALERT_SENDING_ENABLED',
  'ASSISTANT_CRISIS_JOB_ENABLED',
  'ASSISTANT_CRISIS_BACKFILL_ENABLED',
  'ASSISTANT_RETENTION_SWEEP_ENABLED',
  'ASSISTANT_MEMORY_CUTOVER_ENABLED',
  'ASSISTANT_MONITOR_ENABLED',
]) {
  process.env[name] = 'false';
}

import { NestFactory } from '@nestjs/core';
import { SchedulerRegistry } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import {
  runCutoverDryRun,
  type DryRunStep,
} from './assistants-cutover-dry-run.lib';

async function main(): Promise<void> {
  // Imported after the environment is set: modules read config at load.
  const { AppModule } = await import('../../app.module');
  const { CrisisBackfillService } =
    await import('../../chatbot/safety/crisis-backfill.service');
  const { AssistantRetentionService } =
    await import('../../chatbot/privacy/assistant-retention.service');
  const { runStage5Migration } =
    await import('../../chatbot/privacy/stage5-migration');
  const { CreditsCutoverService } =
    await import('../../billing/service/credits-cutover.service');
  const { GoLiveBackfillService } =
    await import('../../chatbot/safety/go-live-backfill.service');
  const { MemoryConsentService } =
    await import('../../chatbot/privacy/memory-consent.service');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error'],
  });
  try {
    const registry = app.get(SchedulerRegistry);
    for (const [, job] of registry.getCronJobs()) void job.stop();

    const get = <T>(token: new (...args: never[]) => T): T =>
      app.get(token, { strict: false });
    const steps: DryRunStep[] = [
      {
        name: 'crisis flag backfill',
        run: () => get(CrisisBackfillService).run({ dryRun: true }),
      },
      {
        name: 'retention report',
        run: () => get(AssistantRetentionService).run({ dryRun: true }),
      },
      {
        name: 'stage 5 migration',
        run: () =>
          runStage5Migration(app.get(DataSource, { strict: false }), {
            dryRun: true,
            allShared: process.argv.includes('--all-shared'),
          }),
      },
      {
        name: 'credits cutover',
        run: () => get(CreditsCutoverService).run(true, null),
      },
      {
        name: 'unpublish backfill',
        run: () => get(GoLiveBackfillService).run({ dryRun: true }),
      },
      {
        name: 'memory cutover',
        run: () => get(MemoryConsentService).cutover({ dryRun: true }),
      },
    ];
    const report = await runCutoverDryRun(steps);
    console.log(JSON.stringify(report, null, 2));
    console.log(
      `\nDry run finished: ${report.steps.length - report.failed.length} of ${report.steps.length} steps ok.` +
        (report.failed.length ? ` Failed: ${report.failed.join(', ')}.` : '') +
        (report.appliedSomething.length
          ? ` APPLIED SOMETHING: ${report.appliedSomething.join(', ')}.`
          : ' Nothing was applied.'),
    );
    if (report.failed.length) process.exitCode = 2;
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(
    `Cutover dry run failed: ${error instanceof Error ? error.message : 'unknown error'}`,
  );
  process.exit(1);
});
