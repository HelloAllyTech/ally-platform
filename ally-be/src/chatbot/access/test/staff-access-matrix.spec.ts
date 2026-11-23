import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import {
  BadRequestException,
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS } from '../../../authorization/constants/permissions.constants';
import { ExecutionManager } from '../../../common/execution/execution-manager';
import { ChatbotCapability, ChatbotMemberRole } from '../../enum/chatbot.enum';
import { ChatbotAccessService } from '../../service/chatbot-access.service';
import {
  ChatbotStaffAccessService,
  STAFF_GRANT_DEFAULT_HOURS,
  STAFF_GRANT_MAX_HOURS,
  STAFF_MESSAGES,
} from '../../staff/chatbot-staff-access.service';
import { ChatbotMemberGuard } from '../chatbot-member.guard';
import {
  ASSISTANT_SCOPE_KEY,
  CHATBOT_ROLE_KEY,
  ChatbotRoleOptions,
} from '../chatbot-role.decorator';
import {
  STAFF_ACCESS_MATRIX,
  STAFF_LIST_SCOPE_HANDLERS,
  STAFF_NEVER_CONVERSATION_ACTIONS,
  staffPolicyFor,
} from '../staff-access-matrix';

/**
 * Assistants stage 8 (plan section 6): a staff read on every route writes a log entry, and a log
 * failure blocks the read; conversation routes are denied without the owner's grant and allowed
 * with a live one; a grant expires; staff never edit or respond.
 */

const SRC = path.resolve(__dirname, '../../..');
const VERBS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'ALL', 'OPTIONS'];

interface Route {
  key: string;
  cls: new (...args: never[]) => unknown;
  handler: string;
  method: string;
  path: string;
}

function controllerFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory())
      return entry.name === 'test' ? [] : controllerFiles(full);
    return entry.name.endsWith('.controller.ts') ? [full] : [];
  });
}

function routes(): Route[] {
  const out: Route[] = [];
  for (const file of ['chatbot', 'bot-draft', 'whatsapp'].flatMap((d) =>
    controllerFiles(path.join(SRC, d)),
  )) {
    const mod = require(file) as Record<string, unknown>;
    for (const exported of Object.values(mod)) {
      if (typeof exported !== 'function') continue;
      const base = Reflect.getMetadata(PATH_METADATA, exported) as
        | string
        | undefined;
      if (base === undefined) continue;
      const proto = (exported as { prototype: object }).prototype;
      for (const handler of Object.getOwnPropertyNames(proto)) {
        const fn = (proto as Record<string, unknown>)[handler];
        if (handler === 'constructor' || typeof fn !== 'function') continue;
        const sub = Reflect.getMetadata(PATH_METADATA, fn) as
          | string
          | undefined;
        if (sub === undefined) continue;
        const name = (exported as { name: string }).name;
        out.push({
          key: `${name}.${handler}`,
          cls: exported as Route['cls'],
          handler,
          method:
            VERBS[Reflect.getMetadata(METHOD_METADATA, fn) as number] ?? '?',
          path: [base, sub].filter(Boolean).join('/'),
        });
      }
    }
  }
  return out;
}

const ALL = routes();
const fnOf = (r: Route) =>
  (r.cls.prototype as Record<string, (...a: unknown[]) => unknown>)[r.handler];
const roleOf = (r: Route) =>
  Reflect.getMetadata(CHATBOT_ROLE_KEY, fnOf(r)) as
    | ChatbotRoleOptions
    | undefined;
const VIEW_ROUTES = ALL.filter(
  (r) => roleOf(r)?.capability === ChatbotCapability.VIEW,
);
const OTHER_ROUTES = ALL.filter(
  (r) => roleOf(r) && roleOf(r)!.capability !== ChatbotCapability.VIEW,
);

