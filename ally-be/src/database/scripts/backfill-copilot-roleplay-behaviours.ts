/**
 * One-time backfill: behaviour rows for roleplays Course Copilot built before
 * the create path filled them from the roleplay's competencies.
 *
 * Without behaviour rows, behaviour detection is skipped at runtime and the
 * score barely moves, while the course gates the item on a minimum score.
 *
 * Only roleplays a finished `roleplay_new` copilot job produced are touched: a
 * hand-built roleplay with an empty behaviour table may be empty on purpose.
 * A roleplay that already has any behaviour row is skipped, so the script is
 * idempotent. Each roleplay is written as its owner (its `createdBy`).
 *
 *   npm run backfill:copilot-roleplay-behaviours -- --dry-run   # report only
 *   npm run backfill:copilot-roleplay-behaviours                # write rows
 */
import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
loadEnv();

import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../../app.module';
import { ScenarioService } from '../../learn/service/scenario.service';
import { ExecutionManager } from '../../common/execution/execution-manager';
import {
  CourseCopilotJobKind,
  CourseCopilotJobStatus,
} from '../../course-copilot/enum/course-copilot.enum';

const DRY_RUN = process.argv.includes('--dry-run');

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const dataSource = app.get(DataSource);
    const scenarios = app.get(ScenarioService, { strict: false });

    // Scenarios carry no tenant; the copilot session that built one does.
    const rows: {
      scenarioId: number;
      createdBy: number;
      tenantId: string | null;
    }[] = await dataSource.query(
      `SELECT DISTINCT ON (s.id)
              s.id AS "scenarioId", s."createdBy", cs."tenantId"
         FROM course_copilot_jobs j
         JOIN course_copilot_sessions cs ON cs.id = j."sessionId"
         JOIN scenarios s ON s.id = (j.result->>'scenarioId')::int
          WHERE j.kind = $1
            AND j.status = $2
            AND j.result ? 'scenarioId'
            AND s."deletedAt" IS NULL
          ORDER BY s.id`,
      [CourseCopilotJobKind.ROLEPLAY_NEW, CourseCopilotJobStatus.DONE],
    );
    console.log(`${rows.length} roleplay(s) built by Course Copilot`);

    const tally: Record<string, number> = {};
    for (const row of rows) {
      const result = await ExecutionManager.runWithContext(() => {
        ExecutionManager.setAuthContext(
          String(row.createdBy),
          row.tenantId ?? '',
        );
        return scenarios.addMissingBehaviorInstructions(row.scenarioId, {
          dryRun: DRY_RUN,
        });
      });
      tally[result.outcome] = (tally[result.outcome] ?? 0) + 1;
      if (result.outcome === 'added') {
        console.log(
          `scenario ${row.scenarioId}: ${DRY_RUN ? 'would add' : 'added'} ${result.rows} row(s)`,
        );
      } else if (result.outcome !== 'has-rows') {
        console.log(`scenario ${row.scenarioId}: ${result.outcome}`);
      }
    }

    console.log(
      `${DRY_RUN ? 'Dry run, nothing written. ' : ''}${Object.entries(tally)
        .map(([outcome, count]) => `${outcome}: ${count}`)
        .join(', ')}`,
    );
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
