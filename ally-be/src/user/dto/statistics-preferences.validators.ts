import {
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

/** The layouts a person saves for the Statistics tabs: one list of card keys per view, and their pins. */
export const STATISTICS_LAYOUT_KEYS = [
  'organisation',
  'course',
  'learner',
  'pins',
  'customers',
] as const;
/** What a person last chose on the Course and Learner tabs. */
export const STATISTICS_SUBJECT_KEYS = ['course', 'learner'] as const;

const MAX_CARDS = 60;
const MAX_KEY_LENGTH = 80;
const SUBJECT_ID = /^[A-Za-z0-9-]{1,64}$/;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * `statistics_layouts`: an object whose keys are views (or `pins`) and whose
 * values are lists of card keys, each a short string, with no duplicates. Card
 * keys are not checked against the chart library: a chart that is retired is
 * dropped by the page, so adding or retiring one needs no backend deploy.
 */
@ValidatorConstraint({ name: 'statisticsLayouts', async: false })
export class StatisticsLayoutsConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (!isPlainObject(value)) return false;
    return Object.entries(value).every(
      ([key, list]) =>
        (STATISTICS_LAYOUT_KEYS as readonly string[]).includes(key) &&
        Array.isArray(list) &&
        list.length <= MAX_CARDS &&
        list.every(
          (card) =>
            typeof card === 'string' &&
            card.length > 0 &&
            card.length <= MAX_KEY_LENGTH,
        ) &&
        new Set(list).size === list.length,
    );
  }

  defaultMessage(args: ValidationArguments): string {
    return `${args.property} must map course, learner, organisation, pins or customers to a list of at most ${MAX_CARDS} distinct card keys`;
  }
}

/** `statistics_subjects`: the id of the course and the learner last chosen. */
@ValidatorConstraint({ name: 'statisticsSubjects', async: false })
export class StatisticsSubjectsConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (!isPlainObject(value)) return false;
    return Object.entries(value).every(
      ([key, id]) =>
        (STATISTICS_SUBJECT_KEYS as readonly string[]).includes(key) &&
        typeof id === 'string' &&
        SUBJECT_ID.test(id),
    );
  }

  defaultMessage(args: ValidationArguments): string {
    return `${args.property} must hold only a course id and a learner id`;
  }
}

const MAX_SEEN_FINDINGS = 40;
const SEEN_SLOTS = ['previous', 'current'] as const;

const isSnapshot = (value: unknown): boolean => {
  if (!isPlainObject(value)) return false;
  const { at, findings, active, sessions } = value;
  return (
    typeof at === 'string' &&
    !Number.isNaN(Date.parse(at)) &&
    Array.isArray(findings) &&
    findings.length <= MAX_SEEN_FINDINGS &&
    findings.every(
      (key) =>
        typeof key === 'string' &&
        key.length > 0 &&
        key.length <= MAX_KEY_LENGTH,
    ) &&
    Number.isInteger(active) &&
    (active as number) >= 0 &&
    Number.isInteger(sessions) &&
    (sessions as number) >= 0
  );
};

/**
 * `statistics_seen`: what a person last saw on For you, so the summary can say
 * what changed since: `{ previous?, current }`, each `{ at, findings, active,
 * sessions }` (when, the findings that needed a look, learners active and
 * sessions completed over the last 30 days). Counts and finding keys only.
 */
@ValidatorConstraint({ name: 'statisticsSeen', async: false })
export class StatisticsSeenConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (!isPlainObject(value)) return false;
    return Object.entries(value).every(
      ([slot, snapshot]) =>
        (SEEN_SLOTS as readonly string[]).includes(slot) &&
        isSnapshot(snapshot),
    );
  }

  defaultMessage(args: ValidationArguments): string {
    return `${args.property} must hold only a previous and a current snapshot (when, finding keys, active learners, sessions)`;
  }
}
