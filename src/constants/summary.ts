import {
  AssessmentIcon,
  BrightnessAlertIcon,
  CallDetailsIcon,
  DatabaseIcon,
  FlowIcon,
  HandShareIcon,
  HeadsetMicIcon,
  KeyConcernIcon,
  MagnifyEyeIcon,
  NewsStandIcon,
  NotesIcon,
  PrescriptionsIcon,
  SessionSummaryIcon,
  SmileIcon,
  TableEyeIcon,
  TagIcon,
} from '@/assets/icons';
import {colors} from '@/theme';
import type {
  FieldDataContext,
  SectionItem,
  SummaryField,
} from '@/types/callSummary';
import {FieldType} from '@/types/fields';
import {formatAsPercentage, formatAsStringOrDash} from '@/utils/common';
import {
  formatDateWithOrdinal,
  formatDurationFromSeconds,
  formatTimeHHmm,
} from '@/utils/date';

import {LanguageMap} from './general';

// Helper functions for computeValue and formatDisplay specific to call summary
const computeFromCallDetailsOrSummary =
  (fieldKey: SummaryFieldKey) =>
  ({summary, callDetails}: FieldDataContext) =>
    callDetails?.[fieldKey] || summary?.[fieldKey];

const formatTimeRange = (value: unknown) => {
  if (
    !value ||
    typeof value !== 'object' ||
    !('startTime' in value) ||
    !('endTime' in value) ||
    !value.startTime ||
    !value.endTime
  ) {
    return '-';
  }
  return `${formatTimeHHmm(value.startTime as string)}-${formatTimeHHmm(value.endTime as string)}`;
};

const formatLanguages = (value: unknown) => {
  if (!value || !Array.isArray(value) || !value.length) return '-';
  return value
    .map(
      (lang: {language: string; percentage: number}) =>
        `${LanguageMap[lang.language as keyof typeof LanguageMap] || lang.language} (${lang.percentage}%)`,
    )
    .join(', ');
};

export enum ChatSummaryStatus {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  NO_AUDIO = 'NO_AUDIO',
}

export const SUMMARY_STATUS_CONFIG: Record<
  Exclude<ChatSummaryStatus, ChatSummaryStatus.NO_AUDIO>,
  {
    backgroundColor: string;
    dotColor: string;
    label: string;
  }
> = {
  [ChatSummaryStatus.PENDING]: {
    backgroundColor: colors.creamYellow,
    dotColor: colors.amberOrange,
    label: 'Processing',
  },
  [ChatSummaryStatus.IN_PROGRESS]: {
    backgroundColor: colors.creamYellow,
    dotColor: colors.amberOrange,
    label: 'Processing',
  },
  [ChatSummaryStatus.SUCCESS]: {
    backgroundColor: colors.mintGreen,
    dotColor: colors.emeraldGreen,
    label: 'Generated',
  },
  [ChatSummaryStatus.FAILED]: {
    backgroundColor: colors.coralPink,
    dotColor: colors.brickRed,
    label: 'Error',
  },
};

export enum SummaryGenerationStep {
  GENERATING_TRANSCRIPTION = 'Generating transcription',
  DELETING_AUDIO = 'Deleting audio',
  SEGREGATING_UTTERANCES = 'Segregating utterances',
  UNDERSTANDING_CONVERSATION = 'Understanding conversation',
  CHARTING_FLOW = 'Charting flow',
  EXTRACTING_KEY_POINTS = 'Extracting key points',
  IDENTIFYING_THEMES = 'Identifying themes',
  ANALYSING = 'Analysing',
  GENERATING_SUMMARY = 'Generating summary',
  ENRICHING_SUMMARY = 'Enriching summary',
  VALIDATING_SUMMARY = 'Validating summary',
}

export const SUMMARY_GENERATION_STEPS = Object.values(SummaryGenerationStep);

export const PLACES_PER_PAGE = 50;

