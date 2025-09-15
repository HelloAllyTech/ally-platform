import type {ChipOption} from '@/components/ChipGroup';

export const FEEDBACK_ISSUE_OPTIONS: ChipOption[] = [
  {
    id: 'missingKeyInfo',
    label: 'FeedbackPopup.issues.missingKeyInfo',
    value: 'missingKeyInfo',
  },
  {
    id: 'inaccurate',
    label: 'FeedbackPopup.issues.inaccurate',
    value: 'inaccurate',
  },
  {
    id: 'tooVague',
    label: 'FeedbackPopup.issues.tooVague',
    value: 'tooVague',
  },
  {
    id: 'difficultToUnderstand',
    label: 'FeedbackPopup.issues.difficultToUnderstand',
    value: 'difficultToUnderstand',
  },
  {
    id: 'tooShort',
    label: 'FeedbackPopup.issues.tooShort',
    value: 'tooShort',
  },
  {
    // Make sure that last option is always 'other'
    id: 'other',
    label: 'FeedbackPopup.issues.other',
    value: 'other',
  },
];

export const RATING_TEXT_MAP: Record<number, string> = {
  1: 'FeedbackPopup.ratingTexts.poor',
  2: 'FeedbackPopup.ratingTexts.fair',
  3: 'FeedbackPopup.ratingTexts.good',
  4: 'FeedbackPopup.ratingTexts.veryGood',
  5: 'FeedbackPopup.ratingTexts.excellent',
};
