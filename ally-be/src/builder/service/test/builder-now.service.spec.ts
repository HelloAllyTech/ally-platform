import {
  BUILDER_STUCK_AFTER_MS,
  nowLineFor,
  waitingOnFor,
} from '../builder-now.service';
import {
  BuilderRunStatus,
  BuilderSessionStatus,
  BuilderStage,
} from '../../enum/builder.enum';

/**
 * The Now page groups every session by what it waits on and labels each row
 * with Builder's stage. Both are pure, so the page's whole structure is pinned
 * here rather than by a screenshot.
 */
describe('BuilderNowService helpers', () => {
  const now = new Date('2026-10-29T12:00:00Z');
  const base = {
    status: BuilderSessionStatus.BUILDING,
    pendingCount: 0,
    hasActiveRun: true,
    turnRunning: false,
    openPullRequests: 0,
    updatedAt: now,
    now,
  };

  describe('waitingOnFor', () => {
    it('is you whenever a decision is pending, whatever else is true', () => {
      expect(
        waitingOnFor({
          ...base,
          pendingCount: 1,
          status: BuilderSessionStatus.FAILED,
        }),
      ).toBe('you');
    });

    it('is builder while a run is active', () => {
      expect(waitingOnFor(base)).toBe('builder');
    });

    it('is stuck when a build has not moved past the threshold with nothing running', () => {
      const old = new Date(now.getTime() - BUILDER_STUCK_AFTER_MS - 1000);
      expect(
        waitingOnFor({ ...base, hasActiveRun: false, updatedAt: old }),
      ).toBe('stuck');
      expect(
        waitingOnFor({
          ...base,
          hasActiveRun: false,
          updatedAt: new Date(now.getTime() - 60_000),
        }),
      ).toBe('builder');
    });

    it('is stuck for a failed session with nothing pending', () => {
      expect(
        waitingOnFor({ ...base, status: BuilderSessionStatus.FAILED }),
      ).toBe('stuck');
    });

    it('is review for a finished session with pull requests open', () => {
      expect(
        waitingOnFor({
          ...base,
          status: BuilderSessionStatus.COMPLETED,
          openPullRequests: 2,
        }),
      ).toBe('review');
    });

    it('never calls an interview stuck', () => {
      expect(
        waitingOnFor({
          ...base,
          status: BuilderSessionStatus.INTERVIEWING,
          hasActiveRun: false,
          updatedAt: new Date(0),
        }),
      ).toBe('builder');
    });
  });

  describe('nowLineFor', () => {
    const line = (over: Record<string, any>) =>
      nowLineFor({
        status: BuilderSessionStatus.BUILDING,
        currentStage: null,
        turnRunning: false,
        run: null,
        openPullRequests: [],
        pendingCount: 0,
        error: null,
        ...over,
      });

    it('says the stage in words, with the run', () => {
      expect(
        line({
          currentStage: BuilderStage.TESTING,
          run: { status: BuilderRunStatus.RUNNING, sequence: 3 },
        }),
      ).toBe('Writing tests · run #3');
    });

    it('says a queued run is waiting for a runner', () => {
      expect(
        line({ run: { status: BuilderRunStatus.QUEUED, sequence: 4 } }),
      ).toBe('Run #4 · waiting for a runner');
    });

    it('tells a thinking interview from one waiting on you', () => {
      expect(
        line({ status: BuilderSessionStatus.INTERVIEWING, turnRunning: true }),
      ).toBe('Interview · thinking');
      expect(
        line({ status: BuilderSessionStatus.INTERVIEWING, pendingCount: 1 }),
      ).toBe('Interview · waiting on your answer');
    });

    it('names the one open pull request and its CI', () => {
      expect(
        line({
          status: BuilderSessionStatus.COMPLETED,
          openPullRequests: [{ prNumber: 58, ciStatus: 'running' }],
        }),
      ).toBe('#58 open · CI running');
    });

    it('carries a stopped session’s reason, clipped', () => {
      expect(
        line({
          status: BuilderSessionStatus.FAILED,
          error: 'Run #3 failed:\n 2 tests still fail',
        }),
      ).toBe('Stopped: Run #3 failed: 2 tests still fail');
    });
  });
});
