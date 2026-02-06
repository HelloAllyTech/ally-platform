import {SUMMARY_FIELDS} from '@/constants/summary';
import {CallSummaryResponse, Tag} from '@/services/callSummaryApi';
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

export const transformFormDataForSubmission = (
  formData: SummaryFormData | null,
  summaryData: CallSummaryResponse,
  tags: Tag[],
): CallSummaryResponse['details']['summary'] => {
  return {
    ...summaryData?.details?.summary,
    [SUMMARY_FIELDS.AGE]: formData?.[SUMMARY_FIELDS.AGE] ?? null,
    [SUMMARY_FIELDS.GENDER]: formData?.[SUMMARY_FIELDS.GENDER] ?? null,
    [SUMMARY_FIELDS.PROFESSION]: formData?.[SUMMARY_FIELDS.PROFESSION] ?? null,
    [SUMMARY_FIELDS.CONCERN_CODE]:
      formData?.[SUMMARY_FIELDS.CONCERN_CODE] ?? null,
    [SUMMARY_FIELDS.RELATIONSHIP_STATUS]:
      formData?.[SUMMARY_FIELDS.RELATIONSHIP_STATUS] ?? null,
    [SUMMARY_FIELDS.LOCATION]: formData?.[SUMMARY_FIELDS.LOCATION] ?? null,
    [SUMMARY_FIELDS.SESSION_SUMMARY]:
      formData?.[SUMMARY_FIELDS.SESSION_SUMMARY] ?? null,
    [SUMMARY_FIELDS.FLOW]: formData?.[SUMMARY_FIELDS.FLOW] ?? null,
    [SUMMARY_FIELDS.KEY_CONCERNS]:
      formData?.[SUMMARY_FIELDS.KEY_CONCERNS] ?? null,
    [SUMMARY_FIELDS.OBJECTIVE_OBSERVATIONS]:
      formData?.[SUMMARY_FIELDS.OBJECTIVE_OBSERVATIONS] ?? null,
    [SUMMARY_FIELDS.SUBJECTIVE_OBSERVATIONS]:
      formData?.[SUMMARY_FIELDS.SUBJECTIVE_OBSERVATIONS] ?? null,
    [SUMMARY_FIELDS.ASSESSMENT]: formData?.[SUMMARY_FIELDS.ASSESSMENT] ?? null,
    [SUMMARY_FIELDS.DOMINANT_FEELINGS]:
      formData?.[SUMMARY_FIELDS.DOMINANT_FEELINGS] ?? null,
    [SUMMARY_FIELDS.ISSUES_WORKED_ON]:
      formData?.[SUMMARY_FIELDS.ISSUES_WORKED_ON] ?? null,
    [SUMMARY_FIELDS.KEY_THERAPEUTIC_TECHNIQUES]:
      formData?.[SUMMARY_FIELDS.KEY_THERAPEUTIC_TECHNIQUES] ?? null,
    [SUMMARY_FIELDS.REFERRALS_PROVIDED]:
      formData?.[SUMMARY_FIELDS.REFERRALS_PROVIDED] ?? null,
    [SUMMARY_FIELDS.HOMEWORK_RECOMMENDED]:
      formData?.[SUMMARY_FIELDS.HOMEWORK_RECOMMENDED] ?? null,
    [SUMMARY_FIELDS.PLAN_FOR_NEXT_CALL]:
      formData?.[SUMMARY_FIELDS.PLAN_FOR_NEXT_CALL] ?? null,
    [SUMMARY_FIELDS.TAGS]: tags,
    [SUMMARY_FIELDS.ADDITIONAL_NOTES]:
      formData?.[SUMMARY_FIELDS.ADDITIONAL_NOTES] ?? null,

    // Intake section
    [SUMMARY_FIELDS.INTAKE_NOTES]:
      formData?.[SUMMARY_FIELDS.INTAKE_NOTES] ?? null,
    [SUMMARY_FIELDS.RISK_SELF_HARM]:
      formData?.[SUMMARY_FIELDS.RISK_SELF_HARM] ?? null,
    [SUMMARY_FIELDS.RISK_SELF_HARM_NOTES]:
      formData?.[SUMMARY_FIELDS.RISK_SELF_HARM_NOTES] ?? null,
    [SUMMARY_FIELDS.RISK_SUICIDAL_THOUGHTS]:
      formData?.[SUMMARY_FIELDS.RISK_SUICIDAL_THOUGHTS] ?? null,
    [SUMMARY_FIELDS.RISK_SUICIDAL_THOUGHTS_NOTES]:
      formData?.[SUMMARY_FIELDS.RISK_SUICIDAL_THOUGHTS_NOTES] ?? null,
    [SUMMARY_FIELDS.RISK_SUICIDAL_PLAN]:
      formData?.[SUMMARY_FIELDS.RISK_SUICIDAL_PLAN] ?? null,
    [SUMMARY_FIELDS.RISK_SUICIDAL_ACTION]:
      formData?.[SUMMARY_FIELDS.RISK_SUICIDAL_ACTION] ?? null,
    [SUMMARY_FIELDS.RISK_RUNNING_AWAY]:
      formData?.[SUMMARY_FIELDS.RISK_RUNNING_AWAY] ?? null,
    [SUMMARY_FIELDS.RISK_RUNNING_AWAY_NOTES]:
      formData?.[SUMMARY_FIELDS.RISK_RUNNING_AWAY_NOTES] ?? null,
    [SUMMARY_FIELDS.TRAUMA_PHYSICAL_ABUSE]:
      formData?.[SUMMARY_FIELDS.TRAUMA_PHYSICAL_ABUSE] ?? null,
    [SUMMARY_FIELDS.TRAUMA_SEXUAL_ABUSE]:
      formData?.[SUMMARY_FIELDS.TRAUMA_SEXUAL_ABUSE] ?? null,
    [SUMMARY_FIELDS.TRAUMA_VERBAL_ABUSE]:
      formData?.[SUMMARY_FIELDS.TRAUMA_VERBAL_ABUSE] ?? null,
    [SUMMARY_FIELDS.TRAUMA_NEGLECT]:
      formData?.[SUMMARY_FIELDS.TRAUMA_NEGLECT] ?? null,
    [SUMMARY_FIELDS.TRAUMA_SEPARATION_FROM_CAREGIVER_PARENT]:
      formData?.[SUMMARY_FIELDS.TRAUMA_SEPARATION_FROM_CAREGIVER_PARENT] ??
      null,
    [SUMMARY_FIELDS.TRAUMA_WITNESSED_DOMESTIC_VIOLENCE]:
      formData?.[SUMMARY_FIELDS.TRAUMA_WITNESSED_DOMESTIC_VIOLENCE] ?? null,
    [SUMMARY_FIELDS.TRAUMA_NOTES]:
      formData?.[SUMMARY_FIELDS.TRAUMA_NOTES] ?? null,
    [SUMMARY_FIELDS.ASSESSMENT_PSYCHOLOGICAL_DIAGNOSIS]:
      formData?.[SUMMARY_FIELDS.ASSESSMENT_PSYCHOLOGICAL_DIAGNOSIS] ?? null,
    [SUMMARY_FIELDS.ASSESSMENT_PSYCHOLOGICAL_DIAGNOSIS_NOTES]:
      formData?.[SUMMARY_FIELDS.ASSESSMENT_PSYCHOLOGICAL_DIAGNOSIS_NOTES] ??
      null,
    [SUMMARY_FIELDS.ASSESSMENT_USE_OF_PSYCHOTROPIC_MEDICATIONS]:
      formData?.[SUMMARY_FIELDS.ASSESSMENT_USE_OF_PSYCHOTROPIC_MEDICATIONS] ??
      null,
    [SUMMARY_FIELDS.ASSESSMENT_USE_OF_PSYCHOTROPIC_MEDICATIONS_NOTES]:
      formData?.[
        SUMMARY_FIELDS.ASSESSMENT_USE_OF_PSYCHOTROPIC_MEDICATIONS_NOTES
      ] ?? null,
    [SUMMARY_FIELDS.ASSESSMENT_HALLUCINATIONS]:
      formData?.[SUMMARY_FIELDS.ASSESSMENT_HALLUCINATIONS] ?? null,
    [SUMMARY_FIELDS.ASSESSMENT_HALLUCINATIONS_NOTES]:
      formData?.[SUMMARY_FIELDS.ASSESSMENT_HALLUCINATIONS_NOTES] ?? null,
    [SUMMARY_FIELDS.ASSESSMENT_AFFECT]:
      formData?.[SUMMARY_FIELDS.ASSESSMENT_AFFECT] ?? null,
    [SUMMARY_FIELDS.ASSESSMENT_SPEECH]:
      formData?.[SUMMARY_FIELDS.ASSESSMENT_SPEECH] ?? null,

    // Ongoing Risks section
    [SUMMARY_FIELDS.ONGOING_RISK_SELF_HARM]:
      formData?.[SUMMARY_FIELDS.ONGOING_RISK_SELF_HARM] ?? null,
    [SUMMARY_FIELDS.ONGOING_RISK_SELF_HARM_NOTES]:
      formData?.[SUMMARY_FIELDS.ONGOING_RISK_SELF_HARM_NOTES] ?? null,
    [SUMMARY_FIELDS.ONGOING_RISK_SUICIDAL_THOUGHTS]:
      formData?.[SUMMARY_FIELDS.ONGOING_RISK_SUICIDAL_THOUGHTS] ?? null,
    [SUMMARY_FIELDS.ONGOING_RISK_SUICIDAL_PLAN]:
      formData?.[SUMMARY_FIELDS.ONGOING_RISK_SUICIDAL_PLAN] ?? null,
    [SUMMARY_FIELDS.ONGOING_RISK_SUICIDAL_ACTION]:
      formData?.[SUMMARY_FIELDS.ONGOING_RISK_SUICIDAL_ACTION] ?? null,
    [SUMMARY_FIELDS.ONGOING_RISK_SUICIDAL_THOUGHTS_NOTES]:
      formData?.[SUMMARY_FIELDS.ONGOING_RISK_SUICIDAL_THOUGHTS_NOTES] ?? null,
  };
};
