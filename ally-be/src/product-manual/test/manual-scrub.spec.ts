import { ManualScrubService } from '../service/manual-scrub.service';

describe('ManualScrubService', () => {
  const scrub = new ManualScrubService();
  const reasonOf = (text: string) => {
    const verdict = scrub.check(text);
    return verdict.ok ? null : verdict.reason;
  };

  it('lets ordinary product prose through', () => {
    const prose = [
      '# Running a roleplay',
      'A learner opens **Practice**, picks a case and talks for 5-10 minutes.',
      'Roadmap item OPP-388 shipped in release 1.157.5; migration 1988500000000 added the tables.',
      'Keys start with `pmk_…` and are shown once. See [[roles-and-access]].',
      'The task-based flow ask-a-question uses sk- as a prefix only in prose.',
    ].join('\n');
    expect(scrub.check(prose)).toEqual({ ok: true });
    expect(scrub.check('')).toEqual({ ok: true });
  });

  it.each([
    ['an sk- key', 'Use ' + 'sk-proj-' + 'a'.repeat(30) + ' to call it'],
    ['a pmk_ key', 'key: ' + 'pmk_' + 'a'.repeat(16)],
    ['a clr_ key', 'reader ' + 'clr_' + 'a'.repeat(16)],
    ['an AWS key id', 'AKIAIOSFODNN7EXAMPLE'],
    ['a PEM block', '-----BEGIN RSA PRIVATE KEY-----'],
    ['a GitHub token', 'ghp_' + 'a'.repeat(36)],
  ])('refuses %s', (_label, text) => {
    expect(reasonOf(`first line\n${text}`)).toMatch(/^Line 2 /);
  });

  it.each([
    'Write to someone@example.com for help',
    'Call +91 98765 43210 now',
    'Call 98765 43210? no: 9876543210',
    'Reach us on (415) 555-2671',
    'Reach us on 415-555-2671',
  ])('refuses an email or phone number: %s', (text) => {
    expect(scrub.check(text).ok).toBe(false);
  });

  it.each([
    'Strategy: we will win on price',
    '  pricing: 20 per seat',
    '- **Strategy:** focus on NGOs',
    '> Pricing: tiered',
  ])('refuses a Strategy:/Pricing: line: %s', (text) => {
    expect(reasonOf(text)).toContain('Strategy');
  });

  it('allows the words strategy and pricing mid-sentence', () => {
    expect(
      scrub.check(
        'The pricing page is for admins. A strategy goal is a target.',
      ).ok,
    ).toBe(true);
  });

  it('never echoes the matched secret back', () => {
    const secret = 'pmk_' + 'a'.repeat(16);
    expect(reasonOf(`x ${secret}`)).not.toContain(secret);
  });
});
