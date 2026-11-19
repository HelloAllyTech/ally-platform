import { AssessmentAttemptsAnalyticsService } from '../assessment-attempts-analytics.service';

describe('AssessmentAttemptsAnalyticsService', () => {
  it('joins units and incomplete starts by week and computes the share', async () => {
    const dataSource = {
      query: jest
        .fn()
        .mockResolvedValueOnce([
          { week: '2026-11-09', units: 4, singleValid: 3 },
          { week: '2026-11-16', units: 2, singleValid: 2 },
        ])
        .mockResolvedValueOnce([
          { week: '2026-11-16', incompleteStarts: 3 },
          { week: '2026-11-23', incompleteStarts: 1 },
        ]),
    };
    const service = new AssessmentAttemptsAnalyticsService(dataSource as any);

    const result = await service.getAssessmentAttempts();

    expect(result.weeks).toEqual([
      {
        week: '2026-11-09',
        units: 4,
        singleValid: 3,
        share: 0.75,
        incompleteStarts: 0,
      },
      {
        week: '2026-11-16',
        units: 2,
        singleValid: 2,
        share: 1,
        incompleteStarts: 3,
      },
      {
        week: '2026-11-23',
        units: 0,
        singleValid: 0,
        share: null,
        incompleteStarts: 1,
      },
    ]);
    expect(result.totals).toEqual({
      units: 6,
      singleValid: 5,
      share: 5 / 6,
      incompleteStarts: 4,
      incompleteStartsPerUnit: 4 / 6,
    });
  });

  it('reads an empty platform as no share, not zero', async () => {
    const service = new AssessmentAttemptsAnalyticsService({
      query: jest.fn().mockResolvedValue([]),
    } as any);
    const result = await service.getAssessmentAttempts();
    expect(result.totals.share).toBeNull();
    expect(result.weeks).toEqual([]);
  });
});
