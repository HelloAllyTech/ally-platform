import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { FeatureToggleKey } from '../../../authorization/constants/admin-feature-toggle.constants';
import { FeatureToggleGuard } from '../../../auth/guards/feature-toggle.guard';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { FEATURE_TOGGLE_KEY } from '../../../auth/decorators/feature-toggle.decorator';
import { PERMISSIONS_KEY } from '../../../auth/decorators/permissions.decorator';
import { PLATFORM_ADMIN_ONLY_KEY } from '../../../auth/decorators/platform-admin-only.decorator';
import { IS_PUBLIC_KEY } from '../../../auth/decorators/auth.metadata';
import { ASSISTANT_OWNER_PERMISSIONS } from '../../../common/constants/user.constants';
import {
  ASSISTANT_SCOPE_KEY,
  CHATBOT_ROLE_KEY,
} from '../chatbot-role.decorator';

/**
 * CR1 Part B, the walk test: a custom login is now an Assistant owner — the ASSISTANT_OWNER role's
 * permissions only, no `system:access`, and the toggles Ally ticked (Chatbots). Every controller
 * in ally-be is walked through the real PermissionsGuard and FeatureToggleGuard as one, and
 * nothing that needs a permission or a toggle may be reachable outside the assistants area and the
 * person's own account. (A1's walk, `custom-login.spec.ts`, still covers the old platform-admin
 * custom logins until the migration script moves them.)
 */
const SRC = path.resolve(__dirname, '../../..');
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

interface Route {
  label: string;
  cls: object;
  fn: object;
  path: string;
}

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      return ['test', 'node_modules', '__tests__'].includes(e.name)
        ? []
        : files(full);
    }
    return e.name.endsWith('.controller.ts') ? [full] : [];
  });
}

function allRoutes(): Route[] {
  const out: Route[] = [];
  for (const file of files(SRC)) {
    const mod = require(file) as Record<string, unknown>;
    for (const exported of Object.values(mod)) {
      if (typeof exported !== 'function') continue;
      const raw = Reflect.getMetadata(PATH_METADATA, exported) as
        | string
        | string[]
        | undefined;
      if (raw === undefined) continue;
      const base = Array.isArray(raw) ? raw[0] : raw;
      const proto = (exported as { prototype: Record<string, unknown> })
        .prototype;
      for (const name of Object.getOwnPropertyNames(proto)) {
        const fn = proto[name];
        if (name === 'constructor' || typeof fn !== 'function') continue;
        const sub = Reflect.getMetadata(PATH_METADATA, fn) as
          | string
          | undefined;
        if (sub === undefined) continue;
        const verb = VERBS[Reflect.getMetadata(METHOD_METADATA, fn) as number];
        const p = [base, sub]
          .map((part) =>
            String(Array.isArray(part) ? part[0] : part).replace(
              /^\/+|\/+$/g,
              '',
            ),
          )
          .filter(Boolean)
          .join('/');
        out.push({ label: `${verb} ${p}`, cls: exported, fn, path: p });
      }
    }
  }
  return out;
}

const ALL = allRoutes();
const meta = <T>(key: string, r: Route) =>
  (Reflect.getMetadata(key, r.fn) ?? Reflect.getMetadata(key, r.cls)) as
    | T
    | undefined;
const isAssistantRoute = (r: Route) =>
  !!meta(CHATBOT_ROLE_KEY, r) || !!meta(ASSISTANT_SCOPE_KEY, r);
/** The person's own plan, usage and tokens (no dollars). */
const isOwnAccount = (r: Route) => /^v1\/me\/(plan|usage)/.test(r.path);

const toggles = new FeatureToggleGuard(
  new Reflector(),
  {
    isWithheld: async () => false,
    hasToggle: async (_id: number, key: string) =>
      key === FeatureToggleKey.WHATSAPP_BOT,
    isLimitedToOrgScopedRoutes: async () => false,
  } as never,
  { isEnabledForTenant: async () => false } as never,
  {} as never,
  { getUserPermissions: async () => ASSISTANT_OWNER_PERMISSIONS } as never,
);
const permissions = new PermissionsGuard(new Reflector(), {
  getUserPermissions: async () => ASSISTANT_OWNER_PERMISSIONS,
} as never);

const ctx = (r: Route) =>
  ({
    getHandler: () => r.fn,
    getClass: () => r.cls,
    switchToHttp: () => ({
      getRequest: () => ({
        user: { id: 42, tenantId: 'org-1' },
        params: {},
        query: {},
      }),
    }),
  }) as unknown as ExecutionContext;

async function reaches(r: Route): Promise<boolean> {
  if (meta<boolean>(PLATFORM_ADMIN_ONLY_KEY, r)) return false;
  try {
    return (
      (await permissions.canActivate(ctx(r))) &&
      (await toggles.canActivate(ctx(r)))
    );
  } catch (error) {
    if (error instanceof ForbiddenException) return false;
    throw error;
  }
}

/** A route anyone signed in reaches today: no permission and no toggle of its own. */
const needsNothing = (r: Route) => {
  const perms = meta<{ permissions: string[] }>(PERMISSIONS_KEY, r);
  return !meta(FEATURE_TOGGLE_KEY, r) && !perms?.permissions?.length;
};

describe('Custom logins as Assistant owners (CR1 walk test)', () => {
  it('has no system:access, so it is never a platform admin', () => {
    expect(ASSISTANT_OWNER_PERMISSIONS).not.toContain('system:access');
  });

  it('reaches every assistant route except the Ally-wide ones', async () => {
    const refused: string[] = [];
    for (const r of ALL.filter(isAssistantRoute)) {
      if (meta<string>(ASSISTANT_SCOPE_KEY, r) === 'platform') continue;
      if (!(await reaches(r))) refused.push(r.label);
    }
    expect(refused).toEqual([]);
  });

  it('reaches nothing that needs a permission or a toggle outside the assistants area and its own account', async () => {
    const reached: string[] = [];
    for (const r of ALL) {
      if (isAssistantRoute(r) || isOwnAccount(r) || needsNothing(r)) continue;
      if (await reaches(r)) reached.push(r.label);
    }
    expect(reached).toEqual([]);
  });

  it('cannot reach the Ally-wide WhatsApp routes, the old number mappings, Costs or Custom logins', async () => {
    const closed = ALL.filter(
      (r) =>
        meta<string>(ASSISTANT_SCOPE_KEY, r) === 'platform' ||
        r.path.startsWith('v1/whatsapp/phone-mappings') ||
        r.path.startsWith('v1/admin/billing') ||
        r.path.startsWith('v1/custom-logins'),
    );
    expect(closed.length).toBeGreaterThan(20);
    const open: string[] = [];
    for (const r of closed) if (await reaches(r)) open.push(r.label);
    expect(open).toEqual([]);
  });

  /**
   * Routes with no permission and no toggle are open to any signed-in account (a learner's too);
   * the custom login reaches them only as any user would. Counted so a new one shows in review.
   */
  it('counts the routes any signed-in user reaches', () => {
    const anyUser = ALL.filter(
      (r) =>
        !isAssistantRoute(r) &&
        needsNothing(r) &&
        !meta<boolean>(IS_PUBLIC_KEY, r) &&
        !/^v1\/(public|internal|webhook)\//.test(r.path),
    );
    expect(anyUser.length).toMatchSnapshot();
  });
});
