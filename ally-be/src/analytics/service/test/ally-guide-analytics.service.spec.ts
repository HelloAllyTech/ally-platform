import { AllyGuideAnalyticsRepository } from '../../repository/ally-guide-analytics.repository';
import {
  ALLY_MIN_GROUP_SIZE,
  AllyGuideAnalyticsService,
  foldCourses,
  rateOf,
  weekGuard,
  weeksOf,
} from '../ally-guide-analytics.service';

describe('Ally guide analytics (AAQ-240..251)', () => {
  describe('minimum group size', () => {
    it('withholds a rate under 5 learners and keeps its counts', () => {
      expect(ALLY_MIN_GROUP_SIZE).toBe(5);
      expect(rateOf(3, 4, 4)).toEqual({
        rate: null,
        count: 3,
        of: 4,
        learners: 4,
        suppressed: true,
      });
      expect(rateOf(3, 4, 5)).toMatchObject({ rate: 0.75, suppressed: false });
      expect(rateOf(0, 0, 9).rate).toBeNull();
    });

    it('folds small courses into one unnamed row', () => {
      const rows = foldCourses([
        { trackId: 'a', title: 'Big', learners: 10, turns: 100, costUsd: 5 },
        {
          trackId: 'b',
          title: 'Small one',
          learners: 2,
          turns: 10,
          costUsd: 1,
        },
        { trackId: 'c', title: 'Small two', learners: 2, turns: 8, costUsd: 1 },
      ]);
      expect(rows).toEqual([
        expect.objectContaining({ trackId: 'a', costPerLearnerUsd: 0.5 }),
        expect.objectContaining({
          trackId: null,
          title: 'Other courses',
          learners: 4,
          folded: 2,
          costPerLearnerUsd: null,
        }),
      ]);
      expect(JSON.stringify(rows)).not.toContain('Small one');
    });
  });

  describe('the paired guard (AAQ-248)', () => {
    const week = (
      items: number | null,
      thumbs: number | null,
      quiz: number | null,
    ) => ({
      week: 'w',
      activeLearners: 20,
      itemsPerLearningDay: items,
      thumbsUpShare: thumbs,
      quizFirstAttemptPass: quiz,
    });
    it('flags engagement up with learning flat, and learning falling', () => {
      const prev = { ...week(2, 0.8, 0.7), guard: 'ok' as const };
      expect(weekGuard(prev, week(2.4, 0.8, 0.7))).toBe(
        'engagement_up_learning_flat',
      );
      expect(weekGuard(prev, week(2, 0.8, 0.6))).toBe('learning_fell');
      expect(weekGuard(prev, week(2.4, 0.8, 0.75))).toBe('ok');
      expect(weekGuard(null, week(2, 0.8, 0.7))).toBe('too_few');
      expect(weekGuard(prev, week(2, 0.8, null))).toBe('too_few');
    });
  });

  it('lists every Monday in the window', () => {
    expect(
      weeksOf(
        new Date('2026-10-01T00:00:00Z'),
        new Date('2026-10-20T00:00:00Z'),
      ),
    ).toEqual(['2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19']);
  });

  describe('weekly assembly', () => {
    const repo = {
      dataFloor: jest.fn(),
      activity: jest.fn(async () => [
        {
          week: '2026-10-12',
          learners: 8,
          voiceLearners: 2,
          learnerMessages: 90,
          learnerDays: 20,
        },
        {
          week: '2026-10-19',
          learners: 3,
          voiceLearners: 1,
          learnerMessages: 9,
          learnerDays: 4,
        },
      ]),
      firstWins: jest.fn(async () => [
        {
          week: '2026-10-12',
          newThreads: 10,
          learners: 8,
          winsInSession: 9,
          winsWithin5Min: 6,
        },
      ]),
      items: jest.fn(async () => [
        { week: '2026-10-12', items: 30, learners: 8 },
      ]),
      returns: jest.fn(async () => [
        { week: '2026-10-12', cohort: 8, returned: 4 },
      ]),
      appointments: jest.fn(async () => [
        { week: '2026-10-12', set: 6, due: 5, kept: 3, learners: 6 },
      ]),
      quizFirstAttempts: jest.fn(async () => [
        {
          week: '2026-10-12',
          ally: true,
          attempts: 10,
          learners: 7,
          rate: 0.7,
        },
        {
          week: '2026-10-12',
          ally: false,
          attempts: 4,
          learners: 4,
          rate: 0.5,
        },
      ]),
      roleplayScores: jest.fn(async () => []),
      health: jest.fn(async () => [
        {
          week: '2026-10-12',
          learners: 8,
          learnerTurns: 80,
          refusals: 2,
          offCourse: 8,
          careEntries: 1,
          costUsd: 4,
        },
      ]),
      crises: jest.fn(async () => [{ week: '2026-10-12', crisisEntries: 1 }]),
    };
    const service = new AllyGuideAnalyticsService(
      repo as unknown as AllyGuideAnalyticsRepository,
    );

    it('builds each chart’s series, scoped to the organisation asked for', async () => {
      const res = await service.weekly({
        from: '2026-10-12',
        to: '2026-10-25',
        tenantId: ' t1 ',
      } as never);
      expect(repo.activity).toHaveBeenCalledWith(
        expect.any(Date),
        expect.any(Date),
        't1',
      );
      expect(res.scoping).toEqual({ tenantId: 't1', unscopedSections: [] });
      const [w1, w2] = res.weeks;
      expect(w1).toMatchObject({
        week: '2026-10-12',
        activeLearners: 8,
        itemsPerLearningDay: 1.5,
        firstSessionWin: { rate: 0.9 },
        firstWinWithin5Min: { rate: 0.6 },
        sevenDayReturn: { rate: 0.5 },
        appointmentsSet: 6,
        appointmentsKept: { rate: 0.6 },
        voiceAdoption: { rate: 0.25 },
        quizFirstAttemptPass: { rate: 0.7 },
        careEntriesPer100: 12.5,
        crisisEntriesPer100: 12.5,
        offCourse: { rate: 0.1 },
        refusals: { rate: 0.025 },
      });
      // The reference line has 4 learners: withheld.
      expect(w1.quizFirstAttemptPassClassic).toMatchObject({
        rate: null,
        suppressed: true,
      });
      // A week with 3 learners shows counts, never rates.
      expect(w2.activeLearners).toBe(3);
      expect(w2.voiceAdoption).toMatchObject({ rate: null, suppressed: true });
      expect(w2.itemsPerLearningDay).toBeNull();
    });
  });

  describe('repository scoping', () => {
    it('excludes test organisations always, and scopes to one only when asked', async () => {
      const query = jest.fn(async () => []);
      const repo = new AllyGuideAnalyticsRepository({ query } as never);
      const s = new Date('2026-10-01');
      const e = new Date('2026-10-08');
      await repo.activity(s, e);
      await repo.quizFirstAttempts(s, e, 't1');
      const [sqlAll, paramsAll] = query.mock.calls[0] as unknown as [
        string,
        unknown[],
      ];
      const [sqlOne, paramsOne] = query.mock.calls[1] as unknown as [
        string,
        unknown[],
      ];
      expect(sqlAll).toContain('"isTestOrganization" = true');
      expect(sqlAll).not.toContain('$3');
      expect(paramsAll).toEqual([s, e]);
      expect(sqlOne).toContain('$3');
      expect(paramsOne).toEqual([s, e, 't1']);
    });
  });
});
