import {
  CourseCopilotJobKind,
  CourseCopilotJobStatus,
} from '../enum/course-copilot.enum';

/**
 * Course Pilot's publish stage: before the trainer publishes, code lists what the build left
 * unresolved. Never blocking (the structural readiness checks already block); shown on the
 * publish card so the trainer decides with it in front of them, and kept on the session for the
 * Stages tab.
 */
export interface PublishJob {
  kind: string;
  status: string;
  title?: string | null;
  summary?: string | null;
  /** Reviewer findings marked "fix" (course_review jobs only). */
  reviewFixes?: number;
}

export interface PublishCheck {
  label: string;
  result: 'pass' | 'warn' | 'fail';
  detail?: string;
}

export interface CoursePilotPublishRecord {
  at: string;
  /** False: the readiness checks failed and nothing was published. */
  ready: boolean;
  published: boolean;
  checks: PublishCheck[];
}

const name = (job: PublishJob) =>
  job.title ? `"${job.title}"` : job.kind.replace(/_/g, ' ');

/** Quality checks from the build jobs and the critic; warnings, never blocking. */
export function publishQualityChecks(input: {
  jobs: PublishJob[];
  critic?: {
    remaining?: { severity: string; problem?: string }[];
  } | null;
}): PublishCheck[] {
  const { jobs } = input;
  const checks: PublishCheck[] = [];
  const failed = jobs.filter((j) => j.status === CourseCopilotJobStatus.FAILED);
  const skipped = jobs.filter(
    (j) => j.status === CourseCopilotJobStatus.SKIPPED,
  );
  checks.push(
    failed.length
      ? {
          label: `${failed.length} item${failed.length === 1 ? ' was' : 's were'} not written`,
          result: 'warn',
          detail: failed.map(name).join(', '),
        }
      : { label: 'Every item was written', result: 'pass' },
  );
  if (skipped.length) {
    checks.push({
      label: `${skipped.length} item${skipped.length === 1 ? '' : 's'} skipped`,
      result: 'warn',
      detail: skipped.map(name).join(', '),
    });
  }
  const disputed = jobs.filter((j) => /disputed/i.test(j.summary ?? ''));
  checks.push(
    disputed.length
      ? {
          label: `Answer-key check disputed ${disputed.length} quiz${disputed.length === 1 ? '' : 'zes'}`,
          result: 'warn',
          detail: disputed.map((j) => `${name(j)}: ${j.summary}`).join(' · '),
        }
      : { label: 'Quiz answer keys checked', result: 'pass' },
  );
  const review = [...jobs]
    .reverse()
    .find(
      (j) =>
        j.kind === CourseCopilotJobKind.COURSE_REVIEW &&
        j.status === CourseCopilotJobStatus.DONE,
    );
  if (review) {
    const fixes = review.reviewFixes ?? 0;
    checks.push(
      fixes
        ? {
            label: `Reviewer suggested ${fixes} fix${fixes === 1 ? '' : 'es'}`,
            result: 'warn',
            detail: 'Applied fixes are not tracked; check the review notes.',
          }
        : { label: 'Reviewer found nothing to fix', result: 'pass' },
    );
  }
  const left = (input.critic?.remaining ?? []).filter(
    (f) => f.severity === 'blocking',
  );
  if (left.length) {
    checks.push({
      label: `Plan critic left ${left.length} problem${left.length === 1 ? '' : 's'}`,
      result: 'warn',
      detail: left
        .map((f) => f.problem)
        .filter(Boolean)
        .join(' · '),
    });
  }
  return checks;
}

/** One line for the publish card; null when nothing needs the trainer's attention. */
export function publishWarningText(checks: PublishCheck[]): string | null {
  const warnings = checks.filter((c) => c.result !== 'pass');
  if (!warnings.length) return null;
  return `Before you publish: ${warnings
    .map((c) => (c.detail ? `${c.label} (${c.detail})` : c.label))
    .join('; ')}.`;
}
