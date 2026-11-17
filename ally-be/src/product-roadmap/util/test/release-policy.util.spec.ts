import { GraphCommit } from 'src/github/service/github-actions.service';

import {
  DEFAULT_AUTO_RELEASE_HELD_PATHS,
  RELEASE_DEBOUNCE_MS,
  PolicyServiceKey,
} from '../../constants/release-policy.constants';
import {
  ReleasePolicyComparison,
  ReleasePolicyDecision,
} from '../../enum/release-policy.enum';
import {
  ServiceReleasePlan,
  UNREADABLE_COMMIT_RULE,
  UNREADABLE_RANGE_RULE,
  classifyRange,
  comparisonFromDecision,
  compileHeldPattern,
  compileHeldRules,
  consecutiveFailures,
  decideReleases,
  matchHeldRule,
  mergeRangeClassifications,
  normaliseHeldPaths,
  normaliseReleaseWindow,
  prNumberFromMessage,
  pullRequestsOfRange,
  unverifiedBackends,
  withinReleaseWindow,
} from '../release-policy.util';

const at = (iso: string) => new Date(iso);

function commit(
  sha: string,
  parents: string[],
  message: string,
  committedAt = '2026-11-17T08:00:00Z',
  authorLogin: string | null = 'someone',
): GraphCommit {
  return { sha, parents, message, authorLogin, committedAt: at(committedAt) };
}

const DEFAULT_RULES = compileHeldRules(DEFAULT_AUTO_RELEASE_HELD_PATHS);

describe('held paths', () => {
  it('pins the defaults (plan §5.5.1): migrations, auth, permissions and roles, payments, billing', () => {
    expect(DEFAULT_AUTO_RELEASE_HELD_PATHS).toEqual([
      'ally-be/src/database/migrations/**',
      '**/auth/**',
      '**/authorization/**',
      '**/*permission*.constants.ts',
      '**/permissions.ts',
      '**/*roles.constants.ts',
      'ally-be/src/common/constants/user.constants.ts',
      'ally-web/apps/ally-admin-dashboard/src/constants/user.ts',
      '**/*payment*',
      '**/*billing*',
    ]);
  });

  it.each([
    [
      'ally-be/src/database/migrations/1983500000000-X.ts',
      'ally-be/src/database/migrations/**',
    ],
    ['ally-be/src/auth/guards/api-auth.guard.ts', '**/auth/**'],
    ['ally-web/libs/ui-shared/src/auth/useAuth.ts', '**/auth/**'],
    [
      'ally-be/src/authorization/constants/permissions.constants.ts',
      '**/authorization/**',
    ],
    [
      'ally-web/apps/ally-admin-dashboard/src/constants/permissions.ts',
      '**/permissions.ts',
    ],
    [
      'ally-web/apps/ally-helpline-dashboard/src/constants/permissions.ts',
      '**/permissions.ts',
    ],
    [
      'ally-be/src/common/constants/user.constants.ts',
      'ally-be/src/common/constants/user.constants.ts',
    ],
    ['ally-be/src/billing/invoice.service.ts', '**/*billing*'],
    [
      'ally-web/apps/ally-admin-dashboard/src/pages/Payments/List.tsx',
      '**/*payment*',
    ],
    ['ally-be/src/razorpay/PaymentWebhook.ts', '**/*payment*'],
  ])('holds %s', (path, rule) => {
    expect(matchHeldRule(path, DEFAULT_RULES)).toBe(rule);
  });

  it.each([
    'ally-be/src/product-roadmap/service/item-release.service.ts',
    'ally-be/src/database/seeds/run.ts',
    'ally-web/apps/ally-admin-dashboard/src/pages/OAuthCallback.tsx',
    'ally-be/src/learn/constants/roleplay-analytics.constants.ts',
    'ally-be/src/oauth/google.strategy.ts',
  ])('does not hold %s', (path) => {
    expect(matchHeldRule(path, DEFAULT_RULES)).toBeNull();
  });

  it('keeps * inside one folder and is case-insensitive', () => {
    expect(compileHeldPattern('src/*.ts').test('src/a.ts')).toBe(true);
    expect(compileHeldPattern('src/*.ts').test('src/x/a.ts')).toBe(false);
    expect(compileHeldPattern('**/*billing*').test('A/B/BillingForm.tsx')).toBe(
      true,
    );
  });

  it('falls back to the defaults for an empty or unusable setting, and accepts JSON text', () => {
    expect(normaliseHeldPaths(null)).toEqual([
      ...DEFAULT_AUTO_RELEASE_HELD_PATHS,
    ]);
    expect(normaliseHeldPaths([])).toEqual([
      ...DEFAULT_AUTO_RELEASE_HELD_PATHS,
    ]);
    expect(normaliseHeldPaths(['  '])).toEqual([
      ...DEFAULT_AUTO_RELEASE_HELD_PATHS,
    ]);
    expect(normaliseHeldPaths('["**/x/**"]')).toEqual(['**/x/**']);
    expect(normaliseHeldPaths([{ pattern: '**/y/**' }])).toEqual(['**/y/**']);
  });
});

