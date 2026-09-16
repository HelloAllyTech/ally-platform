import {SvgProps} from 'react-native-svg';

import {
  AGE_RANGE_OPTIONS,
  ASSESSMENT_AFFECT_OPTIONS,
  ASSESSMENT_SPEECH_OPTIONS,
  GENDER_OPTIONS,
  SectionKey,
  SUMMARY_FIELDS,
  SummaryFieldKey,
  YES_NO_OPTIONS,
} from '@/constants/summary';
import {TranslationType} from '@/localization/locales/type';
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
    mode?: string;
  } | null;
}

export interface SummaryField {
  isEditable: boolean;
  key: SummaryFieldKey;
  label: string;
  options?:
    | typeof GENDER_OPTIONS
    | typeof AGE_RANGE_OPTIONS
    | typeof YES_NO_OPTIONS
    | typeof ASSESSMENT_AFFECT_OPTIONS
    | typeof ASSESSMENT_SPEECH_OPTIONS;
  placeholder?: string;
  sectionKey: SectionKey;
  type: FieldType;

  // Optional: For fields that need computed values (e.g., callDuration from callDetails)
  computeValue?: (data: FieldDataContext) => unknown;

  // Optional: For fields that need special display formatting (e.g., percentage, dates)
  formatDisplay?: (
    value: unknown,
    t?: (key: string, params?: Record<string, unknown>) => string,
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
  /** i18n key for the section title, resolved via t() at render time. */
  labelKey: TranslationType;
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
  [SUMMARY_FIELDS.COUNSELLOR]: string | null;
  [SUMMARY_FIELDS.NEW_CALL_FOLLOW_UP]: string | null;

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

  // Intake section - all editable
  [SUMMARY_FIELDS.INTAKE_NOTES]: string | null;
  [SUMMARY_FIELDS.RISK_SELF_HARM]: string | null;
  [SUMMARY_FIELDS.RISK_SELF_HARM_NOTES]: string | null;
  [SUMMARY_FIELDS.RISK_SUICIDAL_THOUGHTS]: string | null;
  [SUMMARY_FIELDS.RISK_SUICIDAL_THOUGHTS_NOTES]: string | null;
  [SUMMARY_FIELDS.RISK_SUICIDAL_PLAN]: string | null;
  [SUMMARY_FIELDS.RISK_SUICIDAL_ACTION]: string | null;
  [SUMMARY_FIELDS.RISK_RUNNING_AWAY]: string | null;
  [SUMMARY_FIELDS.RISK_RUNNING_AWAY_NOTES]: string | null;
  [SUMMARY_FIELDS.TRAUMA_PHYSICAL_ABUSE]: string | null;
  [SUMMARY_FIELDS.TRAUMA_SEXUAL_ABUSE]: string | null;
  [SUMMARY_FIELDS.TRAUMA_VERBAL_ABUSE]: string | null;
  [SUMMARY_FIELDS.TRAUMA_NEGLECT]: string | null;
  [SUMMARY_FIELDS.TRAUMA_SEPARATION_FROM_CAREGIVER_PARENT]: string | null;
  [SUMMARY_FIELDS.TRAUMA_WITNESSED_DOMESTIC_VIOLENCE]: string | null;
  [SUMMARY_FIELDS.TRAUMA_NOTES]: string | null;
  [SUMMARY_FIELDS.ASSESSMENT_PSYCHOLOGICAL_DIAGNOSIS]: string | null;
  [SUMMARY_FIELDS.ASSESSMENT_PSYCHOLOGICAL_DIAGNOSIS_NOTES]: string | null;
  [SUMMARY_FIELDS.ASSESSMENT_USE_OF_PSYCHOTROPIC_MEDICATIONS]: string | null;
  [SUMMARY_FIELDS.ASSESSMENT_USE_OF_PSYCHOTROPIC_MEDICATIONS_NOTES]:
    | string
    | null;
  [SUMMARY_FIELDS.ASSESSMENT_HALLUCINATIONS]: string | null;
  [SUMMARY_FIELDS.ASSESSMENT_HALLUCINATIONS_NOTES]: string | null;
  [SUMMARY_FIELDS.ASSESSMENT_AFFECT]: string | null;
  [SUMMARY_FIELDS.ASSESSMENT_SPEECH]: string | null;

  // Ongoing Risks section - all editable
  [SUMMARY_FIELDS.ONGOING_RISK_SELF_HARM]: string | null;
  [SUMMARY_FIELDS.ONGOING_RISK_SELF_HARM_NOTES]: string | null;
  [SUMMARY_FIELDS.ONGOING_RISK_SUICIDAL_THOUGHTS]: string | null;
  [SUMMARY_FIELDS.ONGOING_RISK_SUICIDAL_PLAN]: string | null;
  [SUMMARY_FIELDS.ONGOING_RISK_SUICIDAL_ACTION]: string | null;
  [SUMMARY_FIELDS.ONGOING_RISK_SUICIDAL_THOUGHTS_NOTES]: string | null;
};
