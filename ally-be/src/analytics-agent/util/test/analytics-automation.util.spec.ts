import {
  automationBranch,
  evaluateChecks,
  evaluateDbtGate,
  filesNeedDbtBuild,
  findPhiProperties,
  fingerprint,
  isAllowedPath,
} from '../analytics-automation.util';
import { AUTOMATION_WRITE_PATHS } from '../../constants/analytics-automation.constants';

describe('isAllowedPath', () => {
  const prefixes = ['ally-be/src/', 'ally-web/apps/'];

  it('accepts a file under an allowed prefix', () => {
    expect(
      isAllowedPath('ally-be/src/posthog/posthog.service.ts', prefixes),
    ).toBe(true);
  });

  it.each([
    ['outside every prefix', 'ally-mobile/src/a.ts'],
    ['traversal', 'ally-be/src/../../.env'],
    ['absolute', '/etc/passwd'],
    ['backslash', 'ally-be\\src\\a.ts'],
    ['empty segment', 'ally-be/src//a.ts'],
    ['env file', 'ally-be/src/.env'],
    ['migration', 'ally-be/src/database/migrations/1-A.ts'],
    ['CI workflow', 'ally-be/src/.github/workflows/x.yml'],
    ['package file', 'ally-web/apps/package.json'],
    ['empty', ''],
  ])('refuses %s', (_label, path) => {
    expect(isAllowedPath(path, prefixes)).toBe(false);
  });
});

describe('the PostHog agent write scope', () => {
  const allowed = AUTOMATION_WRITE_PATHS.posthog;

  it.each([
    'ally-web/libs/ui-shared/src/lib/analytics/constants/analyticsEvents.ts',
    'ally-web/apps/ally-helpline-dashboard/src/pages/a/Page.tsx',
    'ally-be/src/session/constants/session-analytics.constants.ts',
    'ally-web/docs/current-posthog-events-traking-list.md',
  ])('may change %s', (path) => {
    expect(isAllowedPath(path, allowed)).toBe(true);
  });

  it.each([
    'ally-web/docs/mobile-ux-guidelines.md',
    'ally-web/docs/current-posthog-events-traking-list.md.bak',
    'ally-mobile/src/a.ts',
    'ally-be/src/database/migrations/1-A.ts',
    'ally-web/package.json',
  ])('may not change %s', (path) => {
    expect(isAllowedPath(path, allowed)).toBe(false);
  });
});

describe('findPhiProperties', () => {
  it('lets ids, enums, booleans and counts through', () => {
    expect(
      findPhiProperties([
        'scenario_id',
        'message_count',
        'is_first_session',
        'language',
      ]),
    ).toEqual([]);
  });

  it('flags properties that identify or describe a person', () => {
    expect(
      findPhiProperties([
        'user_email',
        'phone',
        'first_name',
        'transcript_text',
      ]),
    ).toEqual(['user_email', 'phone', 'first_name', 'transcript_text']);
  });

  it('flags free-text names only when they are the whole property', () => {
    expect(findPhiProperties(['message', 'notes', 'text'])).toEqual([
      'message',
      'notes',
      'text',
    ]);
    expect(findPhiProperties(['message_count', 'note_length'])).toEqual([]);
  });
});

describe('fingerprint', () => {
  it('is stable across case and spacing but differs by kind and key', () => {
    expect(fingerprint('dbt_change', 'Event:Lesson Done')).toBe(
      fingerprint('dbt_change', '  event:lesson   done '),
    );
    expect(fingerprint('dbt_change', 'a')).not.toBe(
      fingerprint('posthog_event', 'a'),
    );
    expect(fingerprint('dbt_change', 'a')).not.toBe(
      fingerprint('dbt_change', 'b'),
    );
  });
});

describe('automationBranch', () => {
  it('is always under automation/', () => {
    expect(automationBranch('1234567890abcdef', 'dbt-changes')).toBe(
      'automation/12345678/dbt-changes',
    );
  });
});

describe('evaluateDbtGate', () => {
  const posthog = (
    status: string,
    prNumber: number | null,
    prState: 'open' | 'merged' | 'closed' | null,
  ) => ({ status, prNumber, prState }) as never;

  it('waits while the PostHog agent is still working, or missing', () => {
    expect(evaluateDbtGate(posthog('running', null, null)).open).toBe(false);
    expect(evaluateDbtGate(null).open).toBe(false);
  });

  it('waits while its pull request is open', () => {
    expect(evaluateDbtGate(posthog('completed', 7, 'open'))).toEqual({
      open: false,
      reason:
        'Waiting for the PostHog events pull request to be merged or closed.',
    });
  });

  it('opens WITH events once the pull request is merged', () => {
    expect(evaluateDbtGate(posthog('completed', 7, 'merged'))).toEqual({
      open: true,
      withEvents: true,
      note: null,
    });
  });

  it('opens WITHOUT events when the pull request was closed unmerged', () => {
    const gate = evaluateDbtGate(posthog('completed', 7, 'closed'));
    expect(gate).toMatchObject({ open: true, withEvents: false });
  });

  it('opens when no pull request was needed', () => {
    expect(evaluateDbtGate(posthog('completed', null, null))).toEqual({
      open: true,
      withEvents: false,
      note: null,
    });
  });

  it('opens without events, and says so, when the PostHog agent failed', () => {
    const gate = evaluateDbtGate(posthog('failed', null, null));
    expect(gate).toMatchObject({ open: true, withEvents: false });
    expect((gate as { note: string }).note).toMatch(/failed/);
  });
});

describe('evaluateChecks', () => {
  const run = (
    name: string,
    status: string,
    conclusion: string | null = null,
  ) => ({ id: 1, name, status, conclusion, url: null });

  it('is none when there are no checks', () => {
    expect(evaluateChecks([])).toEqual({ state: 'none' });
  });

  it('is green when every check finished and none failed (neutral and skipped do not count)', () => {
    expect(
      evaluateChecks([
        run('dbt test', 'completed', 'success'),
        run('lint', 'completed', 'neutral'),
        run('docs', 'completed', 'skipped'),
      ]),
    ).toEqual({ state: 'green', count: 3 });
  });

  it('is pending while any check is unfinished, even if another already failed', () => {
    expect(
      evaluateChecks([
        run('dbt test', 'completed', 'failure'),
        run('lint', 'in_progress'),
      ]),
    ).toEqual({ state: 'pending', pending: ['lint'] });
  });

  it.each(['failure', 'cancelled', 'timed_out', 'action_required', 'stale'])(
    'is failed on a finished check that concluded %s',
    (conclusion) => {
      const verdict = evaluateChecks([
        run('dbt test', 'completed', conclusion),
        run('lint', 'completed', 'success'),
      ]);
      expect(verdict).toEqual({
        state: 'failed',
        failed: [expect.objectContaining({ name: 'dbt test' })],
      });
    },
  );

  it('treats a finished check with no conclusion as failed, not as a pass', () => {
    expect(evaluateChecks([run('dbt test', 'completed', null)]).state).toBe(
      'failed',
    );
  });
});

describe('filesNeedDbtBuild', () => {
  it('needs a build for model SQL or a seed, not for yml or tests alone', () => {
    expect(filesNeedDbtBuild(['models/marts/fct_x.sql'])).toBe(true);
    expect(filesNeedDbtBuild(['seeds/posthog_event_catalog.csv'])).toBe(true);
    expect(filesNeedDbtBuild(['models/marts/fct_x.yml', 'tests/t.sql'])).toBe(
      false,
    );
  });
});
