import { Repository } from 'typeorm';

import { User } from 'src/user/entity/user.entity';

import { RoadmapOpportunityRepository } from '../../repository/roadmap-opportunity.repository';
import { RoadmapOpportunityService } from '../roadmap-opportunity.service';
import { RoadmapVectorService } from '../roadmap-vector.service';
import { RoadmapOpportunityType } from '../../enum/roadmap-opportunity.enum';

/**
 * Bugs still WRITE a roadmap row — it is the record of who reported what, and
 * what `bug_findings.reported_bug_id` points at. What they no longer do is show
 * up on the board.
 *
 * The reads are excluded in SQL (see EXCLUDE_BUGS_SQL in
 * RoadmapOpportunityRepository) and are covered against a real database rather
 * than here. What IS unit-testable is the other half: a filed bug still enters
 * Bug Hunter's queue, with its repo classified when the report names none.
 */
describe('RoadmapOpportunityService — bugs stay off the board', () => {
  const saved = (type: RoadmapOpportunityType) => ({
    id: 'opp-1',
    type,
    description: 'Search returns nothing after login',
  });

  const build = (
    type: RoadmapOpportunityType,
    classification: { repo: string | null; rationale: string } = {
      repo: null,
      rationale: '',
    },
  ) => {
    const opportunityRepository = {
      create: jest.fn().mockImplementation((v) => v),
      save: jest.fn().mockResolvedValue(saved(type)),
      findOneWithScore: jest.fn().mockResolvedValue({
        ...saved(type),
        priorityScore: 0,
        myVotes: 0,
        commentCount: 0,
        ownerDisplay: null,
      }),
    };
    // Bug Hunter's queue: a filed bug enters it (BugHunterBoardService.enqueueReported)
    const bugHunterV2 = {
      enqueueReported: jest.fn().mockResolvedValue(undefined),
    };
    const repoClassifier = {
      classifyRepo: jest.fn().mockResolvedValue(classification),
    };

    const service = new RoadmapOpportunityService(
      opportunityRepository as unknown as RoadmapOpportunityRepository,
      {} as never, // allocationRepository — unused by these tests
      // Ranking is not what these tests are about; countGoals feeds the response mapper and
      // getRankContext feeds the read paths.
      {
        countGoals: jest.fn().mockResolvedValue(0),
        isProdDirector: jest.fn().mockResolvedValue(false),
        getRankContext: jest.fn().mockResolvedValue({
          weights: {
            votesWeight: 1,
            votersWeight: 1,
            effortWeight: 1,
            goalImpactWeight: 1,
          },
          bases: { maxScore: 0, maxVoters: 0, totalGoals: 0 },
        }),
      } as never,
      { assessQuietly: jest.fn().mockResolvedValue(undefined) } as never,
      {
        indexQuietly: jest.fn().mockResolvedValue(undefined),
      } as unknown as RoadmapVectorService,
      { find: jest.fn().mockResolvedValue([]) } as unknown as Repository<User>,
      // Images play no part in bug visibility; these satisfy the constructor.
      { parseS3Url: jest.fn() } as never,
      { s3: { assetsBucket: 'ally-assets' } } as never,
      // Never consulted on these paths: the readiness gate applies only to the
      // /opportunities create call, which passes enforceReadiness. A throwing stub keeps
      // that true — if one of these paths starts verifying tokens, the test says so.
      {
        verify: jest.fn(() => {
          throw new Error(
            'readiness token verified on a path that should not gate',
          );
        }),
      } as never,
      { suggestTitle: jest.fn().mockResolvedValue('A title') } as never, // roadmapAi
      bugHunterV2 as never,
      repoClassifier as never,
    );

    return { service, bugHunterV2, repoClassifier };
  };

  /**
   * The half that must NOT change: the Bug Hunter inbox row is the entire point of filing a bug, and
   * it is now the only place the bug will ever be seen.
   */
  it('still queues the bug in Bug Hunter, which is where it now lives', async () => {
    const { service, bugHunterV2 } = build(RoadmapOpportunityType.BUG);

    await service.create(1, {
      description: 'Search returns nothing after login',
      type: RoadmapOpportunityType.BUG,
      productGoal: 'Reported bugs',
    });

    expect(bugHunterV2.enqueueReported).toHaveBeenCalledWith(
      expect.objectContaining({
        opportunityId: 'opp-1',
        description: 'Search returns nothing after login',
      }),
    );
  });

  /**
   * Classified once, here, when the reporter named no app — see
   * RepoClassifierService (Bug Hunter's queue then knows where to look).
   */
  it('stamps the finding with the repo the classifier confidently names', async () => {
    const { service, bugHunterV2, repoClassifier } = build(
      RoadmapOpportunityType.BUG,
      { repo: 'ally-web', rationale: 'mentions the admin dashboard' },
    );

    await service.create(1, {
      description: 'The filter bar on the admin dashboard is unresponsive',
      type: RoadmapOpportunityType.BUG,
      productGoal: 'Reported bugs',
    });

    expect(repoClassifier.classifyRepo).toHaveBeenCalledWith(
      'Search returns nothing after login',
    );
    expect(bugHunterV2.enqueueReported).toHaveBeenCalledWith(
      expect.objectContaining({ repo: 'ally-web' }),
    );
  });

  it('leaves the finding unfiled when the classifier cannot tell', async () => {
    const { service, bugHunterV2 } = build(RoadmapOpportunityType.BUG, {
      repo: null,
      rationale: '',
    });

    await service.create(1, {
      description: 'Something is broken somewhere',
      type: RoadmapOpportunityType.BUG,
      productGoal: 'Reported bugs',
    });

    expect(bugHunterV2.enqueueReported).toHaveBeenCalledWith(
      expect.objectContaining({ repo: null }),
    );
  });
});
