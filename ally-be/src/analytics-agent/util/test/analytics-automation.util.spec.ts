import {
  automationBranch,
  evaluateDbtGate,
  findPhiProperties,
  fingerprint,
  isAllowedPath,
} from '../analytics-automation.util';

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