describe('Staff access matrix (stage 8 leak review)', () => {
  it('finds the view routes (sanity)', () => {
    expect(VIEW_ROUTES.length).toBeGreaterThan(40);
    expect(OTHER_ROUTES.length).toBeGreaterThan(40);
  });

  it('every view route that names a chatbot declares a staff policy in the matrix', () => {
    const missing = VIEW_ROUTES.filter((r) => !STAFF_ACCESS_MATRIX[r.key]).map(
      (r) => `${r.method} ${r.path} (${r.key})`,
    );
    expect(missing).toEqual([]);
  });

  it('names no route that does not exist, and no route above view', () => {
    const viewKeys = new Set(VIEW_ROUTES.map((r) => r.key));
    const listKeys = new Set<string>(STAFF_LIST_SCOPE_HANDLERS);
    const stale = Object.keys(STAFF_ACCESS_MATRIX).filter(
      (k) => !viewKeys.has(k) && !listKeys.has(k),
    );
    expect(stale).toEqual([]);
    for (const key of STAFF_LIST_SCOPE_HANDLERS) {
      const r = ALL.find((x) => x.key === key)!;
      expect(Reflect.getMetadata(ASSISTANT_SCOPE_KEY, fnOf(r))).toBe('list');
    }
  });

  it('conversation content is never "setup"', () => {
    const contentRoutes = VIEW_ROUTES.filter((r) =>
      /conversations|memory|contacts|records|audience|page\/access/.test(
        r.path,
      ),
    );
    expect(contentRoutes.length).toBeGreaterThan(5);
    for (const r of contentRoutes) {
      expect([r.key, staffPolicyFor(r.key)]).not.toEqual([r.key, 'setup']);
    }
    expect(
      staffPolicyFor('AssistantHomeController.readList', { list: 'audience' }),
    ).toBe('conversations');
    expect(
      staffPolicyFor('AssistantHomeController.readList', {
        list: 'pageAccess',
      }),
    ).toBe('conversations');
    expect(
      staffPolicyFor('AssistantHomeController.readList', { list: 'team' }),
    ).toBe('setup');
    expect(
      staffPolicyFor('AssistantHomeController.readList', { list: 'new' }),
    ).toBe('deny');
    expect(staffPolicyFor('Nope.nothing')).toBe('deny');
  });

  it('routes that change something or spend money are denied even though they are "view"', () => {
    for (const key of [
      'ChatbotController.restore',
      'ChatbotController.test',
      'ChatbotController.testStream',
      'ChatbotTeamController.leave',
    ]) {
      expect(staffPolicyFor(key)).toBe('deny');
    }
    const postsAllowed = VIEW_ROUTES.filter(
      (r) => r.method !== 'GET' && staffPolicyFor(r.key) !== 'deny',
    ).map((r) => r.key);
    // The one POST that only reads (a query with a body), and only with a grant.
    expect(postsAllowed).toEqual(['ListController.queryRecords']);
  });
});

