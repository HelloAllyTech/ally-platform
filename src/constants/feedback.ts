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
    label: 'FeedbackPopup.issues.missingKeyInfo',
    value: IssueOptions.MISSING_KEY_INFORMATION,
  },
  {
    label: 'FeedbackPopup.issues.inaccurate',
    value: IssueOptions.INACCURATE,
  },
  {
    label: 'FeedbackPopup.issues.tooVague',
    value: IssueOptions.TOO_VAGUE,
  },
  {
    label: 'FeedbackPopup.issues.difficultToUnderstand',
    value: IssueOptions.DIFFICULT_TO_UNDERSTAND,
  },
  {
    label: 'FeedbackPopup.issues.tooShort',
    value: IssueOptions.TOO_SHORT,
  },
  {
    // Make sure that last option is always 'other'
    label: 'FeedbackPopup.issues.other',
    value: IssueOptions.OTHER,
  },
];

export const RATING_TEXT_MAP: Record<number, string> = {
  1: 'FeedbackPopup.ratingTexts.poor',
  2: 'FeedbackPopup.ratingTexts.fair',
  3: 'FeedbackPopup.ratingTexts.good',
  4: 'FeedbackPopup.ratingTexts.veryGood',
  5: 'FeedbackPopup.ratingTexts.excellent',
};
