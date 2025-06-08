import {SvgProps} from 'react-native-svg';

import {
  AGE_RANGE_OPTIONS,
  GENDER_OPTIONS,
  SectionKey,
  SUMMARY_FIELDS,
  SummaryFieldKey,
} from '@/constants/summary';
import {Language} from '@/services/callSummaryApi';
import {FormData} from '@/utils/callSummary/formDataTransformer';

export enum FieldType {
  Text = 'Text',
  InlineTextInput = 'InlineTextInput',
  MultilineTextInput = 'MultilineTextInput',
  Dropdown = 'Dropdown',
  SearchableDropdown = 'SearchableDropdown',
}

export interface SummaryField {
  isEditable: boolean;
  key: SummaryFieldKey;
  label: string;
  options?: typeof GENDER_OPTIONS | typeof AGE_RANGE_OPTIONS;
  sectionKey: SectionKey;
  type: FieldType;
}

export interface FieldConfig {
  field: SummaryFieldKey;
  value: SummaryFieldValueTypes;
}

// Current configuration - can be moved to API later
export type VisibleFields = {
  [K in keyof typeof SUMMARY_FIELDS]: boolean;
};

export type SummaryFieldValueTypes = string | number | Language[];

// Type utility for editable field keys
export type EditableFieldKey = keyof FormData;

export interface SectionItem {
  key: SectionKey;
  label: string;
  icon: React.FC<SvgProps>;
  canEdit: boolean;
}