describe('release window', () => {
  it("reads the Settings shape: whole hours and 'timezone'", () => {
    expect(
      normaliseReleaseWindow({
        startHour: 22,
        endHour: 6,
        timezone: 'Asia/Kolkata',
      }),
    ).toEqual({
      days: null,
      start: '22:00',
      end: '06:00',
      timeZone: 'Asia/Kolkata',
    });
    expect(normaliseReleaseWindow({ startHour: 24, endHour: 6 })).toBeNull();
  });

  it('is any time when unset or unreadable', () => {
    expect(normaliseReleaseWindow(null)).toBeNull();
    expect(normaliseReleaseWindow({ start: '25:00', end: '02:00' })).toBeNull();
    expect(withinReleaseWindow(at('2026-11-17T08:00:00Z'), null)).toBe(true);
  });

  it('reads the hour in the window time zone, including past midnight', () => {
    // 22:00–06:00 IST, every day.
    const window = normaliseReleaseWindow({ start: '22:00', end: '06:00' })!;
    expect(window.timeZone).toBe('Asia/Kolkata');
    expect(withinReleaseWindow(at('2026-11-17T17:00:00Z'), window)).toBe(true); // 22:30 IST
    expect(withinReleaseWindow(at('2026-11-17T23:00:00Z'), window)).toBe(true); // 04:30 IST
    expect(withinReleaseWindow(at('2026-11-17T08:00:00Z'), window)).toBe(false); // 13:30 IST
  });

  it('honours days, with the early hours belonging to the day before', () => {
    // Fridays only (5), 22:00–02:00 UTC.
    const window = normaliseReleaseWindow({
      days: [5],
      start: '22:00',
      end: '02:00',
      timeZone: 'UTC',
    })!;
    expect(withinReleaseWindow(at('2026-11-20T23:00:00Z'), window)).toBe(true); // Fri 23:00
    expect(withinReleaseWindow(at('2026-11-21T01:00:00Z'), window)).toBe(true); // Sat 01:00, Friday's window
    expect(withinReleaseWindow(at('2026-11-19T23:00:00Z'), window)).toBe(false); // Thu
  });
});

describe('commits → pull requests', () => {
  it('reads merge and squash titles', () => {
    expect(
      prNumberFromMessage('Merge pull request #281 from x/y\n\nbody'),
    ).toBe(281);
    expect(prNumberFromMessage('feat(pm-agent): impact checks (#286)')).toBe(
      286,
    );
    expect(prNumberFromMessage('fix: no number')).toBeNull();
  });

  it('gives a merged branch’s commits, syncs included, to its pull request', () => {
    // m0 (base) ← a1 ← a2 ← M1(#10, branch b1 ← sync S ← b2)
    const commits = [
      commit('a1', ['m0'], 'direct push'),
      commit('b1', ['m0'], 'branch work'),
      commit('a2', ['a1'], 'another push'),
      commit('S', ['b1', 'a2'], "Merge branch 'master' into feat"),
      commit('b2', ['S'], 'more branch work'),
      commit('M1', ['a2', 'b2'], 'Merge pull request #10 from x/feat'),
      commit('q', ['M1'], 'squashed thing (#11)'),
    ];
    const prOf = pullRequestsOfRange(commits);
    expect(prOf.get('b1')).toBe(10);
    expect(prOf.get('S')).toBe(10);
    expect(prOf.get('b2')).toBe(10);
    expect(prOf.get('M1')).toBe(10);
    expect(prOf.get('q')).toBe(11);
    expect(prOf.has('a1')).toBe(false);
    expect(prOf.has('a2')).toBe(false);
  });
});

