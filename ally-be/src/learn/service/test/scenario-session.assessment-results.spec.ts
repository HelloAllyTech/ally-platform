import { ForbiddenException } from '@nestjs/common';
import { ScenarioSessionService } from '../scenario-session.service';

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

/**
 * An assessment roleplay whose trainer turned "Show results to learner" off:
 * the learner who played it gets no score and no report; anyone else viewing
 * the session (a trainer, a reviewer) still does.
 */
describe('ScenarioSessionService — withheld assessment results', () => {
  const LEARNER = 7;
  const TRAINER = 99;
  const scenarioSessionRepository = { findOne: jest.fn() };
  const dataSource = { query: jest.fn() };
  const service: ScenarioSessionService = Object.assign(
    Object.create(ScenarioSessionService.prototype),
    { scenarioSessionRepository, dataSource },
  );

  beforeEach(() => {
    jest.clearAllMocks();
    scenarioSessionRepository.findOne.mockResolvedValue({
      id: 'sess-1',
      counselorId: LEARNER,
      trackItemProgressId: 'tip-1',
    });
  });

  const criteria = (c: Record<string, unknown>) =>
    dataSource.query.mockResolvedValue([{ criteria: c }]);

  it('withholds from the learner when the item hides results', async () => {
    criteria({ assessmentMode: true, showResultsToLearner: false });
    await expect(
      service.isAssessmentResultHidden('sess-1', LEARNER),
    ).resolves.toBe(true);
    await expect(
      service.assertAssessmentResultVisible('sess-1', LEARNER),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('shows a trainer the same session', async () => {
    criteria({ assessmentMode: true, showResultsToLearner: false });
    await expect(
      service.isAssessmentResultHidden('sess-1', TRAINER),
    ).resolves.toBe(false);
    expect(dataSource.query).not.toHaveBeenCalled();
  });

  it('shows results by default and outside assessments', async () => {
    criteria({ assessmentMode: true });
    await expect(
      service.isAssessmentResultHidden('sess-1', LEARNER),
    ).resolves.toBe(false);
    criteria({ showResultsToLearner: false });
    await expect(
      service.isAssessmentResultHidden('sess-1', LEARNER),
    ).resolves.toBe(false);
  });

  it('never hides a session played outside a course', async () => {
    scenarioSessionRepository.findOne.mockResolvedValue({
      id: 'sess-2',
      counselorId: LEARNER,
      trackItemProgressId: null,
    });
    await expect(
      service.isAssessmentResultHidden('sess-2', LEARNER),
    ).resolves.toBe(false);
    expect(dataSource.query).not.toHaveBeenCalled();
  });
});
