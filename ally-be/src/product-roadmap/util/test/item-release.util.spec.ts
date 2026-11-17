import {
  ReleaseRunLike,
  containedIn,
  extractOpportunityCodes,
  firstReleaseAfter,
  newestSuccessfulRun,
  normaliseOpportunityCode,
  opportunityShipped,
  parsePullRequestRef,
  releaseFailedSince,
  sortTagsNewestFirst,
  tagCreatedDuring,
  tagFromRunTitle,
} from '../item-release.util';

const at = (iso: string) => new Date(`2026-11-${iso}Z`);

const run = (
  started: string,
  conclusion: string,
  extra: Partial<ReleaseRunLike> = {},
): ReleaseRunLike => ({
  conclusion,
  createdAt: at(started),
  startedAt: at(started),
  finishedAt: new Date(at(started).getTime() + 20 * 60 * 1000),
  headSha: `sha-${started}`,
  title: 'Production Release - Ally Backend',
  ...extra,
});

describe('extractOpportunityCodes', () => {
  it.each([
    ['feat(x): the thing (OPP-0826)', ['OPP-0826']],
    ['opp-388-add-the-thing', ['OPP-0388']],
    ['feat/opp-388-add', ['OPP-0388']],
    ['feat_opp-12', ['OPP-0012']],
    ['OPP-12345 grows past four digits', ['OPP-12345']],
    ['two: OPP-0001 and opp-2', ['OPP-0001', 'OPP-0002']],
    ['repeated OPP-0007 OPP-0007 opp-7', ['OPP-0007']],
  ])('%s → %j', (text, codes) => {
    expect(extractOpportunityCodes(text)).toEqual(codes);
  });

  it.each([
    'shopp-12 is not a code',
    'XOPP-0012',
    'OPP-',
    'OPP-0000',
    'OPPS-0012',
    'opportunity-12',
    '',
  ])('finds nothing in %j', (text) => {
    expect(extractOpportunityCodes(text)).toEqual([]);
  });

  it('does not read a longer number as a shorter code', () => {
    expect(extractOpportunityCodes('OPP-1234')).toEqual(['OPP-1234']);
    expect(extractOpportunityCodes('OPP-1234')).not.toContain('OPP-0123');
  });

  it('is safe on null', () => {
    expect(extractOpportunityCodes(null)).toEqual([]);
  });
});

describe('normaliseOpportunityCode', () => {
  it('accepts the forms a person types', () => {
    expect(normaliseOpportunityCode('OPP-0388')).toBe('OPP-0388');
    expect(normaliseOpportunityCode('opp-388')).toBe('OPP-0388');
    expect(normaliseOpportunityCode('388')).toBe('OPP-0388');
  });

  it('rejects anything else', () => {
    expect(normaliseOpportunityCode('OPP-')).toBeNull();
    expect(normaliseOpportunityCode('0')).toBeNull();
    expect(normaliseOpportunityCode('OPP-12a')).toBeNull();
    expect(normaliseOpportunityCode('../etc')).toBeNull();
  });
});

describe('parsePullRequestRef', () => {
  const mono = 'HelloAllyTech/ally-platform';

  it('reads a bare number as the monorepo', () => {
    expect(parsePullRequestRef('123', mono)).toEqual({
      repo: mono,
      number: 123,
    });
    expect(parsePullRequestRef('#123', mono)).toEqual({
      repo: mono,
      number: 123,
    });
  });

  it('reads a pull request link, with or without a trailing path', () => {
    expect(
      parsePullRequestRef(
        'https://github.com/HelloAllyTech/ally-be/pull/704/files',
        mono,
      ),
    ).toEqual({ repo: 'HelloAllyTech/ally-be', number: 704 });
  });

  it('rejects what is not a pull request', () => {
    expect(
      parsePullRequestRef('https://github.com/a/b/issues/1', mono),
    ).toBeNull();
    expect(
      parsePullRequestRef('https://example.com/a/b/pull/1', mono),
    ).toBeNull();
    expect(parsePullRequestRef('abc', mono)).toBeNull();
  });
});

