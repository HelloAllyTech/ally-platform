import { TENANT_CHART_LIBRARY } from '../tenant-chart-library.constants';
import {
  INSIGHT_RULES,
  INSIGHT_THRESHOLDS,
} from '../tenant-insight-rules.constants';
import { STATISTICS_VIEWS } from '../tenant-statistics-views.constants';

const rule = (id: string) => {
  const found = INSIGHT_RULES.find((r) => r.id === id);
  if (!found) throw new Error(`no rule ${id}`);
  return found;
};

const status = (over: Partial<Record<string, number>> = {}, total = 40) => ({
  total,
  counts: { active: 20, at_risk: 5, dormant: 5, never_started: 5, ...over },
});

describe('INSIGHT_RULES', () => {
  it('has a unique id for every rule', () => {
    const ids = INSIGHT_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(INSIGHT_RULES.map((r) => [r.id, r] as const))(
    '%s reads a live chart and links to a chart on the tab it names',
    (_id, r) => {
      expect(TENANT_CHART_LIBRARY.find((c) => c.id === r.chartId)?.live).toBe(
        true,
      );
    },
  );

  it('links every finding to a chart that the named tab lists', () => {
    // Fire each rule on data that makes it find something, and check where it points.
    const firing: Record<string, unknown> = {
      'learners.dormant': status({ dormant: 12 }),
      'learners.neverStarted': status({ never_started: 12 }),
      'courses.stalled': { rows: [{ id: 'c1', title: 'A', count: 9 }] },
      'courses.notStarted': { rows: [{ id: 'c1', title: 'A', count: 9 }] },
      'reviews.backlog': { completedSessions: 50, reviewedSessions: 5 },
      'skills.weakest': {
        rows: [{ skill: 'harm', first: 2, latest: 1.8, learners: 9 }],
      },
      'ratings.low': { count: 30, average: 2.6 },
      'usage.high': {
        activeUsers: [1, 2, 3, 4, 5, 9].map((count, i) => ({
          bucket: `w${i}`,
          count,
        })),
      },
      'learners.improving': { improving: 8, total: 10 },
    };
    expect(Object.keys(firing).sort()).toEqual(
      INSIGHT_RULES.map((r) => r.id).sort(),
    );
    INSIGHT_RULES.forEach((r) => {
      const draft = r.evaluate(firing[r.id]);
      expect({ id: r.id, found: draft !== null }).toEqual({
        id: r.id,
        found: true,
      });
      const { view, chartId } = draft!.evidence;
      const listed = STATISTICS_VIEWS.find(
        (v) => v.id === view,
      )!.sections.flatMap((s) => s.charts);
      expect({ id: r.id, listed: listed.includes(chartId) }).toEqual({
        id: r.id,
        listed: true,
      });
      expect(draft!.severity).toBeGreaterThanOrEqual(0);
      expect(draft!.severity).toBeLessThanOrEqual(1);
    });
  });

  describe('learners.dormant and learners.neverStarted', () => {
    it('say nothing below the minimum, or when they are a sliver of a large organisation', () => {
      expect(
        rule('learners.dormant').evaluate(status({ dormant: 2 })),
      ).toBeNull();
      expect(
        rule('learners.dormant').evaluate(status({ dormant: 5 }, 500)),
      ).toBeNull();
      expect(
        rule('learners.neverStarted').evaluate(status({ never_started: 2 })),
      ).toBeNull();
    });

    it('report the count and the total, and rank a bigger share higher', () => {
      const small = rule('learners.dormant').evaluate(status({ dormant: 6 }));
      const large = rule('learners.dormant').evaluate(status({ dormant: 20 }));
      expect(small?.params).toEqual({ count: 6, total: 40 });
      expect(large!.severity).toBeGreaterThan(small!.severity);
    });

    it('say nothing for an organisation with no learners', () => {
      expect(rule('learners.dormant').evaluate(status({}, 0))).toBeNull();
    });
  });

  describe('courses.stalled and courses.notStarted', () => {
    const rows = (count: number) => ({
      rows: [{ id: 'course-1', title: 'Basics', count }],
    });

    it('name the course, and point at it', () => {
      const draft = rule('courses.stalled').evaluate(rows(7));
      expect(draft?.params).toEqual({ title: 'Basics', count: 7 });
      expect(draft?.evidence.filters).toEqual({ course: 'course-1' });
      expect(draft?.subjectKey).toBe('course-1');
    });

    it('say nothing for a few learners, or no course', () => {
      expect(
        rule('courses.stalled').evaluate(
          rows(INSIGHT_THRESHOLDS.courseLearnersMin - 1),
        ),
      ).toBeNull();
      expect(rule('courses.stalled').evaluate({ rows: [] })).toBeNull();
      expect(rule('courses.notStarted').evaluate({ rows: [] })).toBeNull();
    });
  });

  describe('reviews.backlog', () => {
    it('fires when under half of completed sessions are reviewed', () => {
      expect(
        rule('reviews.backlog').evaluate({
          completedSessions: 40,
          reviewedSessions: 10,
        })?.params,
      ).toEqual({ percent: 25, reviewed: 10, completed: 40 });
    });

    it('says nothing when most are reviewed, or there are too few sessions', () => {
      expect(
        rule('reviews.backlog').evaluate({
          completedSessions: 40,
          reviewedSessions: 30,
        }),
      ).toBeNull();
      expect(
        rule('reviews.backlog').evaluate({
          completedSessions: 5,
          reviewedSessions: 0,
        }),
      ).toBeNull();
    });
  });

  describe('skills.weakest', () => {
    const rows = (latest: number, learners: number) => ({
      rows: [{ skill: 'harm', first: 1.5, latest, learners }],
    });

    it('names the weakest skill when it is low', () => {
      expect(rule('skills.weakest').evaluate(rows(2.1, 8))?.params).toEqual({
        skill: 'harm',
        level: 2.1,
      });
    });

    it('says nothing for a skill that is fine, or one few learners reached', () => {
      expect(rule('skills.weakest').evaluate(rows(3.4, 8))).toBeNull();
      expect(rule('skills.weakest').evaluate(rows(1.5, 2))).toBeNull();
    });

    it('skips a thin skill to find the weakest with enough learners', () => {
      const data = {
        rows: [
          { skill: 'thin', first: 1, latest: 1, learners: 1 },
          { skill: 'harm', first: 2, latest: 2.2, learners: 9 },
        ],
      };
      expect(rule('skills.weakest').evaluate(data)?.params.skill).toBe('harm');
    });
  });

  describe('ratings.low', () => {
    it('fires for a low average over enough ratings only', () => {
      expect(
        rule('ratings.low').evaluate({ count: 20, average: 3 })?.params,
      ).toEqual({ average: 3, count: 20 });
      expect(
        rule('ratings.low').evaluate({ count: 20, average: 4.4 }),
      ).toBeNull();
      expect(rule('ratings.low').evaluate({ count: 3, average: 1 })).toBeNull();
      expect(
        rule('ratings.low').evaluate({ count: 0, average: null }),
      ).toBeNull();
    });
  });

  describe('usage.high', () => {
    const series = (...counts: number[]) => ({
      activeUsers: counts.map((count, i) => ({ bucket: `w${i}`, count })),
    });

    it('celebrates a week higher than every week before it', () => {
      expect(
        rule('usage.high').evaluate(series(3, 4, 5, 4, 6, 9))?.params,
      ).toEqual({ count: 9, weeks: 6 });
    });

    it('says nothing if an earlier week was as high, the series is short, or few were active', () => {
      expect(rule('usage.high').evaluate(series(3, 9, 5, 4, 6, 9))).toBeNull();
      expect(rule('usage.high').evaluate(series(1, 2, 9))).toBeNull();
      expect(rule('usage.high').evaluate(series(0, 0, 0, 0, 0, 2))).toBeNull();
    });
  });

  describe('learners.improving', () => {
    it('celebrates when at least half of the learners with a trend are improving', () => {
      expect(
        rule('learners.improving').evaluate({ improving: 6, total: 10 })
          ?.params,
      ).toEqual({ improving: 6, total: 10 });
      expect(
        rule('learners.improving').evaluate({ improving: 2, total: 10 }),
      ).toBeNull();
      expect(
        rule('learners.improving').evaluate({ improving: 4, total: 4 }),
      ).toBeNull();
    });
  });
});
