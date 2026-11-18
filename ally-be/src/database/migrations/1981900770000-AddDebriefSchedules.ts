import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Debrief › Settings › Schedules: the debrief and PM-agent jobs run when
 * their stored schedule says, not on a fixed @Cron tick.
 *
 * - `debrief_schedules`: one row per job (key from
 *   src/debrief/constants/debrief-schedule.constants.ts). Rows are created by
 *   `DebriefScheduleService` from each job's default on first read, and the
 *   defaults equal the old ticks, so nothing changes on deploy.
 * - `debrief_schedule_runs`: every scheduled run (how long it took, the
 *   result, a short summary) and every schedule change (`config_change`:
 *   who, and `change` = {before, after}).
 *
 * Access is the `debrief_schedules` admin feature toggle, granted person by
 * person (admin dashboard: Platform admins › the person › Feature access ›
 * Analytics › "Debriefs — Schedules"). No grant is written here.
 */
export class AddDebriefSchedules1981900770000 implements MigrationInterface {
  name = 'AddDebriefSchedules1981900770000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "debrief_schedules" (
        "key" character varying(64) PRIMARY KEY,
        "frequency" character varying(16) NOT NULL
          CHECK ("frequency" IN ('1min','5min','15min','30min','60min','6h','daily','weekly','2weeks','monthly')),
        "time" character varying(5),
        "weekday" smallint CHECK ("weekday" BETWEEN 0 AND 6),
        "monthDay" smallint CHECK ("monthDay" BETWEEN 1 AND 28),
        "enabled" boolean NOT NULL DEFAULT true,
        "nextRunAt" TIMESTAMP WITH TIME ZONE,
        "lastRunAt" TIMESTAMP WITH TIME ZONE,
        "updatedBy" integer,
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "debrief_schedule_runs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "jobKey" character varying(64) NOT NULL,
        "trigger" character varying(16) NOT NULL CHECK ("trigger" IN ('schedule','config_change')),
        "triggeredBy" integer,
        "startedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "durationMs" integer,
        "result" character varying(16) NOT NULL CHECK ("result" IN ('running','ok','failed')),
        "summary" character varying(300),
        "error" text,
        "change" jsonb
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_debrief_schedule_runs_started" ON "debrief_schedule_runs" ("startedAt" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_debrief_schedule_runs_job_started" ON "debrief_schedule_runs" ("jobKey", "startedAt" DESC)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "debrief_schedule_runs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "debrief_schedules"`);
  }
}
