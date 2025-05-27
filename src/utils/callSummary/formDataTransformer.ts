import {SUMMARY_FIELDS, SummaryFieldKey} from '@/constants/summary';
import {CallSummaryResponse} from '@/services/callSummaryApi';

export type FormData = {
  [key in SummaryFieldKey]?: string | null;
};

export const getInitialFormData = (): FormData => ({
  [SUMMARY_FIELDS.SESSION_SUMMARY]: null,
  [SUMMARY_FIELDS.FLOW]: null,
  [SUMMARY_FIELDS.KEY_CONCERNS]: null,
  [SUMMARY_FIELDS.OBJECTIVE_OBSERVATIONS]: null,
  [SUMMARY_FIELDS.SUBJECTIVE_OBSERVATIONS]: null,
  [SUMMARY_FIELDS.ASSESSMENT]: null,
  [SUMMARY_FIELDS.DOMINANT_FEELINGS]: null,
  [SUMMARY_FIELDS.ISSUES_WORKED_ON]: null,
  [SUMMARY_FIELDS.KEY_THERAPEUTIC_TECHNIQUES]: null,
  [SUMMARY_FIELDS.REFERRALS_PROVIDED]: null,
  [SUMMARY_FIELDS.HOMEWORK_RECOMMENDED]: null,
  [SUMMARY_FIELDS.PLANS_FOR_NEXT_CALL]: null,
  [SUMMARY_FIELDS.TAGS]: null,
});

export const transformSummaryToFormData = (
  summary: CallSummaryResponse['details']['summary'],
): FormData => ({
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
  [SUMMARY_FIELDS.PLANS_FOR_NEXT_CALL]: summary.planForNextCall || null,
  [SUMMARY_FIELDS.TAGS]: summary.tags || null,
});

export const transformFormDataForSubmission = (
  formData: FormData,
  summaryData: CallSummaryResponse,
): CallSummaryResponse['details']['summary'] => {
  return {
    ...summaryData?.details?.summary,
    [SUMMARY_FIELDS.SESSION_SUMMARY]:
      formData[SUMMARY_FIELDS.SESSION_SUMMARY] || null,
    [SUMMARY_FIELDS.FLOW]: formData[SUMMARY_FIELDS.FLOW] || null,
    [SUMMARY_FIELDS.KEY_CONCERNS]:
      formData[SUMMARY_FIELDS.KEY_CONCERNS] || null,
    [SUMMARY_FIELDS.OBJECTIVE_OBSERVATIONS]:
      formData[SUMMARY_FIELDS.OBJECTIVE_OBSERVATIONS] || null,
    [SUMMARY_FIELDS.SUBJECTIVE_OBSERVATIONS]:
      formData[SUMMARY_FIELDS.SUBJECTIVE_OBSERVATIONS] || null,
    [SUMMARY_FIELDS.ASSESSMENT]: formData[SUMMARY_FIELDS.ASSESSMENT] || null,
    [SUMMARY_FIELDS.DOMINANT_FEELINGS]:
      formData[SUMMARY_FIELDS.DOMINANT_FEELINGS] || null,
    [SUMMARY_FIELDS.ISSUES_WORKED_ON]:
      formData[SUMMARY_FIELDS.ISSUES_WORKED_ON] || null,
    [SUMMARY_FIELDS.KEY_THERAPEUTIC_TECHNIQUES]:
      formData[SUMMARY_FIELDS.KEY_THERAPEUTIC_TECHNIQUES] || null,
    [SUMMARY_FIELDS.REFERRALS_PROVIDED]:
      formData[SUMMARY_FIELDS.REFERRALS_PROVIDED] || null,
    [SUMMARY_FIELDS.HOMEWORK_RECOMMENDED]:
      formData[SUMMARY_FIELDS.HOMEWORK_RECOMMENDED] || null,
    [SUMMARY_FIELDS.PLANS_FOR_NEXT_CALL]:
      formData[SUMMARY_FIELDS.PLANS_FOR_NEXT_CALL] || null,
    [SUMMARY_FIELDS.TAGS]: formData[SUMMARY_FIELDS.TAGS] || null,
  };
};
