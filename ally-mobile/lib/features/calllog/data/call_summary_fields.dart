/// Port of ally-mobile (React Native)'s `src/constants/summary.ts` —
/// `SECTION_LIST` + `summaryFields`, the single source of truth for the
/// structured clinical call-summary form. AI-enhance per section, export,
/// tag *ratings* (as opposed to the tag names themselves, which this does
/// edit), the Ask-AI chat, and the separately backend-configurable
/// "custom fields" system are real further work, not ported here.
library;

enum SummarySection {
  // canEdit/canEnhance mirror RN's `SECTION_LIST` (`src/constants/
  // summary.ts`) exactly — `canEdit` gates whether the section's pencil/
  // edit-mode toggle appears at all (further gated by admin/counsellor
  // permission at the call site); `canEnhance` additionally gates the
  // AI-enhance wand button while editing.
  featuresAndDemographics('Features & Demographics', canEdit: true, canEnhance: false),
  sessionSummary('Session Summary', canEdit: true, canEnhance: true),
  flow('Flow', canEdit: true, canEnhance: true),
  keyConcern('Key Concern', canEdit: true, canEnhance: true),
  objectiveObservations('Objective Observations', canEdit: true, canEnhance: true),
  subjectiveObservations('Subjective Observations', canEdit: true, canEnhance: true),
  assessment('Assessment', canEdit: true, canEnhance: true),
  dominantFeelings('Dominant Feelings', canEdit: true, canEnhance: true),
  issuesWorkedOn('Issues Worked On', canEdit: true, canEnhance: true),
  keyTherapeuticTechniques('Key Therapeutic Techniques', canEdit: true, canEnhance: true),
  referralsProvided('Referrals Provided', canEdit: true, canEnhance: true),
  homeworkRecommended('Homework Recommended', canEdit: true, canEnhance: true),
  planForNextCall('Plans for Next Call', canEdit: true, canEnhance: true),
  tags('Tags', canEdit: true, canEnhance: false),
  metrics('Metrics', canEdit: false, canEnhance: false),
  intake('Intake', canEdit: true, canEnhance: false),
  ongoingRisks('Risk Assessment', canEdit: true, canEnhance: false),
  additionalNotes('Additional Notes', canEdit: false, canEnhance: false);

  const SummarySection(this.label, {required this.canEdit, required this.canEnhance});
  final String label;
  final bool canEdit;
  final bool canEnhance;
}

/// [searchableDropdown] is RN `FieldType.SearchableDropdown` — the Location
/// field's places picker (`SearchableLocationDropdown`).
enum SummaryFieldType { text, multilineText, inlineText, dropdown, searchableDropdown }

class SummaryFieldDef {
  const SummaryFieldDef({
    required this.key,
    required this.label,
    required this.section,
    required this.type,
    this.editable = true,
    this.options,
  });

  final String key;
  final String label;
  final SummarySection section;
  final SummaryFieldType type;
  final bool editable;
  final List<String>? options;
}

const _ageRangeOptions = [
  '0-5',
  '6-12',
  '13-17',
  '18-24',
  '25-34',
  '35-44',
  '45-54',
  '55-64',
  '65+',
];
const _genderOptions = [
  'Male',
  'Female',
  'Non-binary',
  'Client Prefers Not to Say',
];
const _yesNoOptions = ['Yes', 'No'];
const _assessmentAffectOptions = [
  'Congruent',
  'Incongruent',
  'Flat',
  'Blunted',
];
const _assessmentSpeechOptions = [
  'Clear & Coherent',
  'Sluttering',
  'Fast',
  'Slow',
  'Difficult to Understand',
];

