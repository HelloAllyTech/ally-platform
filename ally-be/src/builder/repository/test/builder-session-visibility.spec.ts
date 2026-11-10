import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { NotFoundException } from '@nestjs/common';
import { BuilderSessionVisibility } from '../../enum/builder.enum';
import {
  BuilderSessionRepository,
  isSessionVisibleTo,
  SHARED_SESSIONS_ONLY,
} from '../builder-session.repository';
import { BuilderSessionVisibilityInterceptor } from '../../interceptor/builder-session-visibility.interceptor';

const PRIVATE = BuilderSessionVisibility.PRIVATE;
const SHARED = BuilderSessionVisibility.SHARED;

describe('Builder session visibility — the rule', () => {
  it('shows shared sessions to everyone and private ones to their author only', () => {
    expect(isSessionVisibleTo({ visibility: SHARED, createdBy: 1 }, 2)).toBe(
      true,
    );
    expect(isSessionVisibleTo({ visibility: PRIVATE, createdBy: 1 }, 1)).toBe(
      true,
    );
    expect(isSessionVisibleTo({ visibility: PRIVATE, createdBy: 1 }, 2)).toBe(
      false,
    );
  });

  it('visibleToWhere adds "shared OR mine-and-private" to each branch', () => {
    expect(
      BuilderSessionRepository.visibleToWhere(7, { status: 'x' as never }),
    ).toEqual([
      { status: 'x', visibility: SHARED },
      { status: 'x', visibility: PRIVATE, createdBy: 7 },
    ]);
  });

  it("never widens a branch pinned to someone else's sessions", () => {
    expect(
      BuilderSessionRepository.visibleToWhere(7, { createdBy: 3 }),
    ).toEqual([{ createdBy: 3, visibility: SHARED }]);
  });

  it('keeps PRIVATE out of every Builder list', () => {
    expect(SHARED_SESSIONS_ONLY).toEqual({ visibility: SHARED });
  });
});

