import { compilePlan } from '../util/compile-plan';
import { REDACTED, scrubDeep, scrubForPublic } from '../util/scrub.util';
import { cardVersionHash } from '../util/card-hash.util';
import { recommendationPayload } from './pm-agent.fakes';

/**
 * Credential-shaped fixtures, assembled at runtime so no literal in this file looks like
 * a real key to a secret scanner. None of them is real.
 */
const FAKE = {
  openai: ['sk', 'proj', 'abcdefghijklmnopqrstuvwx1234'].join('-'),
  anthropic: ['sk', 'ant', 'api03', 'AbCdEfGhIjKlMnOpQrStUv'].join('-'),
  github: ['gh', 'p_', 'ABCDEFGHIJKLMNOPQRSTUVWXyz0123456789'].join(''),
  slack: ['xo', 'xb-', '1234567890-abcdefghijkl'].join(''),
  aws: ['AK', 'IA', 'IOSFODNN7EXAMPLE'].join(''),
  jwt: [
    'ey' + 'JhbGciOiJIUzI1NiJ9',
    'ey' + 'JzdWIiOiIxMjM0NTYifQ',
    'c2lnbmF0dXJlLXZhbHVl',
  ].join('.'),
};

/**
 * What leaves the platform for a PUBLIC repo. The scrubber is the deterministic backstop
 * behind "aggregate and anonymised only" — these cases are the leaks it exists to stop.
 */
describe('scrubForPublic', () => {
  it.each([
    [
      'an email',
      'Ask priya.sharma@clinic.example.org first',
      'priya.sharma@clinic.example.org',
      REDACTED.EMAIL,
    ],
    [
      'an Indian mobile number',
      'Call +91 98765 43210 today',
      '98765 43210',
      REDACTED.PHONE,
    ],
    ['an OpenAI key', `key ${FAKE.openai}`, FAKE.openai, REDACTED.SECRET],
    [
      'an Anthropic key',
      `ANTHROPIC ${FAKE.anthropic}`,
      FAKE.anthropic,
      REDACTED.SECRET,
    ],
    ['a GitHub token', `use ${FAKE.github}`, FAKE.github, REDACTED.SECRET],
    ['a Slack token', `bot ${FAKE.slack}`, FAKE.slack, REDACTED.SECRET],
    ['an AWS access key', `${FAKE.aws} leaked`, FAKE.aws, REDACTED.SECRET],
    ['a JWT', `token ${FAKE.jwt}`, FAKE.jwt.split('.')[0], REDACTED.SECRET],
    [
      'a bearer header',
      'Authorization: Bearer abc.def.ghi-jkl_mno123',
      'abc.def.ghi-jkl_mno123',
      REDACTED.SECRET,
    ],
    [
      'a password assignment',
      'password=hunter22secret',
      'hunter22secret',
      REDACTED.SECRET,
    ],
    [
      'an internal host',
      'see https://posthogprod.helloally.dev/insights/abc',
      'posthogprod.helloally.dev',
      REDACTED.URL,
    ],
    [
      'a URL with a query string',
      'open https://example.com/x?tenantId=42&token=abc',
      'tenantId=42',
      REDACTED.URL,
    ],
    ['an IP address', 'db at 10.0.12.7 is slow', '10.0.12.7', REDACTED.IP],
    [
      'a UUID',
      'user 3f2b8c1e-4a5d-4e6f-8a9b-0c1d2e3f4a5b churned',
      '3f2b8c1e-4a5d-4e6f-8a9b-0c1d2e3f4a5b',
      REDACTED.ID,
    ],
    [
      'a labelled tenant name',
      'tenant: Sunrise Counselling saw a drop',
      'Sunrise Counselling',
      REDACTED.ORG,
    ],
    [
      'a quoted organisation name',
      "organisation 'Hope Line' asked for it",
      'Hope Line',
      REDACTED.ORG,
    ],
    [
      'a long quoted learner sentence',
      'A learner wrote "I feel like nobody listens to me when I call the helpline at night"',
      'nobody listens',
      REDACTED.QUOTE,
    ],
  ])('removes %s', (_label, input, secret, marker) => {
    const out = scrubForPublic(input);
    expect(out).not.toContain(secret);
    expect(out).toContain(marker);
  });

  it('removes known tenant names case-insensitively, longest first', () => {
    const out = scrubForPublic('ACME HEALTH and acme saw 41% fewer returns', {
      tenantNames: ['Acme', 'Acme Health'],
    });
    expect(out).toBe(
      `${REDACTED.ORG} and ${REDACTED.ORG} saw 41% fewer returns`,
    );
  });

  it('keeps aggregate figures, dates, file paths and short UI labels', () => {
    const text =
      '41% of 1,203 learners on 2026-11-17 skipped "Start" in ally-web/apps/ally-helpline-dashboard/src/pages/Roleplay/StartScreenComponent.tsx';
    expect(scrubForPublic(text)).toBe(text);
  });

  it('scrubs nested structures without mutating the input', () => {
    const input = { a: ['mail me at a@b.co'], b: { c: 'ok' }, n: 3 };
    const out = scrubDeep(input);
    expect(out).toEqual({
      a: [`mail me at ${REDACTED.EMAIL}`],
      b: { c: 'ok' },
      n: 3,
    });
    expect(input.a[0]).toBe('mail me at a@b.co');
  });
});