/// Field keys read-only here, same set the RN screen computes from
/// `callDetails`/`callInfo` rather than the editable `summary.*` map:
/// callId, callDuration, callDate, callTime, callerId, callerType, mode,
/// languages, the Metrics section, and additionalNotes.
const summaryFieldDefs = <SummaryFieldDef>[
  // Features & Demographics
  SummaryFieldDef(
    key: 'callId',
    label: 'Call ID',
    section: SummarySection.featuresAndDemographics,
    type: SummaryFieldType.text,
    editable: false,
  ),
  SummaryFieldDef(
    key: 'callDuration',
    label: 'Call Duration',
    section: SummarySection.featuresAndDemographics,
    type: SummaryFieldType.text,
    editable: false,
  ),
  SummaryFieldDef(
    key: 'callDate',
    label: 'Call Date',
    section: SummarySection.featuresAndDemographics,
    type: SummaryFieldType.text,
    editable: false,
  ),
  SummaryFieldDef(
    key: 'callTime',
    label: 'Call Time',
    section: SummarySection.featuresAndDemographics,
    type: SummaryFieldType.text,
    editable: false,
  ),
  SummaryFieldDef(
    key: 'clientId',
    label: 'Caller ID',
    section: SummarySection.featuresAndDemographics,
    type: SummaryFieldType.text,
    editable: false,
  ),
  SummaryFieldDef(
    key: 'callType',
    label: 'Caller Type',
    section: SummarySection.featuresAndDemographics,
    type: SummaryFieldType.text,
    editable: false,
  ),
  SummaryFieldDef(
    key: 'mode',
    label: 'Mode',
    section: SummarySection.featuresAndDemographics,
    type: SummaryFieldType.text,
    editable: false,
  ),
  SummaryFieldDef(
    key: 'age',
    label: 'Age',
    section: SummarySection.featuresAndDemographics,
    type: SummaryFieldType.dropdown,
    options: _ageRangeOptions,
  ),
  SummaryFieldDef(
    key: 'gender',
    label: 'Gender',
    section: SummarySection.featuresAndDemographics,
    type: SummaryFieldType.dropdown,
    options: _genderOptions,
  ),
  SummaryFieldDef(
    key: 'profession',
    label: 'Profession',
    section: SummarySection.featuresAndDemographics,
    type: SummaryFieldType.inlineText,
  ),
  SummaryFieldDef(
    key: 'relationshipStatus',
    label: 'Relationship Status',
    section: SummarySection.featuresAndDemographics,
    type: SummaryFieldType.inlineText,
  ),
  SummaryFieldDef(
    key: 'languages',
    label: 'Languages',
    section: SummarySection.featuresAndDemographics,
    type: SummaryFieldType.text,
    editable: false,
  ),
  SummaryFieldDef(
    key: 'location',
    label: 'Location',
    section: SummarySection.featuresAndDemographics,
    // RN `FieldType.SearchableDropdown`: picked from `/places`.
    type: SummaryFieldType.searchableDropdown,
  ),
  SummaryFieldDef(
    key: 'codeOfConcern',
    label: 'Concern Code',
    section: SummarySection.featuresAndDemographics,
    type: SummaryFieldType.inlineText,
  ),
  SummaryFieldDef(
    key: 'counsellor',
    label: 'Counselor',
    section: SummarySection.featuresAndDemographics,
    type: SummaryFieldType.inlineText,
  ),
  SummaryFieldDef(
    key: 'newCallFollowUp',
    label: 'New Call Follow Up',
    section: SummarySection.featuresAndDemographics,
    type: SummaryFieldType.inlineText,
  ),

  // Narrative sections (one multiline field each)
  SummaryFieldDef(
    key: 'sessionSummary',
    label: 'Session Summary',
    section: SummarySection.sessionSummary,
    type: SummaryFieldType.multilineText,
  ),
  SummaryFieldDef(
    key: 'counselingProcessFlow',
    label: 'Flow',
    section: SummarySection.flow,
    type: SummaryFieldType.multilineText,
  ),
  SummaryFieldDef(
    key: 'keyConcerns',
    label: 'Key Concerns',
    section: SummarySection.keyConcern,
    type: SummaryFieldType.multilineText,
  ),
  SummaryFieldDef(
    key: 'objectiveObservations',
    label: 'Objective Observations',
    section: SummarySection.objectiveObservations,
    type: SummaryFieldType.multilineText,
  ),
  SummaryFieldDef(
    key: 'subjectiveObservations',
    label: 'Subjective Observations',
    section: SummarySection.subjectiveObservations,
    type: SummaryFieldType.multilineText,
  ),
  SummaryFieldDef(
    key: 'assessment',
    label: 'Assessment',
    section: SummarySection.assessment,
    type: SummaryFieldType.multilineText,
  ),
  SummaryFieldDef(
    key: 'dominantFeelings',
    label: 'Dominant Feelings',
    section: SummarySection.dominantFeelings,
    type: SummaryFieldType.multilineText,
  ),
  SummaryFieldDef(
    key: 'issuesWorkedOn',
    label: 'Issues Worked On',
    section: SummarySection.issuesWorkedOn,
    type: SummaryFieldType.multilineText,
  ),
  SummaryFieldDef(
    key: 'keyTherapeuticTechniques',
    label: 'Key Therapeutic Techniques',
    section: SummarySection.keyTherapeuticTechniques,
    type: SummaryFieldType.multilineText,
  ),
  SummaryFieldDef(
    key: 'referralsProvided',
    label: 'Referrals Provided',
    section: SummarySection.referralsProvided,
    type: SummaryFieldType.multilineText,
  ),
  SummaryFieldDef(
    key: 'homework',
    label: 'Homework Recommended',
    section: SummarySection.homeworkRecommended,
    type: SummaryFieldType.multilineText,
  ),
  SummaryFieldDef(
    key: 'planForNextCall',
    label: 'Plans for Next Call',
    section: SummarySection.planForNextCall,
    type: SummaryFieldType.multilineText,
  ),
  SummaryFieldDef(
    key: 'tags',
    label: 'Tags (comma-separated)',
    section: SummarySection.tags,
    type: SummaryFieldType.multilineText,
  ),

  // Metrics (read-only)
  SummaryFieldDef(
    key: 'listeningShare',
    label: 'Listening Share',
    section: SummarySection.metrics,
    type: SummaryFieldType.text,
    editable: false,
  ),
  SummaryFieldDef(
    key: 'reflectiveQuestionsAsked',
    label: 'Reflective Questions Asked',
    section: SummarySection.metrics,
    type: SummaryFieldType.text,
    editable: false,
  ),
  SummaryFieldDef(
    key: 'emotionalLift',
    label: 'Emotional Lift',
    section: SummarySection.metrics,
    type: SummaryFieldType.text,
    editable: false,
  ),
  SummaryFieldDef(
    key: 'openEndedQuestionsAsked',
    label: 'Open Ended Questions Asked',
    section: SummarySection.metrics,
    type: SummaryFieldType.text,
    editable: false,
  ),

  // Intake
  SummaryFieldDef(
    key: 'intakeNotes',
    label: 'Intake Notes',
    section: SummarySection.intake,
    type: SummaryFieldType.inlineText,
  ),
  SummaryFieldDef(
    key: 'riskSelfHarm',
    label: 'Risk, Self Harm',
    section: SummarySection.intake,
    type: SummaryFieldType.dropdown,
    options: _yesNoOptions,
  ),
  SummaryFieldDef(
    key: 'riskSelfHarmNotes',
    label: 'Risk, Self Harm Notes',
    section: SummarySection.intake,
    type: SummaryFieldType.inlineText,
  ),
  SummaryFieldDef(
    key: 'riskSuicidalThoughts',
    label: 'Risk, Suicidal Thoughts',
    section: SummarySection.intake,
    type: SummaryFieldType.dropdown,
    options: _yesNoOptions,
  ),
  SummaryFieldDef(
    key: 'riskSuicidalThoughtsNotes',
    label: 'Risk, Suicidal Thoughts Notes',
    section: SummarySection.intake,
    type: SummaryFieldType.inlineText,
  ),
  SummaryFieldDef(
    key: 'riskSuicidalPlan',
    label: 'Risk, Suicidal Plan',
    section: SummarySection.intake,
    type: SummaryFieldType.dropdown,
    options: _yesNoOptions,
  ),
  SummaryFieldDef(
    key: 'riskSuicidalAction',
    label: 'Risk, Suicidal Action',
    section: SummarySection.intake,
    type: SummaryFieldType.dropdown,
    options: _yesNoOptions,
  ),
  SummaryFieldDef(
    key: 'riskRunningAway',
    label: 'Risk, Running Away',
    section: SummarySection.intake,
    type: SummaryFieldType.dropdown,
    options: _yesNoOptions,
  ),
  SummaryFieldDef(
    key: 'riskRunningAwayNotes',
    label: 'Risk, Running Away Notes',
    section: SummarySection.intake,
    type: SummaryFieldType.inlineText,
  ),
  SummaryFieldDef(
    key: 'traumaPhysicalAbuse',
    label: 'Trauma, Physical Abuse',
    section: SummarySection.intake,
    type: SummaryFieldType.dropdown,
    options: _yesNoOptions,
  ),
  SummaryFieldDef(
    key: 'traumaSexualAbuse',
    label: 'Trauma, Sexual Abuse',
    section: SummarySection.intake,
    type: SummaryFieldType.dropdown,
    options: _yesNoOptions,
  ),
  SummaryFieldDef(
    key: 'traumaVerbalAbuse',
    label: 'Trauma, Verbal Abuse',
    section: SummarySection.intake,
    type: SummaryFieldType.dropdown,
    options: _yesNoOptions,
  ),
  SummaryFieldDef(
    key: 'traumaNeglect',
    label: 'Trauma, Neglect',
    section: SummarySection.intake,
    type: SummaryFieldType.dropdown,
    options: _yesNoOptions,
  ),
  SummaryFieldDef(
    key: 'traumaSeparationFromCaregiverParent',
    label: 'Trauma, Separation from Caregiver/Parent',
    section: SummarySection.intake,
    type: SummaryFieldType.dropdown,
    options: _yesNoOptions,
  ),
  SummaryFieldDef(
    key: 'traumaWitnessedDomesticViolence',
    label: 'Trauma, Witnessed Domestic Violence',
    section: SummarySection.intake,
    type: SummaryFieldType.dropdown,
    options: _yesNoOptions,
  ),
  SummaryFieldDef(
    key: 'traumaNotes',
    label: 'Trauma Notes',
    section: SummarySection.intake,
    type: SummaryFieldType.inlineText,
  ),
  SummaryFieldDef(
    key: 'assessmentPsychologicalDiagnosis',
    label: 'Assessment, Psychological Diagnosis',
    section: SummarySection.intake,
    type: SummaryFieldType.dropdown,
    options: _yesNoOptions,
  ),
  SummaryFieldDef(
    key: 'assessmentPsychologicalDiagnosisNotes',
    label: 'Assessment, Psychological Diagnosis Notes',
    section: SummarySection.intake,
    type: SummaryFieldType.inlineText,
  ),
  SummaryFieldDef(
    key: 'assessmentUseOfPsychotropicMedications',
    label: 'Assessment, Use of Psychotropic Medications',
    section: SummarySection.intake,
    type: SummaryFieldType.dropdown,
    options: _yesNoOptions,
  ),
  SummaryFieldDef(
    key: 'assessmentUseOfPsychotropicMedicationsNotes',
    label: 'Assessment, Use of Psychotropic Medications Notes',
    section: SummarySection.intake,
    type: SummaryFieldType.inlineText,
  ),
  SummaryFieldDef(
    key: 'assessmentHallucinations',
    label: 'Assessment, Hallucinations',
    section: SummarySection.intake,
    type: SummaryFieldType.dropdown,
    options: _yesNoOptions,
  ),
  SummaryFieldDef(
    key: 'assessmentHallucinationsNotes',
    label: 'Assessment, Hallucinations Notes',
    section: SummarySection.intake,
    type: SummaryFieldType.inlineText,
  ),
  SummaryFieldDef(
    key: 'assessmentAffect',
    label: 'Assessment, Affect',
    section: SummarySection.intake,
    type: SummaryFieldType.dropdown,
    options: _assessmentAffectOptions,
  ),
  SummaryFieldDef(
    key: 'assessmentSpeech',
    label: 'Assessment, Speech',
    section: SummarySection.intake,
    type: SummaryFieldType.dropdown,
    options: _assessmentSpeechOptions,
  ),

  // Ongoing Risks
  SummaryFieldDef(
    key: 'ongoingRiskSelfHarm',
    label: 'Ongoing Risk, Self Harm',
    section: SummarySection.ongoingRisks,
    type: SummaryFieldType.dropdown,
    options: _yesNoOptions,
  ),
  SummaryFieldDef(
    key: 'ongoingRiskSelfHarmNotes',
    label: 'Ongoing Risk, Self Harm Notes',
    section: SummarySection.ongoingRisks,
    type: SummaryFieldType.inlineText,
  ),
  SummaryFieldDef(
    key: 'ongoingRiskSuicidalThoughts',
    label: 'Ongoing Risk, Suicidal Thoughts',
    section: SummarySection.ongoingRisks,
    type: SummaryFieldType.dropdown,
    options: _yesNoOptions,
  ),
  SummaryFieldDef(
    key: 'ongoingRiskSuicidalPlan',
    label: 'Ongoing Risk, Suicidal Plan',
    section: SummarySection.ongoingRisks,
    type: SummaryFieldType.dropdown,
    options: _yesNoOptions,
  ),
  SummaryFieldDef(
    key: 'ongoingRiskSuicidalAction',
    label: 'Ongoing Risk, Suicidal Action',
    section: SummarySection.ongoingRisks,
    type: SummaryFieldType.dropdown,
    options: _yesNoOptions,
  ),
  SummaryFieldDef(
    key: 'ongoingRiskSuicidalThoughtsNotes',
    label: 'Ongoing Risk, Suicidal Thoughts Notes',
    section: SummarySection.ongoingRisks,
    type: SummaryFieldType.inlineText,
  ),

  // Additional Notes (read-only — computed from callInfo.notes in RN)
  SummaryFieldDef(
    key: 'additionalNotes',
    label: 'Additional Notes',
    section: SummarySection.additionalNotes,
    type: SummaryFieldType.multilineText,
    editable: false,
  ),
];

/// RN `ALWAYS_VISIBLE_SECTIONS` (`constants/summary.ts`): shown regardless
/// of the tenant's `/settings/summary-fields` config.
const alwaysVisibleSummarySections = {SummarySection.additionalNotes};

/// RN `CallSummaryDetails.renderSection`: a section renders only when the
/// tenant's visible-field list names at least one of its built-in fields
/// (an empty or missing list hides it), except the always-visible ones.
bool isSummarySectionVisible(SummarySection section, List<String>? visibleFields) {
  if (alwaysVisibleSummarySections.contains(section)) return true;
  final visible = visibleFields ?? const <String>[];
  return summaryFieldDefs.any((f) => f.section == section && visible.contains(f.key));
}

/// RN `SectionWrapper.renderSection` / `VoiceNoteSection`'s field filter:
/// within a shown section, a field shows when the list is empty or names it
/// (always-visible sections show every field).
bool isSummaryFieldVisible(SummaryFieldDef field, List<String>? visibleFields) {
  if (alwaysVisibleSummarySections.contains(field.section)) return true;
  if (visibleFields == null || visibleFields.isEmpty) return true;
  return visibleFields.contains(field.key);
}