describe('BuilderSessionVisibilityInterceptor', () => {
  const SESSION = '0b9d2d7c-6a0e-4b1e-9f3a-2c1d5e6f7a8b';
  const build = (facts: object | null) => {
    const repository = { findVisibilityFacts: jest.fn(async () => facts) };
    return {
      repository,
      interceptor: new BuilderSessionVisibilityInterceptor(repository as never),
    };
  };
  const context = (params: object, user?: object) =>
    ({
      getType: () => 'http',
      switchToHttp: () => ({ getRequest: () => ({ params, user }) }),
    }) as never;
  const next = { handle: jest.fn(() => 'handled') } as never;

  it("404s another admin's private session", async () => {
    const { interceptor } = build({ visibility: PRIVATE, createdBy: 1 });
    await expect(
      interceptor.intercept(context({ sessionId: SESSION }, { id: 2 }), next),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lets the author through to their own private session', async () => {
    const { interceptor } = build({ visibility: PRIVATE, createdBy: 1 });
    await expect(
      interceptor.intercept(context({ sessionId: SESSION }, { id: 1 }), next),
    ).resolves.toBe('handled');
  });

  it('lets anyone through to a shared session', async () => {
    const { interceptor } = build({ visibility: SHARED, createdBy: 1 });
    await expect(
      interceptor.intercept(context({ sessionId: SESSION }, { id: 2 }), next),
    ).resolves.toBe('handled');
  });

  describe('plan sessions', () => {
    const ctx = (method: string, user: object, extra: object = {}) =>
      ({
        getType: () => 'http',
        switchToHttp: () => ({
          getRequest: () => ({
            params: { sessionId: SESSION },
            user,
            method,
            ...extra,
          }),
        }),
      }) as never;
    const plan = (over: object) => ({
      visibility: SHARED,
      createdBy: 1,
      kind: 'plan',
      leadUserId: 4,
      ...over,
    });

    it('confines a Lead-only caller to plan sessions', async () => {
      const { interceptor } = build({ ...plan({}), kind: 'build' });
      await expect(
        interceptor.intercept(
          ctx(
            'GET',
            { id: 4 },
            { viaAlternateToggle: 'product_planning_lead' },
          ),
          next,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('lets everyone who may see a plan read it, but only its lead change it', async () => {
      const { interceptor } = build(plan({}));
      await expect(
        interceptor.intercept(ctx('GET', { id: 9 }), next),
      ).resolves.toBe('handled');
      await expect(
        interceptor.intercept(ctx('POST', { id: 4 }), next),
      ).resolves.toBe('handled');
      await expect(
        interceptor.intercept(ctx('POST', { id: 9 }), next),
      ).rejects.toThrow(/lead/);
    });

    it('lets nobody change a plan nobody has taken on, or a private draft through Builder', async () => {
      const { interceptor } = build(plan({ leadUserId: null }));
      await expect(
        interceptor.intercept(ctx('POST', { id: 4 }), next),
      ).rejects.toThrow(/Take this plan on/);
      const draft = build(plan({ visibility: PRIVATE, leadUserId: null }));
      await expect(
        draft.interceptor.intercept(ctx('POST', { id: 1 }), next),
      ).rejects.toThrow(/private/);
    });
  });

  it('does not query for routes without a session, or for a non-UUID id', async () => {
    const { interceptor, repository } = build(null);
    await interceptor.intercept(context({}, { id: 2 }), next);
    await interceptor.intercept(
      context({ sessionId: 'nope' }, { id: 2 }),
      next,
    );
    expect(repository.findVisibilityFacts).not.toHaveBeenCalled();
  });
});

/**
 * The bypass guard (plans/roadmap-owns-planning rev 5.2 §B.10).
 *
 * A PRIVATE session is an unfiled idea: its author's alone. Every file that can
 * read builder_sessions is listed here with WHY it cannot leak one. A new file
 * that injects BuilderSessionRepository fails this test until someone decides,
 * in review, whether it lists sessions (then it must spread
 * SHARED_SESSIONS_ONLY or use visibleToWhere) or reads one by id behind a check.
 */
describe('Builder session visibility — every reader is accounted for', () => {
  const READERS: Record<string, string> = {
    'builder/builder.module.ts': 'provider registration only',
    'builder/repository/builder-session.repository.ts': 'defines the rule',
    'builder/interceptor/builder-session-visibility.interceptor.ts':
      'enforces the rule on every :sessionId route',
    'builder/eval/sandbox/builder-eval-stores.ts':
      'eval sandbox: in-memory fixtures, no real sessions',
    'builder/service/builder-session.service.ts':
      'lists spread SHARED_SESSIONS_ONLY; getSessionDetail checks isSessionVisibleTo',
    'builder/service/builder-now.service.ts':
      'Now spreads SHARED_SESSIONS_ONLY',
    'builder/service/builder-history.service.ts':
      "History excludes other authors' private sessions in SQL",
    'builder/service/builder-ask.service.ts':
      'grounding lookup by id for an ask already scoped to a visible session',
    'builder/service/builder-build.service.ts':
      'updates and reads by id for a run started from a :sessionId route (interceptor) or by the runner; never lists',
    'builder/service/builder-decision.service.ts':
      'pending list and findPending both spread SHARED_SESSIONS_ONLY',
    'builder/service/builder-event.service.ts':
      'update by id from runner callbacks; never reads a session out',
    'builder/service/builder-exemplar.service.ts':
      'by id when archiving a finished build into an exemplar; never lists',
    'builder/service/builder-interview-orchestrator.service.ts':
      'updates by id inside a turn on a :sessionId route the interceptor checked',
    'builder/service/builder-outcome.service.ts':
      'injects the repository for its sweep; returns nothing to a viewer',
    'product-roadmap/plan/plan-session.store.ts':
      'plan reads by id; every list scopes its own WHERE to the author or to shared plans (product-roadmap/plan/*)',
    'builder/service/builder-pull-request.service.ts':
      'by id for a pull request, and the failed-run sweep; returns nothing to a viewer',
  };

  const root = join(__dirname, '..', '..', '..');
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        if (name !== 'node_modules' && name !== 'test') walk(path);
      } else if (name.endsWith('.ts') && !name.endsWith('.spec.ts')) {
        files.push(path);
      }
    }
  };
  walk(root);

  const readers = files
    .filter((file) =>
      /BuilderSessionRepository|Repository\(BuilderSession\)|getRepository\(BuilderSession\)/.test(
        readFileSync(file, 'utf8'),
      ),
    )
    .map((file) => relative(root, file).split('\\').join('/'))
    .sort();

  it('lists every file that reads builder_sessions, with a reason', () => {
    expect(readers).toEqual(Object.keys(READERS).sort());
  });
});
