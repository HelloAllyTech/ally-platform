import {SUMMARY_FIELDS, SummaryFieldKey} from '@/constants/summary';
import {CallSummaryResponse} from '@/services/callSummaryApi';
import {SummaryFormData} from '@/types';
import {mapTagsToString} from '@/utils/callSummary';

export const transformSummaryToFormData = (
  summary: CallSummaryResponse['details']['summary'],
  callInfo?: CallSummaryResponse['details']['callInfo'],
): SummaryFormData => ({
  [SUMMARY_FIELDS.SESSION_SUMMARY]: summary.sessionSummary || null,
  [SUMMARY_FIELDS.FLOW]: summary.counselingProcessFlow || null,
  [SUMMARY_FIELDS.KEY_CONCERNS]: summary.keyConcerns || null,
  [SUMMARY_FIELDS.OBJECTIVE_OBSERVATIONS]:
    summary.objectiveObservations || null,
  [SUMMARY_FIELDS.SUBJECTIVE_OBSERVATIONS]:
    summary.subjectiveObservations || null,
  [SUMMARY_FIELDS.ASSESSMENT]: summary.assessment || null,
  [SUMMARY_FIELDS.DOMINANT_FEELINGS]: Array.isArray(summary.dominantFeelings)
    ? summary.dominantFeelings.join(', ')
    : summary.dominantFeelings || null,
  [SUMMARY_FIELDS.ISSUES_WORKED_ON]: summary.issuesWorkedOn || null,
  [SUMMARY_FIELDS.KEY_THERAPEUTIC_TECHNIQUES]:
    summary.keyTherapeuticTechniques || null,
  [SUMMARY_FIELDS.REFERRALS_PROVIDED]: summary.referralsProvided || null,
  [SUMMARY_FIELDS.HOMEWORK_RECOMMENDED]: summary.homework || null,
  [SUMMARY_FIELDS.PLAN_FOR_NEXT_CALL]: summary.planForNextCall || null,
  [SUMMARY_FIELDS.TAGS]: mapTagsToString(summary?.tags || []) || null,
  [SUMMARY_FIELDS.AGE]: summary.age || null,
  [SUMMARY_FIELDS.GENDER]: summary.gender || null,
  [SUMMARY_FIELDS.PROFESSION]: summary.profession || null,
  [SUMMARY_FIELDS.RELATIONSHIP_STATUS]: summary.relationshipStatus || null,
  [SUMMARY_FIELDS.LOCATION]: summary.location || null,
  [SUMMARY_FIELDS.CONCERN_CODE]: summary.codeOfConcern || null,
  [SUMMARY_FIELDS.COUNSELLOR]: summary.counsellor || null,
  [SUMMARY_FIELDS.NEW_CALL_FOLLOW_UP]: summary.newCallFollowUp || null,
  [SUMMARY_FIELDS.ADDITIONAL_NOTES]: callInfo?.notes || null,

  // Intake section
  [SUMMARY_FIELDS.INTAKE_NOTES]: summary.intakeNotes || null,
  [SUMMARY_FIELDS.RISK_SELF_HARM]: summary.riskSelfHarm || null,
  [SUMMARY_FIELDS.RISK_SELF_HARM_NOTES]: summary.riskSelfHarmNotes || null,
  [SUMMARY_FIELDS.RISK_SUICIDAL_THOUGHTS]: summary.riskSuicidalThoughts || null,
  [SUMMARY_FIELDS.RISK_SUICIDAL_THOUGHTS_NOTES]:
    summary.riskSuicidalThoughtsNotes || null,
  [SUMMARY_FIELDS.RISK_SUICIDAL_PLAN]: summary.riskSuicidalPlan || null,
  [SUMMARY_FIELDS.RISK_SUICIDAL_ACTION]: summary.riskSuicidalAction || null,
  [SUMMARY_FIELDS.RISK_RUNNING_AWAY]: summary.riskRunningAway || null,
  [SUMMARY_FIELDS.RISK_RUNNING_AWAY_NOTES]:
    summary.riskRunningAwayNotes || null,
  [SUMMARY_FIELDS.TRAUMA_PHYSICAL_ABUSE]: summary.traumaPhysicalAbuse || null,
  [SUMMARY_FIELDS.TRAUMA_SEXUAL_ABUSE]: summary.traumaSexualAbuse || null,
  [SUMMARY_FIELDS.TRAUMA_VERBAL_ABUSE]: summary.traumaVerbalAbuse || null,
  [SUMMARY_FIELDS.TRAUMA_NEGLECT]: summary.traumaNeglect || null,
  [SUMMARY_FIELDS.TRAUMA_SEPARATION_FROM_CAREGIVER_PARENT]:
    summary.traumaSeparationFromCaregiverParent || null,
  [SUMMARY_FIELDS.TRAUMA_WITNESSED_DOMESTIC_VIOLENCE]:
    summary.traumaWitnessedDomesticViolence || null,
  [SUMMARY_FIELDS.TRAUMA_NOTES]: summary.traumaNotes || null,
  [SUMMARY_FIELDS.ASSESSMENT_PSYCHOLOGICAL_DIAGNOSIS]:
    summary.assessmentPsychologicalDiagnosis || null,
  [SUMMARY_FIELDS.ASSESSMENT_PSYCHOLOGICAL_DIAGNOSIS_NOTES]:
    summary.assessmentPsychologicalDiagnosisNotes || null,
  [SUMMARY_FIELDS.ASSESSMENT_USE_OF_PSYCHOTROPIC_MEDICATIONS]:
    summary.assessmentUseOfPsychotropicMedications || null,
  [SUMMARY_FIELDS.ASSESSMENT_USE_OF_PSYCHOTROPIC_MEDICATIONS_NOTES]:
    summary.assessmentUseOfPsychotropicMedicationsNotes || null,
  [SUMMARY_FIELDS.ASSESSMENT_HALLUCINATIONS]:
    summary.assessmentHallucinations || null,
  [SUMMARY_FIELDS.ASSESSMENT_HALLUCINATIONS_NOTES]:
    summary.assessmentHallucinationsNotes || null,
  [SUMMARY_FIELDS.ASSESSMENT_AFFECT]: summary.assessmentAffect || null,
  [SUMMARY_FIELDS.ASSESSMENT_SPEECH]: summary.assessmentSpeech || null,

  // Ongoing Risks section
  [SUMMARY_FIELDS.ONGOING_RISK_SELF_HARM]: summary.ongoingRiskSelfHarm || null,
  [SUMMARY_FIELDS.ONGOING_RISK_SELF_HARM_NOTES]:
    summary.ongoingRiskSelfHarmNotes || null,
  [SUMMARY_FIELDS.ONGOING_RISK_SUICIDAL_THOUGHTS]:
    summary.ongoingRiskSuicidalThoughts || null,
  [SUMMARY_FIELDS.ONGOING_RISK_SUICIDAL_PLAN]:
    summary.ongoingRiskSuicidalPlan || null,
  [SUMMARY_FIELDS.ONGOING_RISK_SUICIDAL_ACTION]:
    summary.ongoingRiskSuicidalAction || null,
  [SUMMARY_FIELDS.ONGOING_RISK_SUICIDAL_THOUGHTS_NOTES]:
    summary.ongoingRiskSuicidalThoughtsNotes || null,
});

