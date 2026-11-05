import {
  PARENT_COURSE_CODE,
  PARENT_COURSE_OPPORTUNITIES,
  descriptionOf,
} from './1980940000000-SeedParentCourseRoadmapOpportunities';

const GOALS = [
  'Roleplay Actor Realism',
  'Coaching Effectiveness',
  'Roleplay Actor Build Time',
  'Engagement & Usability',
  'Reliability & Trust',
  'Foundation & Experiments',
  'Scribe',
];

describe('PARENT_COURSE roadmap seed', () => {
  it('has 23 opportunities with unique refs and descriptions', () => {
    expect(PARENT_COURSE_OPPORTUNITIES).toHaveLength(23);
    const refs = PARENT_COURSE_OPPORTUNITIES.map((o) => o.ref);
    expect(new Set(refs).size).toBe(refs.length);
    const descriptions = PARENT_COURSE_OPPORTUNITIES.map(descriptionOf);
    expect(new Set(descriptions).size).toBe(descriptions.length);
  });

  it.each(PARENT_COURSE_OPPORTUNITIES.map((o) => [o.ref, o] as const))(
    '%s fits the table constraints and carries the search code',
    (_ref, o) => {
      const description = descriptionOf(o);
      expect(description.startsWith(PARENT_COURSE_CODE)).toBe(true);
      expect(description.length).toBeLessThanOrEqual(1000);
      expect(GOALS).toContain(o.goal);
      expect(['s', 'm', 'l', 'xl', 'xxl']).toContain(o.effort);
      expect(o.subConfig.length).toBeGreaterThan(0);
    },
  );

  it('names no partner organisation or individual (the repo is public)', () => {
    const all = JSON.stringify(PARENT_COURSE_OPPORTUNITIES).toLowerCase();
    for (const banned of ['agatsu', 'ira khan', 'aamir', 'kriti', 'lakh']) {
      expect(all).not.toContain(banned);
    }
  });
});
