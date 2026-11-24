import { TenantBehaviourRepository } from '../tenant-behaviour.repository';

describe('TenantBehaviourRepository', () => {
  const query = jest.fn();
  const repo = new TenantBehaviourRepository({ query } as never);
  beforeEach(() => query.mockReset());

  const people = (n: number, first: string[], last: string[], from = 0) =>
    Array.from({ length: n }, (_, i) => [
      { uid: from + i, which: 'first', codes: first },
      { uid: from + i, which: 'last', codes: last },
    ]).flat();

  describe('helpful behaviours', () => {
    it('shows nothing under the floor of learners', async () => {
      query.mockResolvedValue(people(4, [], ['verbal.b1']));
      expect(await repo.getHelpfulBehaviours('t', 'code', {})).toEqual({
        learners: 4,
        rows: [],
      });
    });

    it('ranks helpful behaviours by how much more common they became', async () => {
      query.mockResolvedValue([
        ...people(3, [], ['verbal.b1']),
        ...people(2, ['verbal.b2'], ['verbal.b2'], 10),
      ]);
      const out = await repo.getHelpfulBehaviours('t', 'code', {});
      expect(out.learners).toBe(5);
      expect(out.rows[0]).toMatchObject({
        code: 'verbal.b1',
        beforePercent: 0,
        afterPercent: 60,
      });
      // Unhelpful codes are never offered here.
      expect(out.rows.every((r) => !r.code.includes('.u'))).toBe(true);
    });

    it('passes ids as parameters, in order, when a course is chosen', async () => {
      query.mockResolvedValue([]);
      await repo.getHelpfulBehaviours('t', 'code', { courseId: 'c-1' });
      const [sql, params] = query.mock.calls[0];
      expect(params.slice(0, 2)).toEqual(['t', 'code']);
      expect(params[3]).toBe('c-1');
      expect(sql).toContain('$4::uuid');
      expect(sql).not.toContain('c-1');
    });
  });

  describe('unhelpful responses over time', () => {
    it('gives a share per slice, and nothing for a single point', async () => {
      query.mockResolvedValueOnce([
        { idx: 1, assessments: '10', flagged: '5' },
        { idx: 2, assessments: '10', flagged: '2' },
      ]);
      expect(await repo.getUnhelpfulTrend('t', 'code', {})).toEqual({
        points: [
          { slice: 1, assessments: 10, sharePercent: 50 },
          { slice: 2, assessments: 10, sharePercent: 20 },
        ],
      });
      query.mockResolvedValueOnce([{ idx: 1, assessments: '3', flagged: '1' }]);
      expect(await repo.getUnhelpfulTrend('t', 'code', {})).toEqual({
        points: [],
      });
    });

    it('asks for several learners behind each point, except for one learner', async () => {
      query.mockResolvedValue([]);
      await repo.getUnhelpfulTrend('t', 'code', {});
      await repo.getUnhelpfulTrend('t', 'code', { learnerId: 9 });
      expect(query.mock.calls[0][0]).toContain('COUNT(DISTINCT uid) >= 3');
      expect(query.mock.calls[1][0]).not.toContain('HAVING');
      expect(query.mock.calls[1][1][3]).toBe(9);
    });
  });

  describe('score by attempt', () => {
    it('drops attempts few learners reached, and needs two steps to draw', async () => {
      query.mockResolvedValueOnce([
        { attempt: 1, learners: '8', avg_score: '61.4' },
        { attempt: 2, learners: '6', avg_score: '68.2' },
        { attempt: 3, learners: '2', avg_score: '70' },
      ]);
      expect(await repo.getScoreByAttempt('t', 'code')).toEqual({
        steps: [
          { attempt: 1, learners: 8, averageScore: 61 },
          { attempt: 2, learners: 6, averageScore: 68 },
        ],
      });
      query.mockResolvedValueOnce([
        { attempt: 1, learners: '8', avg_score: '61' },
      ]);
      expect(await repo.getScoreByAttempt('t', 'code')).toEqual({ steps: [] });
    });
  });
});
