import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import {
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { FeatureToggleGuard } from '../../../auth/guards/feature-toggle.guard';
import { ChatbotCapability, ChatbotMemberRole } from '../../enum/chatbot.enum';
import { can } from '../chatbot-roles';
import { ChatbotAccessService } from '../../service/chatbot-access.service';
import { ChatbotMemberGuard } from '../chatbot-member.guard';
import {
  ASSISTANT_SCOPE_KEY,
  CHATBOT_ROLE_KEY,
  ChatbotRoleOptions,
} from '../chatbot-role.decorator';

/**
 * A1's route walk: every assistant route, found from the controllers on disk (so a new controller
 * or route can't be missed), declares how it keeps to the caller's own bots, and every route that
 * names a bot is walked as a non-member (404), a viewer, a responder, an editor, an owner, and a
 * platform admin who isn't a member (404). Stage 1b: each route needs a capability; a member passes
 * when their role SET grants it (a responder: view and respond, never build).
 */

const SRC = path.resolve(__dirname, '../../..');
const DIRS = ['chatbot', 'bot-draft', 'whatsapp'];
/** Not assistant routes: their own access (public pages, the agent gateway, Meta's webhook), or
 * platform data that is not an assistant (the WhatsApp numbers list, WA-NUMBERS-REPORT.md). */
const NOT_ASSISTANT = [
  /^v1\/public\//,
  /^v1\/internal\//,
  /^v1\/webhook\//,
  /^v1\/whatsapp\/phone-mappings$/,
];

interface Route {
  controller: string;
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

const VERBS = [
  'GET',
  'POST',
  'PUT',
  'DELETE',
  'PATCH',
  'ALL',
  'OPTIONS',
  'HEAD',
  'SEARCH',
];

function routes(): Route[] {
  const out: Route[] = [];
  for (const file of DIRS.flatMap((d) => controllerFiles(path.join(SRC, d)))) {
    const mod = require(file) as Record<string, unknown>;
    for (const exported of Object.values(mod)) {
      if (typeof exported !== 'function') continue;
      const base = Reflect.getMetadata(PATH_METADATA, exported) as
        | string
        | undefined;
      if (base === undefined) continue;
      if (NOT_ASSISTANT.some((re) => re.test(base))) continue;
      const proto = (exported as { prototype: object }).prototype;
      for (const handler of Object.getOwnPropertyNames(proto)) {
        if (handler === 'constructor') continue;
        const fn = (proto as Record<string, unknown>)[handler];
        if (typeof fn !== 'function') continue;
        const sub = Reflect.getMetadata(PATH_METADATA, fn) as
          | string
          | undefined;
        if (sub === undefined) continue;
        const verb = Reflect.getMetadata(METHOD_METADATA, fn) as number;
        out.push({
          controller: (exported as { name: string }).name,
          cls: exported as Route['cls'],
          handler,
          method: VERBS[verb] ?? String(verb),
          path: [base, sub].filter(Boolean).join('/'),
        });
      }
    }
  }
  return out;
}

const ALL = routes();
const label = (r: Route) =>
  `${r.method} ${r.path} (${r.controller}.${r.handler})`;
const fnOf = (r: Route) =>
  (r.cls.prototype as Record<string, (...a: unknown[]) => unknown>)[r.handler];
const roleOf = (r: Route) =>
  Reflect.getMetadata(CHATBOT_ROLE_KEY, fnOf(r)) as
    | ChatbotRoleOptions
    | undefined;
const scopeOf = (r: Route) =>
  Reflect.getMetadata(ASSISTANT_SCOPE_KEY, fnOf(r)) as string | undefined;

describe('Assistant routes: owners only (A1 route walk)', () => {
  it('finds the assistant controllers (sanity)', () => {
    const controllers = new Set(ALL.map((r) => r.controller));
    for (const name of [
      'ChatbotController',
      'AssistantHomeController',
      'CheckupController',
      'InboxController',
      'ListController',
      'BotDraftController',
      'WhatsAppConversationController',
    ]) {
      expect(controllers).toContain(name);
    }
    expect(ALL.length).toBeGreaterThan(150);
  });

  it('every assistant route declares @ChatbotRole or @AssistantScope', () => {
    const missing = ALL.filter((r) => !roleOf(r) && !scopeOf(r)).map(label);
    expect(missing).toEqual([]);
  });

  it('every route that names a bot in its path declares @ChatbotRole on that param', () => {
    const wrong = ALL.filter((r) => {
      const role = roleOf(r);
      const namesBot =
        /^v1\/chatbots\/:id(\/|$)/.test(r.path) ||
        /^v1\/inbox\/chatbots\/:chatbotId(\/|$)/.test(r.path);
      if (!namesBot) return !!role; // a role on a route with no bot param can't be checked
      return !role || !r.path.includes(`:${role.param}`);
    }).map(label);
    expect(wrong).toEqual([]);
  });

  it('runs the member check after the route’s own feature-toggle guard', () => {
    const misordered = ALL.filter((r) => roleOf(r)).filter((r) => {
      const guards = (Reflect.getMetadata(GUARDS_METADATA, fnOf(r)) ??
        []) as unknown[];
      const member = guards.indexOf(ChatbotMemberGuard);
      const toggle = guards.indexOf(FeatureToggleGuard);
      return member < 0 || toggle < 0 || member < toggle;
    });
    expect(misordered.map(label)).toEqual([]);
  });

  describe('walked as each kind of caller', () => {
    const BOT = '00000000-0000-4000-8000-000000000001';
    const PEOPLE = {
      nonMember: 1,
      viewer: 2,
      editor: 3,
      owner: 4,
      platformAdminNonMember: 5,
      responder: 6,
      viewerResponder: 7,
    } as const;
    const MEMBERS: Record<number, ChatbotMemberRole[]> = {
      [PEOPLE.viewer]: [ChatbotMemberRole.VIEWER],
      [PEOPLE.editor]: [ChatbotMemberRole.EDITOR],
      [PEOPLE.owner]: [ChatbotMemberRole.OWNER],
      [PEOPLE.responder]: [ChatbotMemberRole.RESPONDER],
      [PEOPLE.viewerResponder]: [
        ChatbotMemberRole.RESPONDER,
        ChatbotMemberRole.VIEWER,
      ],
    };
    // What the old column holds for each (dual write): a responder is a viewer there.
    const LEGACY: Record<number, ChatbotMemberRole> = {
      [PEOPLE.viewer]: ChatbotMemberRole.VIEWER,
      [PEOPLE.editor]: ChatbotMemberRole.EDITOR,
      [PEOPLE.owner]: ChatbotMemberRole.OWNER,
      [PEOPLE.responder]: ChatbotMemberRole.VIEWER,
      [PEOPLE.viewerResponder]: ChatbotMemberRole.VIEWER,
    };
    const access = new ChatbotAccessService(
      { findOne: async () => ({ id: BOT, archivedAt: null }) } as never,
      {
        findOne: async ({
          where,
        }: {
          where: { chatbotId: string; userId: number };
        }) =>
          where.chatbotId === BOT && MEMBERS[where.userId]
            ? { role: LEGACY[where.userId], roles: MEMBERS[where.userId] }
            : null,
      } as never,
      {
        resolveTenantIds: async (userId: number) =>
          userId === PEOPLE.platformAdminNonMember ? null : ['org-a'],
      } as never,
      { hasToggle: async () => true } as never,
    );
    const guard = new ChatbotMemberGuard(new Reflector(), access);
    const context = (r: Route, userId: number, param: string) =>
      ({
        getHandler: () => fnOf(r),
        getClass: () => r.cls,
        switchToHttp: () => ({
          getRequest: () => ({
            user: { id: userId },
            params: { [param]: BOT },
          }),
        }),
      }) as unknown as ExecutionContext;

    const walked = ALL.filter((r) => roleOf(r));

    it.each(walked.map((r) => [label(r), r] as const))(
      '%s',
      async (_name, r) => {
        const { capability: needed, param } = roleOf(r)!;
        for (const userId of [
          PEOPLE.nonMember,
          PEOPLE.platformAdminNonMember,
        ]) {
          await expect(
            guard.canActivate(context(r, userId, param)),
          ).rejects.toBeInstanceOf(NotFoundException);
        }
        expect(Object.values(ChatbotCapability)).toContain(needed);
        for (const userId of [
          PEOPLE.viewer,
          PEOPLE.editor,
          PEOPLE.owner,
          PEOPLE.responder,
          PEOPLE.viewerResponder,
        ]) {
          const has = MEMBERS[userId];
          const call = guard.canActivate(context(r, userId, param));
          if (can(has, needed)) {
            await expect(call).resolves.toBe(true);
          } else {
            await expect(call).rejects.toBeInstanceOf(ForbiddenException);
          }
        }
      },
    );
  });

  it('keeps the team, deleting, eval suites, the safety pack and seats to owners', () => {
    const owners = ALL.filter(
      (r) => roleOf(r)?.capability === ChatbotCapability.MANAGE_PEOPLE,
    )
      .map((r) => `${r.method} ${r.path}`)
      .sort();
    expect(owners).toEqual([
      'DELETE v1/chatbots/:id/invites/:inviteId',
      // Stage 1b: removing one person, invites and handing the chatbot over.
      'DELETE v1/chatbots/:id/members/:userId',
      // Stage 8: an owner's permission for Ally staff to read conversations, and who looked.
      'DELETE v1/chatbots/:id/staff-access/:grantId',
      'GET v1/chatbots/:id/invites',
      'GET v1/chatbots/:id/staff-access',
      'GET v1/chatbots/:id/staff-views',
      'POST v1/chatbots/:id/archive',
      'POST v1/chatbots/:id/checkup/suites',
      'POST v1/chatbots/:id/invites',
      // Stage 5: only an owner lets a source with personal details be indexed.
      'POST v1/chatbots/:id/knowledge/:documentId/approve',
      // Stage 4: accepting the safety terms before go-live.
      'POST v1/chatbots/:id/safety-terms',
      'POST v1/chatbots/:id/staff-access',
      // T1: a template can raise the safety pack and turn hand-over on, both owners' switches.
      'POST v1/chatbots/:id/templates/:templateId',
      'POST v1/chatbots/:id/transfer',
      'PUT v1/chatbots/:id/members',
      // Q3-fast Part 1: the owner corrects the pack, with a reason when it's less strict.
      'PUT v1/chatbots/:id/safety-pack',
      // Stage 5: an owner stores a safety-text translation (unused until Ally reviews it).
      'PUT v1/chatbots/:id/safety-translations',
      // CR1: only an owner gives, moves or frees a seat on their assistant.
      'PUT v1/chatbots/:id/seats/:seatId/assignee',
    ]);
  });

  it('take-over, hand-back and reply are the respond capability, not edit (Stage 1b)', () => {
    const respond = ALL.filter(
      (r) => roleOf(r)?.capability === ChatbotCapability.RESPOND,
    )
      .map((r) => `${r.method} ${r.path}`)
      .sort();
    expect(respond).toEqual(
      expect.arrayContaining([
        'POST v1/inbox/chatbots/:chatbotId/conversations/:id/hand-back',
        'POST v1/inbox/chatbots/:chatbotId/conversations/:id/messages',
        'POST v1/inbox/chatbots/:chatbotId/conversations/:id/take-over',
      ]),
    );
  });

  it('a responder can change nothing that shapes the chatbot (no build route admits them)', () => {
    const responderBuilds = ALL.filter((r) => {
      const cap = roleOf(r)?.capability;
      return (
        cap &&
        can([ChatbotMemberRole.RESPONDER], cap) &&
        cap !== ChatbotCapability.VIEW &&
        cap !== ChatbotCapability.RESPOND
      );
    }).map(label);
    expect(responderBuilds).toEqual([]);
    const build = ALL.filter(
      (r) => roleOf(r)?.capability === ChatbotCapability.BUILD,
    );
    expect(build.length).toBeGreaterThan(20);
  });
});
