import { BadRequestException } from '@nestjs/common';
import { entrySourceOf } from 'src/track/service/track-enrollment.service';
import { GuideBaselineService } from '../guide-baseline.service';

function setup(rows: any[], quiz: any[]) {
  const params: unknown[][] = [];
  const dataSource = {
    query: jest.fn(async (sql: string, args: unknown[] = []) => {
      params.push(args);
      if (sql.includes('track_quiz_attempts')) return quiz;
      if (sql.includes('COUNT(*)::int AS "n"')) return [{ n: 3 }];
      return rows;
    }),
  };
  const snapshots = {
    create: jest.fn((row) => row),
    save: jest.fn(async (row) => ({ id: 'b1', ...row })),
    find: jest.fn(async () => []),
  };
  const service = new GuideBaselineService(
    snapshots as never,
    dataSource as never,
  );
  return { service, params, dataSource };
}

describe('GuideBaselineService', () => {
  it('keeps each cohort and the rollup, rounded, with the quiz rate joined in', async () => {
    const t = setup(
      [
        {
          cohort: 'unknown',
          enrollments: 4,
          completionRate: 0.254321,
          medianDaysToComplete: 15.333,
          itemsCompletedPerEnrollment: 2.5,
          firstDayWinRate: 0.75,
          returnWithin7dRate: 0.5,
        },
        {
          cohort: null,
          enrollments: 4,
          completionRate: 0.254321,
          medianDaysToComplete: null,
          itemsCompletedPerEnrollment: 2.5,
          firstDayWinRate: 0.75,
          returnWithin7dRate: 0.5,
        },
      ],
      [
        { cohort: 'unknown', attempts: 2, passRate: 0.5 },
        { cohort: null, attempts: 2, passRate: 0.5 },
      ],
    );
    const snapshot = await t.service.capture({ windowDays: 90, userId: 1 });
    expect(snapshot.metrics.publicCourses).toBe(3);
    expect(snapshot.metrics.cohorts.unknown).toMatchObject({
      enrollments: 4,
      completionRate: 0.2543,
      medianDaysToComplete: 15.33,
      quizFirstAttempts: 2,
      quizFirstAttemptPassRate: 0.5,
    });
    expect(snapshot.metrics.cohorts.all.enrollments).toBe(4);
    // The window travels as ISO instants, converted to UTC in SQL.
    expect(t.params[0]).toHaveLength(2);
    expect(String(t.params[0][0])).toMatch(/Z$/);
  });

  it('records an empty baseline rather than nothing', async () => {
    const snapshot = await setup([], []).service.capture({
      windowDays: 30,
      userId: null,
    });
    expect(snapshot.metrics.cohorts.all).toMatchObject({
      enrollments: 0,
      completionRate: null,
    });
  });

  it('refuses a window outside 7–365 days', async () => {
    await expect(
      setup([], []).service.capture({ windowDays: 3, userId: 1 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('entrySourceOf', () => {
  it('keeps known sources and reads anything else as in-app', () => {
    expect(entrySourceOf('public_link')).toBe('public_link');
    expect(entrySourceOf('guided')).toBe('guided');
    expect(entrySourceOf('from-the-moon')).toBe('in_app');
    expect(entrySourceOf(undefined)).toBe('in_app');
  });
});