describe('classifyRange: the release diff, not the PR', () => {
  const files: Record<string, string[]> = {
    // Someone else's pull request carries a migration.
    b1: [
      'ally-be/src/database/migrations/1983900000000-Other.ts',
      'ally-be/src/x/x.service.ts',
    ],
    // This idea's pull request is harmless.
    c1: ['ally-be/src/product-roadmap/service/y.service.ts'],
    // A frontend-only commit.
    w1: ['ally-web/apps/ally-admin-dashboard/src/pages/A.tsx'],
    // A held path in the web app does not hold the backend.
    w2: ['ally-web/apps/ally-admin-dashboard/src/pages/Payments/P.tsx'],
  };
  const commits = [
    commit(
      'b1',
      ['m0'],
      'other person migration',
      '2026-11-17T07:00:00Z',
      'priya',
    ),
    commit(
      'M1',
      ['m0', 'b1'],
      'Merge pull request #20 from x/other',
      '2026-11-17T07:05:00Z',
    ),
    commit('c1', ['M1'], 'roadmap thing', '2026-11-17T07:10:00Z'),
    commit(
      'M2',
      ['M1', 'c1'],
      'Merge pull request #21 from x/mine',
      '2026-11-17T07:15:00Z',
    ),
    commit('w1', ['M2'], 'admin page (#22)', '2026-11-17T07:20:00Z'),
    commit('w2', ['w1'], 'payments page (#23)', '2026-11-17T07:25:00Z'),
  ];
  const filesOf = (sha: string) =>
    files[sha] ? { files: files[sha], truncated: false } : undefined;

  it('holds be when ANY commit in the range touches a held path, including other people’s', () => {
    const result = classifyRange({
      service: 'be',
      commits,
      filesOf,
      rules: DEFAULT_RULES,
      rangeTruncated: false,
    });
    expect(result.commits.map((c) => c.sha)).toEqual(['b1', 'M1', 'c1', 'M2']);
    expect(result.heldReasons).toEqual([
      {
        sha: 'b1',
        file: 'ally-be/src/database/migrations/1983900000000-Other.ts',
        rule: 'ally-be/src/database/migrations/**',
      },
    ]);
    expect(result.commits.find((c) => c.sha === 'b1')!.held).toBe(true);
    expect(result.prNumbers).toEqual([20, 21]);
    expect(result.serviceHeadSha).toBe('M2');
    expect(result.lastChangeAt).toEqual(at('2026-11-17T07:15:00Z'));
    expect(result.apps).toBeNull();
    expect(result.unknown).toBeNull();
  });

  it('does not hold be for a held path in another service, and holds that service', () => {
    const be = classifyRange({
      service: 'be',
      commits: commits
        .filter((c) => !['b1', 'M1'].includes(c.sha))
        .map((c) =>
          c.sha === 'c1'
            ? { ...c, parents: ['m0'] }
            : c.sha === 'M2'
              ? { ...c, parents: ['m0', 'c1'] }
              : c,
        ),
      filesOf,
      rules: DEFAULT_RULES,
      rangeTruncated: false,
    });
    expect(be.heldReasons).toEqual([]);
    expect(be.commits.map((c) => c.sha)).toEqual(['c1', 'M2']);

    const web = classifyRange({
      service: 'frontend',
      commits,
      filesOf,
      rules: DEFAULT_RULES,
      rangeTruncated: false,
    });
    expect(web.commits.map((c) => c.sha)).toEqual(['w1', 'w2']);
    expect(web.heldReasons.map((r) => r.rule)).toEqual(['**/*payment*']);
    expect(web.apps).toBe('admin');
  });

  it('lists nothing and holds nothing for a service the range never touched', () => {
    const ai = classifyRange({
      service: 'ai',
      commits,
      filesOf,
      rules: DEFAULT_RULES,
      rangeTruncated: false,
    });
    expect(ai.commits).toEqual([]);
    expect(ai.heldReasons).toEqual([]);
    expect(ai.serviceHeadSha).toBeNull();
  });

  it('is unknown when a commit’s files cannot be read', () => {
    const result = classifyRange({
      service: 'be',
      commits: [...commits, commit('z', ['w2'], 'unreadable')],
      filesOf,
      rules: DEFAULT_RULES,
      rangeTruncated: false,
    });
    expect(result.unknown).toMatch(/could not read the files of z/);
  });

  it('holds on a commit too large to list, and on a range too long to list', () => {
    const big = classifyRange({
      service: 'learn',
      commits: [commit('huge', ['m0'], 'huge')],
      filesOf: () => ({ files: [], truncated: true }),
      rules: DEFAULT_RULES,
      rangeTruncated: true,
    });
    expect(big.heldReasons.map((r) => r.rule)).toEqual([
      UNREADABLE_COMMIT_RULE,
      UNREADABLE_RANGE_RULE,
    ]);
    expect(big.commits.map((c) => c.sha)).toEqual(['huge']);
  });

  it('classifies a dashboard against its own base, shared code counting for both', () => {
    const webFiles: Record<string, string[]> = {
      h1: ['ally-web/apps/ally-helpline-dashboard/src/A.tsx'],
      l1: ['ally-web/libs/ui-shared/src/B.tsx'],
    };
    const range = [
      commit('h1', ['m0'], 'helpline (#30)', '2026-11-17T07:00:00Z'),
      commit('l1', ['h1'], 'shared (#31)', '2026-11-17T07:30:00Z'),
    ];
    const opts = {
      service: 'frontend' as const,
      commits: range,
      filesOf: (sha: string) => ({
        files: webFiles[sha] ?? [],
        truncated: false,
      }),
      rules: DEFAULT_RULES,
      rangeTruncated: false,
    };
    const admin = classifyRange({ ...opts, app: 'admin' });
    const helpline = classifyRange({ ...opts, app: 'helpline' });
    expect(admin.commits.map((c) => c.sha)).toEqual(['l1']);
    expect(helpline.commits.map((c) => c.sha)).toEqual(['h1', 'l1']);
    const merged = mergeRangeClassifications(admin, helpline);
    expect(merged.commits.map((c) => c.sha)).toEqual(['h1', 'l1']);
    expect(merged.apps).toBe('both');
    expect(merged.prNumbers).toEqual([30, 31]);
  });
});

