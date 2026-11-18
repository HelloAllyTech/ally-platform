import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Runs now stamp `workspace.appliedAt` when their debrief is written into the session, and the
 * stuck sweep publishes a readable live run without one again. Every readable live run that exists
 * already counts as applied (it was, or it is not worth publishing again), so the sweep only ever
 * sees runs finished after this deploy.
 */
export class StampAppliedDebriefRuns1984410000000 implements MigrationInterface {
  name = 'StampAppliedDebriefRuns1984410000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE debrief_runs
         SET workspace = jsonb_set(coalesce(workspace, '{}'::jsonb), '{appliedAt}',
                                   to_jsonb(coalesce("finishedAt", "createdAt")::text))
       WHERE mode = 'live' AND status IN ('published', 'below_bar') AND cards IS NOT NULL
         AND NOT (coalesce(workspace, '{}'::jsonb) ? 'appliedAt')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE debrief_runs SET workspace = workspace - 'appliedAt' WHERE workspace ? 'appliedAt'
    `);
  }
}
