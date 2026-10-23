import {
  AssessmentIcon,
  BrightnessAlertIcon,
  CallDetailsIcon,
  DatabaseIcon,
  FlowIcon,
  HandShareIcon,
  HeadsetMicIcon,
  IntakeIcon,
  KeyConcernIcon,
  MagnifyEyeIcon,
  NewsStandIcon,
  NotesIcon,
  OngoingRisksIcon,
  PrescriptionsIcon,
  SessionSummaryIcon,
  SmileIcon,
  TableEyeIcon,
  TagIcon,
} from '@/assets/icons';
import type {TranslationType} from '@/localization/locales/type';
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

import {ScribeSessionMode} from './chat';
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

/**
 * Translator shape this module needs: a key lookup returning a string.
 *
 * Keyed on `TranslationType` rather than i18next's `TFunction` because the
 * app does not use i18next's `t` directly — `useTranslate` returns its own
 * narrower function, and `SummaryField.formatDisplay` declares a third shape
 * again. `TranslationType` is the one key type all of them accept: it is
 * assignable to the `string` that `formatDisplay` asks for, and narrow enough
 * for `useTranslate`, which will not take a bare `string`.
 *
 * Optional, because `formatDisplay` may be called without a translator. In
 * that case the raw mode is a better answer than a crash, which is what
 * passing `undefined` into a required `TFunction` used to produce.
 */
type ModeTranslate = (
  key: TranslationType,
  params?: Record<string, unknown>,
) => string;

export const formatSessionMode = (value: unknown, t?: ModeTranslate) => {
  if (!value) return '-';
  const mode = value.toString().toUpperCase();
  const key =
    mode === ScribeSessionMode.DICTATION
      ? 'calls.mode.dictation'
      : 'calls.mode.scribe';
  return t ? t(key) : mode;
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
  Intake = 'intake',
  OngoingRisks = 'ongoingRisks',
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
  CALLER_TYPE: 'callType',
  MODE: 'mode',
  AGE: 'age',
  GENDER: 'gender',
  PROFESSION: 'profession',
  RELATIONSHIP_STATUS: 'relationshipStatus',
  LANGUAGES: 'languages',
  LOCATION: 'location',
  CONCERN_CODE: 'codeOfConcern',
  COUNSELLOR: 'counsellor',
  NEW_CALL_FOLLOW_UP: 'newCallFollowUp',

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
  OPEN_ENDED_QUESTIONS_ASKED: 'openEndedQuestionsAsked',

  // Intake section
  INTAKE_NOTES: 'intakeNotes',
  RISK_SELF_HARM: 'riskSelfHarm',
  RISK_SELF_HARM_NOTES: 'riskSelfHarmNotes',
  RISK_SUICIDAL_THOUGHTS: 'riskSuicidalThoughts',
  RISK_SUICIDAL_PLAN: 'riskSuicidalPlan',
  RISK_SUICIDAL_ACTION: 'riskSuicidalAction',
  RISK_SUICIDAL_THOUGHTS_NOTES: 'riskSuicidalThoughtsNotes',
  RISK_RUNNING_AWAY: 'riskRunningAway',
  RISK_RUNNING_AWAY_NOTES: 'riskRunningAwayNotes',
  TRAUMA_PHYSICAL_ABUSE: 'traumaPhysicalAbuse',
  TRAUMA_SEXUAL_ABUSE: 'traumaSexualAbuse',
  TRAUMA_VERBAL_ABUSE: 'traumaVerbalAbuse',
  TRAUMA_NEGLECT: 'traumaNeglect',
  TRAUMA_SEPARATION_FROM_CAREGIVER_PARENT:
    'traumaSeparationFromCaregiverParent',
  TRAUMA_WITNESSED_DOMESTIC_VIOLENCE: 'traumaWitnessedDomesticViolence',
  TRAUMA_NOTES: 'traumaNotes',
  ASSESSMENT_PSYCHOLOGICAL_DIAGNOSIS: 'assessmentPsychologicalDiagnosis',
  ASSESSMENT_PSYCHOLOGICAL_DIAGNOSIS_NOTES:
    'assessmentPsychologicalDiagnosisNotes',
  ASSESSMENT_USE_OF_PSYCHOTROPIC_MEDICATIONS:
    'assessmentUseOfPsychotropicMedications',
  ASSESSMENT_USE_OF_PSYCHOTROPIC_MEDICATIONS_NOTES:
    'assessmentUseOfPsychotropicMedicationsNotes',
  ASSESSMENT_HALLUCINATIONS: 'assessmentHallucinations',
  ASSESSMENT_HALLUCINATIONS_NOTES: 'assessmentHallucinationsNotes',
  ASSESSMENT_AFFECT: 'assessmentAffect',
  ASSESSMENT_SPEECH: 'assessmentSpeech',

  // Ongoing Risks section
  ONGOING_RISK_SELF_HARM: 'ongoingRiskSelfHarm',
  ONGOING_RISK_SELF_HARM_NOTES: 'ongoingRiskSelfHarmNotes',
  ONGOING_RISK_SUICIDAL_THOUGHTS: 'ongoingRiskSuicidalThoughts',
  ONGOING_RISK_SUICIDAL_PLAN: 'ongoingRiskSuicidalPlan',
  ONGOING_RISK_SUICIDAL_ACTION: 'ongoingRiskSuicidalAction',
  ONGOING_RISK_SUICIDAL_THOUGHTS_NOTES: 'ongoingRiskSuicidalThoughtsNotes',

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
  '0-5',
  '6-12',
  '13-17',
  '18-24',
  '25-34',
  '35-44',
  '45-54',
  '55-64',
  '65+',
] as const;