describe('decideReleases', () => {
  const now = at('2026-11-17T12:00:00Z');
  const longAgo = at('2026-11-17T11:00:00Z');

  function plan(
    service: PolicyServiceKey,
    overrides: Partial<ServiceReleasePlan> = {},
  ): ServiceReleasePlan {
    return {
      service,
      baseRef: `${service}-v1.0.0`,
      baseTag: `${service}-v1.0.0`,
      headSha: 'head',
      opportunityIds: [],
      commits: [
        {
          sha: `${service}-1`,
          title: 't',
          authorLogin: null,
          committedAt: longAgo.toISOString(),
          prNumber: 1,
          merge: false,
          held: false,
        },
      ],
      heldReasons: [],
      apps: service === 'frontend' ? 'admin' : null,
      prNumbers: [1],
      lastChangeAt: longAgo,
      serviceHeadSha: `${service}-1`,
      unknown: null,
      ...overrides,
    };
  }
  const empty = (service: PolicyServiceKey) =>
    plan(service, {
      commits: [],
      lastChangeAt: null,
      serviceHeadSha: null,
      prNumbers: [],
    });
  const decide = (
    plans: ServiceReleasePlan[],
    extra: Partial<Parameters<typeof decideReleases>[0]> = {},
  ) =>
    decideReleases({
      plans: new Map(plans.map((p) => [p.service, p])),
      now,
      pausedAt: null,
      window: null,
      unverifiedBackends: [],
      ...extra,
    });

  it('releases a quiet, unheld backend, and the frontend waits for it (backends first)', () => {
    const verdicts = decide([
      plan('be'),
      empty('ai'),
      empty('learn'),
      plan('frontend'),
    ]);
    expect(verdicts.get('be')!.decision).toBe(ReleasePolicyDecision.RELEASE);
    expect(verdicts.get('ai')!.decision).toBe(ReleasePolicyDecision.NOTHING);
    expect(verdicts.get('frontend')!.decision).toBe(
      ReleasePolicyDecision.WAITING_BACKEND,
    );
    expect(verdicts.get('frontend')!.reason).toBe('waiting for be');
  });

  it('releases the frontend once every backend is released and healthy', () => {
    const verdicts = decide([
      empty('be'),
      empty('ai'),
      empty('learn'),
      plan('frontend'),
    ]);
    expect(verdicts.get('frontend')!.decision).toBe(
      ReleasePolicyDecision.RELEASE,
    );
  });

  it('keeps the frontend waiting while a backend release has not answered its health check', () => {
    const verdicts = decide(
      [empty('be'), empty('ai'), empty('learn'), plan('frontend')],
      {
        unverifiedBackends: ['be'],
      },
    );
    expect(verdicts.get('frontend')!.decision).toBe(
      ReleasePolicyDecision.WAITING_BACKEND,
    );
  });

  it('keeps the frontend waiting behind a held backend', () => {
    const verdicts = decide([
      plan('be', { heldReasons: [{ sha: 'x', file: 'f', rule: 'r' }] }),
      empty('ai'),
      empty('learn'),
      plan('frontend'),
    ]);
    expect(verdicts.get('be')!.decision).toBe(ReleasePolicyDecision.HELD);
    expect(verdicts.get('frontend')!.decision).toBe(
      ReleasePolicyDecision.WAITING_BACKEND,
    );
  });

  it('debounces for ten minutes after the last merge to the service', () => {
    const recent = new Date(now.getTime() - RELEASE_DEBOUNCE_MS + 60_000);
    const verdict = decide([plan('be', { lastChangeAt: recent })]).get('be')!;
    expect(verdict.decision).toBe(ReleasePolicyDecision.DEBOUNCING);
    expect(verdict.readyAt).toEqual(
      new Date(recent.getTime() + RELEASE_DEBOUNCE_MS),
    );

    const settled = new Date(now.getTime() - RELEASE_DEBOUNCE_MS);
    expect(
      decide([plan('be', { lastChangeAt: settled })]).get('be')!.decision,
    ).toBe(ReleasePolicyDecision.RELEASE);
  });

  it('holds before anything else, pauses on an open breaker, and respects the window', () => {
    const held = plan('be', {
      heldReasons: [{ sha: 'x', file: 'f', rule: '**/auth/**' }],
    });
    expect(decide([held], { pausedAt: now }).get('be')!.decision).toBe(
      ReleasePolicyDecision.HELD,
    );
    expect(decide([plan('be')], { pausedAt: now }).get('be')!.decision).toBe(
      ReleasePolicyDecision.PAUSED,
    );
    const window = normaliseReleaseWindow({
      start: '22:00',
      end: '06:00',
      timeZone: 'UTC',
    });
    expect(decide([plan('be')], { window }).get('be')!.decision).toBe(
      ReleasePolicyDecision.OUTSIDE_WINDOW,
    );
  });

  it('decides nothing on partial data', () => {
    expect(
      decide([plan('be', { unknown: 'could not read' })]).get('be')!.decision,
    ).toBe(ReleasePolicyDecision.UNKNOWN);
  });
});

