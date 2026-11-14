import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from '../../exception/error-code.enum';
import type { ListRecordView } from './list-types';

/** Why a list write or definition change was refused (chunk 5a). */
export type ListRefusalCode =
  | 'required_missing'
  | 'invalid_value'
  | 'not_writable'
  | 'unique_taken'
  | 'capacity_full'
  | 'limit_reached'
  | 'transition_not_allowed'
  | 'not_found'
  | 'version_conflict'
  | 'limit_exceeded'
  | 'in_use';

export interface ListRefusal {
  code: ListRefusalCode;
  field?: string;
  /** Plain words, from copy deck §26. Owners' screens (5b) and the agent (6) both show it. */
  message: string;
  conflict?: {
    /** For `unique_taken` and `capacity_full` on a relation: up to 3 targets that would pass. */
    alternatives?: ListRecordView[];
    /** For a rule that existing records break: the records that break it. For `in_use`: the
     * live entries that point at the one being deleted. */
    records?: { id: string; title: string }[];
  };
}

const STATUS: Record<ListRefusalCode, HttpStatus> = {
  required_missing: HttpStatus.BAD_REQUEST,
  invalid_value: HttpStatus.BAD_REQUEST,
  not_writable: HttpStatus.BAD_REQUEST,
  limit_exceeded: HttpStatus.BAD_REQUEST,
  not_found: HttpStatus.NOT_FOUND,
  unique_taken: HttpStatus.CONFLICT,
  capacity_full: HttpStatus.CONFLICT,
  limit_reached: HttpStatus.CONFLICT,
  transition_not_allowed: HttpStatus.CONFLICT,
  version_conflict: HttpStatus.CONFLICT,
  in_use: HttpStatus.CONFLICT,
};

/**
 * A refusal, as an HTTP error: the response carries `errorCode: LIST_REFUSED` and the refusal as
 * `details`. 6's gateway reads `refusal`.
 */
export class ListRefusalException extends HttpException {
  constructor(readonly refusal: ListRefusal) {
    // The app's exception filter passes only `message`, and `details` beside an `errorCode`.
    super(
      {
        message: refusal.message,
        errorCode: ErrorCode.LIST_REFUSED,
        details: refusal,
      },
      STATUS[refusal.code],
    );
  }
}

/** Mid-sentence, a label or list name reads in lower case: "That slot is already taken." */
const lower = (s: string): string =>
  s && s[0] !== s[0].toLowerCase() && s.slice(1) === s.slice(1).toLowerCase()
    ? s[0].toLowerCase() + s.slice(1)
    : s;

/** Copy deck §26, "Lists (5a)". */
export const LIST_COPY = {
  required_missing: (field: string) => `${field} is needed.`,
  invalid_value: (field: string, why: string) =>
    `${field} isn't valid: ${why}.`,
  not_writable: (field: string) => `${field} can't be changed here.`,
  unique_taken: (field: string) => `That ${lower(field)} is already taken.`,
  capacity_full: (target: string) => `${target} is full.`,
  limit_reached: (max: number, list: string) =>
    `This person already has ${max} ${lower(list)}.`,
  transition_not_allowed: (list: string, from: string, to: string) =>
    `${list} can't go from ${from} to ${to}.`,
  not_found: () => `That entry doesn't exist any more.`,
  version_conflict: () =>
    `Someone changed this entry just now. Reload and try again.`,
  limit_exceeded: (limit: string) =>
    `This would go over the limit of ${limit}.`,
  /** Chunk 5b: deleting an entry that live entries elsewhere point at. */
  in_use: (n: number, lists: string) =>
    n === 1
      ? `1 entry in ${lists} uses this. Cancel or move it first.`
      : `${n} entries in ${lists} use this. Cancel or move them first.`,
};

export const refuse = {
  requiredMissing: (key: string, label: string) =>
    new ListRefusalException({
      code: 'required_missing',
      field: key,
      message: LIST_COPY.required_missing(label),
    }),
  invalidValue: (key: string | undefined, label: string, why: string) =>
    new ListRefusalException({
      code: 'invalid_value',
      ...(key ? { field: key } : {}),
      message: LIST_COPY.invalid_value(label, why),
    }),
  notWritable: (key: string | undefined, label: string) =>
    new ListRefusalException({
      code: 'not_writable',
      ...(key ? { field: key } : {}),
      message: LIST_COPY.not_writable(label),
    }),
  notFound: () =>
    new ListRefusalException({
      code: 'not_found',
      message: LIST_COPY.not_found(),
    }),
  versionConflict: () =>
    new ListRefusalException({
      code: 'version_conflict',
      message: LIST_COPY.version_conflict(),
    }),
  limitExceeded: (limit: string) =>
    new ListRefusalException({
      code: 'limit_exceeded',
      message: LIST_COPY.limit_exceeded(limit),
    }),
  inUse: (n: number, lists: string, records: { id: string; title: string }[]) =>
    new ListRefusalException({
      code: 'in_use',
      message: LIST_COPY.in_use(n, lists),
      conflict: { records },
    }),
};
