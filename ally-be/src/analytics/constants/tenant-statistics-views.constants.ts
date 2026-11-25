import { ChartFilterKey } from './tenant-chart-library.constants';

/**
 * The tabs of the Statistics page that show charts, and what each holds.
 *
 * A view is configuration, not code: its sections, the charts in each (in the
 * order the questions are asked in the Statistics questions doc), and the
 * layout a person gets before they customise. Organisation is about the
 * organisation as a whole; Course and Learner each start with an overview of
 * all courses or all learners (lists, rankings), then one course or learner in depth. One chart can be in several
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
   * The layout before a person customises: every chart of the view, in section
   * order so a heading is never repeated. Derived from `sections`, never written
   * by hand, so a chart added to a section is on the page by default. The page
   * leaves out the ones the organisation cannot fill; a person removes, reorders
   * and brings back charts from the library.
   */
  defaultLayout: readonly string[];
}

type StatisticsViewDefinition = Omit<StatisticsViewConfig, 'defaultLayout'>;

/**
 * The cards pinned to For you until a person pins their own. Two, so the page
 * is never empty and never crowded. They are shown only if the organisation can
 * fill them, and a person who removes them or pins others keeps their own list.
 */
export const STATISTICS_DEFAULT_PINS: readonly string[] = [
  'TSQ-001', // Headline numbers
  'TSQ-007', // Learner status
];

const STATISTICS_VIEW_DEFINITIONS: readonly StatisticsViewDefinition[] = [
  {
    id: 'organisation',
    subject: null,
    sections: [
      {
        key: 'learners',
        subject: false,
        charts: ['TSQ-001', 'TSQ-007', 'TSQ-011', 'TSQ-012'],
      },
      {
        key: 'practice',
        subject: false,
        charts: ['TSQ-002', 'TSQ-005', 'TSQ-006', 'TSQ-003'],
      },
      {
        key: 'courses',
        subject: false,
        charts: ['TSQ-038', 'TSQ-014', 'TSQ-013'],
      },
      {
        key: 'results',
        subject: false,
        charts: ['TSQ-020', 'TSQ-021', 'TSQ-022'],
      },
      {
        key: 'reviews',
        subject: false,
        charts: ['TSQ-027', 'TSQ-034', 'TSQ-070'],
      },
      {
        key: 'skills',
        subject: false,
        charts: ['TSQ-024', 'TSQ-036', 'TSQ-087'],
      },
      { key: 'feedback', subject: false, charts: ['TSQ-026'] },
    ],
  },
  {
    id: 'course',
    subject: 'course',
    sections: [
      {
        key: 'allCourses',
        subject: false,
        charts: [
          'TSQ-038',
          'TSQ-039',
          'TSQ-014',
          'TSQ-013',
          'TSQ-015',
          'TSQ-016',
          'TSQ-017',
          'TSQ-036',
        ],
      },
      {
        key: 'acrossCourses',
        subject: false,
        charts: ['TSQ-049', 'TSQ-055'],
      },
      { key: 'courseFacts', subject: true, charts: ['TSQ-041'] },
      {
        key: 'useOverTime',
        subject: true,
        charts: ['TSQ-042', 'TSQ-043', 'TSQ-044'],
      },
      {
        key: 'modules',
        subject: true,
        charts: ['TSQ-045', 'TSQ-046', 'TSQ-088', 'TSQ-047'],
      },
      {
        key: 'roleplays',
        subject: true,
        charts: ['TSQ-083', 'TSQ-053', 'TSQ-085', 'TSQ-084', 'TSQ-020'],
      },
      {
        key: 'learning',
        subject: true,
        charts: ['TSQ-018', 'TSQ-019', 'TSQ-050', 'TSQ-051', 'TSQ-086'],
      },
      { key: 'feedback', subject: true, charts: ['TSQ-026', 'TSQ-022'] },
    ],
  },
  {
    id: 'learner',
    subject: 'learner',
    sections: [
      {
        key: 'allLearners',
        subject: false,
        charts: ['TSQ-023', 'TSQ-008', 'TSQ-009', 'TSQ-086'],
      },
      { key: 'profile', subject: true, charts: ['TSQ-062'] },
      { key: 'practice', subject: true, charts: ['TSQ-063'] },
      { key: 'progress', subject: true, charts: ['TSQ-064'] },
      {
        key: 'skills',
        subject: true,
        charts: ['TSQ-065', 'TSQ-051', 'TSQ-066', 'TSQ-024'],
      },
      {
        key: 'reviewsAndRatings',
        subject: true,
        charts: ['TSQ-070', 'TSQ-026'],
      },
    ],
  },
];

export const STATISTICS_VIEWS: readonly StatisticsViewConfig[] =
  STATISTICS_VIEW_DEFINITIONS.map((view) => ({
    ...view,
    defaultLayout: view.sections.flatMap((section) => section.charts),
  }));
