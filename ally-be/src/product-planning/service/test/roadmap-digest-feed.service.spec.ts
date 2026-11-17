import { RoadmapDigestFeedService } from '../roadmap-digest-feed.service';

const SINCE = new Date('2026-10-01T00:00:00Z');
const IN_WEEK = '2026-10-03T00:00:00Z';
const BEFORE = '2026-09-20T00:00:00Z';

const row = (over: Record<string, unknown>) => ({
  code: 'OPP-0001',
  description: 'Title line\nbody',
  stage: 'prioritised',
  reviewState: 'accepted',
  reviewedAt: BEFORE,
  releasedAt: null,
  planStage: null,
  comments: '0',
  planUpdates: '0',
  ...over,
});

function build(rows: Record<string, unknown>[]) {
  const dataSource = { query: jest.fn(async () => rows) };
  return {
    service: new RoadmapDigestFeedService(dataSource as never),
    dataSource,
  };
}

describe('RoadmapDigestFeedService.ideasThisWeek', () => {
  it('keeps only ideas with news this week, in words the email can use', async () => {
    const { service, dataSource } = build([
      row({ code: 'OPP-0001' }),
      row({
        code: 'OPP-0002',
        stage: 'released',
        releasedAt: IN_WEEK,
        planStage: 'launching',
      }),
      row({ code: 'OPP-0003', reviewState: 'declined', reviewedAt: IN_WEEK }),
      row({ code: 'OPP-0004', comments: '2', planStage: 'design' }),
      row({ code: 'OPP-0005', planUpdates: '1', planStage: 'building' }),
      row({ code: 'OPP-0006', reviewState: 'pending', comments: '1' }),
    ]);
    const news = await service.ideasThisWeek(7, SINCE);
    expect(dataSource.query).toHaveBeenCalledWith(expect.any(String), [
      7,
      SINCE,
    ]);
    expect(
      news.map((n) => [n.code, n.stage, n.reviewed, !!n.shippedAt]),
    ).toEqual([
      ['OPP-0002', 'shipped', null, true],
      ['OPP-0003', 'declined', 'declined', false],
      ['OPP-0004', 'planning', null, false],
      ['OPP-0005', 'building', null, false],
      ['OPP-0006', 'submitted', null, false],
    ]);
    expect(news[0].title).toBe('Title line');
  });

  it('counts a release before the week as no news', async () => {
    const { service } = build([row({ stage: 'released', releasedAt: BEFORE })]);
    expect(await service.ideasThisWeek(7, SINCE)).toEqual([]);
  });
});

describe('RoadmapDigestFeedService.recipients', () => {
  it('drops anyone without an email address', async () => {
    const { service } = build([
      { userId: 1, email: 'a@example.com', name: ' Asha ' },
      { userId: 2, email: null, name: 'Nobody' },
    ]);
    expect(await service.recipients(SINCE)).toEqual([
      { userId: 1, email: 'a@example.com', name: 'Asha' },
    ]);
  });
});