describe('release history', () => {
  it('orders tags by version, not by text', () => {
    expect(
      sortTagsNewestFirst(
        ['be-v1.9.0', 'be-v1.10.0', 'be-v1.10.2', 'be-vx', 'ai-v9.0.0'],
        'be-v',
      ),
    ).toEqual(['be-v1.10.2', 'be-v1.10.0', 'be-v1.9.0']);
  });

  it('never treats a failed run as the newest release', () => {
    const runs = [run('10T10:00:00', 'success'), run('11T10:00:00', 'failure')];
    expect(newestSuccessfulRun(runs)?.startedAt).toEqual(at('10T10:00:00'));
  });

  it('picks the newest success for one frontend app', () => {
    const runs = [
      run('10T10:00:00', 'success', {
        title: 'Production Release - Frontends frontend-v1.2.0 [apps=both]',
      }),
      run('11T10:00:00', 'success', {
        title: 'Production Release - Frontends frontend-v1.2.1 [apps=helpline]',
      }),
    ];
    expect(
      tagFromRunTitle(newestSuccessfulRun(runs, 'admin')!.title, 'frontend-v'),
    ).toBe('frontend-v1.2.0');
    expect(
      tagFromRunTitle(
        newestSuccessfulRun(runs, 'helpline')!.title,
        'frontend-v',
      ),
    ).toBe('frontend-v1.2.1');
  });

  it('matches a run to the tag made during it', () => {
    const success = run('10T10:00:00', 'success');
    const tags = [
      { name: 'be-v1.2.0', commitSha: 'a', at: at('09T09:00:00') },
      { name: 'be-v1.2.1', commitSha: 'b', at: at('10T10:00:30') },
      // A later run's tag (it failed, so it is not the release).
      { name: 'be-v1.2.2', commitSha: 'c', at: at('11T10:00:30') },
    ];
    expect(tagCreatedDuring(tags, success)?.name).toBe('be-v1.2.1');
  });

  it('finds no tag when none dates inside the run', () => {
    const success = run('10T10:00:00', 'success');
    expect(
      tagCreatedDuring(
        [{ name: 'be-v1.2.0', commitSha: 'a', at: at('09T09:00:00') }],
        success,
      ),
    ).toBeNull();
  });

  it('dates a release from the first success that started after the merge', () => {
    const runs = [
      run('10T09:00:00', 'success'),
      run('10T12:00:00', 'success'),
      run('10T15:00:00', 'success'),
    ];
    expect(firstReleaseAfter(runs, at('10T11:00:00'), undefined)).toEqual(
      runs[1].finishedAt,
    );
    expect(firstReleaseAfter(runs, at('10T16:00:00'))).toBeNull();
  });

  it('calls a merge failed only when the newest release since it failed', () => {
    const merged = at('10T11:00:00');
    expect(releaseFailedSince([run('10T12:00:00', 'failure')], merged)).toBe(
      true,
    );
    expect(
      releaseFailedSince(
        [run('10T12:00:00', 'failure'), run('10T13:00:00', 'success')],
        merged,
      ),
    ).toBe(false);
    // A failure before the merge says nothing about it.
    expect(releaseFailedSince([run('10T10:00:00', 'failure')], merged)).toBe(
      false,
    );
    // Cancelled is not failed.
    expect(releaseFailedSince([run('10T12:00:00', 'cancelled')], merged)).toBe(
      false,
    );
  });

  it('reads behind and identical as contained, and nothing else', () => {
    expect(containedIn('behind')).toBe(true);
    expect(containedIn('identical')).toBe(true);
    expect(containedIn('ahead')).toBe(false);
    expect(containedIn('diverged')).toBe(false);
    expect(containedIn(null)).toBe(false);
  });
});

describe('opportunityShipped', () => {
  const merged = (prNumber: number, resolved = true) => ({
    repo: 'o/r',
    prNumber,
    state: 'merged',
    servicesResolvedAt: resolved ? new Date() : null,
  });
  const row = (prNumber: number, state: string, releasedAt?: string) => ({
    repo: 'o/r',
    prNumber,
    state,
    releasedAt: releasedAt ? at(releasedAt) : null,
  });

  it('ships when every service of every merged PR is live, at the last of them', () => {
    expect(
      opportunityShipped(
        [merged(1), merged(2)],
        [
          row(1, 'live', '10T10:00:00'),
          row(1, 'live', '11T10:00:00'),
          row(2, 'live', '10T12:00:00'),
        ],
      ),
    ).toEqual({ shipped: true, liveAt: at('11T10:00:00') });
  });

  it('holds while any service is pending or failed', () => {
    expect(
      opportunityShipped([merged(1)], [row(1, 'live'), row(1, 'pending')])
        .shipped,
    ).toBe(false);
    expect(opportunityShipped([merged(1)], [row(1, 'failed')]).shipped).toBe(
      false,
    );
  });

  it('holds while a linked PR is still open', () => {
    expect(
      opportunityShipped(
        [merged(1), { ...merged(2), state: 'open' }],
        [row(1, 'live')],
      ).shipped,
    ).toBe(false);
  });

  it('ignores a PR closed without merging', () => {
    expect(
      opportunityShipped(
        [
          merged(1),
          { ...merged(2), state: 'closed', servicesResolvedAt: null },
        ],
        [row(1, 'live', '10T10:00:00')],
      ).shipped,
    ).toBe(true);
  });

  it('ships nothing when nothing merged', () => {
    expect(opportunityShipped([], []).shipped).toBe(false);
    expect(
      opportunityShipped([{ ...merged(1), state: 'closed' }], []).shipped,
    ).toBe(false);
  });

  it('holds a merged PR whose services are not yet known', () => {
    expect(
      opportunityShipped([merged(1, false)], [row(1, 'live')]).shipped,
    ).toBe(false);
    expect(opportunityShipped([merged(1)], []).shipped).toBe(false);
  });

  it('ships with an unknown time when a release is older than the history read', () => {
    expect(opportunityShipped([merged(1)], [row(1, 'live')])).toEqual({
      shipped: true,
      liveAt: null,
    });
  });
});