describe('compilePlan', () => {
  const card = (payload = recommendationPayload()) => ({
    id: '11111111-1111-4111-8111-111111111111',
    version: 2,
    versionHash: cardVersionHash('recommendation', 'ui_ux', payload),
    category: 'ui_ux',
    payload: payload as never,
  });

  it('is deterministic: the same card compiles to the same text and hash', () => {
    const a = compilePlan(card());
    const b = compilePlan(card());
    expect(a.markdown).toBe(b.markdown);
    expect(a.prdHash).toBe(b.prdHash);
    expect(a.prdHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('a changed card compiles to a different hash', () => {
    const changed = compilePlan(card(recommendationPayload({ size: 'M' })));
    expect(changed.prdHash).not.toBe(compilePlan(card()).prdHash);
  });

  it('renders every section of plan.md from the card fields', () => {
    const { markdown } = compilePlan(card());
    for (const expected of [
      '# Show the streak count on the roleplay start screen',
      '**Why:** 41% of learners',
      '## Change',
      '1. Read the streak from the existing XP endpoint',
      '### Acceptance criteria',
      '- The chip shows the current streak',
      '### Defaults chosen',
      '- Hide the chip when the streak is 0',
      '## Repos',
      '- ally-web',
      'Rollback: Revert the pull request',
      'next-day return rate (should go up)',
      '- A push notification',
      'card 11111111-1111-4111-8111-111111111111 v2',
    ]) {
      expect(markdown).toContain(expected);
    }
  });

  it('builds PRD replace ops for every section Builder reads, and none for the design', () => {
    const { prdOps } = compilePlan(card());
    const paths = prdOps.map((op) => op.path);
    expect(paths).toEqual([
      '/title',
      '/summary',
      '/problem',
      '/usersAndContext',
      '/existingBehaviour',
      '/whereChangesBelong',
      '/goals',
      '/nonGoals',
      '/requirements',
      '/assumptions',
      '/technicalPlan',
      '/testPlanMd',
      '/e2ePlanMd',
      '/openQuestions',
    ]);
    expect(paths.some((path) => path.startsWith('/technicalDesign'))).toBe(
      false,
    );
    expect(prdOps.every((op) => op.op === 'replace')).toBe(true);
    const requirements = prdOps.find((op) => op.path === '/requirements')!
      .value as any[];
    expect(requirements[0]).toMatchObject({
      id: 'R1',
      acceptanceCriteria: ['The chip shows the current streak'],
    });
    const plan = prdOps.find((op) => op.path === '/technicalPlan')!
      .value as any;
    expect(plan.repos).toEqual([expect.objectContaining({ repo: 'ally-web' })]);
    expect(plan.repos[0].changesMd).toContain('Start.tsx');
    const assumptions = prdOps.find((op) => op.path === '/assumptions')!
      .value as any[];
    expect(assumptions).toEqual([
      {
        id: 'A1',
        text: 'Hide the chip when the streak is 0',
        status: 'confirmed',
      },
    ]);
  });

  it('never carries tenant names, contact details, secrets or evidence snapshots', () => {
    const leaky = recommendationPayload({
      whyHeadline: '41% of Acme Health learners stop; ask ops@acme.example',
      problem:
        'Sunrise tenant: Sunrise Counselling sees "I feel like nobody listens to me when I call at night" in transcripts. Token ' +
        FAKE.openai +
        '.',
      evidenceIds: ['0b7e7c1e-2f7a-4a43-9a6b-2a6d1f1c0001'],
      // A snapshot that slipped into the payload must not survive either.
      plan: {
        ...recommendationPayload().plan,
        steps: ['Query https://posthogprod.helloally.dev/api?key=abc'],
      },
    });
    const { markdown, prdOps } = compilePlan(card(leaky), {
      tenantNames: ['Acme Health', 'Sunrise Counselling'],
    });
    const everything = `${markdown}\n${JSON.stringify(prdOps)}`;
    for (const leak of [
      'Acme Health',
      'Sunrise Counselling',
      'ops@acme.example',
      'nobody listens',
      FAKE.openai,
      'posthogprod',
      '0b7e7c1e-2f7a-4a43-9a6b-2a6d1f1c0001',
    ]) {
      expect(everything).not.toContain(leak);
    }
    // The aggregate figure the card cites survives.
    expect(markdown).toContain('41%');
    expect(markdown).toContain('1 internal evidence item(s)');
  });
});
