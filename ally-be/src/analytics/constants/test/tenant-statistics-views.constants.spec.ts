import { TENANT_CHART_LIBRARY } from '../tenant-chart-library.constants';
import {
  STATISTICS_DEFAULT_LAYOUT_CAP,
  STATISTICS_VIEWS,
} from '../tenant-statistics-views.constants';

const entry = (id: string) => TENANT_CHART_LIBRARY.find((c) => c.id === id);

describe('STATISTICS_VIEWS', () => {
  it('has one view for each of the organisation, course and learner tabs', () => {
    expect(STATISTICS_VIEWS.map((v) => v.id)).toEqual([
      'organisation',
      'course',
      'learner',
    ]);
  });

  describe.each(STATISTICS_VIEWS.map((v) => [v.id, v] as const))(
    '%s',
    (_id, view) => {
      const listed = view.sections.flatMap((s) => s.charts);

      it('lists only charts that exist and are live', () => {
        listed.forEach((id) => {
          expect(entry(id)?.live).toBe(true);
        });
      });

      it('lists no chart twice', () => {
        expect(new Set(listed).size).toBe(listed.length);
      });

      it('lists every chart in a section that can honour it', () => {
        view.sections.forEach((section) => {
          section.charts.forEach((id) => {
            const scopes = entry(id)?.scopes ?? [];
            // A subject section is drawn for the chosen course or learner;
            // any other section is drawn for the whole organisation.
            const needed = section.subject ? view.subject : 'organisation';
            expect({
              id,
              section: section.key,
              ok: scopes.includes(needed!),
            }).toEqual({ id, section: section.key, ok: true });
          });
        });
      });

      it('has subject sections only when the view asks for a subject', () => {
        expect(view.sections.some((s) => s.subject)).toBe(
          view.subject !== null,
        );
      });

      it('has a default layout of listed charts, within the cap, with no repeats', () => {
        expect(view.defaultLayout.length).toBeLessThanOrEqual(
          STATISTICS_DEFAULT_LAYOUT_CAP,
        );
        expect(new Set(view.defaultLayout).size).toBe(
          view.defaultLayout.length,
        );
        view.defaultLayout.forEach((id) => expect(listed).toContain(id));
      });

      it('keeps the default layout in section order, so no heading repeats', () => {
        const sectionOf = (id: string) =>
          view.sections.findIndex((s) => s.charts.includes(id));
        const order = view.defaultLayout.map(sectionOf);
        expect(order).toEqual([...order].sort((a, b) => a - b));
      });
    },
  );
});

describe('where every chart lives', () => {
  const homes = ['organisation', 'course', 'learner'];
  const viewOf = (id: string) => STATISTICS_VIEWS.find((v) => v.id === id)!;
  const listedIn = (view: string, chartId: string) =>
    viewOf(view)
      .sections.flatMap((s) => s.charts)
      .includes(chartId);

  it('gives every chart in the registry, live or planned, a home tab', () => {
    TENANT_CHART_LIBRARY.forEach((chart) => {
      expect({ id: chart.id, home: homes.includes(chart.home) }).toEqual({
        id: chart.id,
        home: true,
      });
    });
  });

  it('lists every live chart in its home view', () => {
    TENANT_CHART_LIBRARY.filter((c) => c.live).forEach((chart) => {
      expect({
        id: chart.id,
        home: chart.home,
        listed: listedIn(chart.home, chart.id),
      }).toEqual({
        id: chart.id,
        home: chart.home,
        listed: true,
      });
    });
  });

  it('lists a live chart only on tabs that can draw it, and never leaves it unplaced', () => {
    TENANT_CHART_LIBRARY.filter((c) => c.live).forEach((chart) => {
      const placed = STATISTICS_VIEWS.filter((v) => listedIn(v.id, chart.id));
      expect({ id: chart.id, placed: placed.length > 0 }).toEqual({
        id: chart.id,
        placed: true,
      });
    });
  });

  it('keeps per-learner lists off the Organisation tab and course internals off it too', () => {
    const organisation = STATISTICS_VIEWS.find(
      (v) => v.id === 'organisation',
    )!.sections.flatMap((s) => s.charts);
    // Top learners, learners who need attention, the learner table: the Learner tab.
    ['TSQ-008', 'TSQ-009', 'TSQ-023'].forEach((id) =>
      expect(organisation).not.toContain(id),
    );
    // Items, quizzes, performance since launch, time to finish, roleplays: the Course tab.
    ['TSQ-018', 'TSQ-019', 'TSQ-042', 'TSQ-043', 'TSQ-053'].forEach((id) =>
      expect(organisation).not.toContain(id),
    );
  });
});
