/**
 * One-time backfill: narration audio for every active role-play whose description has none yet.
 *
 * Idempotent: a scenario whose stored audio already matches its description (same text, voice and
 * language) is skipped without a TTS call, so a second run — or one after a partial failure —
 * only does the missing work. Failures are recorded on the row and retried by the scheduler
 * sweep, exactly as for a normal save.
 *
 *   npm run backfill:scenario-description-audio -- --dry-run   # count only
 *   npm run backfill:scenario-description-audio                # generate
 */
import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
loadEnv();

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { ScenarioDescriptionAudioService } from '../src/learn/service/scenario-description-audio.service';

const DRY_RUN = process.argv.includes('--dry-run');

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const audio = app.get(ScenarioDescriptionAudioService, { strict: false });
    if (DRY_RUN) {
      const due = await audio.countMissing();
      console.log(
        `${due} active scenario(s) need description audio (dry run, nothing generated)`,
      );
      return;
    }
    const queued = await audio.queueBackfill();
    console.log(`${queued} scenario(s) queued`);
    // Drain in this process rather than waiting for the 5-minute sweep.
    for (;;) {
      const { done, failed, remaining } = await audio.drainBatch();
      console.log(
        `batch: ${done} generated, ${failed} failed, ${remaining} left`,
      );
      if (remaining === 0 || done + failed === 0) break;
    }
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
