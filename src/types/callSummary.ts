type FieldType = 'Text' | 'Number' | 'Dropdown' | 'Multiline' | 'Boolean';

export enum SectionKey {
  CallDetails = 'callDetails',
  KeyConcern = 'keyConcern',
  CallHighlights = 'callHighlights',
  Demographics = 'demographics',
  Flow = 'flow',
}

interface SummaryField {
  isEditable: boolean;
  isEnhanceable?: boolean;
  key: string;
  label: string;
  options?: string[];
  sectionKey: SectionKey;
  type: FieldType;
}

// Future API response type
export interface CallSummaryAPIResponse {
  // Call Details section
  callDate?: string;
  callTime?: string;
  callerType?: string;
  counsellorName?: string;

  // Demographics section
  callerId?: string;
  age?: number;
  gender?: string;
  location?: string;
  profession?: string;
  concernCode?: string;
  formalDiagnosis?: string;

  // Call Highlights section
  callLastedOver?: number;
  youAsked?: number;
  usedCopilot?: number;
  listeningRatio?: number;
  moodImprovedBy?: number;

  // Other fields
  flow?: string;
  keyConcerns?: string;
}

// Processed/formatted data type
export interface FormattedSummaryValues {
  // Call Details section
  callDate?: string;
  callTime?: string;
  callerType?: string;
  counsellorName?: string;

  // Demographics section
  callerId?: string;
  age?: number;
  gender?: string;
  location?: string;
  profession?: string;
  concernCode?: string;
  formalDiagnosis?: string;

  // Call Highlights section
  callLastedOver?: number;
  youAsked?: number;
  usedCopilot?: number;
  listeningRatio?: number;
  moodImprovedBy?: number;

  // Other fields
  flow?: string;
  keyConcerns?: string;
}

interface VisibleFields {
  [key: string]: boolean;
}

// TO DO: Remove later (Current configuration - can be moved to API later)
export const summaryFields: SummaryField[] = [
  // Call Details section
  {
    isEditable: false,
    key: 'callDate',
    label: 'Call Date',
    sectionKey: SectionKey.CallDetails,
    type: 'Text',
  },
  {
    isEditable: false,
    key: 'callTime',
    label: 'Call time',
    sectionKey: SectionKey.CallDetails,
    type: 'Text',
  },
  {
    isEditable: false,
    key: 'callerType',
    label: 'Caller type',
    sectionKey: SectionKey.CallDetails,
    type: 'Text',
  },
  {
    isEditable: false,
    key: 'counsellorName',
    label: 'Counsellor Name',
    sectionKey: SectionKey.CallDetails,
    type: 'Text',
  },

  // Demographics section
  {
    isEditable: false,
    key: 'callerId',
    label: 'Caller ID',
    sectionKey: SectionKey.Demographics,
    type: 'Text',
  },
  {
    isEditable: true,
    key: 'age',
    label: 'Age',
    sectionKey: SectionKey.Demographics,
    type: 'Number',
  },
  {
    isEditable: true,
    key: 'gender',
    label: 'Gender',
    options: ['Male', 'Female', 'Other', 'Prefer not to say'],
    sectionKey: SectionKey.Demographics,
    type: 'Text',
  },
  {
    isEditable: true,
    key: 'location',
    label: 'Location',
    sectionKey: SectionKey.Demographics,
    type: 'Text',
  },
  {
    isEditable: true,
    key: 'profession',
    label: 'Profession',
    sectionKey: SectionKey.Demographics,
    type: 'Text',
  },
  {
    isEditable: true,
    key: 'concernCode',
    label: 'Concern code',
    sectionKey: SectionKey.Demographics,
    type: 'Text',
  },
  {
    isEditable: true,
    key: 'formalDiagnosis',
    label: 'Formal diagnosis',
    sectionKey: SectionKey.Demographics,
    type: 'Multiline',
  },

  // Call Highlights section
  {
    isEditable: false,
    key: 'callLastedOver',
    label: 'Call lasted over',
    sectionKey: SectionKey.CallHighlights,
    type: 'Text',
  },
  {
    isEditable: false,
    key: 'youAsked',
    label: 'You asked',
    sectionKey: SectionKey.CallHighlights,
    type: 'Text',
  },
  {
    isEditable: false,
    key: 'usedCopilot',
    label: 'Used Copilot',
    sectionKey: SectionKey.CallHighlights,
    type: 'Boolean',
  },
  {
    isEditable: false,
    key: 'listeningRatio',
    label: 'Listening Ratio',
    sectionKey: SectionKey.CallHighlights,
    type: 'Text',
  },
  {
    isEditable: false,
    key: 'moodImprovedBy',
    label: 'Mood improved by',
    sectionKey: SectionKey.CallHighlights,
    type: 'Text',
  },

  // Other fields
  {
    isEditable: true,
    isEnhanceable: true,
    key: 'flow',
    label: 'Flow',
    sectionKey: SectionKey.Flow,
    type: 'Multiline',
  },
  {
    isEditable: true,
    isEnhanceable: true,
    key: 'keyConcerns',
    label: 'Key concerns',
    sectionKey: SectionKey.KeyConcern,
    type: 'Multiline',
  },
];

// Current configuration - can be moved to API later
export const visibleFields: VisibleFields = {
  age: true,
  callDate: true,
  callerId: true,
  callLastedOver: true,
  callTime: true,
  callerType: true,
  concernCode: true,
  counsellorName: true,
  flow: true,
  formalDiagnosis: true,
  gender: true,
  keyConcerns: true,
  listeningRatio: true,
  location: true,
  moodImprovedBy: true,
  profession: true,
  usedCopilot: true,
  youAsked: true,
};