export type SummaryPatch = Partial<CallSummaryResponse['details']['summary']>;

/**
 * Which form fields the counsellor actually changed, by comparing the current
 * form against the baseline captured when it was seeded.
 *
 * The baseline is the right thing to diff against — NOT the live server copy.
 * A server value can drift for reasons that have nothing to do with this user
 * (an async AI fill, another editor, a regeneration landing), and diffing
 * against it would count that drift as a local edit and write the stale seeded
 * value back over it.
 */
export const getChangedSummaryFieldKeys = (
  baseline: SummaryFormData | null,
  current: SummaryFormData | null,
): SummaryFieldKey[] => {
  if (!baseline || !current) return [];
  return (Object.keys(current) as SummaryFieldKey[]).filter(
    key => baseline[key] !== current[key],
  );
};

/**
 * Build the summary patch to send: only the fields named in `changedKeys`.
 *
 * This used to spread the whole stored summary and write every field back,
 * which meant a save reverted anything added after the form was seeded — an
 * AI-filled field, or a regeneration that landed while the counsellor was
 * typing. The backend merges a patch key-wise, so an omitted key keeps its
 * stored value; a key present with null is cleared.
 */
export const transformFormDataForSubmission = (
  formData: SummaryFormData | null,
  changedKeys: readonly SummaryFieldKey[],
  tagNames?: string[],
): SummaryPatch => {
  const patch: Record<string, unknown> = {};
  for (const key of changedKeys) {
    if (key === SUMMARY_FIELDS.TAGS) {
      // The field holds comma-separated text; the API takes tag names and keeps
      // whatever rating each tag already had.
      if (tagNames) patch[SUMMARY_FIELDS.TAGS] = tagNames;
      continue;
    }
    patch[key] = formData?.[key] ?? null;
  }
  return patch as SummaryPatch;
};
