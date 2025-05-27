import {
  AGE_RANGE_OPTIONS,
  GENDER_OPTIONS,
  SectionKey,
  SUMMARY_FIELDS,
} from '@/constants/summary';

type FieldType = 'Text' | 'Number' | 'Boolean' | 'Multiline' | 'Dropdown';

type SummaryFieldKey = (typeof SUMMARY_FIELDS)[keyof typeof SUMMARY_FIELDS];

export interface SummaryField {
  isEditable: boolean;
  isEnhanceable?: boolean;
  key: SummaryFieldKey;
  label: string;
  options?: typeof GENDER_OPTIONS | typeof AGE_RANGE_OPTIONS;
  sectionKey: SectionKey;
  type: FieldType;
}

// Current configuration - can be moved to API later
export type VisibleFields = {
  [K in keyof typeof SUMMARY_FIELDS]: boolean;
};

// Remove the Future API response type since we're using SummaryDetails
export type {SummaryDetails} from '@/services/callSummaryApi';
