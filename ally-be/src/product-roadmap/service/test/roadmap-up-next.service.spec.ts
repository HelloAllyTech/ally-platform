import { BadRequestException, ConflictException } from '@nestjs/common';
import { RoadmapUpNextService } from '../roadmap-up-next.service';
import {
  RoadmapOpportunityStage,
  RoadmapOpportunityType,
} from '../../enum/roadmap-opportunity.enum';

/**
 * Up next is a two-way door with a hard edge: Start is one press and Put back
 * undoes it, but the limit is never passed and never queued past.
 */
describe('RoadmapUpNextService', () => {
  const opportunity = (over: Record<string, any> = {}) => ({
    id: 'opp-1',
    code: 'OPP-0582',
    description: 'Review and sign-off before a course goes live\nMore detail',
    type: RoadmapOpportunityType.IDEA,
    stage: RoadmapOpportunityStage.UNDER_DEVELOPMENT,
    builderSessionId: 'sess-1',
    ...over,
  });

  const build = (over: Record<string, any> = {}) => {
    const opportunityRepository = {
      findOne: jest.fn().mockResolvedValue(over.opportunity ?? opportunity()),
      find: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const opportunityService = {
      list: jest.fn().mockResolvedValue({
        items: over.items ?? [],
        count: 0,
      }),
    };
    const roadmapBuilderService = {
      openSession: jest.fn().mockResolvedValue({
        sessionId: 'sess-new',
        created: true,
        seedMessage: 'Interview me',
      }),
    };
    const builderSessionService = {
      cancelSession: jest.fn().mockResolvedValue({}),
    };
    const nowService = {
      inProgressCount: jest
        .fn()
        .mockResolvedValue({ inProgress: over.inProgress ?? 1, limit: 3 }),
      now: jest.fn().mockResolvedValue({
        sessions: over.sessions ?? [
          {
            id: 'sess-1',
            title: 'Review and sign-off',
            code: 'OPP-0582',
            putBackEligible: true,
          },
        ],
      }),
    };
    const decisionService = {
      startBackgroundTurn: jest.fn().mockResolvedValue(undefined),
    };
    const historyService = { record: jest.fn().mockResolvedValue(null) };
    const liveService = { changed: jest.fn() };
    const service = new RoadmapUpNextService(
      opportunityRepository as never,
      opportunityService as never,
      roadmapBuilderService as never,
      builderSessionService as never,
      nowService as never,
      decisionService as never,
      historyService as never,
      liveService as never,
    );
    return {
      service,
      opportunityRepository,
      roadmapBuilderService,
      builderSessionService,
      decisionService,
      historyService,
    };
  };

  it('lists unstarted, non-bug opportunities in queue order', async () => {
    const { service } = build({
      items: [
        {
          id: 'b',
          code: 'OPP-2',
          description: 'B',
          queueRank: 2,
          type: 'idea',
        },
        {
          id: 'a',
          code: 'OPP-1',
          description: 'A',
          queueRank: 1,
          type: 'idea',
        },
        { id: 'c', code: 'OPP-3', description: 'C', queueRank: 3, type: 'bug' },
        {
          id: 'd',
          code: 'OPP-4',
          description: 'D',
          queueRank: 0,
          type: 'idea',
          builderSessionId: 'x',
        },
      ],
    });

    const result = await service.upNext(7);

    expect(result.items.map((item) => item.code)).toEqual(['OPP-1', 'OPP-2']);
    expect(result).toMatchObject({ inProgress: 1, limit: 3 });
  });

  it('starts the interview server-side and records the Start', async () => {
    const { service, decisionService, historyService } = build();

    await expect(service.start(7, 'opp-1')).resolves.toEqual({
      sessionId: 'sess-new',
      created: true,
    });
    expect(decisionService.startBackgroundTurn).toHaveBeenCalledWith(
      'sess-new',
      'Interview me',
      7,
    );
    expect(historyService.record).toHaveBeenCalledWith(
      expect.objectContaining({ entryType: 'start', surface: 'now' }),
    );
  });

  it('refuses Start at the limit instead of queueing', async () => {
    const { service, roadmapBuilderService } = build({ inProgress: 3 });

    await expect(service.start(7, 'opp-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(roadmapBuilderService.openSession).not.toHaveBeenCalled();
  });

  it('refuses a bug', async () => {
    const { service } = build({
      opportunity: opportunity({ type: RoadmapOpportunityType.BUG }),
    });
    await expect(service.start(7, 'opp-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('puts an untouched interview back and returns the opportunity to prioritised', async () => {
    const { service, builderSessionService, opportunityRepository } = build();

    await expect(service.putBack(7, 'sess-1')).resolves.toEqual({
      ok: true,
      opportunityId: 'opp-1',
    });
    expect(builderSessionService.cancelSession).toHaveBeenCalledWith(
      'sess-1',
      7,
    );
    expect(opportunityRepository.update).toHaveBeenCalledWith(
      { id: 'opp-1' },
      expect.objectContaining({
        builderSessionId: null,
        stage: RoadmapOpportunityStage.PRIORITISED,
      }),
    );
  });

  it('refuses to put back an interview with answers in it', async () => {
    const { service, builderSessionService } = build({
      sessions: [{ id: 'sess-1', title: 'x', putBackEligible: false }],
    });

    await expect(service.putBack(7, 'sess-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(builderSessionService.cancelSession).not.toHaveBeenCalled();
  });
});
