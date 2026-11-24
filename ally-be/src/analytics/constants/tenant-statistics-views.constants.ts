import { ChartFilterKey } from './tenant-chart-library.constants';

/**
 * The tabs of the Statistics page that show charts, and what each holds.
 *
 * A view is configuration, not code: its sections, the charts in each (in the
 * order the questions are asked in the Statistics questions doc), and the
 * layout a person gets before they customise. One chart can be in several
 * views; the chart registry says what a chart can do, this file says where it
 * is shown. `foryou` is not here: it has no chart layout of its own, only the
 * pins a person chooses.
 */
export type StatisticsViewId = 'organisation' | 'course' | 'learner';

export interface StatisticsViewSection {
  /** Translation key under `statisticsLibrary.sections`. */
  key: string;
  /**
   * The section is drawn for the course or learner chosen on the view, so its
   * charts must support that filter. A section without a subject is drawn for
   * the whole organisation.
   */
  subject: boolean;
  /** Chart ids, in the order they are listed in the library. */
  charts: readonly string[];
}

export interface StatisticsViewConfig {
  id: StatisticsViewId;
  /** What the view asks you to choose, or null when it is about the whole organisation. */
  subject: ChartFilterKey | null;
  sections: readonly StatisticsViewSection[];
  /**
   * The layout before a person customises, in section order so a heading is
   * never repeated. Only charts the organisation can fill are used, up to
   * {@link STATISTICS_DEFAULT_LAYOUT_CAP}.
   */
  defaultLayout: readonly string[];
}

/** The most cards a default layout holds. */
export const STATISTICS_DEFAULT_LAYOUT_CAP = 10;
/** A default layout is topped up from the rest of the view to at least this many. */
export const STATISTICS_DEFAULT_LAYOUT_FLOOR = 5;

export const STATISTICS_VIEWS: readonly StatisticsViewConfig[] = [
  {
    id: 'organisation',
    subject: null,
    sections: [
      {
        key: 'learners',
        subject: false,
        charts: [
          'TSQ-001',
          'TSQ-007',
          'TSQ-008',
          'TSQ-023',
          'TSQ-009',
          'TSQ-011',
          'TSQ-012',
        ],
      },
      {
        key: 'practice',
        subject: false,
        charts: ['TSQ-002', 'TSQ-005', 'TSQ-006', 'TSQ-003', 'TSQ-063'],
      },
      {
        key: 'courses',
        subject: false,
        charts: [
          'TSQ-038',
          'TSQ-039',
          'TSQ-014',
          'TSQ-013',
          'TSQ-015',
          'TSQ-016',
          'TSQ-017',
          'TSQ-042',
          'TSQ-043',
          'TSQ-053',
          'TSQ-018',
          'TSQ-019',
        ],
      },
      {
        key: 'results',
        subject: false,
        charts: ['TSQ-020', 'TSQ-021', 'TSQ-022'],
      },
      { key: 'reviews', subject: false, charts: ['TSQ-027'] },
      { key: 'skills', subject: false, charts: ['TSQ-024', 'TSQ-065'] },
      { key: 'feedback', subject: false, charts: ['TSQ-026'] },
    ],
    defaultLayout: [
      'TSQ-001',
      'TSQ-007',
      'TSQ-008',
      'TSQ-002',
      'TSQ-038',
      'TSQ-014',
      'TSQ-013',
      'TSQ-027',
      'TSQ-024',
      'TSQ-026',
    ],
  },
  {
    id: 'course',
    subject: 'course',
    sections: [
      {
        key: 'allCourses',
        subject: false,
        charts: ['TSQ-038', 'TSQ-039', 'TSQ-014', 'TSQ-013'],
      },
      { key: 'courseFacts', subject: true, charts: ['TSQ-041'] },
      {
        key: 'useOverTime',
        subject: true,
        charts: ['TSQ-042', 'TSQ-043', 'TSQ-045', 'TSQ-046'],
      },
      { key: 'roleplays', subject: true, charts: ['TSQ-053', 'TSQ-020'] },
      { key: 'learning', subject: true, charts: ['TSQ-018', 'TSQ-019'] },
      { key: 'feedback', subject: true, charts: ['TSQ-026', 'TSQ-022'] },
    ],
    defaultLayout: [
      'TSQ-038',
      'TSQ-039',
      'TSQ-014',
      'TSQ-013',
      'TSQ-041',
      'TSQ-042',
      'TSQ-043',
      'TSQ-045',
      'TSQ-046',
      'TSQ-053',
    ],
  },
  {
    id: 'learner',
    subject: 'learner',
    sections: [
      { key: 'practice', subject: true, charts: ['TSQ-063'] },
      { key: 'progress', subject: true, charts: ['TSQ-064'] },
      { key: 'skills', subject: true, charts: ['TSQ-065', 'TSQ-024'] },
    ],
    defaultLayout: ['TSQ-063', 'TSQ-064', 'TSQ-065', 'TSQ-024'],
  },
];
