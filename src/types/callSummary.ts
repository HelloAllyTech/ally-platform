import {
  AGE_RANGE_OPTIONS,
  GENDER_OPTIONS,
  SectionKey,
  SUMMARY_FIELDS,
} from '@/constants/summary';
import {Language} from '@/services/callSummaryApi';

export enum FieldType {
  Text = 'Text',
  InlineTextInput = 'InlineTextInput',
  MultilineTextInput = 'MultilineTextInput',
  Dropdown = 'Dropdown',
  SearchableDropdown = 'SearchableDropdown',
}

type SummaryFieldKey = (typeof SUMMARY_FIELDS)[keyof typeof SUMMARY_FIELDS];

export interface SummaryField {
  isEditable: boolean;
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

export type SummaryFieldValueTypes = string | number | Language[];

// Remove the Future API response type since we're using SummaryDetails
export type {SummaryDetails} from '@/services/callSummaryApi';