describe('Staff read-only view through the member guard (stage 8)', () => {
  const BOT = '00000000-0000-4000-8000-000000000001';
  const OTHER_BOT = '00000000-0000-4000-8000-000000000002';
  const STAFF = 50;
  const NOT_STAFF = 51;
  const OWNER = 4;

  let now = Date.now();
  let grants: {
    id: string;
    chatbotId: string;
    expiresAt: number;
    revokedAt: number | null;
  }[] = [];
  let logRows: Record<string, unknown>[] = [];
  let logFails = false;
  let switchValue: string | undefined;

  const views = {
    insert: jest.fn(async (row: Record<string, unknown>) => {
      if (logFails) throw new Error('db down');
      logRows.push(row);
    }),
  };
  const dataSource = {
    query: jest.fn(async (sql: string, params: unknown[]) => {
      if (
        /FROM chatbot_access_grants/.test(sql) &&
        /expires_at > now\(\)/.test(sql)
      ) {
        return grants
          .filter(
            (g) =>
              g.chatbotId === params[0] &&
              g.revokedAt === null &&
              g.expiresAt > now,
          )
          .map((g) => ({ id: g.id }));
      }
      return [];
    }),
  };
  const staffService = new ChatbotStaffAccessService(
    { findOne: jest.fn() } as never,
    views as never,
    dataSource as never,
    {
      getUserPermissions: async (id: number) =>
        id === STAFF ? [PERMISSIONS.SYSTEM_ACCESS] : [],
    } as never,
    { get: () => switchValue } as never,
  );
  const access = new ChatbotAccessService(
    {
      findOne: async ({ where }: { where: { id: string } }) =>
        [BOT, OTHER_BOT].includes(where.id)
          ? { id: where.id, archivedAt: null }
          : null,
    } as never,
    {
      findOne: async ({
        where,
      }: {
        where: { chatbotId: string; userId: number };
      }) =>
        where.userId === OWNER
          ? { role: 'owner', roles: [ChatbotMemberRole.OWNER] }
          : null,
    } as never,
    { resolveTenantIds: async () => null } as never,
    { hasToggle: async () => true } as never,
    staffService,
  );
  const guard = new ChatbotMemberGuard(new Reflector(), access);

  const context = (r: Route, userId: number, params: Record<string, string>) =>
    ({
      getHandler: () => fnOf(r),
      getClass: () => r.cls,
      switchToHttp: () => ({
        getRequest: () => ({
          user: { id: userId },
          params,
          query: {},
          method: r.method,
          route: { path: `/${r.path}` },
        }),
      }),
    }) as unknown as ExecutionContext;

  /** Run as a request: an execution context with the caller signed in. */
  const asRequest = <T>(userId: number, fn: () => Promise<T>) =>
    ExecutionManager.runWithContext(
      async () => {
        ExecutionManager.setAuthContext(String(userId), 't');
        return fn();
      },
      { path: '/' },
    );

  const paramsFor = (r: Route) => {
    const params: Record<string, string> = {
      [roleOf(r)!.param]: BOT,
    };
    for (const m of r.path.matchAll(/:(\w+)/g)) {
      if (!params[m[1]])
        params[m[1]] =
          m[1] === 'list' ? 'team' : '00000000-0000-4000-8000-00000000000a';
    }
    return params;
  };

  beforeEach(() => {
    now = Date.now();
    grants = [];
    logRows = [];
    logFails = false;
    switchValue = undefined;
    views.insert.mockClear();
  });

  const liveGrant = () =>
    grants.push({
      id: '00000000-0000-4000-8000-0000000000aa',
      chatbotId: BOT,
      expiresAt: now + 24 * 3600_000,
      revokedAt: null,
    });

  describe.each(VIEW_ROUTES.map((r) => [`${r.method} ${r.path}`, r] as const))(
    '%s',
    (_name, r) => {
      const params = paramsFor(r);
      const policy = staffPolicyFor(r.key, params);

      it('a non-staff non-member still gets 404 and nothing is logged', async () => {
        await expect(
          asRequest(NOT_STAFF, () =>
            guard.canActivate(context(r, NOT_STAFF, params)),
          ),
        ).rejects.toBeInstanceOf(NotFoundException);
        expect(views.insert).not.toHaveBeenCalled();
      });

      if (policy === 'deny') {
        it('staff are refused even with a grant, and nothing is logged', async () => {
          liveGrant();
          await expect(
            asRequest(STAFF, () =>
              guard.canActivate(context(r, STAFF, params)),
            ),
          ).rejects.toBeInstanceOf(ForbiddenException);
          expect(views.insert).not.toHaveBeenCalled();
        });
        return;
      }

      if (policy === 'conversations') {
        it('staff without a live grant are refused, and nothing is logged', async () => {
          await expect(
            asRequest(STAFF, () =>
              guard.canActivate(context(r, STAFF, params)),
            ),
          ).rejects.toThrow(STAFF_MESSAGES.noGrant);
          expect(views.insert).not.toHaveBeenCalled();
        });
      }

      it('a staff read writes one log entry first, then is served', async () => {
        if (policy === 'conversations') liveGrant();
        const staffAfter = await asRequest(STAFF, async () => {
          await guard.canActivate(context(r, STAFF, params));
          // The service's own view check now passes for this bot, view only.
          const seen = await access.assertCan(
            BOT,
            ChatbotCapability.VIEW,
            STAFF,
          );
          return seen;
        });
        expect(staffAfter.staff).toBe(true);
        expect(staffAfter.roles).toEqual([]);
        expect(logRows).toHaveLength(1);
        expect(logRows[0]).toMatchObject({
          chatbotId: BOT,
          staffUserId: STAFF,
          policy,
          handler: r.key,
          route: `${r.method} /${r.path}`,
          grantId: policy === 'conversations' ? grants[0].id : null,
        });
      });

      it('a failed log write refuses the read', async () => {
        if (policy === 'conversations') liveGrant();
        logFails = true;
        await expect(
          asRequest(STAFF, async () => {
            try {
              await guard.canActivate(context(r, STAFF, params));
            } finally {
              // and the request was never marked as a staff view
              expect(ExecutionManager.getStaffView()).toBeUndefined();
            }
          }),
        ).rejects.toBeInstanceOf(ServiceUnavailableException);
      });
    },
  );

  it('staff can never pass a build, respond or manage-people route (walked)', async () => {
    liveGrant();
    for (const r of OTHER_ROUTES) {
      const params = paramsFor(r);
      await expect(
        asRequest(STAFF, () => guard.canActivate(context(r, STAFF, params))),
      ).rejects.toBeInstanceOf(NotFoundException);
    }
    expect(views.insert).not.toHaveBeenCalled();
  });

  it('after a logged view, staff still cannot edit, respond or manage, nor see another bot', async () => {
    const home = ALL.find((r) => r.key === 'AssistantHomeController.get')!;
    await asRequest(STAFF, async () => {
      await guard.canActivate(context(home, STAFF, { id: BOT }));
      for (const cap of [
        ChatbotCapability.BUILD,
        ChatbotCapability.RESPOND,
        ChatbotCapability.MANAGE_PEOPLE,
      ]) {
        await expect(access.assertCan(BOT, cap, STAFF)).rejects.toBeInstanceOf(
          NotFoundException,
        );
      }
      await expect(
        access.assertCan(OTHER_BOT, ChatbotCapability.VIEW, STAFF),
      ).rejects.toBeInstanceOf(NotFoundException);
      // The legacy shim used by the services: a viewer check passes, an editor check does not.
      await expect(
        access.assert(BOT, ChatbotMemberRole.VIEWER, STAFF),
      ).resolves.toMatchObject({
        role: ChatbotMemberRole.VIEWER,
      });
      await expect(
        access.assert(BOT, ChatbotMemberRole.EDITOR, STAFF),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  it('a staff view does not carry to the next request', async () => {
    const home = ALL.find((r) => r.key === 'AssistantHomeController.get')!;
    await asRequest(STAFF, () =>
      guard.canActivate(context(home, STAFF, { id: BOT })),
    );
    await asRequest(STAFF, async () => {
      await expect(
        access.assertCan(BOT, ChatbotCapability.VIEW, STAFF),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  it('an expired or revoked grant no longer opens conversations', async () => {
    const thread = ALL.find((r) => r.key === 'InboxController.thread')!;
    const params = {
      chatbotId: BOT,
      id: '00000000-0000-4000-8000-00000000000c',
    };
    liveGrant();
    await expect(
      asRequest(STAFF, () => guard.canActivate(context(thread, STAFF, params))),
    ).resolves.toBe(true);
    expect(logRows[0]).toMatchObject({ conversationId: params.id });
    now += 25 * 3600_000; // past the 24 hours
    await expect(
      asRequest(STAFF, () => guard.canActivate(context(thread, STAFF, params))),
    ).rejects.toThrow(STAFF_MESSAGES.noGrant);
    now -= 25 * 3600_000;
    grants[0].revokedAt = now;
    await expect(
      asRequest(STAFF, () => guard.canActivate(context(thread, STAFF, params))),
    ).rejects.toThrow(STAFF_MESSAGES.noGrant);
    expect(logRows).toHaveLength(1);
  });

  it('a chatbot that does not exist is a 404 for staff too, never logged', async () => {
    const home = ALL.find((r) => r.key === 'AssistantHomeController.get')!;
    await expect(
      asRequest(STAFF, () =>
        guard.canActivate(
          context(home, STAFF, { id: '00000000-0000-4000-8000-0000000000ff' }),
        ),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(views.insert).not.toHaveBeenCalled();
  });

  it('members are not logged, and the kill switch turns the staff view off (404)', async () => {
    const home = ALL.find((r) => r.key === 'AssistantHomeController.get')!;
    await asRequest(OWNER, () =>
      guard.canActivate(context(home, OWNER, { id: BOT })),
    );
    expect(views.insert).not.toHaveBeenCalled();
    switchValue = 'false';
    await expect(
      asRequest(STAFF, () =>
        guard.canActivate(context(home, STAFF, { id: BOT })),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('the inbox list and counts take one chatbot for staff, with a grant, logged', async () => {
    const route = {
      key: 'InboxController.list',
      route: 'GET /v1/inbox/conversations',
    };
    await asRequest(STAFF, async () => {
      await expect(access.staffListScope(BOT, route)).rejects.toThrow(
        STAFF_MESSAGES.noGrant,
      );
    });
    liveGrant();
    const scope = await asRequest(STAFF, () =>
      access.staffListScope(BOT, route),
    );
    expect(scope).toEqual([BOT]);
    expect(logRows).toHaveLength(1);
    // Members and non-staff keep their own scope; no chatbot named: nothing changes.
    expect(
      await asRequest(OWNER, () => access.staffListScope(BOT, route)),
    ).toBeUndefined();
    expect(
      await asRequest(NOT_STAFF, () => access.staffListScope(BOT, route)),
    ).toBeUndefined();
    expect(
      await asRequest(STAFF, () => access.staffListScope(undefined, route)),
    ).toBeUndefined();
    logFails = true;
    await expect(
      asRequest(STAFF, () => access.staffListScope(BOT, route)),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  describe('read-only conversations (staff view of the inbox)', () => {
    const CONV = '00000000-0000-4000-8000-00000000000c';
    const CONTACT = '00000000-0000-4000-8000-00000000000d';
    const route = (key: string) => ALL.find((r) => r.key === key)!;
    const reads = () =>
      [
        [route('InboxController.thread'), { chatbotId: BOT, id: CONV }],
        [
          route('InboxController.memoryOf'),
          { chatbotId: BOT, contactId: CONTACT },
        ],
      ] as const;

    it('without a live grant every conversation read is refused with the no-grant message, nothing logged', async () => {
      for (const [r, params] of reads()) {
        await expect(
          asRequest(STAFF, () => guard.canActivate(context(r, STAFF, params))),
        ).rejects.toThrow(STAFF_MESSAGES.noGrant);
      }
      for (const key of STAFF_LIST_SCOPE_HANDLERS) {
        await expect(
          asRequest(STAFF, () =>
            access.staffListScope(BOT, { key, route: 'GET /x' }),
          ),
        ).rejects.toThrow(STAFF_MESSAGES.noGrant);
      }
      expect(views.insert).not.toHaveBeenCalled();
    });

    it('with a live grant staff read the list, counts, a thread and the memory view, each logged', async () => {
      liveGrant();
      for (const key of STAFF_LIST_SCOPE_HANDLERS) {
        expect(
          await asRequest(STAFF, () =>
            access.staffListScope(BOT, { key, route: 'GET /x' }),
          ),
        ).toEqual([BOT]);
      }
      for (const [r, params] of reads()) {
        await expect(
          asRequest(STAFF, () => guard.canActivate(context(r, STAFF, params))),
        ).resolves.toBe(true);
      }
      expect(logRows).toHaveLength(4);
      for (const row of logRows) {
        expect(row).toMatchObject({
          chatbotId: BOT,
          staffUserId: STAFF,
          policy: 'conversations',
          grantId: grants[0].id,
        });
      }
      expect(logRows[2]).toMatchObject({
        handler: 'InboxController.thread',
        conversationId: CONV,
      });
      expect(logRows[3]).toMatchObject({
        handler: 'InboxController.memoryOf',
        target: `contactId:${CONTACT}`,
      });
    });

    it('names every staff-forbidden action, each gated above view (or own-scope only)', () => {
      const expected: Record<string, ChatbotCapability> = {
        respond: ChatbotCapability.RESPOND,
        build: ChatbotCapability.BUILD,
      };
      for (const [key, rule] of Object.entries(
        STAFF_NEVER_CONVERSATION_ACTIONS,
      )) {
        const r = ALL.find((x) => x.key === key);
        expect([key, !!r]).toEqual([key, true]);
        expect(STAFF_ACCESS_MATRIX[key]).toBeUndefined();
        if (rule.enforcedBy === 'own') {
          expect(roleOf(r!)).toBeUndefined();
          expect(Reflect.getMetadata(ASSISTANT_SCOPE_KEY, fnOf(r!))).toBe(
            'service',
          );
        } else {
          expect([key, roleOf(r!)?.capability]).toEqual([
            key,
            expected[rule.enforcedBy],
          ]);
        }
      }
      // Every write route in the inbox is in the list.
      const inboxWrites = ALL.filter(
        (r) => r.key.startsWith('InboxController.') && r.method !== 'GET',
      ).map((r) => r.key);
      expect(inboxWrites.length).toBeGreaterThanOrEqual(6);
      for (const key of inboxWrites) {
        expect(STAFF_NEVER_CONVERSATION_ACTIONS[key]).toBeDefined();
      }
    });

    it('staff with a live grant can never take over, hand back, reply, forget, edit, delete or export', async () => {
      liveGrant();
      for (const [key, rule] of Object.entries(
        STAFF_NEVER_CONVERSATION_ACTIONS,
      )) {
        if (rule.enforcedBy === 'own') continue;
        const r = route(key);
        await expect(
          asRequest(STAFF, () =>
            guard.canActivate(context(r, STAFF, paramsFor(r))),
          ),
        ).rejects.toBeInstanceOf(NotFoundException);
      }
      // Even inside a request already admitted to read a thread.
      await asRequest(STAFF, async () => {
        await guard.canActivate(
          context(route('InboxController.thread'), STAFF, {
            chatbotId: BOT,
            id: CONV,
          }),
        );
        for (const cap of [
          ChatbotCapability.RESPOND,
          ChatbotCapability.BUILD,
        ]) {
          await expect(
            access.assertCan(BOT, cap, STAFF),
          ).rejects.toBeInstanceOf(NotFoundException);
        }
      });
      expect(logRows).toHaveLength(1);
      expect(logRows[0]).toMatchObject({ handler: 'InboxController.thread' });
    });
  });
});

describe("The owner's grant (stage 8)", () => {
  const BOT = '00000000-0000-4000-8000-000000000001';
  const make = () => {
    const tx = {
      query: jest.fn<Promise<{ id: string }[]>, [string, unknown[]?]>(
        async () => [{ id: 'g1' }],
      ),
    };
    const dataSource = {
      transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
      query: jest.fn(async () => [
        {
          id: 'g1',
          granted_by: 4,
          granted_by_name: 'Owner',
          reason: null,
          created_at: new Date(),
          expires_at: new Date(),
          revoked_at: null,
          status: 'live',
        },
      ]),
    };
    const service = new ChatbotStaffAccessService(
      { findOne: jest.fn() } as never,
      { insert: jest.fn() } as never,
      dataSource as never,
      { getUserPermissions: async () => [] } as never,
      { get: () => undefined } as never,
    );
    return { service, tx };
  };

  it('defaults to 24 hours and replaces any live grant first', async () => {
    const { service, tx } = make();
    const grant = await service.grant(BOT, 4);
    expect(grant.status).toBe('live');
    expect(tx.query.mock.calls[0][0]).toMatch(/UPDATE chatbot_access_grants/);
    const insert = tx.query.mock.calls[1] as unknown as [string, unknown[]];
    expect(insert[0]).toMatch(/make_interval\(hours => \$5::int\)/);
    expect(insert[1][4]).toBe(STAFF_GRANT_DEFAULT_HOURS);
    expect(STAFF_GRANT_DEFAULT_HOURS).toBe(24);
  });

  it('allows up to 7 days and nothing longer or shorter than an hour', async () => {
    const { service, tx } = make();
    await service.grant(BOT, 4, {
      hours: STAFF_GRANT_MAX_HOURS,
      reason: ' help ',
    });
    expect(STAFF_GRANT_MAX_HOURS).toBe(168);
    const insert = tx.query.mock.calls[1] as unknown as [string, unknown[]];
    expect(insert[1][3]).toBe('help');
    for (const hours of [0, 169, 1.5, -1]) {
      await expect(service.grant(BOT, 4, { hours })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    }
  });
});
