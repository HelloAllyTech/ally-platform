import {
  publishQualityChecks,
  publishWarningText,
} from '../course-pilot-publish.util';

const job = (over: any = {}) => ({
  kind: 'article',
  status: 'done',
  title: 'Read',
  summary: null,
  ...over,
});

describe('Course Pilot publish checks', () => {
  it('passes a clean build', () => {
    const checks = publishQualityChecks({
      jobs: [
        job(),
        job({ kind: 'course_review', title: null, reviewFixes: 0 }),
      ],
    });
    expect(checks.every((c) => c.result === 'pass')).toBe(true);
    expect(publishWarningText(checks)).toBeNull();
  });

  it('lists failed items, disputed keys, reviewer fixes and critic leftovers', () => {
    const checks = publishQualityChecks({
      jobs: [
        job({ status: 'failed', title: 'Jamie roleplay' }),
        job({
          kind: 'quiz',
          title: 'Quiz 1',
          summary: '5 questions; 1 disputed and repaired',
        }),
        job({ kind: 'course_review', title: null, reviewFixes: 2 }),
      ],
      critic: {
        remaining: [
          { severity: 'blocking', problem: 'No debrief' },
          { severity: 'advisory', problem: 'Long intro' },
        ],
      },
    });
    const text = publishWarningText(checks) ?? '';
    expect(text).toContain('1 item was not written ("Jamie roleplay")');
    expect(text).toContain('Answer-key check disputed 1 quiz');
    expect(text).toContain('Reviewer suggested 2 fixes');
    expect(text).toContain('Plan critic left 1 problem (No debrief)');
    expect(text).not.toContain('Long intro');
  });

  it('uses the latest finished review', () => {
    const checks = publishQualityChecks({
      jobs: [
        job({ kind: 'course_review', reviewFixes: 3 }),
        job({ kind: 'course_review', reviewFixes: 0 }),
      ],
    });
    expect(checks.map((c) => c.label)).toContain(
      'Reviewer found nothing to fix',
    );
  });
});
