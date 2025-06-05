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
  PrescriptionsIcon,
  SessionSummaryIcon,
  SmileIcon,
  TableEyeIcon,
  TagIcon,
} from '@/assets/icons';
import {FieldType, SummaryField} from '@/types/callSummary';

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
  PlansForNextCall = 'plansForNextCall',
  Tags = 'tags',
  Metrics = 'metrics',
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
  PLANS_FOR_NEXT_CALL: 'planForNextCall',

  // Tags
  TAGS: 'tags',

  // Metrics
  LISTENING_RATIO: 'listeningShare',
  EMOTIONAL_LIFT: 'emotionalLift',
  REFLECTIVE_QUESTIONS_ASKED: 'reflectiveQuestionsAsked',
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

export const SECTION_LIST = [
  {
    key: SectionKey.FeaturesAndDemographics,
    label: 'Features & Demographics',
    icon: CallDetailsIcon,
    canEdit: true,
  },
  {
    key: SectionKey.SessionSummary,
    label: 'Session Summary',
    icon: SessionSummaryIcon,
    canEdit: true,
  },
  {key: SectionKey.Flow, label: 'Flow', icon: FlowIcon, canEdit: true},
  {
    key: SectionKey.KeyConcern,
    label: 'Key Concern',
    icon: KeyConcernIcon,
    canEdit: true,
  },
  {
    key: SectionKey.ObjectiveObservations,
    label: 'Objective Observations',
    icon: TableEyeIcon,
    canEdit: true,
  },
  {
    key: SectionKey.SubjectiveObservations,
    label: 'Subjective Observations',
    icon: MagnifyEyeIcon,
    canEdit: true,
  },
  {
    key: SectionKey.Assessment,
    label: 'Assessment',
    icon: AssessmentIcon,
    canEdit: true,
  },
  {
    key: SectionKey.DominantFeelings,
    label: 'Dominant Feelings',
    icon: SmileIcon,
    canEdit: true,
  },
  {
    key: SectionKey.IssuesWorkedOn,
    label: 'Issues Worked On',
    icon: BrightnessAlertIcon,
    canEdit: true,
  },
  {
    key: SectionKey.KeyTherapeuticTechniques,
    label: 'Key Therapeutic Techniques',
    icon: PrescriptionsIcon,
    canEdit: true,
  },
  {
    key: SectionKey.ReferralsProvided,
    label: 'Referrals Provided',
    icon: HandShareIcon,
    canEdit: true,
  },
  {
    key: SectionKey.HomeworkRecommended,
    label: 'Home work Recommended',
    icon: NewsStandIcon,
    canEdit: true,
  },
  {
    key: SectionKey.PlansForNextCall,
    label: 'Plans for Next Call',
    icon: HeadsetMicIcon,
    canEdit: true,
  },
  {
    key: SectionKey.Tags,
    label: 'Tags',
    icon: TagIcon,
    canEdit: true,
  },
  {
    key: SectionKey.Metrics,
    label: 'Metrics',
    icon: DatabaseIcon,
    canEdit: false,
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
  },
  {
    isEditable: false,
    key: SUMMARY_FIELDS.CALL_DURATION,
    label: 'Call Duration',
    sectionKey: SectionKey.FeaturesAndDemographics,
    type: FieldType.Text,
  },
  {
    isEditable: false,
    key: SUMMARY_FIELDS.CALL_DATE,
    label: 'Call Date',
    sectionKey: SectionKey.FeaturesAndDemographics,
    type: FieldType.Text,
  },
  {
    isEditable: false,
    key: SUMMARY_FIELDS.CALL_TIME,
    label: 'Call Time',
    sectionKey: SectionKey.FeaturesAndDemographics,
    type: FieldType.Text,
  },
  {
    isEditable: false,
    key: SUMMARY_FIELDS.CALLER_ID,
    label: 'Caller ID',
    sectionKey: SectionKey.FeaturesAndDemographics,
    type: FieldType.Text,
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
    isEditable: true,
    key: SUMMARY_FIELDS.LANGUAGES,
    label: 'Languages',
    sectionKey: SectionKey.FeaturesAndDemographics,
    type: FieldType.Text,
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
    key: SUMMARY_FIELDS.PLANS_FOR_NEXT_CALL,
    label: 'Plans for Next Call',
    sectionKey: SectionKey.PlansForNextCall,
    type: FieldType.MultilineTextInput,
  },
  {
    isEditable: true,
    key: SUMMARY_FIELDS.TAGS,
    label: 'Tags',
    sectionKey: SectionKey.Tags,
    type: FieldType.Text,
  },

  // Metrics section
  {
    isEditable: false,
    key: SUMMARY_FIELDS.LISTENING_RATIO,
    label: 'Listening Share',
    sectionKey: SectionKey.Metrics,
    type: FieldType.Text,
  },
  {
    isEditable: false,
    key: SUMMARY_FIELDS.REFLECTIVE_QUESTIONS_ASKED,
    label: 'Reflective Questions Asked',
    sectionKey: SectionKey.Metrics,
    type: FieldType.Text,
  },
  {
    isEditable: false,
    key: SUMMARY_FIELDS.EMOTIONAL_LIFT,
    label: 'Emotional Lift',
    sectionKey: SectionKey.Metrics,
    type: FieldType.Text,
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
