import { DataSource, DataSourceOptions } from 'typeorm';

/**
 * One key for every migration run, whoever starts it. Arbitrary but fixed; distinct from the
 * scheduler's advisory-lock namespace (4919) so the two can never contend.
 */
export const MIGRATION_LOCK_KEY = 4_918_201;

/**
 * Whether the app runs pending migrations itself on boot. On unless `DB_MIGRATIONS_ON_BOOT` is
 * exactly `false` (any case), so local development and tests keep migrating without setting it.
 *
 * Production turns it off: the deploy runs `npm run migration:run` in a one-shot container of
 * the new image before the old containers stop, so a failed migration leaves the old version
 * serving. A second runner at boot would only ever find nothing pending. Read from
 * `process.env` (validated in env.validation.ts) because the TypeORM dataSourceFactory, which
 * keeps the module's connection retry around the run, receives the options and nothing else.
 */
export function migrationsOnBootEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.DB_MIGRATIONS_ON_BOOT?.trim().toLowerCase() !== 'false';
}

export interface MigrationRunLog {
  log: (message: string) => void;
}

/**
 * Run pending migrations so that only one process can be doing it at a time.
 *
 * A production deploy starts two runners at once: the app runs migrations on boot, and the
 * deploy job runs `npm run migration:run` inside the same container a few seconds later.
 * TypeORM takes no lock, so both saw the same pending migrations and both ran them. On
 * 2026-11-10 (be-v1.180.1) the second one failed on `CREATE TABLE IF NOT EXISTS
 * "generated_images"` with a duplicate `pg_type` key, which is what Postgres raises when two
 * transactions create the same table at once; `IF NOT EXISTS` does not cover that race.
 *
 * Here every runner takes the same session-level advisory lock first. The second one waits,
 * then finds nothing pending and returns. Postgres releases the lock if the process dies, so a
 * crashed run cannot leave it held.
 *
 * Migrations also run on their own small pool with no statement timeout. The app's pool
 * cancels any statement after 30 s, which is right for requests and wrong for a migration
 * that copies a table: on production data a copy can take longer, and a cancelled statement
 * fails the whole deploy. The wait for the lock would be cancelled the same way.
 *
 * Returns the names of the migrations this call ran (empty when another runner got there
 * first).
 */
export async function runMigrationsExclusively(
  options: DataSourceOptions,
  out: MigrationRunLog = console,
): Promise<string[]> {
  const extra = ((options as { extra?: Record<string, unknown> }).extra ??
    {}) as Record<string, unknown>;
  const dataSource = new DataSource({
    ...options,
    migrationsRun: false,
    synchronize: false,
    extra: {
      ...extra,
      // One connection holds the lock, one runs the migrations.
      max: 2,
      min: 0,
      statement_timeout: 0,
    },
  } as DataSourceOptions);
  await dataSource.initialize();
  const lockHolder = dataSource.createQueryRunner();
  try {
    await lockHolder.connect();
    out.log('Waiting for the migration lock…');
    await lockHolder.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    try {
      const ran = await dataSource.runMigrations({ transaction: 'all' });
      const names = ran.map((m) => m.name);
      out.log(
        names.length
          ? `Ran ${names.length} migration(s): ${names.join(', ')}`
          : 'No pending migrations.',
      );
      return names;
    } finally {
      await lockHolder
        .query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY])
        .catch(() => undefined);
    }
  } finally {
    await lockHolder.release().catch(() => undefined);
    await dataSource.destroy().catch(() => undefined);
  }
}
