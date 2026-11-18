import { SessionItemStatus } from 'src/common/type/common.type';
import { TrackEnrollmentService } from '../track-enrollment.service';
import { TrackItemType } from '../../type/track.type';
import {
  BranchingExperience,
  BranchingScenarioContent,
} from '../../type/branching.type';

jest.mock('src/logger/logger.service', () => ({
  LoggerService: {
    getInstance: jest.fn(() => ({
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      log: jest.fn(),
    })),
  },
}));

describe('TrackEnrollmentService — branching scenario experience', () => {
  const ITEM_ID = 'item-1';

  const service = new TrackEnrollmentService(
    {} as any, // dataSource
    {} as any, // trackRepository
    {} as any, // trackTenantRepository
    {} as any, // trackEnrollmentRepository
    { update: jest.fn() } as any, // trackItemProgressRepository
    {} as any, // trackJournalEntryRepository
    {} as any, // trackQuizAttemptRepository
    {} as any, // trackAnnotationAttemptRepository
    {} as any, // trackSharedService
    { completeItem: jest.fn() } as any, // trackProgressService
    {} as any, // caseSessionService
    {} as any, // scenarioSharedService
    {} as any, // trackLocalizationService
    {} as any, // cohortVisibilityService
  );

  const content = (
    extra: Partial<BranchingScenarioContent> = {},
  ): BranchingScenarioContent => ({
    startNodeId: 'start',
    nodes: [
      {
        id: 'start',
        text: 'She hesitates.',
        choices: [{ id: 'c1', text: 'Keep listening', nextNodeId: 'end' }],
      },
      { id: 'end', text: 'She opens up.' },
    ],
    ...extra,
  });

  const start = async (scenario: BranchingScenarioContent) => {
    jest.spyOn(service, 'getPermittedItemProgress').mockResolvedValue({
      item: {
        id: ITEM_ID,
        type: TrackItemType.BRANCHING_SCENARIO,
        content: scenario,
      } as any,
      sourceItem: {} as any,
      progress: {
        id: 'progress-1',
        trackEnrollmentId: 'enr-1',
        status: SessionItemStatus.UNLOCKED,
      } as any,
      enrollment: { id: 'enr-1' } as any,
      languageCode: null,
    });
    (service as any).trackEnrollmentRepository.update = jest.fn();
    return (await service.startItem(ITEM_ID)) as any;
  };

  it('sends CLASSIC when the scenario was authored before experiences existed', async () => {
    const result = await start(content());
    expect(result.experience).toBe(BranchingExperience.CLASSIC);
  });

  it('sends the authored experience', async () => {
    const result = await start(
      content({ experience: BranchingExperience.STORY }),
    );
    expect(result.experience).toBe(BranchingExperience.STORY);
  });

  it('ships a single-button scene as authored', async () => {
    const result = await start(content());
    expect(result.nodes[0].choices).toEqual([
      { id: 'c1', text: 'Keep listening', nextNodeId: 'end' },
    ]);
  });
});
