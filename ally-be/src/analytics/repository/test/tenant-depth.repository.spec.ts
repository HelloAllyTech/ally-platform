import { TenantDepthRepository } from '../tenant-depth.repository';

describe('TenantDepthRepository', () => {
  const query = jest.fn();
  const repo = new TenantDepthRepository({ query } as never);
  beforeEach(() => query.mockReset());

  const section = (id: string, ord: number) => ({
    section_id: id,
    title: `Module ${id}`,
    ord,
  });

  describe('learners across modules', () => {
    it('gives each learner a cell per module, with minutes only for a finished one', async () => {
      query.mockResolvedValue([
        {
          uid: 1,
          name: 'Asha',
          last_at: '2026-11-20',
          ...section('a', 1),
          total: '2',
          done: '2',
          started: '2',
          minutes: '42.4',
        },
        {
          uid: 1,
          name: 'Asha',
          last_at: '2026-11-20',
          ...section('b', 2),
          total: '2',
          done: '1',
          started: '2',
          minutes: '10',
        },
        {
          uid: 2,
          name: 'Ravi',
          last_at: '2026-11-25',
          ...section('a', 1),
          total: '2',
          done: '0',
          started: '0',
          minutes: null,
        },
      ]);
      const out = await repo.getLearnersAcrossModules('t', 'code', 'c1');
      expect(out.modules.map((m) => m.sectionId)).toEqual(['a', 'b']);
      // Most recently active first; a module the learner has no row for is not started.
      expect(out.learners.map((l) => l.name)).toEqual(['Ravi', 'Asha']);
      expect(out.learners[1].cells).toEqual([
        { status: 'completed', minutes: 42 },
        { status: 'inProgress', minutes: null },
      ]);
      expect(out.learners[0].cells[1]).toEqual({
        status: 'notStarted',
        minutes: null,
      });
      expect(query.mock.calls[0][1]).toEqual(['t', 'code', 'c1']);
    });

    it('keeps the most recently active learners and says when there are more', async () => {
      query.mockResolvedValue(
        Array.from({ length: 30 }, (_, i) => ({
          uid: i,
          name: `L${i}`,
          last_at: new Date(2026, 10, 1 + (i % 28)).toISOString(),
          ...section('a', 1),
          total: '1',
          done: '1',
          started: '1',
          minutes: '5',
        })),
      );
      const out = await repo.getLearnersAcrossModules('t', 'code', 'c1');
      expect(out.learners).toHaveLength(25);
      expect(out.truncated).toBe(true);
    });
  });

  describe('module difficulty', () => {
    it('ranks easy to hard with untagged last, and sums each level', async () => {
      query.mockResolvedValue([
        {
          section_id: 'h',
          title: 'Hard one',
          diff: 3,
          reached: '4',
          completed: '1',
          attempts: '2.26',
          median_minutes: '60',
          avg_score: '55.4',
        },
        {
          section_id: 'u',
          title: 'Untagged',
          diff: null,
          reached: '5',
          completed: '5',
          attempts: null,
          median_minutes: null,
          avg_score: null,
        },
        {
          section_id: 'e',
          title: 'Easy one',
          diff: 1,
          reached: '6',
          completed: '6',
          attempts: '1',
          median_minutes: '20',
          avg_score: '81',
        },
      ]);
      const out = await repo.getModuleDifficulty('t', 'code', 'c1');
      expect(out.modules.map((m) => m.sectionId)).toEqual(['e', 'h', 'u']);
      expect(out.modules[1]).toMatchObject({
        difficulty: 'hard',
        completionPercent: 25,
        averageScore: 55,
        averageAttempts: 2.3,
      });
      expect(out.modules[2].difficulty).toBeNull();
      expect(out.levels.map((l) => l.difficulty)).toEqual(['easy', 'hard']);
      expect(out.levels[0]).toMatchObject({
        completionPercent: 100,
        medianMinutes: 20,
      });
    });
  });

  describe('roleplays', () => {
    it('writes abandonment from sessions left unfinished', async () => {
      query.mockResolvedValue([
        {
          item_id: 'i1',
          title: 'Grief',
          sessions: '10',
          completed: '7',
          avg_score: '71.6',
          avg_rating: '4.25',
          ratings: '4',
        },
        {
          item_id: 'i2',
          title: 'New',
          sessions: '0',
          completed: '0',
          avg_score: null,
          avg_rating: null,
          ratings: '0',
        },
      ]);
      const out = await repo.getRoleplayTable('t', 'code', 'c1');
      expect(out.rows[0]).toMatchObject({
        abandonmentPercent: 30,
        averageScore: 72,
        averageRating: 4.3,
      });
      expect(out.rows[1]).toMatchObject({
        abandonmentPercent: null,
        averageScore: null,
      });
    });

    it('draws a spread only from a floor of sessions, in the query', async () => {
      query.mockResolvedValue([
        {
          item_id: 'i1',
          title: 'Grief',
          sessions: '9',
          low: '41.2',
          typical: '70.4',
          high: '88.9',
        },
      ]);
      const out = await repo.getScoreSpread('t', 'code', 'c1');
      expect(query.mock.calls[0][0]).toContain('HAVING COUNT(*) >= 5');
      expect(out.rows[0]).toMatchObject({ low: 41, typical: 70, high: 89 });
    });
  });

  describe('learner change', () => {
    const row = (uid: number, first: number, last: number) => ({
      uid,
      name: `L${uid}`,
      first_score: first,
      last_score: last,
    });

    it('tags each learner by how far the score moved, and counts them', async () => {
      query.mockResolvedValue([row(1, 50, 70), row(2, 60, 62), row(3, 80, 60)]);
      const out = await repo.getLearnerChange('t', 'code');
      expect(out.counts).toEqual({ improving: 1, steady: 1, declining: 1 });
      expect(out.rows.map((r) => r.trend)).toEqual([
        'improving',
        'steady',
        'declining',
      ]);
    });

    it('shows the two ends of a long list, and filters by course through a parameter', async () => {
      query.mockResolvedValue(
        Array.from({ length: 40 }, (_, i) => row(i, 50, 90 - i)),
      );
      const out = await repo.getLearnerChange('t', 'code', 'c1');
      expect(out.rows).toHaveLength(24);
      expect(query.mock.calls[0][1]).toEqual(['t', 'code', 'c1']);
      expect(query.mock.calls[0][0]).toContain('$3::uuid');
    });

    it('uses no course parameter for the whole organisation', async () => {
      query.mockResolvedValue([]);
      await repo.getLearnerChange('t', 'code');
      expect(query.mock.calls[0][1]).toEqual(['t', 'code']);
    });
  });

  describe('skill grids', () => {
    it('builds a grid and keeps the courses with the most skills measured', async () => {
      query.mockResolvedValue([
        {
          row_id: 'c1',
          title: 'Course 1',
          skill: 'verbal',
          level: '2.54',
          learners: '4',
        },
        {
          row_id: 'c1',
          title: 'Course 1',
          skill: 'empathy',
          level: '3',
          learners: '4',
        },
        {
          row_id: 'c2',
          title: 'Course 2',
          skill: 'verbal',
          level: '1.5',
          learners: '3',
        },
      ]);
      const out = await repo.getSkillsByCourse('t', 'code');
      expect(out.rows.map((r) => r.id)).toEqual(['c1', 'c2']);
      expect(out.skills).toEqual(['empathy', 'verbal']);
      expect(
        out.cells.find((c) => c.rowId === 'c1' && c.skill === 'verbal')?.level,
      ).toBe(2.5);
      expect(query.mock.calls[0][0]).toContain(
        'HAVING COUNT(DISTINCT cc.uid) >= 3',
      );
    });
  });

  describe('behaviours against the group', () => {
    it('says nothing for a learner with too few scored practices', async () => {
      query.mockResolvedValue([
        {
          code: 'verbal.b1',
          group_with: '5',
          learner_with: '1',
          group_cuts: '20',
          learner_cuts: '2',
        },
      ]);
      expect(
        (await repo.getBehavioursAgainstGroup('t', 'code', 7)).rows,
      ).toEqual([]);
    });

    it('puts what the group does and this learner does not first', async () => {
      query.mockResolvedValue([
        {
          code: 'verbal.b1',
          group_with: '10',
          learner_with: '4',
          group_cuts: '20',
          learner_cuts: '5',
        },
        {
          code: 'verbal.b2',
          group_with: '10',
          learner_with: '0',
          group_cuts: '20',
          learner_cuts: '5',
        },
        {
          code: 'verbal.u1',
          group_with: '10',
          learner_with: '0',
          group_cuts: '20',
          learner_cuts: '5',
        },
      ]);
      const out = await repo.getBehavioursAgainstGroup('t', 'code', 7);
      expect(out.rows.map((r) => r.code)).toEqual(['verbal.b2', 'verbal.b1']);
      expect(out.rows[0]).toMatchObject({
        learnerPercent: 0,
        groupPercent: 50,
      });
      expect(query.mock.calls[0][1]).toContain(7);
    });
  });

  describe('sessions waiting', () => {
    it('lists the oldest first with how long they have waited, for one learner by parameter', async () => {
      query.mockResolvedValueOnce([
        {
          session_id: 's1',
          title: 'Grief',
          name: 'Asha',
          completed_at: new Date(Date.now() - 5 * 86_400_000),
        },
      ]);
      query.mockResolvedValueOnce([{ n: '12' }]);
      const out = await repo.getSessionsWaiting('t', 'code', 4);
      expect(out.total).toBe(12);
      expect(out.rows[0]).toMatchObject({
        scenarioTitle: 'Grief',
        daysWaiting: 5,
      });
      expect(query.mock.calls[0][1]).toEqual(['t', 'code', 4]);
      expect(query.mock.calls[0][0]).toContain(
        'ORDER BY COALESCE(ss."endedAt", ss."createdAt") ASC',
      );
    });
  });

  describe('cohorts and measures', () => {
    it('lists cohorts oldest first with the share that finished', async () => {
      query.mockResolvedValue([
        { start: '2026-10-01', size: '4', completed: '1', avg_score: '70.2' },
        { start: '2026-09-01', size: '3', completed: '3', avg_score: null },
      ]);
      const out = await repo.getCohorts('t', 'code', 'c1');
      expect(out.rows.map((r) => r.start)).toEqual([
        '2026-09-01',
        '2026-10-01',
      ]);
      expect(out.rows[1]).toMatchObject({
        completedPercent: 25,
        averageScore: 70,
      });
    });

    it('writes review turnaround as measures, and nothing for an organisation with none reviewed', async () => {
      query.mockResolvedValue([
        { completed: '10', reviewed: '0', median_days: null, within_two: '0' },
      ]);
      const out = await repo.getReviewTurnaround('t', 'code', new Date());
      expect(out.measures.find((m) => m.key === 'pending')?.value).toBe(10);
      expect(
        out.measures.find((m) => m.key === 'turnaroundDays')?.value,
      ).toBeNull();
      expect(
        out.measures.find((m) => m.key === 'withinTwoDays')?.value,
      ).toBeNull();
    });

    it('writes a learner profile with dates as text', async () => {
      query.mockResolvedValue([
        {
          joined: '2026-07-20T10:00:00Z',
          assigned: '3',
          finished: '1',
          cohorts: '1',
          last_active: null,
        },
      ]);
      const out = await repo.getLearnerProfile('t', 'code', 4);
      expect(out.measures[0]).toMatchObject({
        key: 'joined',
        format: 'date',
        text: '2026-07-20',
      });
      expect(out.measures.find((m) => m.key === 'lastPracticed')).toMatchObject(
        { text: null },
      );
    });

    it('says how many scored conversations a clinician has checked', async () => {
      query.mockResolvedValue([{ scored: '9', checked: '0' }]);
      const out = await repo.getScoreTrust('t', 'code');
      expect(out.measures.map((m) => m.value)).toEqual([9, 0, 0]);
    });
  });
});
