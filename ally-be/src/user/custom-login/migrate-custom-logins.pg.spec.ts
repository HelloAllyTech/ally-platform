import { DataSource } from 'typeorm';
import {
  closeTestDataSource,
  describePg,
  openTestDataSource,
} from '../../whatsapp/shared-store/test/shared-store.pg';
import { migrateCustomLogins } from './migrate-custom-logins';

/** CR1 Part B: the custom-login move, dry run and real, on Postgres. */
describePg('migrateCustomLogins (Postgres)', () => {
  let dataSource: DataSource;
  const ids: number[] = [];

  let tenant: string;

  beforeAll(async () => {
    dataSource = await openTestDataSource();
    for (const name of ['PLATFORM_ADMIN', 'ASSISTANT_OWNER']) {
      await dataSource.query(
        `INSERT INTO groups (name) SELECT $1::varchar WHERE NOT EXISTS (SELECT 1 FROM groups WHERE name = $1::varchar)`,
        [name],
      );
    }
    [{ id: tenant }] = await dataSource.query(
      `INSERT INTO tenants (name, code) SELECT 'CR1 test org ' || x, 'cr1-' || x FROM (SELECT floor(random() * 1e9)::text AS x) r RETURNING id`,
    );
  });
  afterAll(async () => {
    if (ids.length) {
      await dataSource.query(
        `DELETE FROM admin_feature_toggles WHERE "userId" = ANY($1)`,
        [ids],
      );
      await dataSource.query(
        `DELETE FROM user_groups WHERE "userId" = ANY($1)`,
        [ids],
      );
      await dataSource.query(`DELETE FROM users WHERE id = ANY($1)`, [ids]);
    }
    await dataSource.query(`DELETE FROM tenants WHERE id = $1`, [tenant]);
    await closeTestDataSource(dataSource);
  });

  async function admin(
    email: string,
    on: string[],
    off: string[],
  ): Promise<number> {
    const [user] = await dataSource.query(
      `INSERT INTO users (email, name, username, status, tenant_id)
       VALUES ($1, 'Test', $1, 'ACTIVE', $2) RETURNING id`,
      [email, tenant],
    );
    ids.push(user.id);
    await dataSource.query(
      `INSERT INTO user_groups ("userId", "groupId") SELECT $1, id FROM groups WHERE name = 'PLATFORM_ADMIN'`,
      [user.id],
    );
    for (const [keys, enabled] of [
      [on, true],
      [off, false],
    ] as const) {
      for (const key of keys) {
        await dataSource.query(
          `INSERT INTO admin_feature_toggles ("userId", "featureKey", enabled) VALUES ($1, $2, $3)`,
          [user.id, key, enabled],
        );
      }
    }
    return user.id;
  }

  const roles = async (id: number) =>
    (
      await dataSource.query(
        `SELECT g.name FROM user_groups ug JOIN groups g ON g.id = ug."groupId" WHERE ug."userId" = $1 ORDER BY 1`,
        [id],
      )
    ).map((r: { name: string }) => r.name);

  it('moves Chatbots-only logins, reports the others, and leaves real admins alone', async () => {
    const chatbotsOnly = await admin(
      'cr1-a@test.local',
      ['whatsapp_bot'],
      ['users', 'logs', 'settings'],
    );
    const more = await admin(
      'cr1-b@test.local',
      ['whatsapp_bot', 'logs'],
      ['users', 'settings', 'blog'],
    );
    const realAdmin = await admin(
      'cr1-c@test.local',
      ['whatsapp_bot', 'logs', 'users'],
      ['settings'],
    );

    const dry = await migrateCustomLogins(dataSource, { dryRun: true });
    expect(dry.moved.map((m) => m.userId)).toContain(chatbotsOnly);
    expect(dry.kept.map((m) => m.userId)).toContain(more);
    expect([...dry.moved, ...dry.kept].map((m) => m.userId)).not.toContain(
      realAdmin,
    );
    expect(await roles(chatbotsOnly)).toEqual(['PLATFORM_ADMIN']);

    await migrateCustomLogins(dataSource, { dryRun: false });
    expect(await roles(chatbotsOnly)).toEqual(['ASSISTANT_OWNER']);
    expect(await roles(more)).toEqual(['PLATFORM_ADMIN']);
    expect(await roles(realAdmin)).toEqual(['PLATFORM_ADMIN']);
  });
});