// Section keys for organizing fields
export enum SectionKey {
  FeaturesAndDemographics = 'featuresAndDemographics',
  SessionSummary = 'sessionSummary',
  Flow = 'flow',
  KeyConcern = 'keyConcern',
  ObjectiveObservations = 'objectiveObservations',
  SubjectiveObservations = 'subjectiveObservations',
  Assessment = 'assessment',
  DominantFeelings = 'dominantFeelings',
  IssuesWorkedOn = 'issuesWorkedOn',
  KeyTherapeuticTechniques = 'keyTherapeuticTechniques',
  ReferralsProvided = 'referralsProvided',
  HomeworkRecommended = 'homeworkRecommended',
  PlanForNextCall = 'planForNextCall',
  Tags = 'tags',
  Metrics = 'metrics',
  AdditionalNotes = 'additionalNotes',
}

// Field names as constants to prevent typos (keys are identical to UI field labels)
export const SUMMARY_FIELDS = {
  // Features & Demographics
  CALL_ID: 'callId',
  CALL_DURATION: 'callDuration',
  CALL_DATE: 'callDate',
  CALL_TIME: 'callTime',
  CALLER_ID: 'clientId',
  COUNSELOR_NAME: 'counselorName',
  CALLER_TYPE: 'callType',
  AGE: 'age',
  GENDER: 'gender',
  PROFESSION: 'profession',
  RELATIONSHIP_STATUS: 'relationshipStatus',
  LANGUAGES: 'languages',
  LOCATION: 'location',
  CONCERN_CODE: 'codeOfConcern',

  // Session Summary
  SESSION_SUMMARY: 'sessionSummary',

  // Flow
  FLOW: 'counselingProcessFlow',

  // Key Concerns
  KEY_CONCERNS: 'keyConcerns',

  // Observations and Assessment
  OBJECTIVE_OBSERVATIONS: 'objectiveObservations',

  // Subjective Observations
  SUBJECTIVE_OBSERVATIONS: 'subjectiveObservations',

  // Assessment
  ASSESSMENT: 'assessment',

  // Dominant Feelings
  DOMINANT_FEELINGS: 'dominantFeelings',

  // Issues Worked On
  ISSUES_WORKED_ON: 'issuesWorkedOn',

  // Key Therapeutic Techniques
  KEY_THERAPEUTIC_TECHNIQUES: 'keyTherapeuticTechniques',

  // Referrals Provided
  REFERRALS_PROVIDED: 'referralsProvided',

  // Homework Recommended
  HOMEWORK_RECOMMENDED: 'homework',

  // Plans for Next Call
  PLAN_FOR_NEXT_CALL: 'planForNextCall',

  // Tags
  TAGS: 'tags',

  // Metrics
  LISTENING_RATIO: 'listeningShare',
  EMOTIONAL_LIFT: 'emotionalLift',
  REFLECTIVE_QUESTIONS_ASKED: 'reflectiveQuestionsAsked',

  // Additional Notes
  ADDITIONAL_NOTES: 'additionalNotes',
} as const;

// Derive the type from the object values
export type SummaryFieldKey =
  (typeof SUMMARY_FIELDS)[keyof typeof SUMMARY_FIELDS];

// Gender options
export const GENDER_OPTIONS = [
  'Male',
  'Female',
  'Non-binary',
  'Client Prefers Not to Say',
] as const;

// Age range options
export const AGE_RANGE_OPTIONS = [
  '18-24',
  '25-34',
  '35-44',
  '45-54',
  '55-64',
  '65+',
] as const;

