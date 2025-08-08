import {SvgProps} from 'react-native-svg';

import {
  AGE_RANGE_OPTIONS,
  GENDER_OPTIONS,
  SectionKey,
  SUMMARY_FIELDS,
  SummaryFieldKey,
} from '@/constants/summary';
import {AgeRange, Language} from '@/services/callSummaryApi';

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
export type EditableFieldKey = keyof SummaryFormData;

export interface SectionItem {
  key: SectionKey;
  label: string;
  icon: React.FC<SvgProps>;
  canEdit: boolean;
  canEnhance: boolean;
}

// Centralized type for Call Summary form data used in CallSummaryScreen
export type SummaryFormData = {
  // Demographics - editable fields only
  [SUMMARY_FIELDS.AGE]: AgeRange | null;
  [SUMMARY_FIELDS.GENDER]: string | null;
  [SUMMARY_FIELDS.PROFESSION]: string | null;
  [SUMMARY_FIELDS.RELATIONSHIP_STATUS]: string | null;
  [SUMMARY_FIELDS.LOCATION]: string | null;
  [SUMMARY_FIELDS.CONCERN_CODE]: string | null;

  // Text content fields - all editable
  [SUMMARY_FIELDS.SESSION_SUMMARY]: string | null;
  [SUMMARY_FIELDS.FLOW]: string | null;
  [SUMMARY_FIELDS.KEY_CONCERNS]: string | null;
  [SUMMARY_FIELDS.OBJECTIVE_OBSERVATIONS]: string | null;
  [SUMMARY_FIELDS.SUBJECTIVE_OBSERVATIONS]: string | null;
  [SUMMARY_FIELDS.ASSESSMENT]: string | null;
  [SUMMARY_FIELDS.DOMINANT_FEELINGS]: string | null;
  [SUMMARY_FIELDS.ISSUES_WORKED_ON]: string | null;
  [SUMMARY_FIELDS.KEY_THERAPEUTIC_TECHNIQUES]: string | null;
  [SUMMARY_FIELDS.REFERRALS_PROVIDED]: string | null;
  [SUMMARY_FIELDS.HOMEWORK_RECOMMENDED]: string | null;
  [SUMMARY_FIELDS.PLAN_FOR_NEXT_CALL]: string | null;
  [SUMMARY_FIELDS.TAGS]: string | null;
  [SUMMARY_FIELDS.ADDITIONAL_NOTES]: string | null;
};
