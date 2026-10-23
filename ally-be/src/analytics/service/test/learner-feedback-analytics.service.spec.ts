import { Test, TestingModule } from '@nestjs/testing';
import {
  LearnerFeedbackAnalyticsService,
  parseRatings,
  summariseStars,
} from '../learner-feedback-analytics.service';
import {
  LearnerFeedbackAnalyticsRepository,
  LearnerFeedbackRow,
  LearnerFeedbackStarRow,
} from '../../repository/learner-feedback-analytics.repository';

const row: LearnerFeedbackRow = {
  feedbackId: 'f1',
  sessionId: 's1',
  sessionAt: '2026-10-01T10:00:00.000Z',
  ratedAt: '2026-10-01T10:05:00.000Z',
  rating: 2,
  comment: 'AI not responding',
  tags: ['Lacking'],
  learnerId: 7,
  learnerName: 'A Learner',
  tenantId: 'org-1',
  orgName: 'Org One',
  scenarioId: 104,
  scenarioTitle: 'Talk to a worried parent',
  language: 'English (India)',
};

describe('parseRatings', () => {
  it('returns undefined when nothing is asked for', () => {
    expect(parseRatings(undefined)).toBeUndefined();
    expect(parseRatings('')).toBeUndefined();
  });

  it('dedupes and sorts the stars', () => {
    expect(parseRatings('5,1,5,2')).toEqual([1, 2, 5]);
  });
});

describe('summariseStars', () => {
  it('always lists all five stars, zeros included', () => {
    const summary = summariseStars([
      { rating: 5, count: 3, withComment: 1 },
      { rating: 1, count: 1, withComment: 1 },
    ]);
    expect(summary.distribution.map((d) => d.rating)).toEqual([1, 2, 3, 4, 5]);
    expect(summary.distribution[1]).toEqual({
      rating: 2,
      count: 0,
      withComment: 0,
    });
    expect(summary.ratings).toBe(4);
    expect(summary.withComment).toBe(2);
    // (5*3 + 1*1) / 4 = 4
    expect(summary.avgRating).toBe(4);
  });

  it('has no mean when nothing was rated', () => {
    const summary = summariseStars([]);
    expect(summary.ratings).toBe(0);
    expect(summary.avgRating).toBeNull();
  });

  it('rounds the mean to two decimals', () => {
    const summary = summariseStars([
      { rating: 4, count: 2, withComment: 0 },
      { rating: 5, count: 1, withComment: 0 },
    ]);
    expect(summary.avgRating).toBe(4.33);
  });
});

describe('LearnerFeedbackAnalyticsService', () => {
  let service: LearnerFeedbackAnalyticsService;
  let repository: jest.Mocked<LearnerFeedbackAnalyticsRepository>;

  const setup = async (opts?: {
    stars?: LearnerFeedbackStarRow[];
    rows?: LearnerFeedbackRow[];
    total?: number;
  }) => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LearnerFeedbackAnalyticsService,
        {
          provide: LearnerFeedbackAnalyticsRepository,
          useValue: {
            getDataFloor: jest
              .fn()
              .mockResolvedValue(new Date('2026-01-01T00:00:00.000Z')),
            getStarCounts: jest.fn().mockResolvedValue(opts?.stars ?? []),
            getPage: jest.fn().mockResolvedValue({
              rows: opts?.rows ?? [],
              total: opts?.total ?? opts?.rows?.length ?? 0,
            }),
          },
        },
      ],
    }).compile();
    service = module.get(LearnerFeedbackAnalyticsService);
    repository = module.get(LearnerFeedbackAnalyticsRepository);
  };

  it('defaults to comments only, page one of 25, no tenant', async () => {
    await setup({ rows: [row], total: 1 });
    const res = await service.getLearnerFeedback({ range: '30d' });

    const [, , tenantId, filters, limit, offset] =
      repository.getPage.mock.calls[0];
    expect(tenantId).toBeUndefined();
    expect(filters).toEqual({
      ratings: undefined,
      commentsOnly: true,
      search: undefined,
    });
    expect(limit).toBe(25);
    expect(offset).toBe(0);
    expect(res.items).toEqual([row]);
    expect(res.total).toBe(1);
    expect(res.scoping).toEqual({ tenantId: null, unscopedSections: [] });
    expect(repository.getDataFloor).not.toHaveBeenCalled();
  });

  it('passes the filters, trimmed, and lists every rating on commentsOnly=false', async () => {
    await setup();
    await service.getLearnerFeedback({
      range: '90d',
      tenantId: ' org-1 ',
      ratings: '2,1',
      commentsOnly: 'false',
      search: '  nikhil ',
      limit: 50,
      offset: 50,
    });
    const [, , tenantId, filters, limit, offset] =
      repository.getPage.mock.calls[0];
    expect(tenantId).toBe('org-1');
    expect(filters).toEqual({
      ratings: [1, 2],
      commentsOnly: false,
      search: 'nikhil',
    });
    expect(limit).toBe(50);
    expect(offset).toBe(50);
    expect(repository.getStarCounts.mock.calls[0][2]).toBe('org-1');
  });

  it('measures the data floor for an all-time window', async () => {
    await setup();
    const res = await service.getLearnerFeedback({ range: 'all' });
    expect(repository.getDataFloor).toHaveBeenCalled();
    expect(res.window.allTime).toBe(true);
    expect(res.window.from).toBe('2026-01-01');
  });

  it('summarises the whole window independently of the page filters', async () => {
    await setup({
      stars: [
        { rating: 1, count: 2, withComment: 2 },
        { rating: 5, count: 6, withComment: 1 },
      ],
      rows: [row],
      total: 1,
    });
    const res = await service.getLearnerFeedback({
      range: '30d',
      ratings: '1',
    });
    expect(res.summary.ratings).toBe(8);
    expect(res.summary.withComment).toBe(3);
    expect(res.summary.avgRating).toBe(4);
    expect(res.total).toBe(1);
  });
});