export const SECTION_LIST: SectionItem[] = [
  {
    key: SectionKey.FeaturesAndDemographics,
    label: 'Features & Demographics',
    icon: CallDetailsIcon,
    canEdit: true,
    canEnhance: false,
  },
  {
    key: SectionKey.SessionSummary,
    label: 'Session Summary',
    icon: SessionSummaryIcon,
    canEdit: true,
    canEnhance: true,
  },
  {
    key: SectionKey.Flow,
    label: 'Flow',
    icon: FlowIcon,
    canEdit: true,
    canEnhance: true,
  },
  {
    key: SectionKey.KeyConcern,
    label: 'Key Concern',
    icon: KeyConcernIcon,
    canEdit: true,
    canEnhance: true,
  },
  {
    key: SectionKey.ObjectiveObservations,
    label: 'Objective Observations',
    icon: TableEyeIcon,
    canEdit: true,
    canEnhance: true,
  },
  {
    key: SectionKey.SubjectiveObservations,
    label: 'Subjective Observations',
    icon: MagnifyEyeIcon,
    canEdit: true,
    canEnhance: true,
  },
  {
    key: SectionKey.Assessment,
    label: 'Assessment',
    icon: AssessmentIcon,
    canEdit: true,
    canEnhance: true,
  },
  {
    key: SectionKey.DominantFeelings,
    label: 'Dominant Feelings',
    icon: SmileIcon,
    canEdit: true,
    canEnhance: true,
  },
  {
    key: SectionKey.IssuesWorkedOn,
    label: 'Issues Worked On',
    icon: BrightnessAlertIcon,
    canEdit: true,
    canEnhance: true,
  },
  {
    key: SectionKey.KeyTherapeuticTechniques,
    label: 'Key Therapeutic Techniques',
    icon: PrescriptionsIcon,
    canEdit: true,
    canEnhance: true,
  },
  {
    key: SectionKey.ReferralsProvided,
    label: 'Referrals Provided',
    icon: HandShareIcon,
    canEdit: true,
    canEnhance: true,
  },
  {
    key: SectionKey.HomeworkRecommended,
    label: 'Home work Recommended',
    icon: NewsStandIcon,
    canEdit: true,
    canEnhance: true,
  },
  {
    key: SectionKey.PlanForNextCall,
    label: 'Plans for Next Call',
    icon: HeadsetMicIcon,
    canEdit: true,
    canEnhance: true,
  },
  {
    key: SectionKey.Tags,
    label: 'Tags',
    icon: TagIcon,
    canEdit: true,
    canEnhance: false,
  },
  {
    key: SectionKey.Metrics,
    label: 'Metrics',
    icon: DatabaseIcon,
    canEdit: false,
    canEnhance: false,
  },
  {
    key: SectionKey.AdditionalNotes,
    label: 'Additional Notes',
    icon: NotesIcon,
    canEdit: false,
    canEnhance: false,
  },
];

