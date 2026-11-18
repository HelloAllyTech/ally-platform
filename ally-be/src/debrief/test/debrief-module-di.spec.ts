import 'reflect-metadata';
import { ModuleRef, Reflector } from '@nestjs/core';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource, EntityManager } from 'typeorm';
import { validationSchema } from 'src/config/env.validation';

/**
 * Importing the module graph runs `ConfigModule.forRoot`, which validates the environment at import
 * time. Fill every REQUIRED variable the schema names with a harmless placeholder of its type, so
 * the guard needs no real environment (nothing here connects to anything).
 */
const CANDIDATES = [
  'x',
  '1',
  'true',
  'http://localhost',
  'a@example.com',
  '/tmp/x.json',
  'x.json',
  'localhost',
  '1,2',
];
function placeholderFor(name: string, d: any): string {
  if (Array.isArray(d.allow) && d.allow.length) return String(d.allow[0]);
  // The first candidate the variable's own rule accepts.
  const rule = (validationSchema as any).extract(name);
  const ok = CANDIDATES.find((c) => !rule.validate(c).error);
  return ok ?? 'x';
}
for (const [name, d] of Object.entries<any>(
  validationSchema.describe().keys ?? {},
)) {
  if (d.flags?.presence === 'required' && process.env[name] === undefined) {
    process.env[name] = placeholderFor(name, d);
  }
}

/* eslint-disable @typescript-eslint/no-require-imports */
const { DebriefModule } = require('../debrief.module');
const { AuthModule } = require('src/auth/auth.module');
const {
  AuthorizationModule,
} = require('src/authorization/authorization.module');
const { CommonModule } = require('src/common/common.module');
const { AppConfigModule } = require('src/config/config.module');
const { PostHogModule: PosthogModule } = require('src/posthog/posthog.module');
const { RedisModule } = require('src/redis/redis.module');
/* eslint-enable @typescript-eslint/no-require-imports */

/**
 * A permanent guard for the Debrief module's dependency graph. CI never compiles Nest's DI graph
 * (a past release exited 1 at boot), and building the whole module needs the database and every
 * imported module, so this reads the same metadata Nest reads: every constructor parameter of every
 * provider and controller in `DebriefModule` must be a provider in it, an export of a module it
 * imports, or a known app-wide provider. `@Optional()` and `@Inject(token)` parameters are exempt,
 * as are interfaces (their type is erased) and `forwardRef`s.
 */
type Token = unknown;

const metaOf = (target: unknown, key: string): any[] =>
  (Reflect.getMetadata(key, target as object) as any[]) ?? [];

const tokenOf = (p: any): Token =>
  p && p.provide !== undefined ? p.provide : p;

/** What a module (class or dynamic) makes available to its importer. */
function exportsOf(mod: any, seen = new Set<unknown>()): Token[] {
  if (!mod || seen.has(mod)) return [];
  seen.add(mod);
  const cls = mod.module ?? mod;
  const declared = [...metaOf(cls, 'exports'), ...(mod.exports ?? [])];
  const out: Token[] = [];
  for (const e of declared) {
    const isModule =
      (e && e.module) ||
      (typeof e === 'function' &&
        Reflect.getMetadataKeys(e).includes('providers'));
    if (isModule) out.push(...exportsOf(e, seen));
    else out.push(tokenOf(e));
  }
  return out;
}

/**
 * Providers available everywhere: what the app's @Global() modules export (read from the modules
 * themselves, not listed by hand) plus the framework's own.
 */
const GLOBAL_MODULES = [
  AuthModule,
  AuthorizationModule,
  CommonModule,
  AppConfigModule,
  PosthogModule,
  RedisModule,
];
const FRAMEWORK: Token[] = [
  DataSource,
  EntityManager,
  ModuleRef,
  Reflector,
  EventEmitter2,
];

const nameOf = (t: Token): string =>
  typeof t === 'function' ? (t as Function).name : String(t);

describe('DebriefModule dependency graph', () => {
  const imports: any[] = metaOf(DebriefModule, 'imports');
  const providers: any[] = metaOf(DebriefModule, 'providers');
  const controllers: any[] = metaOf(DebriefModule, 'controllers');

  const available = new Set<Token>([
    ...providers.map(tokenOf),
    ...imports.flatMap((m) => exportsOf(m)),
    ...GLOBAL_MODULES.flatMap((m) => [
      ...metaOf(m, 'providers').map(tokenOf),
      ...exportsOf(m),
    ]),
    ...FRAMEWORK,
  ]);

  const classes = [
    ...providers.filter((p) => typeof p === 'function'),
    ...providers.filter((p) => p && p.useClass).map((p) => p.useClass),
    ...controllers,
  ];

  it('has providers to check', () => {
    expect(classes.length).toBeGreaterThan(40);
  });

  it.each(classes.map((c) => [c.name, c] as const))(
    '%s can have every constructor parameter resolved',
    (_name, cls) => {
      const types: any[] = Reflect.getMetadata('design:paramtypes', cls) ?? [];
      const self: Record<number, unknown> =
        (Reflect.getMetadata('self:paramtypes', cls) as any) ?? {};
      const optional: number[] =
        (Reflect.getMetadata('optional:paramtypes', cls) as number[]) ?? [];
      const missing: string[] = [];
      types.forEach((t, i) => {
        if (optional.includes(i)) return;
        if (
          Array.isArray(self) ? self.some((s: any) => s.index === i) : i in self
        )
          return;
        if (t === undefined) return; // a forwardRef or circular import
        if (available.has(t) || t === Object || t === Function) return;
        missing.push(`${i}: ${nameOf(t)}`);
      });
      expect(missing).toEqual([]);
    },
  );
});
