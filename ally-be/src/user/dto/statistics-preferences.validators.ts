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
    return `${args.property} must map course, learner, organisation or pins to a list of at most ${MAX_CARDS} distinct card keys`;
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