// Single source of truth for field configuration
export const summaryFields: SummaryField[] = [
  // Features and Demographics section
  {
    isEditable: false,
    key: SUMMARY_FIELDS.CALL_ID,
    label: 'Call ID',
    sectionKey: SectionKey.FeaturesAndDemographics,
    type: FieldType.Text,
    computeValue: ({callDetails}) => callDetails?.chatId,
  },
  {
    isEditable: false,
    key: SUMMARY_FIELDS.CALL_DURATION,
    label: 'Call Duration',
    sectionKey: SectionKey.FeaturesAndDemographics,
    type: FieldType.Text,
    computeValue: computeFromCallDetailsOrSummary(SUMMARY_FIELDS.CALL_DURATION),
    formatDisplay: (value, t) =>
      formatDurationFromSeconds(value as number, {
        t,
        includeSeconds: false,
        format: 'long',
      }),
  },
  {
    isEditable: false,
    key: SUMMARY_FIELDS.CALL_DATE,
    label: 'Call Date',
    sectionKey: SectionKey.FeaturesAndDemographics,
    type: FieldType.Text,
    computeValue: ({callDetails}) => callDetails?.startTime,
    formatDisplay: value =>
      value && typeof value === 'string' ? formatDateWithOrdinal(value) : '-',
  },
  {
    isEditable: false,
    key: SUMMARY_FIELDS.CALL_TIME,
    label: 'Call Time',
    sectionKey: SectionKey.FeaturesAndDemographics,
    type: FieldType.Text,
    computeValue: ({callDetails}) => ({
      startTime: callDetails?.startTime,
      endTime: callDetails?.endTime,
    }),
    formatDisplay: formatTimeRange,
  },
  {
    isEditable: false,
    key: SUMMARY_FIELDS.CALLER_ID,
    label: 'Caller ID',
    sectionKey: SectionKey.FeaturesAndDemographics,
    type: FieldType.Text,
    computeValue: ({summary, callDetails}) =>
      callDetails?.clientId || summary?.[SUMMARY_FIELDS.CALLER_ID],
    formatDisplay: formatAsStringOrDash,
  },
  {
    isEditable: false,
    key: SUMMARY_FIELDS.COUNSELOR_NAME,
    label: 'Counselor Name',
    sectionKey: SectionKey.FeaturesAndDemographics,
    type: FieldType.Text,
  },
  {
    isEditable: false,
    key: SUMMARY_FIELDS.CALLER_TYPE,
    label: 'Caller Type',
    sectionKey: SectionKey.FeaturesAndDemographics,
    type: FieldType.Text,
  },
  {
    isEditable: true,
    key: SUMMARY_FIELDS.AGE,
    label: 'Age',
    options: AGE_RANGE_OPTIONS,
    sectionKey: SectionKey.FeaturesAndDemographics,
    type: FieldType.Dropdown,
  },
  {
    isEditable: true,
    key: SUMMARY_FIELDS.GENDER,
    label: 'Gender',
    options: GENDER_OPTIONS,
    sectionKey: SectionKey.FeaturesAndDemographics,
    type: FieldType.Dropdown,
  },
  {
    isEditable: true,
    key: SUMMARY_FIELDS.PROFESSION,
    label: 'Profession',
    sectionKey: SectionKey.FeaturesAndDemographics,
    type: FieldType.InlineTextInput,
  },
  {
    isEditable: true,
    key: SUMMARY_FIELDS.RELATIONSHIP_STATUS,
    label: 'Relationship Status',
    sectionKey: SectionKey.FeaturesAndDemographics,
    type: FieldType.InlineTextInput,
  },
  {
    isEditable: false,
    key: SUMMARY_FIELDS.LANGUAGES,
    label: 'Languages',
    sectionKey: SectionKey.FeaturesAndDemographics,
    type: FieldType.Text,
    formatDisplay: formatLanguages,
  },
  {
    isEditable: true,
    key: SUMMARY_FIELDS.LOCATION,
    label: 'Location',
    sectionKey: SectionKey.FeaturesAndDemographics,
    type: FieldType.SearchableDropdown,
  },
  {
    isEditable: true,
    key: SUMMARY_FIELDS.CONCERN_CODE,
    label: 'Concern Code',
    sectionKey: SectionKey.FeaturesAndDemographics,
    type: FieldType.InlineTextInput,
  },

  {
    isEditable: true,
    key: SUMMARY_FIELDS.SESSION_SUMMARY,
    label: 'Session Summary',
    sectionKey: SectionKey.SessionSummary,
    type: FieldType.MultilineTextInput,
  },
  {
    isEditable: true,
    key: SUMMARY_FIELDS.FLOW,
    label: 'Flow',
    sectionKey: SectionKey.Flow,
    type: FieldType.MultilineTextInput,
  },
  {
    isEditable: true,
    key: SUMMARY_FIELDS.KEY_CONCERNS,
    label: 'Key Concerns',
    sectionKey: SectionKey.KeyConcern,
    type: FieldType.MultilineTextInput,
  },
  {
    isEditable: true,
    key: SUMMARY_FIELDS.OBJECTIVE_OBSERVATIONS,
    label: 'Objective Observations',
    sectionKey: SectionKey.ObjectiveObservations,
    type: FieldType.MultilineTextInput,
  },
  {
    isEditable: true,
    key: SUMMARY_FIELDS.SUBJECTIVE_OBSERVATIONS,
    label: 'Subjective Observations',
    sectionKey: SectionKey.SubjectiveObservations,
    type: FieldType.MultilineTextInput,
  },
  {
    isEditable: true,
    key: SUMMARY_FIELDS.ASSESSMENT,
    label: 'Assessment',
    sectionKey: SectionKey.Assessment,
    type: FieldType.MultilineTextInput,
  },
  {
    isEditable: true,
    key: SUMMARY_FIELDS.DOMINANT_FEELINGS,
    label: 'Dominant Feelings',
    sectionKey: SectionKey.DominantFeelings,
    type: FieldType.MultilineTextInput,
  },
  {
    isEditable: true,
    key: SUMMARY_FIELDS.ISSUES_WORKED_ON,
    label: 'Issues Worked On',
    sectionKey: SectionKey.IssuesWorkedOn,
    type: FieldType.MultilineTextInput,
  },
  {
    isEditable: true,
    key: SUMMARY_FIELDS.KEY_THERAPEUTIC_TECHNIQUES,
    label: 'Key Therapeutic Techniques',
    sectionKey: SectionKey.KeyTherapeuticTechniques,
    type: FieldType.MultilineTextInput,
  },
  {
    isEditable: true,
    key: SUMMARY_FIELDS.REFERRALS_PROVIDED,
    label: 'Referrals Provided',
    sectionKey: SectionKey.ReferralsProvided,
    type: FieldType.MultilineTextInput,
  },
  {
    isEditable: true,
    key: SUMMARY_FIELDS.HOMEWORK_RECOMMENDED,
    label: 'Home work Recommended',
    sectionKey: SectionKey.HomeworkRecommended,
    type: FieldType.MultilineTextInput,
  },
  {
    isEditable: true,
    key: SUMMARY_FIELDS.PLAN_FOR_NEXT_CALL,
    label: 'Plans for Next Call',
    sectionKey: SectionKey.PlanForNextCall,
    type: FieldType.MultilineTextInput,
  },
  {
    isEditable: true,
    key: SUMMARY_FIELDS.TAGS,
    label: 'Tags',
    sectionKey: SectionKey.Tags,
    type: FieldType.MultilineTextInput,
  },

  // Metrics section
  {
    isEditable: false,
    key: SUMMARY_FIELDS.LISTENING_RATIO,
    label: 'Listening Share',
    sectionKey: SectionKey.Metrics,
    type: FieldType.Text,
    formatDisplay: formatAsPercentage,
  },
  {
    isEditable: false,
    key: SUMMARY_FIELDS.REFLECTIVE_QUESTIONS_ASKED,
    label: 'Reflective Questions Asked',
    sectionKey: SectionKey.Metrics,
    type: FieldType.Text,
    formatDisplay: formatAsStringOrDash,
  },
  {
    isEditable: false,
    key: SUMMARY_FIELDS.EMOTIONAL_LIFT,
    label: 'Emotional Lift',
    sectionKey: SectionKey.Metrics,
    type: FieldType.Text,
  },

  // Additional Notes section
  {
    isEditable: false,
    key: SUMMARY_FIELDS.ADDITIONAL_NOTES,
    label: 'Additional Notes',
    sectionKey: SectionKey.AdditionalNotes,
    type: FieldType.MultilineTextInput,
    computeValue: ({callDetails}) => callDetails?.callInfo?.notes,
  },
];

export const FIELD_LABELS: Record<SummaryFieldKey, string> =
  summaryFields.reduce(
    (acc, field) => {
      acc[field.key] = field.label;
      return acc;
    },
    {} as Record<SummaryFieldKey, string>,
  );

export const ALWAYS_VISIBLE_SECTIONS = [SectionKey.AdditionalNotes];

export const CallSummaryGenerationData = {
  durationInSeconds: 2503, // 41 mins 43 secs
  summaryGenerationDurationInSeconds: 178, // 2 mins 58 secs
};
