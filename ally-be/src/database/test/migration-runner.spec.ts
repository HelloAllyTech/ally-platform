const calls: string[] = [];
let constructedOptions: any;
let runMigrationsImpl: () => Promise<Array<{ name: string }>>;

jest.mock('typeorm', () => {
  const actual = jest.requireActual('typeorm');
  class FakeDataSource {
    constructor(options: unknown) {
      constructedOptions = options;
    }
    async initialize() {
      calls.push('initialize');
      return this;
    }
    createQueryRunner() {
      return {
        connect: async () => calls.push('connect'),
        query: async (sql: string) => {
          calls.push(sql.includes('unlock') ? 'unlock' : 'lock');
          return [];
        },
        release: async () => calls.push('release'),
      };
    }
    async runMigrations(opts: unknown) {
      calls.push(`runMigrations:${JSON.stringify(opts)}`);
      return runMigrationsImpl();
    }
    async destroy() {
      calls.push('destroy');
    }
  }
  return { ...actual, DataSource: FakeDataSource };
});

import {
  MIGRATION_LOCK_KEY,
  runMigrationsExclusively,
} from '../migration-runner';

const quiet = { log: () => undefined };
const options = {
  type: 'postgres',
  migrationsRun: true,
  extra: {
    max: 30,
    statement_timeout: 30_000,
    connectionTimeoutMillis: 10_000,
  },
} as any;

describe('runMigrationsExclusively', () => {
  beforeEach(() => {
    calls.length = 0;
    runMigrationsImpl = async () => [{ name: 'A1' }, { name: 'B2' }];
  });

  it('takes the advisory lock before running migrations and releases it after', async () => {
    const ran = await runMigrationsExclusively(options, quiet);
    expect(ran).toEqual(['A1', 'B2']);
    expect(calls).toEqual([
      'initialize',
      'connect',
      'lock',
      'runMigrations:{"transaction":"all"}',
      'unlock',
      'release',
      'destroy',
    ]);
    expect(MIGRATION_LOCK_KEY).not.toBe(4919); // the scheduler's namespace
  });

  it('runs on its own small pool with no statement timeout, keeping other settings', async () => {
    await runMigrationsExclusively(options, quiet);
    expect(constructedOptions.extra).toEqual({
      max: 2,
      min: 0,
      statement_timeout: 0,
      connectionTimeoutMillis: 10_000,
    });
    expect(constructedOptions.migrationsRun).toBe(false);
    // The caller's options are not mutated.
    expect(options.extra.statement_timeout).toBe(30_000);
  });

  it('still releases the lock and the pool when a migration fails', async () => {
    runMigrationsImpl = async () => {
      throw new Error('boom');
    };
    await expect(runMigrationsExclusively(options, quiet)).rejects.toThrow(
      'boom',
    );
    expect(calls.slice(-3)).toEqual(['unlock', 'release', 'destroy']);
  });

  it('returns nothing when another runner already applied everything', async () => {
    runMigrationsImpl = async () => [];
    expect(await runMigrationsExclusively(options, quiet)).toEqual([]);
  });
});
