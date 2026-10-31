import { Test, TestingModule } from '@nestjs/testing';

import { CourseUnitsAnalyticsService } from '../course-units-analytics.service';
import { GoalsXpAnalyticsRepository } from '../../repository/goals-xp-analytics.repository';
import {
  COURSE_UNIT_XP,
  CourseUnitsAnalyticsRepository,
} from '../../repository/course-units-analytics.repository';

/** Fixed "now" = 2026-10-31. The default window is 12m in monthly buckets. */
const FIXED_NOW = new Date('2026-10-31T12:00:00.000Z');
const DATA_FLOOR = new Date('2026-04-10T00:00:00.000Z');

describe('CourseUnitsAnalyticsService', () => {
  let service: CourseUnitsAnalyticsService;
  let repo: jest.Mocked<CourseUnitsAnalyticsRepository>;
  let goals: jest.Mocked<GoalsXpAnalyticsRepository>;

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(FIXED_NOW);

    const mockRepo: Partial<jest.Mocked<CourseUnitsAnalyticsRepository>> = {
      getDataFloor: jest.fn().mockResolvedValue(DATA_FLOOR),
      getCourseUnitsByBucket: jest.fn().mockResolvedValue([]),
    };

    const mockGoals: Partial<jest.Mocked<GoalsXpAnalyticsRepository>> = {
      getGoalsByGrain: jest.fn().mockResolvedValue(new Map()),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CourseUnitsAnalyticsService,
        { provide: CourseUnitsAnalyticsRepository, useValue: mockRepo },
        { provide: GoalsXpAnalyticsRepository, useValue: mockGoals },
      ],
    }).compile();

    service = module.get(CourseUnitsAnalyticsService);
    repo = module.get(CourseUnitsAnalyticsRepository);
    goals = module.get(GoalsXpAnalyticsRepository);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('defaults to 12m in monthly buckets without reading the data floor', async () => {
    const res = await service.getCourseUnits({});

    expect(repo.getDataFloor).not.toHaveBeenCalled();
    expect(res.window.bucket).toBe('month');
    expect(res.window.allTime).toBe(false);
    expect(res.points[res.points.length - 1].bucket).toBe('2026-10-01');
    expect(res.points.length).toBeGreaterThanOrEqual(11);
  });

  it('reads the platform data floor only for an all-time window', async () => {
    await service.getCourseUnits({ range: 'all' });

    expect(repo.getDataFloor).toHaveBeenCalledTimes(1);
  });

  it('turns XP into units and an average per learner', async () => {
    repo.getCourseUnitsByBucket.mockResolvedValue([
      { bucket: '2026-10-01', xp: 148000, learners: 540 },
    ]);

    const res = await service.getCourseUnits({});
    const oct = res.points.find((p) => p.bucket === '2026-10-01');

    expect(res.unitXp).toBe(COURSE_UNIT_XP);
    expect(oct).toEqual({
      bucket: '2026-10-01',
      units: 1480,
      learners: 540,
      targetUnits: null,
      avgUnitsPerLearner: 2.74,
    });
  });

  it('keeps fractional units to two decimals', async () => {
    repo.getCourseUnitsByBucket.mockResolvedValue([
      { bucket: '2026-10-01', xp: 250, learners: 3 },
    ]);

    const res = await service.getCourseUnits({});
    const oct = res.points.find((p) => p.bucket === '2026-10-01');

    expect(oct?.units).toBe(2.5);
    expect(oct?.avgUnitsPerLearner).toBe(0.83);
  });

  it('fills absent buckets with a real zero and a null average', async () => {
    const res = await service.getCourseUnits({});

    expect(res.points.every((p) => p.units === 0 && p.learners === 0)).toBe(
      true,
    );
    expect(res.points.every((p) => p.avgUnitsPerLearner === null)).toBe(true);
  });

  it('is always platform-wide', async () => {
    const res = await service.getCourseUnits({});

    expect(res.scoping).toEqual({ tenantId: null, unscopedSections: [] });
  });

  it('derives the target from the configured XP goal, / 100', async () => {
    goals.getGoalsByGrain.mockResolvedValue(
      new Map([
        ['2026-09-01', 150000],
        ['2026-10-01', 123456],
      ]),
    );

    const res = await service.getCourseUnits({});
    const target = (bucket: string) =>
      res.points.find((p) => p.bucket === bucket)?.targetUnits;

    expect(goals.getGoalsByGrain).toHaveBeenCalledWith('month');
    expect(target('2026-09-01')).toBe(1500);
    expect(target('2026-10-01')).toBe(1234.56);
  });

  it('leaves the target null where no goal is set', async () => {
    const res = await service.getCourseUnits({});

    expect(res.points.every((p) => p.targetUnits === null)).toBe(true);
  });

  it('has no target at day or week grain and does not read goals', async () => {
    const res = await service.getCourseUnits({ range: '90d', bucket: 'week' });

    expect(goals.getGoalsByGrain).not.toHaveBeenCalled();
    expect(res.points.every((p) => p.targetUnits === null)).toBe(true);
  });
});