// Yes/No options for intake and ongoing risks
export const YES_NO_OPTIONS = ['Yes', 'No'] as const;

// Assessment Affect options
export const ASSESSMENT_AFFECT_OPTIONS = [
  'Congruent',
  'Incongruent',
  'Flat',
  'Blunted',
] as const;

// Assessment Speech options
export const ASSESSMENT_SPEECH_OPTIONS = [
  'Clear & Coherent',
  'Sluttering',
  'Fast',
  'Slow',
  'Difficult to Understand',
] as const;

export const SECTION_LIST: SectionItem[] = [
  {
    key: SectionKey.FeaturesAndDemographics,
    label: 'Features & Demographics',
    labelKey: 'summary.sections.featuresAndDemographics',
    icon: CallDetailsIcon,
    canEdit: true,
    canEnhance: false,
  },
  {
    key: SectionKey.SessionSummary,
    label: 'Session Summary',
    labelKey: 'summary.sections.sessionSummary',
    icon: SessionSummaryIcon,
    canEdit: true,
    canEnhance: true,
  },
  {
    key: SectionKey.Flow,
    label: 'Flow',
    labelKey: 'summary.sections.flow',
    icon: FlowIcon,
    canEdit: true,
    canEnhance: true,
  },
  {
    key: SectionKey.KeyConcern,
    label: 'Key Concern',
    labelKey: 'summary.sections.keyConcerns',
    icon: KeyConcernIcon,
    canEdit: true,
    canEnhance: true,
  },
  {
    key: SectionKey.ObjectiveObservations,
    label: 'Objective Observations',
    labelKey: 'summary.sections.objectiveObservations',
    icon: TableEyeIcon,
    canEdit: true,
    canEnhance: true,
  },
  {
    key: SectionKey.SubjectiveObservations,
    label: 'Subjective Observations',
    labelKey: 'summary.sections.subjectiveObservations',
    icon: MagnifyEyeIcon,
    canEdit: true,
    canEnhance: true,
  },
  {
    key: SectionKey.Assessment,
    label: 'Assessment',
    labelKey: 'summary.sections.assessment',
    icon: AssessmentIcon,
    canEdit: true,
    canEnhance: true,
  },
  {
    key: SectionKey.DominantFeelings,
    label: 'Dominant Feelings',
    labelKey: 'summary.sections.dominantFeelings',
    icon: SmileIcon,
    canEdit: true,
    canEnhance: true,
  },
  {
    key: SectionKey.IssuesWorkedOn,
    label: 'Issues Worked On',
    labelKey: 'summary.sections.issuesWorkedOn',
    icon: BrightnessAlertIcon,
    canEdit: true,
    canEnhance: true,
  },
  {
    key: SectionKey.KeyTherapeuticTechniques,
    label: 'Key Therapeutic Techniques',
    labelKey: 'summary.sections.keyTherapeuticTechniques',
    icon: PrescriptionsIcon,
    canEdit: true,
    canEnhance: true,
  },
  {
    key: SectionKey.ReferralsProvided,
    label: 'Referrals Provided',
    labelKey: 'summary.sections.referralsProvided',
    icon: HandShareIcon,
    canEdit: true,
    canEnhance: true,
  },
  {
    key: SectionKey.HomeworkRecommended,
    label: 'Home work Recommended',
    labelKey: 'summary.sections.homeworkRecommended',
    icon: NewsStandIcon,
    canEdit: true,
    canEnhance: true,
  },
  {
    key: SectionKey.PlanForNextCall,
    label: 'Plans for Next Call',
    labelKey: 'summary.sections.plansForNextCall',
    icon: HeadsetMicIcon,
    canEdit: true,
    canEnhance: true,
  },
  {
    key: SectionKey.Tags,
    label: 'Tags',
    labelKey: 'summary.sections.tags',
    icon: TagIcon,
    canEdit: true,
    canEnhance: false,
  },
  {
    key: SectionKey.Metrics,
    label: 'Metrics',
    labelKey: 'summary.sections.metrics',
    icon: DatabaseIcon,
    canEdit: false,
    canEnhance: false,
  },
  {
    key: SectionKey.Intake,
    label: 'Intake',
    labelKey: 'summary.sections.intake',
    icon: IntakeIcon,
    canEdit: true,
    canEnhance: false,
  },
  {
    key: SectionKey.OngoingRisks,
    label: 'Risk Assessment',
    labelKey: 'summary.sections.ongoingRisks',
    icon: OngoingRisksIcon,
    canEdit: true,
    canEnhance: false,
  },
  {
    key: SectionKey.AdditionalNotes,
    label: 'Additional Notes',
    labelKey: 'summary.sections.additionalNotes',
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
    key: SUMMARY_FIELDS.CALLER_TYPE,
    label: 'Caller Type',
    sectionKey: SectionKey.FeaturesAndDemographics,
    type: FieldType.Text,
  },
  {
    isEditable: false,
    key: SUMMARY_FIELDS.MODE,
    label: 'Mode',
    sectionKey: SectionKey.FeaturesAndDemographics,
    type: FieldType.Text,
    computeValue: ({callInfo}) => callInfo?.mode,
    formatDisplay: (value, t) => formatSessionMode(value, t),
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
    key: SUMMARY_FIELDS.COUNSELLOR,
    label: 'Counselor',
    sectionKey: SectionKey.FeaturesAndDemographics,
    type: FieldType.InlineTextInput,
  },
  {
    isEditable: true,
    key: SUMMARY_FIELDS.NEW_CALL_FOLLOW_UP,
    label: 'New Call Follow Up',
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
  {
    isEditable: false,
    key: SUMMARY_FIELDS.OPEN_ENDED_QUESTIONS_ASKED,
    label: 'Open Ended Questions Asked',
    sectionKey: SectionKey.Metrics,
    type: FieldType.Text,
    formatDisplay: formatAsStringOrDash,
  },

  // Intake section
  {
    isEditable: true,
    key: SUMMARY_FIELDS.INTAKE_NOTES,
    label: 'Intake Notes',
    sectionKey: SectionKey.Intake,
    type: FieldType.InlineTextInput,
    placeholder: 'Add note',
  },
  {
    isEditable: true,
    key: SUMMARY_FIELDS.RISK_SELF_HARM,
    label: 'Risk, Self Harm',
    sectionKey: SectionKey.Intake,
    type: FieldType.Dropdown,
    options: YES_NO_OPTIONS,
  },
  {
    isEditable: true,
    key: SUMMARY_FIELDS.RISK_SELF_HARM_NOTES,
    label: 'Risk, Self\nHarm Notes',
    sectionKey: SectionKey.Intake,
    type: FieldType.InlineTextInput,
    placeholder: 'Add note',
  },
  {
    isEditable: true,
    key: SUMMARY_FIELDS.RISK_SUICIDAL_THOUGHTS,
    label: 'Risk, Suicidal Thoughts',
    sectionKey: SectionKey.Intake,
    type: FieldType.Dropdown,
    options: YES_NO_OPTIONS,
  },
  {
    isEditable: true,
    key: SUMMARY_FIELDS.RISK_SUICIDAL_THOUGHTS_NOTES,
    label: 'Risk, Suicidal\nThoughts Notes',
    sectionKey: SectionKey.Intake,
    type: FieldType.InlineTextInput,
    placeholder: 'Add note',
  },
  {
    isEditable: true,
    key: SUMMARY_FIELDS.RISK_SUICIDAL_PLAN,
    label: 'Risk, Suicidal Plan',
    sectionKey: SectionKey.Intake,
    type: FieldType.Dropdown,
    options: YES_NO_OPTIONS,
  },
  {
    isEditable: true,
    key: SUMMARY_FIELDS.RISK_SUICIDAL_ACTION,
    label: 'Risk, Suicidal Action',
    sectionKey: SectionKey.Intake,
    type: FieldType.Dropdown,
    options: YES_NO_OPTIONS,
  },
  {
    isEditable: true,
    key: SUMMARY_FIELDS.RISK_RUNNING_AWAY,
    label: 'Risk, Running Away',
    sectionKey: SectionKey.Intake,
    type: FieldType.Dropdown,
    options: YES_NO_OPTIONS,
  },
  {
    isEditable: true,
    key: SUMMARY_FIELDS.RISK_RUNNING_AWAY_NOTES,
    label: 'Risk, Running\nAway Notes',
    sectionKey: SectionKey.Intake,
    type: FieldType.InlineTextInput,
    placeholder: 'Add note',
  },
  {
    isEditable: true,
    key: SUMMARY_FIELDS.TRAUMA_PHYSICAL_ABUSE,
    label: 'Trauma, Physical Abuse',
    sectionKey: SectionKey.Intake,
    type: FieldType.Dropdown,
    options: YES_NO_OPTIONS,
  },
  {
    isEditable: true,
    key: SUMMARY_FIELDS.TRAUMA_SEXUAL_ABUSE,
    label: 'Trauma, Sexual Abuse',
    sectionKey: SectionKey.Intake,
    type: FieldType.Dropdown,
    options: YES_NO_OPTIONS,
  },
  {
    isEditable: true,
    key: SUMMARY_FIELDS.TRAUMA_VERBAL_ABUSE,
    label: 'Trauma, Verbal Abuse',
    sectionKey: SectionKey.Intake,
    type: FieldType.Dropdown,
    options: YES_NO_OPTIONS,
  },
  {
    isEditable: true,
    key: SUMMARY_FIELDS.TRAUMA_NEGLECT,
    label: 'Trauma, Neglect',
    sectionKey: SectionKey.Intake,
    type: FieldType.Dropdown,
    options: YES_NO_OPTIONS,
  },
  {
    isEditable: true,
    key: SUMMARY_FIELDS.TRAUMA_SEPARATION_FROM_CAREGIVER_PARENT,
    label: 'Trauma, Separation from\nCaregiver/Parent',
    sectionKey: SectionKey.Intake,
    type: FieldType.Dropdown,
    options: YES_NO_OPTIONS,
  },
  {
    isEditable: true,
    key: SUMMARY_FIELDS.TRAUMA_WITNESSED_DOMESTIC_VIOLENCE,
    label: 'Trauma, Witnessed\nDomestic Violence',
    sectionKey: SectionKey.Intake,
    type: FieldType.Dropdown,
    options: YES_NO_OPTIONS,
  },
  {
    isEditable: true,
    key: SUMMARY_FIELDS.TRAUMA_NOTES,
    label: 'Trauma Notes',
    sectionKey: SectionKey.Intake,
    type: FieldType.InlineTextInput,
    placeholder: 'Add note',
  },
  {
    isEditable: true,
    key: SUMMARY_FIELDS.ASSESSMENT_PSYCHOLOGICAL_DIAGNOSIS,
    label: 'Assessment,\nPsychological Diagnosis',
    sectionKey: SectionKey.Intake,
    type: FieldType.Dropdown,
    options: YES_NO_OPTIONS,
  },
  {
    isEditable: true,
    key: SUMMARY_FIELDS.ASSESSMENT_PSYCHOLOGICAL_DIAGNOSIS_NOTES,
    label: 'Assessment, Psychological\nDiagnosis Notes',
    sectionKey: SectionKey.Intake,
    type: FieldType.InlineTextInput,
    placeholder: 'Add note',
  },
  {
    isEditable: true,
    key: SUMMARY_FIELDS.ASSESSMENT_USE_OF_PSYCHOTROPIC_MEDICATIONS,
    label: 'Assessment, Use of\nPsychotropic Medications',
    sectionKey: SectionKey.Intake,
    type: FieldType.Dropdown,
    options: YES_NO_OPTIONS,
  },
  {
    isEditable: true,
    key: SUMMARY_FIELDS.ASSESSMENT_USE_OF_PSYCHOTROPIC_MEDICATIONS_NOTES,
    label: 'Assessment, Use of Psychotropic\nMedications Notes',
    sectionKey: SectionKey.Intake,
    type: FieldType.InlineTextInput,
    placeholder: 'Add note',
  },
  {
    isEditable: true,
    key: SUMMARY_FIELDS.ASSESSMENT_HALLUCINATIONS,
    label: 'Assessment, Hallucinations',
    sectionKey: SectionKey.Intake,
    type: FieldType.Dropdown,
    options: YES_NO_OPTIONS,
  },
  {
    isEditable: true,
    key: SUMMARY_FIELDS.ASSESSMENT_HALLUCINATIONS_NOTES,
    label: 'Assessment,\nHallucinations Notes',
    sectionKey: SectionKey.Intake,
    type: FieldType.InlineTextInput,
    placeholder: 'Add note',
  },
  {
    isEditable: true,
    key: SUMMARY_FIELDS.ASSESSMENT_AFFECT,
    label: 'Assessment, Affect',
    sectionKey: SectionKey.Intake,
    type: FieldType.Dropdown,
    options: ASSESSMENT_AFFECT_OPTIONS,
  },
  {
    isEditable: true,
    key: SUMMARY_FIELDS.ASSESSMENT_SPEECH,
    label: 'Assessment, Speech',
    sectionKey: SectionKey.Intake,
    type: FieldType.Dropdown,
    options: ASSESSMENT_SPEECH_OPTIONS,
  },

  // Ongoing Risks section
  {
    isEditable: true,
    key: SUMMARY_FIELDS.ONGOING_RISK_SELF_HARM,
    label: 'Ongoing Risk, Self Harm',
    sectionKey: SectionKey.OngoingRisks,
    type: FieldType.Dropdown,
    options: YES_NO_OPTIONS,
  },
  {
    isEditable: true,
    key: SUMMARY_FIELDS.ONGOING_RISK_SELF_HARM_NOTES,
    label: 'Ongoing Risk,\nSelf Harm Notes',
    sectionKey: SectionKey.OngoingRisks,
    type: FieldType.InlineTextInput,
    placeholder: 'Add note',
  },
  {
    isEditable: true,
    key: SUMMARY_FIELDS.ONGOING_RISK_SUICIDAL_THOUGHTS,
    label: 'Ongoing Risk, Suicidal Thoughts',
    sectionKey: SectionKey.OngoingRisks,
    type: FieldType.Dropdown,
    options: YES_NO_OPTIONS,
  },
  {
    isEditable: true,
    key: SUMMARY_FIELDS.ONGOING_RISK_SUICIDAL_PLAN,
    label: 'Ongoing Risk, Suicidal Plan',
    sectionKey: SectionKey.OngoingRisks,
    type: FieldType.Dropdown,
    options: YES_NO_OPTIONS,
  },
  {
    isEditable: true,
    key: SUMMARY_FIELDS.ONGOING_RISK_SUICIDAL_ACTION,
    label: 'Ongoing Risk, Suicidal Action',
    sectionKey: SectionKey.OngoingRisks,
    type: FieldType.Dropdown,
    options: YES_NO_OPTIONS,
  },
  {
    isEditable: true,
    key: SUMMARY_FIELDS.ONGOING_RISK_SUICIDAL_THOUGHTS_NOTES,
    label: 'Ongoing Risk,\nSuicidal Thoughts Notes',
    sectionKey: SectionKey.OngoingRisks,
    type: FieldType.InlineTextInput,
    placeholder: 'Add note',
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

// i18n keys for field labels, resolved via t() at render time.
// Field keys are data identifiers, so they don't always match the
// `summary.fields.*` translation key — hence this explicit mapping.
export const FIELD_LABEL_KEYS: Record<SummaryFieldKey, TranslationType> = {
  [SUMMARY_FIELDS.CALL_ID]: 'summary.fields.callId',
  [SUMMARY_FIELDS.CALL_DURATION]: 'summary.fields.callDuration',
  [SUMMARY_FIELDS.CALL_DATE]: 'summary.fields.callDate',
  [SUMMARY_FIELDS.CALL_TIME]: 'summary.fields.callTime',
  [SUMMARY_FIELDS.CALLER_ID]: 'summary.fields.callerId',
  [SUMMARY_FIELDS.CALLER_TYPE]: 'summary.fields.callerType',
  [SUMMARY_FIELDS.MODE]: 'summary.fields.mode',
  [SUMMARY_FIELDS.AGE]: 'summary.fields.age',
  [SUMMARY_FIELDS.GENDER]: 'summary.fields.gender',
  [SUMMARY_FIELDS.PROFESSION]: 'summary.fields.profession',
  [SUMMARY_FIELDS.RELATIONSHIP_STATUS]: 'summary.fields.relationshipStatus',
  [SUMMARY_FIELDS.LANGUAGES]: 'summary.fields.languages',
  [SUMMARY_FIELDS.LOCATION]: 'summary.fields.location',
  [SUMMARY_FIELDS.CONCERN_CODE]: 'summary.fields.concernCode',
  [SUMMARY_FIELDS.COUNSELLOR]: 'summary.fields.counsellor',
  [SUMMARY_FIELDS.NEW_CALL_FOLLOW_UP]: 'summary.fields.newCallFollowUp',
  [SUMMARY_FIELDS.SESSION_SUMMARY]: 'summary.fields.sessionSummary',
  [SUMMARY_FIELDS.FLOW]: 'summary.fields.flow',
  [SUMMARY_FIELDS.KEY_CONCERNS]: 'summary.fields.keyConcerns',
  [SUMMARY_FIELDS.OBJECTIVE_OBSERVATIONS]:
    'summary.fields.objectiveObservations',
  [SUMMARY_FIELDS.SUBJECTIVE_OBSERVATIONS]:
    'summary.fields.subjectiveObservations',
  [SUMMARY_FIELDS.ASSESSMENT]: 'summary.fields.assessment',
  [SUMMARY_FIELDS.DOMINANT_FEELINGS]: 'summary.fields.dominantFeelings',
  [SUMMARY_FIELDS.ISSUES_WORKED_ON]: 'summary.fields.issuesWorkedOn',
  [SUMMARY_FIELDS.KEY_THERAPEUTIC_TECHNIQUES]:
    'summary.fields.keyTherapeuticTechniques',
  [SUMMARY_FIELDS.REFERRALS_PROVIDED]: 'summary.fields.referralsProvided',
  [SUMMARY_FIELDS.HOMEWORK_RECOMMENDED]: 'summary.fields.homeworkRecommended',
  [SUMMARY_FIELDS.PLAN_FOR_NEXT_CALL]: 'summary.fields.plansForNextCall',
  [SUMMARY_FIELDS.TAGS]: 'summary.fields.tags',
  [SUMMARY_FIELDS.LISTENING_RATIO]: 'summary.fields.listeningRatio',
  [SUMMARY_FIELDS.REFLECTIVE_QUESTIONS_ASKED]:
    'summary.fields.reflectiveQuestions',
  [SUMMARY_FIELDS.EMOTIONAL_LIFT]: 'summary.fields.emotionsLift',
  [SUMMARY_FIELDS.OPEN_ENDED_QUESTIONS_ASKED]:
    'summary.fields.openEndedQuestions',
  [SUMMARY_FIELDS.INTAKE_NOTES]: 'summary.fields.intakeNotes',
  [SUMMARY_FIELDS.RISK_SELF_HARM]: 'summary.fields.riskSelfHarm',
  [SUMMARY_FIELDS.RISK_SELF_HARM_NOTES]: 'summary.fields.riskSelfHarmNotes',
  [SUMMARY_FIELDS.RISK_SUICIDAL_THOUGHTS]:
    'summary.fields.riskSuicidalThoughts',
  [SUMMARY_FIELDS.RISK_SUICIDAL_THOUGHTS_NOTES]:
    'summary.fields.riskSuicidalThoughtsNotes',
  [SUMMARY_FIELDS.RISK_SUICIDAL_PLAN]: 'summary.fields.riskSuicidalPlan',
  [SUMMARY_FIELDS.RISK_SUICIDAL_ACTION]: 'summary.fields.riskSuicidalAction',
  [SUMMARY_FIELDS.RISK_RUNNING_AWAY]: 'summary.fields.riskRunningAway',
  [SUMMARY_FIELDS.RISK_RUNNING_AWAY_NOTES]:
    'summary.fields.riskRunningAwayNotes',
  [SUMMARY_FIELDS.TRAUMA_PHYSICAL_ABUSE]: 'summary.fields.traumaPhysicalAbuse',
  [SUMMARY_FIELDS.TRAUMA_SEXUAL_ABUSE]: 'summary.fields.traumaSexualAbuse',
  [SUMMARY_FIELDS.TRAUMA_VERBAL_ABUSE]: 'summary.fields.traumaVerbalAbuse',
  [SUMMARY_FIELDS.TRAUMA_NEGLECT]: 'summary.fields.traumaNeglect',
  [SUMMARY_FIELDS.TRAUMA_SEPARATION_FROM_CAREGIVER_PARENT]:
    'summary.fields.traumaSeparation',
  [SUMMARY_FIELDS.TRAUMA_WITNESSED_DOMESTIC_VIOLENCE]:
    'summary.fields.traumaDomesticViolence',
  [SUMMARY_FIELDS.TRAUMA_NOTES]: 'summary.fields.traumaNotes',
  [SUMMARY_FIELDS.ASSESSMENT_PSYCHOLOGICAL_DIAGNOSIS]:
    'summary.fields.assessmentPsychDiagnosis',
  [SUMMARY_FIELDS.ASSESSMENT_PSYCHOLOGICAL_DIAGNOSIS_NOTES]:
    'summary.fields.assessmentPsychDiagnosisNotes',
  [SUMMARY_FIELDS.ASSESSMENT_USE_OF_PSYCHOTROPIC_MEDICATIONS]:
    'summary.fields.assessmentPsychotropicMeds',
  [SUMMARY_FIELDS.ASSESSMENT_USE_OF_PSYCHOTROPIC_MEDICATIONS_NOTES]:
    'summary.fields.assessmentPsychotropicMedsNotes',
  [SUMMARY_FIELDS.ASSESSMENT_HALLUCINATIONS]:
    'summary.fields.assessmentHallucinations',
  [SUMMARY_FIELDS.ASSESSMENT_HALLUCINATIONS_NOTES]:
    'summary.fields.assessmentHallucinationsNotes',
  [SUMMARY_FIELDS.ASSESSMENT_AFFECT]: 'summary.fields.assessmentAffect',
  [SUMMARY_FIELDS.ASSESSMENT_SPEECH]: 'summary.fields.assessmentSpeech',
  [SUMMARY_FIELDS.ONGOING_RISK_SELF_HARM]: 'summary.fields.ongoingRiskSelfHarm',
  [SUMMARY_FIELDS.ONGOING_RISK_SELF_HARM_NOTES]:
    'summary.fields.ongoingRiskSelfHarmNotes',
  [SUMMARY_FIELDS.ONGOING_RISK_SUICIDAL_THOUGHTS]:
    'summary.fields.ongoingRiskSuicidalThoughts',
  [SUMMARY_FIELDS.ONGOING_RISK_SUICIDAL_PLAN]:
    'summary.fields.ongoingRiskSuicidalPlan',
  [SUMMARY_FIELDS.ONGOING_RISK_SUICIDAL_ACTION]:
    'summary.fields.ongoingRiskSuicidalAction',
  [SUMMARY_FIELDS.ONGOING_RISK_SUICIDAL_THOUGHTS_NOTES]:
    'summary.fields.ongoingRiskSuicidalThoughtsNotes',
  [SUMMARY_FIELDS.ADDITIONAL_NOTES]: 'summary.fields.additionalNotes',
};

export const ALWAYS_VISIBLE_SECTIONS = [SectionKey.AdditionalNotes];

export const CallSummaryGenerationData = {
  durationInSeconds: 2503, // 41 mins 43 secs
  summaryGenerationDurationInSeconds: 178, // 2 mins 58 secs
};

export const ASK_AI_EMPTY_STATE_QUESTIONS = [
  'Where did I respond most effectively in this session?',
  'How was my pacing and presence overall?',
  'Where might I have missed or misread the client?',
  'What therapeutic techniques/moves were most helpful?',
];
