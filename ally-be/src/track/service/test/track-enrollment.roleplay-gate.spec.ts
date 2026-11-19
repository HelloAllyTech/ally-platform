import { SessionItemStatus } from 'src/common/type/common.type';
import { TrackEnrollmentService } from '../track-enrollment.service';
import {
  RoleplayAttemptFailureReason,
  TrackItemCompletionCriteria,
  TrackItemCompletionLogic,
  TrackItemType,
} from '../../type/track.type';
import { resolveRoleplayGate } from '../../util/roleplay-gate.util';

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

const { INSUFFICIENT_SCORE, INSUFFICIENT_DURATION } =
  RoleplayAttemptFailureReason;

/**
 * The roleplay start payload: the resolved rule, and the learner's last missed
 * attempt re-checked against the rule as it is now — a trainer may have
 * changed it on the live course since that attempt.
 */
describe('TrackEnrollmentService — roleplay requirement and last attempt', () => {
  const service = new TrackEnrollmentService(
    {} as any, // dataSource
    {} as any, // trackRepository
    {} as any, // trackTenantRepository
    { update: jest.fn() } as any, // trackEnrollmentRepository
    { update: jest.fn() } as any, // trackItemProgressRepository
    {} as any, // trackJournalEntryRepository
    {} as any, // trackQuizAttemptRepository
    {} as any, // trackAnnotationAttemptRepository
    {} as any, // trackSharedService
    {
      // The real resolver, with a 180s platform default.
      getRoleplayGate: (criteria: TrackItemCompletionCriteria) =>
        resolveRoleplayGate(criteria, 180),
      findPairedPreAssessment: jest.fn().mockResolvedValue(null),
    } as any, // trackProgressService
    {} as any, // caseSessionService
    {
      getLatestScenarioSessionIdByTrackItemProgressId: jest
        .fn()
        .mockResolvedValue(null),
    } as any, // scenarioSharedService
    { hasScenarioTranslation: jest.fn().mockResolvedValue(true) } as any, // trackLocalizationService
    {} as any, // cohortVisibilityService
  );

  // 75s at score 40, against the 90s / 60 rule that applied then.
  const storedAttempt = {
    failureReasons: [INSUFFICIENT_DURATION, INSUFFICIENT_SCORE],
    score: 40,
    durationSeconds: 75,
    requiredScore: 60,
    requiredDurationSeconds: 90,
    endedAt: '2026-11-17T10:00:00.000Z',
  };

  const start = async (
    completionCriteria: TrackItemCompletionCriteria,
    status = SessionItemStatus.UNLOCKED,
  ) => {
    jest.spyOn(service, 'getPermittedItemProgress').mockResolvedValue({
      item: {
        id: 'item-1',
        type: TrackItemType.ROLEPLAY,
        scenarioId: 7,
        completionCriteria,
      } as any,
      sourceItem: {} as any,
      progress: {
        id: 'progress-1',
        trackEnrollmentId: 'enr-1',
        status,
        startedAt: new Date(),
        meta: { lastRoleplayAttempt: storedAttempt },
      } as any,
      enrollment: { id: 'enr-1' } as any,
      languageCode: null,
    });
    return (await service.startItem('item-1')) as any;
  };

  it('sends the resolved rule, platform default included', async () => {
    const result = await start({
      completionLogic: TrackItemCompletionLogic.SCORE_AND_DURATION,
      minScore: 60,
    });
    expect(result.roleplayGate).toEqual({
      roleplayType: 'PRACTICE',
      minLearnerTurns: null,
      completionLogic: TrackItemCompletionLogic.SCORE_AND_DURATION,
      minScore: 60,
      minDurationSeconds: 180,
    });
  });

  it('reports both missed gates while the rule is unchanged', async () => {
    const result = await start({
      completionLogic: TrackItemCompletionLogic.SCORE_AND_DURATION,
      minScore: 60,
      minDurationSeconds: 90,
    });
    expect(result.lastRoleplayAttempt).toEqual(storedAttempt);
  });

  it('drops a gate the trainer has since removed', async () => {
    const result = await start({
      completionLogic: TrackItemCompletionLogic.SCORE,
      minScore: 60,
      minDurationSeconds: 90,
    });
    expect(result.lastRoleplayAttempt).toMatchObject({
      failureReasons: [INSUFFICIENT_SCORE],
      requiredScore: 60,
      requiredDurationSeconds: null,
    });
  });

  it('quotes the bar as it is now, not as it was', async () => {
    const result = await start({
      completionLogic: TrackItemCompletionLogic.DURATION,
      minDurationSeconds: 120,
    });
    expect(result.lastRoleplayAttempt).toMatchObject({
      failureReasons: [INSUFFICIENT_DURATION],
      durationSeconds: 75,
      requiredDurationSeconds: 120,
    });
  });

  it('reports nothing once the rule no longer fails the attempt', async () => {
    expect(
      (
        await start({
          completionLogic: TrackItemCompletionLogic.PARTICIPATION,
        })
      ).lastRoleplayAttempt,
    ).toBeNull();
    expect(
      (
        await start({
          completionLogic: TrackItemCompletionLogic.DURATION,
          minDurationSeconds: 60,
        })
      ).lastRoleplayAttempt,
    ).toBeNull();
  });

  it('reports nothing on a completed item', async () => {
    const result = await start(
      { completionLogic: TrackItemCompletionLogic.SCORE, minScore: 60 },
      SessionItemStatus.COMPLETED,
    );
    expect(result.lastRoleplayAttempt).toBeNull();
  });

  describe('assessment items', () => {
    const KEY = '6f1d0b0e-8f0a-4c3b-9a55-0d6c2f0e9a11';

    it('describes the assessment and keeps a short attempt as judged', async () => {
      const shortAttempt = {
        failureReasons: [RoleplayAttemptFailureReason.INSUFFICIENT_TURNS],
        score: 70,
        durationSeconds: 40,
        requiredScore: null,
        requiredDurationSeconds: null,
        learnerTurns: 3,
        requiredTurns: 10,
        endedAt: '2026-11-19T10:00:00.000Z',
      };
      jest.spyOn(service, 'getPermittedItemProgress').mockResolvedValue({
        item: {
          id: 'item-1',
          type: TrackItemType.ROLEPLAY,
          scenarioId: 7,
          completionCriteria: {
            assessmentMode: true,
            minLearnerTurns: 10,
            assessmentPhase: 'PRE',
            assessmentPairKey: KEY,
          },
        } as any,
        sourceItem: {} as any,
        progress: {
          id: 'progress-1',
          trackEnrollmentId: 'enr-1',
          status: SessionItemStatus.UNLOCKED,
          startedAt: new Date(),
          meta: {
            lastRoleplayAttempt: shortAttempt,
            assessmentIncompleteStarts: 1,
          },
        } as any,
        enrollment: {} as any,
        languageCode: null,
      });

      const result: any = await service.startItem('item-1');

      expect(result.lastRoleplayAttempt).toEqual(shortAttempt);
      expect(result.assessment).toEqual({
        phase: 'PRE',
        requiredTurns: 10,
        showResults: true,
        resultsHidden: false,
        preAssessment: null,
        incompleteStarts: 1,
        submission: null,
      });
    });

    it('withholds the score and the report link when results are hidden', async () => {
      jest.spyOn(service, 'getPermittedItemProgress').mockResolvedValue({
        item: {
          id: 'item-1',
          type: TrackItemType.ROLEPLAY,
          scenarioId: 7,
          completionCriteria: {
            assessmentMode: true,
            minLearnerTurns: 6,
            showResultsToLearner: false,
          },
        } as any,
        sourceItem: {} as any,
        progress: {
          id: 'progress-1',
          trackEnrollmentId: 'enr-1',
          status: SessionItemStatus.COMPLETED,
          startedAt: new Date(),
          score: 88,
          meta: {
            assessmentSubmittedAt: '2026-11-19T10:00:00.000Z',
            assessmentSubmission: {
              scenarioSessionId: 'sess-1',
              learnerTurns: 9,
              requiredTurns: 6,
              score: 88,
              requiredScore: null,
              submittedAt: '2026-11-19T10:00:00.000Z',
            },
          },
        } as any,
        enrollment: {} as any,
        languageCode: null,
      });

      const result: any = await service.startItem('item-1');

      expect(result.lastScenarioSessionId).toBeNull();
      expect(result.assessment.resultsHidden).toBe(true);
      expect(result.assessment.submission).toEqual({
        learnerTurns: 9,
        submittedAt: '2026-11-19T10:00:00.000Z',
        score: null,
      });
    });
  });
});
