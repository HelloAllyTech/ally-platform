import { TrackItemType } from 'src/track/type/track.type';
import { CourseCopilotJobExecutorService } from '../course-copilot-job-executor.service';

/**
 * What the post-build reviewer reads about each roleplay. The reviewer could not see trigger
 * warnings, and asked trainers to regenerate 11 local roleplays that already carried them.
 */
describe('CourseCopilotJobExecutorService — roleplays for review', () => {
  const track = {
    sections: [
      {
        items: [
          { type: TrackItemType.ROLEPLAY, scenarioId: 7 },
          { type: TrackItemType.ROLEPLAY, scenarioId: 8 },
          { type: TrackItemType.ARTICLE },
        ],
      },
    ],
  } as any;

  const executorWith = (library: Record<string, jest.Mock>) => {
    const service = Object.create(
      CourseCopilotJobExecutorService.prototype,
    ) as any;
    service.library = library;
    service.logger = { warn: jest.fn() };
    return service;
  };

  const scenarios = [
    { id: 7, title: 'Caller in crisis', description: 'd', metadata: {} },
    { id: 8, title: 'Quiet student', description: 'd', metadata: {} },
  ];

  it('tells the reviewer which trigger warnings each roleplay shows', async () => {
    const service = executorWith({
      getActiveScenarios: jest.fn().mockResolvedValue(scenarios),
      triggerWarningNamesFor: jest
        .fn()
        .mockResolvedValue(new Map([[7, ['Self-harm', 'Suicide']]])),
    });
    const digest: Map<number, string> = await service.roleplaysForReview(track);
    expect(digest.get(7)).toContain(
      'trigger warnings shown before it starts: Self-harm, Suicide',
    );
    expect(digest.get(8)).toContain(
      'trigger warnings shown before it starts: none',
    );
  });

  it('still describes the roleplays when the warnings cannot be read', async () => {
    const service = executorWith({
      getActiveScenarios: jest.fn().mockResolvedValue(scenarios),
      triggerWarningNamesFor: jest.fn().mockRejectedValue(new Error('db')),
    });
    const digest: Map<number, string> = await service.roleplaysForReview(track);
    expect(digest.size).toBe(2);
    expect(digest.get(7)).toContain('roleplay #7 "Caller in crisis"');
  });

  it('shows a whole 617-character description, and labels a longer one as an excerpt', () => {
    const service = executorWith({});
    const complete = 'a'.repeat(616) + '.';
    const digest: string = service.courseDigest({
      title: 'T',
      description: complete,
      sections: [],
    });
    expect(digest).toContain(`DESCRIPTION: ${complete}`);
    expect(digest).not.toContain('…');

    const long: string = service.courseDigest({
      title: 'T',
      description: 'b'.repeat(2_500),
      sections: [],
    });
    expect(long).toContain(
      '[digest excerpt — the description continues; not a defect]',
    );
  });

  it('labels a long roleplay challenge as an excerpt rather than cutting it with an ellipsis', async () => {
    const service = executorWith({
      getActiveScenarios: jest
        .fn()
        .mockResolvedValue([
          { id: 7, title: 'C', description: 'x'.repeat(1_500), metadata: {} },
        ]),
      triggerWarningNamesFor: jest.fn().mockResolvedValue(new Map()),
    });
    const digest: Map<number, string> = await service.roleplaysForReview({
      sections: [{ items: [{ type: TrackItemType.ROLEPLAY, scenarioId: 7 }] }],
    });
    expect(digest.get(7)).toContain(
      '[digest excerpt — the challenge continues; not a defect]',
    );
  });
});
