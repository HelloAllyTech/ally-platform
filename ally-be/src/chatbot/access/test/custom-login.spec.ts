import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { FeatureToggleKey } from '../../../authorization/constants/admin-feature-toggle.constants';
import { FeatureToggleGuard } from '../../../auth/guards/feature-toggle.guard';
import {
  FEATURE_TOGGLE_KEY,
  FeatureToggleOptions,
} from '../../../auth/decorators/feature-toggle.decorator';
import { IS_PUBLIC_KEY } from '../../../auth/decorators/auth.metadata';
import {
  ASSISTANT_SCOPE_KEY,
  CHATBOT_ROLE_KEY,
} from '../chatbot-role.decorator';

/**
 * A1 "custom logins": a platform admin whose toggles were set to exactly what was ticked
 * (POST /v1/users → POST /v1/platform-admins → PATCH /v1/users/:id/feature-toggles). The toggle
 * logic is unchanged, so this walks EVERY controller in ally-be through the real FeatureToggleGuard
 * as a login with only Chatbots (WHATSAPP_BOT) and:
 * - proves the assistant routes pass and every other toggle-gated route is refused;
 * - lists what such a login can still reach (permission-only routes, the Ally-wide WhatsApp routes,
 *   and routes an organisation preference opens), recorded in CHUNK-A1-NOTES.md and
 *   LAUNCH-CHECKLIST.md: custom logins are platform admins until these are closed.
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
        out.push({
          label: `${verb} ${p}`,
          cls: exported,
          fn,
          path: p,
        });
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

/** A custom login with only Chatbots ticked: every other key stored as off. */
function guardFor(enabled: FeatureToggleKey[], orgPreferencesOn: boolean) {
  const featureToggleService = {
    isWithheld: async () => false,
    hasToggle: async (_id: number, key: string) =>
      enabled.includes(key as FeatureToggleKey),
    isLimitedToOrgScopedRoutes: async () => false,
  };
  return new FeatureToggleGuard(
    new Reflector(),
    featureToggleService as never,
    { isEnabledForTenant: async () => orgPreferencesOn } as never,
    {} as never,
    // A platform admin holds every permission the platform role has.
    { getUserPermissions: async () => [] } as never,
  );
}

const ctx = (r: Route) =>
  ({
    getHandler: () => r.fn,
    getClass: () => r.cls,
    switchToHttp: () => ({
      getRequest: () => ({
        user: { id: 42, tenantId: 1 },
        params: {},
        query: {},
      }),
    }),
  }) as unknown as ExecutionContext;

async function passes(guard: FeatureToggleGuard, r: Route): Promise<boolean> {
  try {
    return await guard.canActivate(ctx(r));
  } catch (error) {
    if (error instanceof ForbiddenException) return false;
    throw error;
  }
}

describe('Custom logins: a platform admin with only Chatbots (A1)', () => {
  const chatbotsOnly = guardFor([FeatureToggleKey.WHATSAPP_BOT], false);

  it('walks every controller in ally-be (sanity)', () => {
    expect(ALL.length).toBeGreaterThan(500);
  });

  it('reaches every assistant route', async () => {
    const assistant = ALL.filter(isAssistantRoute);
    expect(assistant.length).toBeGreaterThan(150);
    const refused: string[] = [];
    for (const r of assistant)
      if (!(await passes(chatbotsOnly, r))) refused.push(r.label);
    expect(refused).toEqual([]);
  });

  it('gets the toggle refusal on every other toggle-gated route (no org preference)', async () => {
    const reached: string[] = [];
    for (const r of ALL) {
      const options = meta<FeatureToggleOptions>(FEATURE_TOGGLE_KEY, r);
      if (!options || options.featureKey === FeatureToggleKey.WHATSAPP_BOT)
        continue;
      if (await passes(chatbotsOnly, r)) reached.push(r.label);
    }
    expect(reached).toEqual([]);
  });

  it('cannot reach Users, the custom-login screen’s routes or Ally admins', async () => {
    const userAdmin = ALL.filter((r) =>
      [
        'POST v1/users',
        'PATCH v1/users/:userId/feature-toggles',
        'GET v1/users/:userId/feature-toggles',
        'POST v1/platform-admins',
        'DELETE v1/platform-admins/:userId',
      ].includes(r.label),
    );
    expect(userAdmin).toHaveLength(5);
    for (const r of userAdmin)
      expect(await passes(chatbotsOnly, r)).toBe(false);
  });

  it('keeps those routes to holders of the toggle themselves: no organisation-wide way in', () => {
    for (const label of [
      'POST v1/users',
      'PATCH v1/users/:userId/feature-toggles',
      'POST v1/platform-admins',
    ]) {
      const r = ALL.find((x) => x.label === label)!;
      const options = meta<FeatureToggleOptions>(FEATURE_TOGGLE_KEY, r)!;
      expect(options.featureKey).toBe(
        label === 'POST v1/users'
          ? FeatureToggleKey.USERS
          : FeatureToggleKey.ADMIN_USER_MANAGEMENT,
      );
      // Neither the org-preference nor the org-admin branch can open them: only a per-user row,
      // and those rows are given to platform admins alone.
      expect(options.tenantPreference).toBeUndefined();
      expect(options.orgAdminPermission).toBeUndefined();
      expect(options.alsoAllowedBy).toBeUndefined();
    }
  });

  it('has no sign-up route anywhere in auth', () => {
    const signUp = ALL.filter((r) =>
      /(^|\/)(sign-?up|register)(\/|$)/i.test(r.path),
    ).map((r) => r.label);
    expect(signUp).toEqual([]);
  });

  /**
   * What a Chatbots-only custom login can still reach, because it is a platform admin. Kept as a
   * snapshot so a new route that widens this shows up in review. Closing these (a scoped role, or
   * an allowlist on the routes) is needed before self-serve customers get logins.
   */
  it('lists what it can still reach (open item)', async () => {
    const permissionOnly: string[] = [];
    const allyWideWhatsApp: string[] = [];
    const viaOrgPreference: string[] = [];
    const withOrgPrefs = guardFor([FeatureToggleKey.WHATSAPP_BOT], true);
    for (const r of ALL) {
      if (meta<boolean>(IS_PUBLIC_KEY, r)) continue;
      if (/^v1\/(public|internal|webhook)\//.test(r.path)) continue;
      const options = meta<FeatureToggleOptions>(FEATURE_TOGGLE_KEY, r);
      if (!options) {
        permissionOnly.push(r.label);
        continue;
      }
      if (options.featureKey === FeatureToggleKey.WHATSAPP_BOT) {
        const scope = meta<string>(ASSISTANT_SCOPE_KEY, r);
        if (!isAssistantRoute(r) || scope === 'platform')
          allyWideWhatsApp.push(r.label);
        continue;
      }
      if (!(await passes(chatbotsOnly, r)) && (await passes(withOrgPrefs, r))) {
        viaOrgPreference.push(r.label);
      }
    }
    const report = { permissionOnly, allyWideWhatsApp, viaOrgPreference };
    if (process.env.WRITE_CUSTOM_LOGIN_REPORT) {
      fs.writeFileSync(
        process.env.WRITE_CUSTOM_LOGIN_REPORT,
        JSON.stringify(report, null, 2),
      );
    }
    expect(allyWideWhatsApp.sort()).toMatchSnapshot(
      'Ally-wide WhatsApp routes',
    );
    expect({
      permissionOnly: permissionOnly.length,
      viaOrgPreference: viaOrgPreference.length,
    }).toMatchSnapshot('counts');
  });
});
