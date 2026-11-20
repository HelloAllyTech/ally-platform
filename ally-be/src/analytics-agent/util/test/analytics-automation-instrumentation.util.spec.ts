import { readFileSync } from 'fs';
import { join } from 'path';
import { findInstrumentationViolations } from '../analytics-automation-instrumentation.util';

const files = (entries: Record<string, string>) =>
  new Map(Object.entries(entries));

/** What the app's existing guarded capture methods look like. */
const GOOD_BACKEND = `
  private captureThing(userId: number, id: string): void {
    try {
      this.posthog.capture({
        distinctId: userDistinctId(userId),
        event: THING_ANALYTICS_EVENTS.CREATED,
        properties: { thing_id: id },
      });
    } catch (error) {
      this.logger.error(\`Failed to capture in PostHog: \${error}\`);
    }
  }
`;

describe('findInstrumentationViolations', () => {
  it('accepts the app’s own guarded capture pattern', () => {
    const result = findInstrumentationViolations(
      files({ 'ally-be/src/thing/service/thing.service.ts': GOOD_BACKEND }),
    );
    expect(result).toEqual({ blocking: [], advisory: [] });
  });

  it('accepts web code that uses the shared hook and constants', () => {
    const result = findInstrumentationViolations(
      files({
        'ally-web/apps/ally-helpline-dashboard/src/pages/x/X.tsx': `
          const { track } = useAnalytics();
          track(ANALYTICS_EVENTS.CALL_STARTED, { [ANALYTICS_PROPS.CALL_ID]: id });
        `,
      }),
    );
    expect(result).toEqual({ blocking: [], advisory: [] });
  });

  it('blocks a backend event name written inline at the call site', () => {
    const result = findInstrumentationViolations(
      files({
        'ally-be/src/x/x.service.ts': GOOD_BACKEND.replace(
          'THING_ANALYTICS_EVENTS.CREATED',
          "'thing.created'",
        ),
      }),
    );
    expect(result.blocking).toEqual([expect.stringContaining('inline')]);
  });

  it('blocks LoggerService injected through the constructor (not a Nest provider)', () => {
    const injected = `
      constructor(
        @InjectRepository(Thing) private readonly things: Repository<Thing>,
        private readonly posthog: PostHog,
        private readonly logger: LoggerService,
      ) {}
    `;
    const lastParam = `constructor(private readonly logger: LoggerService) {}`;
    for (const body of [injected, lastParam]) {
      const result = findInstrumentationViolations(
        files({ 'ally-be/src/thing/service/thing.service.ts': body }),
      );
      expect(result.blocking.join(' ')).toMatch(/injects LoggerService/);
    }
  });

  it('accepts the existing logger patterns, including a LoggerService field set in the constructor', () => {
    const bodies = [
      `private readonly logger = LoggerService.getInstance(ThingService.name);`,
      `private readonly logger: LoggerService;\n constructor(private readonly posthog: PostHog) { this.logger = LoggerService.getInstance('x'); }`,
      `private readonly logger = new Logger(ThingService.name);`,
    ];
    for (const body of bodies) {
      const result = findInstrumentationViolations(
        files({ 'ally-be/src/thing/service/thing.service.ts': body }),
      );
      expect(result.blocking).toEqual([]);
    }
  });

  it('blocks a second PostHog client', () => {
    const result = findInstrumentationViolations(
      files({
        'ally-be/src/x/x.service.ts': "const client = new PostHog('key');",
      }),
    );
    expect(result.blocking).toEqual([
      expect.stringContaining('own PostHog client'),
    ]);
  });

  it('blocks posthog-js and an inline event name in web code, but not inside the analytics lib', () => {
    const result = findInstrumentationViolations(
      files({
        'ally-web/apps/ally-helpline-dashboard/src/A.tsx': `import posthog from 'posthog-js';\nposthog.capture('x');`,
        'ally-web/apps/ally-helpline-dashboard/src/B.tsx': `track('thing_created', {});`,
        'ally-web/libs/ui-shared/src/lib/analytics/utils/posthog.ts': `import posthog from 'posthog-js';\nposthog.capture(e);`,
      }),
    );
    expect(result.blocking).toHaveLength(2);
    expect(result.blocking.join(' ')).toContain('A.tsx');
    expect(result.blocking.join(' ')).toContain('B.tsx');
    expect(result.blocking.join(' ')).not.toContain('utils/posthog.ts');
  });

  it('advises on a hand-built distinctId and an unguarded capture', () => {
    const result = findInstrumentationViolations(
      files({
        'ally-be/src/x/x.service.ts': `
          this.posthog.capture({
            distinctId: String(userId),
            event: X_ANALYTICS_EVENTS.CREATED,
            properties: {},
          });
        `,
      }),
    );
    expect(result.blocking).toEqual([]);
    expect(result.advisory).toHaveLength(2);
  });

  it('ignores test files and non-code files', () => {
    const result = findInstrumentationViolations(
      files({
        'ally-be/src/x/x.service.spec.ts': "new PostHog('k'); track('a')",
        'ally-web/apps/a/src/A.test.tsx': "posthog.capture('x')",
        'ally-be/README.md': 'new PostHog(',
      }),
    );
    expect(result).toEqual({ blocking: [], advisory: [] });
  });

  // Guards the check against flagging the app's own, correct code.
  it.each([
    'src/scenario-session-review/service/review.service.ts',
    'src/user/service/user.service.ts',
    'src/case/service/case-session.service.ts',
    'src/learn/service/simulation-credits.service.ts',
  ])('finds nothing to flag in the existing call site %s', (relative) => {
    const content = readFileSync(
      join(__dirname, '../../../../', relative),
      'utf8',
    );
    const result = findInstrumentationViolations(
      files({ [`ally-be/${relative}`]: content }),
    );
    expect(result).toEqual({ blocking: [], advisory: [] });
  });
});
