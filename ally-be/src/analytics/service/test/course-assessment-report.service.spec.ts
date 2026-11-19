import {
  ASSESSMENT_COHORT_MIN_GROUP_SIZE,
  CourseAssessmentReportService,
} from '../course-assessment-report.service';

describe('CourseAssessmentReportService', () => {
  const KEY = '6f1d0b0e-8f0a-4c3b-9a55-0d6c2f0e9a11';
  const items = [
    { id: 'pre', title: 'Baseline', scenarioId: 7, phase: 'PRE', pairKey: KEY },
    { id: 'post', title: 'Final', scenarioId: 7, phase: 'POST', pairKey: KEY },
  ];
  const submitted = (score: number, extra: Record<string, unknown> = {}) => ({
    assessmentSubmittedAt: '2026-11-19T10:00:00.000Z',
    assessmentSubmission: {
      scenarioSessionId: 's',
      learnerTurns: 10,
      requiredTurns: 10,
      score,
      requiredScore: null,
      submittedAt: '2026-11-19T10:00:00.000Z',
    },
    ...extra,
  });
  const progressFor = (userId: number, pre: number, post: number) => [
    {
      trackItemId: 'pre',
      userId,
      name: `L${userId}`,
      score: pre,
      meta: submitted(pre),
    },
    {
      trackItemId: 'post',
      userId,
      name: `L${userId}`,
      score: post,
      meta: submitted(post),
    },
  ];

  const build = (progress: unknown[]) => {
    const dataSource = {
      query: jest
        .fn()
        .mockResolvedValueOnce(items)
        .mockResolvedValueOnce(progress),
    };
    return new CourseAssessmentReportService(dataSource as any);
  };

  it('returns no pairs for a course without one', async () => {
    const service = new CourseAssessmentReportService({
      query: jest.fn().mockResolvedValue([]),
    } as any);
    await expect(service.getCoursePairs('t', 'tenant')).resolves.toEqual({
      trackId: 't',
      pairs: [],
    });
  });

  it('computes each learner gain and withholds cohort averages below the group size', async () => {
    const service = build([
      ...progressFor(1, 40, 70),
      ...progressFor(2, 50, 45),
    ]);
    const { pairs } = await service.getCoursePairs('t', 'tenant');

    expect(pairs).toHaveLength(1);
    expect(pairs[0].comparability.comparable).toBe(true);
    expect(pairs[0].learners.map((l) => l.gain)).toEqual([30, -5]);
    expect(pairs[0].cohort).toEqual({
      n: 2,
      avgPre: null,
      avgPost: null,
      avgGain: null,
      suppressed: true,
      minGroupSize: ASSESSMENT_COHORT_MIN_GROUP_SIZE,
    });
  });

  it('reports cohort averages once enough learners have both', async () => {
    const progress = [1, 2, 3, 4, 5].flatMap((id) => progressFor(id, 40, 60));
    const { pairs } = await build(progress).getCoursePairs('t', 'tenant');

    expect(pairs[0].cohort).toMatchObject({
      n: 5,
      avgPre: 40,
      avgPost: 60,
      avgGain: 20,
      suppressed: false,
    });
  });

  it('keeps a reopened learner on the frozen submission and flags the reopen', async () => {
    const meta = {
      assessmentReopenedAt: '2026-11-20T00:00:00.000Z',
      assessmentIncompleteStarts: 2,
      assessmentSubmission: submitted(30).assessmentSubmission,
    };
    const { pairs } = await build([
      { trackItemId: 'pre', userId: 1, name: 'A', score: 30, meta },
    ]).getCoursePairs('t', 'tenant');

    expect(pairs[0].learners[0].pre).toEqual({
      score: 30,
      submittedAt: '2026-11-19T10:00:00.000Z',
      incompleteStarts: 2,
      reopened: true,
    });
    expect(pairs[0].learners[0].gain).toBeNull();
  });
});
