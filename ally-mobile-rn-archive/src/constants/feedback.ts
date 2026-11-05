import type {ChipOption} from '@/components/ChipGroup';

export enum IssueOptions {
  MISSING_KEY_INFORMATION = 'MISSING_KEY_INFORMATION',
  INACCURATE = 'INACCURATE',
  TOO_VAGUE = 'TOO_VAGUE',
  DIFFICULT_TO_UNDERSTAND = 'DIFFICULT_TO_UNDERSTAND',
  TOO_SHORT = 'TOO_SHORT',
  OTHER = 'OTHER',
}

export const FEEDBACK_ISSUE_OPTIONS: ChipOption[] = [
  {
    label: 'callFeedback.issues.missingKeyInfo',
    value: IssueOptions.MISSING_KEY_INFORMATION,
  },
  {
    label: 'callFeedback.issues.inaccurate',
    value: IssueOptions.INACCURATE,
  },
  {
    label: 'callFeedback.issues.tooVague',
    value: IssueOptions.TOO_VAGUE,
  },
  {
    label: 'callFeedback.issues.difficultToUnderstand',
    value: IssueOptions.DIFFICULT_TO_UNDERSTAND,
  },
  {
    label: 'callFeedback.issues.tooShort',
    value: IssueOptions.TOO_SHORT,
  },
  {
    // Make sure that last option is always 'other'
    label: 'callFeedback.issues.other',
    value: IssueOptions.OTHER,
  },
];

export const RATING_TEXT_MAP: Record<number, string> = {
  1: 'callFeedback.ratings.1',
  2: 'callFeedback.ratings.2',
  3: 'callFeedback.ratings.3',
  4: 'callFeedback.ratings.4',
  5: 'callFeedback.ratings.5',
};
