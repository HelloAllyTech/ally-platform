import {SvgProps} from 'react-native-svg';

import {
  AGE_RANGE_OPTIONS,
  GENDER_OPTIONS,
  SectionKey,
  SUMMARY_FIELDS,
  SummaryFieldKey,
} from '@/constants/summary';
import {AgeRange, CallDetails, SummaryDetails} from '@/services/callSummaryApi';

import {FieldType} from './fields';

/**
 * Call details data structure (returned by selector)
 * Extends the API CallDetails type with optional clientId override
 */
export interface CallDetailsData extends Partial<CallDetails> {
  clientId?: number | string | null;
}

/**
 * Data context passed to field computation and formatting functions
 */
export interface FieldDataContext {
  summary: SummaryDetails | null;
  formData: SummaryFormData | null;
  callDetails: CallDetailsData | null;
  // callInfo selector returns a custom shape with specific fields from different sources
  callInfo: {
    chatId?: number;
    callDuration?: number;
    startTime?: string;
    endTime?: string | null;
    clientId?: number;
    summaryName?: string;
  } | null;
}

export interface SummaryField {
  isEditable: boolean;
  key: SummaryFieldKey;
  label: string;
  options?: typeof GENDER_OPTIONS | typeof AGE_RANGE_OPTIONS;
  sectionKey: SectionKey;
  type: FieldType;

  // Optional: For fields that need computed values (e.g., callDuration from callDetails)
  computeValue?: (data: FieldDataContext) => unknown;

  // Optional: For fields that need special display formatting (e.g., percentage, dates)
  formatDisplay?: (
    value: unknown,
    t?: (key: string, params?: any) => string,
  ) => string;
}

// Current configuration - can be moved to API later
export type VisibleFields = {
  [K in keyof typeof SUMMARY_FIELDS]: boolean;
};

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
