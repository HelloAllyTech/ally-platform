import { ConflictException, ForbiddenException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  closeTestDataSource,
  describePg,
  openTestDataSource,
} from '../../../whatsapp/shared-store/test/shared-store.pg';
import { ChatbotMemberRole } from '../../enum/chatbot.enum';
import { ChatbotAccessService } from '../../service/chatbot-access.service';
import { ChatbotInvitesService } from '../chatbot-invites.service';
import { ChatbotMembersService } from '../chatbot-members.service';

let actingUser = 0;
jest.mock('src/common/execution/execution-manager', () => ({
  ExecutionManager: {
    getUserId: () => actingUser,
    getTenantId: () => null,
    getExecutionId: () => undefined,
  },
}));

/**
 * Stage 1b on real Postgres (runs only with CHATBOT_STORE_TEST_DB, see shared-store.pg.ts; the
 * database must be migrated through 1986500000200):
 * - the role-set migration's trigger when an OLD instance writes only `role`;
 * - two owners removing each other at the same instant: one wins, the bot keeps an owner;
 * - an invite for an email that has an account in another organisation;
 * - an invite link claimed with a different email.
 */
describePg('Chatbot team (Postgres)', () => {
  let ds: DataSource;
  let bot: string;
  const PLATFORM_ADMIN = new Set<number>();
  const ids: Record<string, number> = {};

  const access = () =>
    new ChatbotAccessService(
      ds.getRepository('Chatbot') as never,
      {
        findOne: async ({
          where,
        }: {
          where: { chatbotId: string; userId: number };
        }) => {
          const [row] = await ds.query(
            `SELECT role, roles FROM chatbot_members WHERE chatbot_id = $1 AND user_id = $2`,
            [where.chatbotId, where.userId],
          );
          return row ?? null;
        },
      } as never,
      {
        resolveTenantIds: async (userId: number) =>
          PLATFORM_ADMIN.has(userId) ? null : ['t'],
      } as never,
      { hasToggle: async () => true } as never,
    );
  const members = () => new ChatbotMembersService(ds, access());
  const invites = (sent: unknown[] = []) =>
    new ChatbotInvitesService(
      ds,
      access(),
      members(),
      { adminBaseUrl: 'http://admin.test' } as never,
      {
        emitAsync: async (_: string, event: unknown) => {
          sent.push(event);
          return [true];
        },
      } as never,
    );

  beforeAll(async () => {
    ds = await openTestDataSource();
  });
  afterAll(() => closeTestDataSource(ds));

  beforeEach(async () => {
    await ds.query(`DELETE FROM chatbot_invites`);
    await ds.query(`DELETE FROM chatbot_members`);
    await ds.query(`DELETE FROM chatbots WHERE name LIKE 'sb1b %'`);
    await ds.query(
      `DELETE FROM user_groups WHERE "userId" IN (SELECT id FROM users WHERE email LIKE '%@sb1b.test')`,
    );
    await ds.query(`DELETE FROM users WHERE email LIKE '%@sb1b.test'`);
    PLATFORM_ADMIN.clear();
    for (const [key, tenant] of [
      ['asha', 'tenant-a'],
      ['ravi', 'tenant-a'],
      ['meena', 'tenant-b'],
      ['staff', 'tenant-a'],
    ] as const) {
      const [row] = await ds.query(
        `INSERT INTO users (email, name, username, status, tenant_id)
         VALUES ($1, $2, $1, 'ACTIVE', $3) RETURNING id`,
        [`${key}@sb1b.test`, key, tenant],
      );
      ids[key] = Number(row.id);
    }
    PLATFORM_ADMIN.add(ids.staff);
    const [b] = await ds.query(
      `INSERT INTO chatbots (name, created_by, status) VALUES ('sb1b bot', $1, 'live') RETURNING id`,
      [ids.asha],
    );
    bot = b.id;
  });

  it('keeps role and roles in step when an old instance writes only `role`', async () => {
    // An old instance's INSERT: no `roles` column in its entity.
    await ds.query(
      `INSERT INTO chatbot_members (chatbot_id, user_id, role) VALUES ($1, $2, 'editor')`,
      [bot, ids.ravi],
    );
    const read = async () =>
      (
        await ds.query(
          `SELECT role, roles FROM chatbot_members WHERE chatbot_id = $1 AND user_id = $2`,
          [bot, ids.ravi],
        )
      )[0];
    expect(await read()).toEqual({ role: 'editor', roles: ['editor'] });

    // New code adds Responder: the old column shows the highest on the old ladder.
    await ds.query(
      `UPDATE chatbot_members SET roles = ARRAY['editor','responder'] WHERE user_id = $1`,
      [ids.ravi],
    );
    expect(await read()).toEqual({
      role: 'editor',
      roles: ['editor', 'responder'],
    });

    // The old instance demotes them to viewer: the ladder part follows, Responder is kept.
    await ds.query(
      `UPDATE chatbot_members SET role = 'viewer' WHERE user_id = $1`,
      [ids.ravi],
    );
    expect(await read()).toEqual({
      role: 'viewer',
      roles: ['viewer', 'responder'],
    });

    // Responder-only, written by new code: the old column says viewer.
    await ds.query(
      `UPDATE chatbot_members SET roles = ARRAY['responder'] WHERE user_id = $1`,
      [ids.ravi],
    );
    expect(await read()).toEqual({ role: 'viewer', roles: ['responder'] });

    // The CHECK refuses an empty or unknown set.
    await expect(
      ds.query(
        `UPDATE chatbot_members SET roles = ARRAY['admin'] WHERE user_id = $1`,
        [ids.ravi],
      ),
    ).rejects.toThrow(/CHK_chatbot_members_roles/);
  });

  it('two owners removing each other at once leave one owner', async () => {
    // The creator is off the team, so neither is protected as creator: only the last-owner rule bites.
    await ds.query(`UPDATE chatbots SET created_by = $2 WHERE id = $1`, [
      bot,
      ids.meena,
    ]);
    for (const user of [ids.asha, ids.ravi]) {
      await ds.query(
        `INSERT INTO chatbot_members (chatbot_id, user_id, role, roles) VALUES ($1, $2, 'owner', ARRAY['owner'])`,
        [bot, user],
      );
    }
    // Hold the bot's row so both removals pass their capability check and then queue on the
    // lock, as two owners clicking at the same instant would.
    const holder = ds.createQueryRunner();
    await holder.connect();
    await holder.startTransaction();
    await holder.query(`SELECT id FROM chatbots WHERE id = $1 FOR UPDATE`, [
      bot,
    ]);
    const service = members();
    actingUser = ids.asha;
    const a = service.remove(bot, ids.ravi);
    actingUser = ids.ravi;
    const b = service.remove(bot, ids.asha);
    await new Promise((resolve) => setTimeout(resolve, 300));
    await holder.commitTransaction();
    await holder.release();
    const results = await Promise.allSettled([a, b]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const refused = results.filter(
      (r) =>
        r.status === 'rejected' &&
        (
          (r.reason as ConflictException).getResponse?.() as {
            errorCode?: string;
          }
        )?.errorCode === 'last_owner',
    );
    expect(ok).toHaveLength(1);
    expect(refused).toHaveLength(1);
    const [{ n }] = await ds.query(
      `SELECT count(*)::int AS n FROM chatbot_members WHERE chatbot_id = $1 AND 'owner' = ANY(roles)`,
      [bot],
    );
    expect(n).toBe(1);
  });

  it('refuses removing the creator until the chatbot is handed over', async () => {
    for (const user of [ids.asha, ids.ravi]) {
      await ds.query(
        `INSERT INTO chatbot_members (chatbot_id, user_id, role, roles) VALUES ($1, $2, 'owner', ARRAY['owner'])`,
        [bot, user],
      );
    }
    actingUser = ids.ravi;
    await expect(members().remove(bot, ids.asha)).rejects.toMatchObject({
      response: { errorCode: 'creator_must_transfer' },
    });
    actingUser = ids.asha;
    await expect(members().leave(bot)).rejects.toMatchObject({
      response: { errorCode: 'creator_must_transfer' },
    });
    await members().transfer(bot, ids.ravi);
    await members().leave(bot);
    const [row] = await ds.query(
      `SELECT created_by FROM chatbots WHERE id = $1`,
      [bot],
    );
    expect(row.created_by).toBe(ids.ravi);
  });

  it('invites an email with an account in another organisation: access is added to that account', async () => {
    await ds.query(
      `INSERT INTO chatbot_members (chatbot_id, user_id, role, roles) VALUES ($1, $2, 'owner', ARRAY['owner'])`,
      [bot, ids.asha],
    );
    actingUser = ids.asha;
    const sent: Array<{ link: string; to: string }> = [];
    const created = await invites(sent as never[]).create(bot, {
      email: 'MEENA@sb1b.test',
      roles: [ChatbotMemberRole.RESPONDER],
    });
    expect(created).toMatchObject({
      email: 'meena@sb1b.test',
      emailSent: true,
    });
    const token = new URL(sent[0].link).searchParams.get('token')!;

    const accepted = await invites().accept(token, {
      signedInUserId: ids.meena,
    });
    expect(accepted).toMatchObject({
      accountCreated: false,
      roles: [ChatbotMemberRole.RESPONDER],
    });
    const [member] = await ds.query(
      `SELECT role, roles FROM chatbot_members WHERE chatbot_id = $1 AND user_id = $2`,
      [bot, ids.meena],
    );
    expect(member).toEqual({ role: 'viewer', roles: ['responder'] });
    // Still in their own organisation; given the member login so they can sign in.
    const [user] = await ds.query(`SELECT tenant_id FROM users WHERE id = $1`, [
      ids.meena,
    ]);
    expect(user.tenant_id).toBe('tenant-b');
    const groups = await ds.query(
      `SELECT g.name FROM user_groups ug JOIN groups g ON g.id = ug."groupId" WHERE ug."userId" = $1`,
      [ids.meena],
    );
    expect(groups.map((g: { name: string }) => g.name)).toContain(
      'ASSISTANT_MEMBER',
    );
    // Used once.
    await expect(
      invites().accept(token, { signedInUserId: ids.meena }),
    ).rejects.toMatchObject({
      response: { errorCode: 'invite_not_found' },
    });
  });

  it('a forwarded link cannot be claimed by a different email', async () => {
    await ds.query(
      `INSERT INTO chatbot_members (chatbot_id, user_id, role, roles) VALUES ($1, $2, 'owner', ARRAY['owner'])`,
      [bot, ids.asha],
    );
    actingUser = ids.asha;
    const sent: Array<{ link: string }> = [];
    await invites(sent as never[]).create(bot, {
      email: 'newperson@sb1b.test',
      roles: [ChatbotMemberRole.EDITOR],
    });
    const token = new URL(sent[0].link).searchParams.get('token')!;

    // Signed in as someone else, or typing someone else's address: refused, nothing granted.
    await expect(
      invites().accept(token, { signedInUserId: ids.ravi }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      invites().accept(token, { email: 'ravi@sb1b.test' }),
    ).rejects.toMatchObject({ response: { errorCode: 'invite_wrong_email' } });
    const [{ n }] = await ds.query(
      `SELECT count(*)::int AS n FROM chatbot_members WHERE chatbot_id = $1`,
      [bot],
    );
    expect(n).toBe(1);

    // With the invited address: a limited account in the inviter's organisation.
    const ok = await invites().accept(token, { email: 'NewPerson@sb1b.test' });
    expect(ok).toMatchObject({ accountCreated: true, roles: ['editor'] });
    const [created] = await ds.query(
      `SELECT u.tenant_id, array_agg(g.name) AS groups FROM users u
         JOIN user_groups ug ON ug."userId" = u.id JOIN groups g ON g.id = ug."groupId"
        WHERE u.email = 'newperson@sb1b.test' GROUP BY u.tenant_id`,
    );
    expect(created.tenant_id).toBe('tenant-a');
    expect(created.groups).toEqual(['ASSISTANT_MEMBER']);
  });

  it('refuses inviting a platform admin', async () => {
    await ds.query(
      `INSERT INTO chatbot_members (chatbot_id, user_id, role, roles) VALUES ($1, $2, 'owner', ARRAY['owner'])`,
      [bot, ids.asha],
    );
    actingUser = ids.asha;
    await expect(
      invites().create(bot, {
        email: 'staff@sb1b.test',
        roles: [ChatbotMemberRole.VIEWER],
      }),
    ).rejects.toMatchObject({
      response: { errorCode: 'invite_platform_admin' },
    });
  });
});
