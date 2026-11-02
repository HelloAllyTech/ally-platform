import { Test, TestingModule } from '@nestjs/testing';

import { XpLevelReachedAnalyticsService } from '../xp-level-reached-analytics.service';
import { XpLevelReachedAnalyticsRepository } from '../../repository/xp-level-reached-analytics.repository';

/** Fixed "now" = Wednesday 2024-06-12T12:00:00Z. */
const FIXED_NOW = new Date('2024-06-12T12:00:00.000Z');
const DATA_FLOOR = new Date('2024-04-10T00:00:00.000Z');

describe('XpLevelReachedAnalyticsService', () => {
  let service: XpLevelReachedAnalyticsService;

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(FIXED_NOW);

    const mockRepo: Partial<jest.Mocked<XpLevelReachedAnalyticsRepository>> = {
      getDataFloor: jest.fn().mockResolvedValue(DATA_FLOOR),
      getLevelCrossings: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        XpLevelReachedAnalyticsService,
        { provide: XpLevelReachedAnalyticsRepository, useValue: mockRepo },
      ],
    }).compile();

    service = module.get(XpLevelReachedAnalyticsService);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe('scoping', () => {
    it('is always platform-wide — this chart has no tenant filter', async () => {
      const res = await service.getLevelsReached({});
      expect(res.scoping).toEqual({ tenantId: null, unscopedSections: [] });
    });
  });
});
