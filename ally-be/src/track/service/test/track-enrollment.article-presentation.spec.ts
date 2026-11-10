import { SessionItemStatus } from 'src/common/type/common.type';
import { TrackEnrollmentService } from '../track-enrollment.service';
import { ArticleExperience, TrackItemType } from '../../type/track.type';

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

describe('TrackEnrollmentService — article presentation', () => {
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

  const start = async (content: Record<string, unknown>) => {
    jest.spyOn(service, 'getPermittedItemProgress').mockResolvedValue({
      item: {
        id: 'item-1',
        type: TrackItemType.ARTICLE,
        content: { html: '<p>Say it back.</p>', ...content },
        completionCriteria: {},
      } as any,
      sourceItem: {} as any,
      progress: {
        id: 'progress-1',
        trackEnrollmentId: 'enr-1',
        status: SessionItemStatus.UNLOCKED,
        meta: { articleFirstOpenedAt: '2026-01-01T00:00:00.000Z' },
      } as any,
      enrollment: { id: 'enr-1' } as any,
      languageCode: null,
    });
    (service as any).trackEnrollmentRepository.update = jest.fn();
    return (await service.startItem('item-1')) as any;
  };

  it('defaults an older article to classic with no cover or takeaways', async () => {
    const result = await start({});
    expect(result.experience).toBe(ArticleExperience.CLASSIC);
    expect(result.cover).toBeNull();
    expect(result.takeaways).toEqual([]);
  });

  it('sends the authored experience, cover and takeaways', async () => {
    const cover = { url: 'https://cdn.example.com/a.jpg', alt: 'A room' };
    const result = await start({
      experience: ArticleExperience.CARDS,
      cover,
      takeaways: ['Name the feeling first.'],
    });
    expect(result.experience).toBe(ArticleExperience.CARDS);
    expect(result.cover).toEqual(cover);
    expect(result.takeaways).toEqual(['Name the feeling first.']);
  });
});