describe('circuit breaker and health', () => {
  it('counts consecutive failed or unhealthy releases until the first good one', () => {
    expect(consecutiveFailures([])).toBe(0);
    expect(consecutiveFailures([{ succeeded: false, healthy: null }])).toBe(1);
    expect(
      consecutiveFailures([
        { succeeded: true, healthy: false },
        { succeeded: false, healthy: null },
        { succeeded: true, healthy: true },
        { succeeded: false, healthy: null },
      ]),
    ).toBe(2);
    // A release still waiting on its health check neither breaks nor extends the streak.
    expect(
      consecutiveFailures([
        { succeeded: true, healthy: null },
        { succeeded: false, healthy: null },
        { succeeded: false, healthy: null },
      ]),
    ).toBe(2);
  });

  it('treats a recent backend release as unverified until it answers healthy', () => {
    const now = at('2026-11-17T12:00:00Z');
    const finishedAt = at('2026-11-17T11:50:00Z');
    expect(
      unverifiedBackends(
        [
          { service: 'be', succeeded: true, healthy: null, finishedAt },
          { service: 'ai', succeeded: true, healthy: true, finishedAt },
          { service: 'learn', succeeded: false, healthy: null, finishedAt },
          { service: 'frontend', succeeded: true, healthy: null, finishedAt },
          {
            service: 'learn',
            succeeded: true,
            healthy: false,
            finishedAt: at('2026-11-17T01:00:00Z'),
          },
        ],
        now,
      ),
    ).toEqual(['be']);
  });
});

describe('comparisonFromDecision', () => {
  it('names why the policy would not have released', () => {
    expect(comparisonFromDecision(null)).toBe(
      ReleasePolicyComparison.NO_DECISION,
    );
    expect(comparisonFromDecision(ReleasePolicyDecision.HELD)).toBe(
      ReleasePolicyComparison.POLICY_HELD,
    );
    expect(comparisonFromDecision(ReleasePolicyDecision.DEBOUNCING)).toBe(
      ReleasePolicyComparison.POLICY_DEBOUNCING,
    );
    expect(comparisonFromDecision(ReleasePolicyDecision.RELEASE)).toBeNull();
  });
});
